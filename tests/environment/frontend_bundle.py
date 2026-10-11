#!/usr/bin/env python3
"""Prepare, verify, and restore a platform-specific offline frontend node_modules bundle.

Normal builds never download npm dependencies. `--prepare` is an explicit, online-capable
maintenance command which runs npm ci and a real production build before archiving modules.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

SCRIPT = Path(__file__).resolve()
DEFAULT_ROOT = SCRIPT.parents[2]
BUNDLE_DIR_REL = Path('tests/toolchain-cache/frontend-deps')
MANIFEST_NAME = 'manifest.json'
SCHEMA_VERSION = 1


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def json_read(path: Path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception as exc:
        raise RuntimeError(f'无法读取有效 JSON：{path}（{exc}）') from exc


def run(cmd: list[str], cwd: Path, timeout: int = 1800, env=None):
    print('+ ' + ' '.join(cmd), flush=True)
    try:
        return subprocess.run(cmd, cwd=cwd, env=env, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f'命令超过 {timeout} 秒超时：{cmd[0]}') from exc
    except OSError as exc:
        raise RuntimeError(f'无法启动命令 {cmd[0]}：{exc}') from exc


def node_info(root: Path) -> dict:
    node = shutil.which('node')
    if not node:
        raise RuntimeError('PATH 中找不到 Node.js。需要 Node.js 22+。')
    p = subprocess.run([node, '-p', 'JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})'], cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
    if p.returncode != 0:
        raise RuntimeError('无法读取 Node.js 运行时信息：' + p.stderr.strip())
    info = json.loads(p.stdout)
    parts = [int(x) for x in info['version'].split('.')[:3]]
    parts += [0] * (3 - len(parts))
    if tuple(parts) < (22, 12, 0):
        raise RuntimeError(f'当前锁定的 Vite 要求 Node.js >=22.12.0，当前为 {info["version"]}')
    return info


def package_info(root: Path):
    package_path, lock_path = root / 'package.json', root / 'package-lock.json'
    if not package_path.is_file() or not lock_path.is_file():
        raise RuntimeError('必须同时存在 package.json 与 package-lock.json，才能建立可复现的依赖包。')
    package, lock = json_read(package_path), json_read(lock_path)
    declared = {**(package.get('dependencies') or {}), **(package.get('devDependencies') or {}), **(package.get('optionalDependencies') or {})}
    if 'vite' not in declared:
        raise RuntimeError('package.json 没有声明 Vite，拒绝建立前端依赖包。')
    locked_vite = (lock.get('packages') or {}).get('node_modules/vite', {}).get('version')
    if not locked_vite:
        raise RuntimeError('package-lock.json 没有锁定 node_modules/vite 的具体版本。')
    return package, lock, locked_vite


def check_direct_dependencies(root: Path, lock: dict, expected_vite: str | None = None) -> dict:
    package, _, locked_vite = package_info(root)
    nm = root / 'node_modules'
    if not nm.is_dir():
        raise RuntimeError('node_modules 不存在。')
    deps = {**(package.get('dependencies') or {}), **(package.get('devDependencies') or {}), **(package.get('optionalDependencies') or {})}
    missing, mismatched = [], []
    for name in deps:
        package_path = nm.joinpath(*name.split('/')) / 'package.json'
        # Scoped packages have two path components; unscoped packages have one.
        if not package_path.is_file():
            missing.append(name)
            continue
        try:
            installed = json.loads(package_path.read_text(encoding='utf-8')).get('version')
        except Exception:
            installed = None
        lock_entry = (lock.get('packages') or {}).get('node_modules/' + name, {})
        expected = lock_entry.get('version')
        if expected and installed != expected:
            mismatched.append(f'{name}: expected {expected}, got {installed}')
    vite_path = nm / 'vite' / 'package.json'
    actual_vite = json_read(vite_path).get('version') if vite_path.is_file() else None
    target_vite = expected_vite or locked_vite
    if actual_vite != target_vite:
        mismatched.append(f'vite: expected {target_vite}, got {actual_vite}')
    if missing or mismatched:
        parts = []
        if missing: parts.append('缺失直接依赖：' + ', '.join(missing))
        if mismatched: parts.append('版本不匹配：' + '; '.join(mismatched))
        raise RuntimeError('node_modules 校验失败；' + '；'.join(parts))
    return {'viteVersion': actual_vite, 'directDependencyCount': len(deps)}


def manifest_path(root: Path) -> Path:
    return root / BUNDLE_DIR_REL / MANIFEST_NAME


def load_and_verify_manifest(root: Path, check_platform: bool = True) -> dict:
    mp = manifest_path(root)
    if not mp.is_file():
        raise RuntimeError(
            f'没有预置前端依赖包：{mp.relative_to(root)}。当前构建不会临时联网下载。'
            '请在可访问 npm registry 的准备环境中明确执行 '
            '`python tests/environment/frontend_bundle.py --prepare`，再交付/复制生成的归档和 manifest。'
        )
    manifest = json_read(mp)
    if manifest.get('schemaVersion') != SCHEMA_VERSION:
        raise RuntimeError(f'依赖包 manifest 版本不受支持：{manifest.get("schemaVersion")}')
    package_path, lock_path = root / 'package.json', root / 'package-lock.json'
    if manifest.get('packageJsonSha256') != sha256_file(package_path):
        raise RuntimeError('预置依赖包与当前 package.json 不匹配；需要重新准备依赖包。')
    if manifest.get('packageLockSha256') != sha256_file(lock_path):
        raise RuntimeError('预置依赖包与当前 package-lock.json 不匹配；需要重新准备依赖包。')
    info = node_info(root)
    expected_runtime = manifest.get('runtime', {})
    if check_platform and (info['platform'] != expected_runtime.get('platform') or info['arch'] != expected_runtime.get('architecture')):
        raise RuntimeError(
            '预置 node_modules 平台不匹配：依赖包为 '
            f'{expected_runtime.get("platform")}/{expected_runtime.get("architecture")}，当前为 {info["platform"]}/{info["arch"]}。'
            '原生/可选依赖必须在匹配平台单独准备。'
        )
    if check_platform and int(info['version'].split('.')[0]) != int(expected_runtime.get('nodeMajor', -1)):
        raise RuntimeError(f'预置依赖包要求 Node.js 主版本 {expected_runtime.get("nodeMajor")}，当前为 {info["version"]}。')
    archive_rel = manifest.get('archivePath')
    if not archive_rel:
        raise RuntimeError('依赖包 manifest 未记录 archivePath。')
    archive_rel_path = Path(archive_rel)
    if archive_rel_path.is_absolute() or '..' in archive_rel_path.parts:
        raise RuntimeError('依赖包 manifest 的 archivePath 包含不安全路径。')
    archive = root / archive_rel_path
    try:
        archive.resolve().relative_to((root / BUNDLE_DIR_REL).resolve())
    except ValueError as exc:
        raise RuntimeError('依赖归档必须位于 tests/toolchain-cache/frontend-deps/ 内。') from exc
    if not archive.is_file():
        raise RuntimeError(f'依赖包归档不存在：{archive_rel}')
    actual_hash = sha256_file(archive)
    if actual_hash != manifest.get('archiveSha256'):
        raise RuntimeError(f'依赖包归档 SHA-256 不匹配：{archive_rel}')
    if archive.stat().st_size != manifest.get('archiveBytes'):
        raise RuntimeError(f'依赖包归档大小与 manifest 不一致：{archive_rel}')
    _, lock, locked_vite = package_info(root)
    if manifest.get('viteVersion') != locked_vite:
        raise RuntimeError('manifest 中的 Vite 版本与当前 package-lock.json 不一致。')
    return manifest


def _validate_tar_members(tar: tarfile.TarFile):
    members = tar.getmembers()
    for member in members:
        pure = PurePosixPath(member.name)
        if pure.is_absolute() or '..' in pure.parts or not pure.parts or pure.parts[0] != 'node_modules':
            raise RuntimeError(f'依赖归档包含不安全路径：{member.name}')
        if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
            raise RuntimeError(f'依赖归档包含不允许的特殊文件：{member.name}')
        if member.issym() or member.islnk():
            target = PurePosixPath(member.linkname)
            if target.is_absolute():
                raise RuntimeError(f'依赖归档包含绝对链接：{member.name} -> {member.linkname}')
            resolved = pure.parent.joinpath(target)
            normalized = []
            for part in resolved.parts:
                if part in ('', '.'): continue
                if part == '..':
                    if not normalized:
                        raise RuntimeError(f'依赖归档链接越界：{member.name} -> {member.linkname}')
                    normalized.pop()
                else: normalized.append(part)
            if not normalized or normalized[0] != 'node_modules':
                raise RuntimeError(f'依赖归档链接指向 node_modules 之外：{member.name} -> {member.linkname}')
    return members


def restore(root: Path):
    manifest = load_and_verify_manifest(root)
    info = node_info(root)
    _, lock, locked_vite = package_info(root)
    archive = root / manifest['archivePath']
    backup = None
    with tempfile.TemporaryDirectory(prefix='mybox-frontend-restore-', dir=str(root)) as td:
        temp_root = Path(td)
        try:
            with tarfile.open(archive, 'r:gz') as tar:
                members = _validate_tar_members(tar)
                if sys.version_info >= (3, 12):
                    tar.extractall(temp_root, members=members, filter='data')
                else:
                    tar.extractall(temp_root, members=members)
        except (tarfile.TarError, OSError) as exc:
            raise RuntimeError(f'无法解压预置依赖包：{exc}') from exc
        restored_nm = temp_root / 'node_modules'
        check_direct_dependencies_from_tree(restored_nm, root, lock, locked_vite)
        # Only swap after the extracted bundle has passed package/version checks.
        destination = root / 'node_modules'
        if destination.exists():
            backup = root / f'.node_modules-backup-{int(time.time())}-{os.getpid()}'
            destination.rename(backup)
        try:
            restored_nm.rename(destination)
            check_direct_dependencies(root, lock, locked_vite)
        except Exception:
            if destination.exists(): shutil.rmtree(destination, ignore_errors=True)
            if backup and backup.exists(): backup.rename(destination)
            raise
        if backup and backup.exists(): shutil.rmtree(backup, ignore_errors=True)
    print(f'PASS: 已从预置依赖包恢复 node_modules（Vite {manifest["viteVersion"]}，Node {info["version"]}，{info["platform"]}/{info["arch"]}）。')
    return 0


def check_direct_dependencies_from_tree(nm: Path, root: Path, lock: dict, locked_vite: str):
    package = json_read(root / 'package.json')
    deps = {**(package.get('dependencies') or {}), **(package.get('devDependencies') or {}), **(package.get('optionalDependencies') or {})}
    missing, mismatched = [], []
    for name in deps:
        p = nm.joinpath(*name.split('/')) / 'package.json'
        if not p.is_file():
            missing.append(name); continue
        installed = json_read(p).get('version')
        expected = (lock.get('packages') or {}).get('node_modules/' + name, {}).get('version')
        if expected and installed != expected:
            mismatched.append(f'{name}: expected {expected}, got {installed}')
    vp = nm / 'vite' / 'package.json'
    av = json_read(vp).get('version') if vp.is_file() else None
    if av != locked_vite: mismatched.append(f'vite: expected {locked_vite}, got {av}')
    if missing or mismatched:
        raise RuntimeError('恢复后的 node_modules 不完整：' + '; '.join((['缺失：' + ', '.join(missing)] if missing else []) + (['版本不匹配：' + ', '.join(mismatched)] if mismatched else [])))


def prepare(root: Path, timeout: int):
    package, lock, locked_vite = package_info(root)
    info = node_info(root)
    npm = shutil.which('npm')
    if not npm:
        raise RuntimeError('PATH 中找不到 npm。需要在有 npm 的环境准备预置依赖包。')
    print('准备动作是显式的依赖维护操作，可能访问 npm registry；常规 build 不会执行该下载。')
    run([npm, 'ci', '--no-audit', '--no-fund'], root, timeout=timeout)
    nm_info = check_direct_dependencies(root, lock, locked_vite)
    run([npm, 'run', 'build'], root, timeout=timeout)
    if not (root / 'dist' / 'index.html').is_file():
        raise RuntimeError('npm run build 返回成功，但 dist/index.html 不存在，拒绝打包 node_modules。')
    bundle_dir = root / BUNDLE_DIR_REL
    bundle_dir.mkdir(parents=True, exist_ok=True)
    lock_hash = sha256_file(root / 'package-lock.json')[:16]
    name = f'frontend-node{info["version"]}-{info["platform"]}-{info["arch"]}-{lock_hash}.tar.gz'
    archive = bundle_dir / name
    temp_archive = bundle_dir / (name + '.tmp')
    try:
        with tarfile.open(temp_archive, 'w:gz', compresslevel=6, format=tarfile.PAX_FORMAT) as tar:
            tar.add(root / 'node_modules', arcname='node_modules', recursive=True)
        temp_archive.replace(archive)
    except Exception:
        temp_archive.unlink(missing_ok=True)
        raise
    manifest = {
        'schemaVersion': SCHEMA_VERSION,
        'generatedAtUtc': datetime.now(timezone.utc).isoformat(),
        'archivePath': str(archive.relative_to(root)).replace('\\', '/'),
        'archiveSha256': sha256_file(archive),
        'archiveBytes': archive.stat().st_size,
        'packageJsonSha256': sha256_file(root / 'package.json'),
        'packageLockSha256': sha256_file(root / 'package-lock.json'),
        'runtime': {'nodeVersion': info['version'], 'nodeMajor': int(info['version'].split('.')[0]), 'platform': info['platform'], 'architecture': info['arch'], 'pythonVersion': platform.python_version()},
        'viteVersion': nm_info['viteVersion'],
        'directDependencyCount': nm_info['directDependencyCount'],
        'validatedBuild': True,
        'purpose': 'offline-recoverable frontend node_modules; platform-specific; not an Android runtime dependency'
    }
    manifest_path(root).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    # Read it back and validate its hashes before claiming preparation succeeded.
    load_and_verify_manifest(root)
    print(f'PASS: 已建立预置依赖包：{archive.relative_to(root)} ({archive.stat().st_size:,} bytes)')
    print(f'PASS: manifest：{manifest_path(root).relative_to(root)}')
    return 0


def main():
    p = argparse.ArgumentParser(description='MyBox frontend offline dependency bundle manager; normal builds do not download dependencies.')
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument('--prepare', action='store_true', help='显式联网/缓存安装依赖，验证正式构建并生成 node_modules 归档')
    g.add_argument('--restore', action='store_true', help='从已验证的本地归档恢复 node_modules，不联网')
    g.add_argument('--verify', action='store_true', help='核验依赖包 manifest、文件哈希和当前平台')
    g.add_argument('--check-installed', action='store_true', help='检查当前 node_modules 的直接依赖与锁文件版本')
    p.add_argument('--root', default=str(DEFAULT_ROOT), help='项目根目录')
    p.add_argument('--timeout', type=int, default=1800, help='显式 --prepare 的命令超时（秒）')
    args = p.parse_args()
    root = Path(args.root).resolve()
    try:
        if args.prepare: return prepare(root, args.timeout)
        if args.restore: return restore(root)
        if args.verify:
            m = load_and_verify_manifest(root)
            print(f'PASS: 预置依赖包有效；Vite {m["viteVersion"]}；平台 {m["runtime"]["platform"]}/{m["runtime"]["architecture"]}；归档 {m["archiveBytes"]:,} bytes。')
            return 0
        if args.check_installed:
            _, lock, v = package_info(root)
            info = check_direct_dependencies(root, lock, v)
            print(f'PASS: node_modules 直接依赖版本通过检查，Vite {info["viteVersion"]}。')
            return 0
    except Exception as exc:
        print(f'BLOCKED: {exc}', file=sys.stderr)
        return 2
    return 2

if __name__ == '__main__':
    raise SystemExit(main())
