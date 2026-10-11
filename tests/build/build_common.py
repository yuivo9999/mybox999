"""Shared helpers for MyBox build provenance and Android web-asset verification."""
from __future__ import annotations
import hashlib
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def json_read(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def json_write(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(path)


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def manifest_report_path(root: Path) -> Path:
    return root / 'tests' / 'reports' / 'build' / 'latest-assets-manifest.json'


def list_regular_files(directory: Path) -> list[Path]:
    if not directory.is_dir():
        raise RuntimeError(f'目录不存在：{directory}')
    files = []
    for path in directory.rglob('*'):
        if path.is_symlink():
            raise RuntimeError(f'构建资源目录中存在符号链接，拒绝生成可移植清单：{path}')
        if path.is_file(): files.append(path)
    if not files:
        raise RuntimeError(f'目录中没有文件：{directory}')
    return sorted(files, key=lambda p: p.relative_to(directory).as_posix())


class LocalResourceParser(HTMLParser):
    ATTRS = {'script': ('src',), 'link': ('href',), 'img': ('src',), 'source': ('src',), 'video': ('poster', 'src'), 'audio': ('src',)}
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.refs = []
    def handle_starttag(self, tag, attrs):
        attrmap = dict(attrs)
        for attr in self.ATTRS.get(tag.lower(), ()):
            value = attrmap.get(attr)
            if value: self.refs.append((tag.lower(), attr, value.strip()))


def check_html_local_references(index_path: Path, dist_dir: Path) -> list[str]:
    parser = LocalResourceParser()
    parser.feed(index_path.read_text(encoding='utf-8', errors='replace'))
    missing = []
    for tag, attr, value in parser.refs:
        lower = value.lower()
        if not value or lower.startswith(('http://', 'https://', '//', 'data:', 'blob:', 'javascript:', '#')):
            continue
        # Vite's base-relative references such as /assets/app.js resolve from dist root.
        ref = value.split('?', 1)[0].split('#', 1)[0].lstrip('/')
        if not ref: continue
        target = (dist_dir / ref).resolve()
        try:
            target.relative_to(dist_dir.resolve())
        except ValueError:
            missing.append(f'{tag}[{attr}] escapes dist: {value}')
            continue
        if not target.is_file(): missing.append(f'{tag}[{attr}] missing: {value}')
    return missing


def source_fingerprint(root: Path) -> dict:
    """Fingerprint frontend inputs so an old dist/ cannot pass after source edits."""
    candidates = []
    for rel in ('src', 'public'):
        directory = root / rel
        if directory.is_dir():
            candidates.extend(p for p in directory.rglob('*') if p.is_file() and not p.is_symlink())
    for pattern in ('index.html', 'vite.config.*', 'postcss.config.*', 'tailwind.config.*', 'tsconfig*.json', 'capacitor.config.*', '.env', '.env.*', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json'):
        if any(ch in pattern for ch in '*?['):
            candidates.extend(root.glob(pattern))
        else:
            candidate = root / pattern
            if candidate.is_file(): candidates.append(candidate)
    unique = {p.resolve() for p in candidates if p.is_file()}
    entries = []
    for path in sorted(unique, key=lambda p: p.relative_to(root).as_posix()):
        rel = path.relative_to(root).as_posix()
        entries.append({'path': rel, 'sha256': sha256_file(path), 'bytes': path.stat().st_size})
    material = ''.join(f"{item['path']}\0{item['sha256']}\n" for item in entries)
    return {'sha256': hashlib.sha256(material.encode('utf-8')).hexdigest(), 'fileCount': len(entries), 'files': entries}


def build_environment_fingerprint() -> str:
    import os
    relevant = {key: value for key, value in os.environ.items() if key.startswith('VITE_') or key in {'NODE_ENV', 'MODE'}}
    material = ''.join(f'{key}\0{relevant[key]}\n' for key in sorted(relevant))
    return hashlib.sha256(material.encode('utf-8')).hexdigest()

def verify_current_source_manifest(root: Path, manifest: dict) -> dict:
    source = manifest.get('source') or {}
    current_package = root / 'package.json'
    current_lock = root / 'package-lock.json'
    package_match = current_package.is_file() and sha256_file(current_package) == source.get('packageJsonSha256')
    lock_match = current_lock.is_file() and sha256_file(current_lock) == source.get('packageLockSha256')
    current_tree = source_fingerprint(root)
    environment_hash = build_environment_fingerprint()
    expected_environment_hash = source.get('buildEnvironmentSha256')
    environment_match = bool(expected_environment_hash) and environment_hash == expected_environment_hash
    expected_tree = source.get('sourceTreeSha256')
    tree_match = bool(expected_tree) and current_tree['sha256'] == expected_tree
    return {
        'packageJsonMatches': package_match,
        'packageLockMatches': lock_match,
        'sourceTreeMatches': tree_match,
        'buildEnvironmentMatches': environment_match,
        'expectedBuildEnvironmentSha256': expected_environment_hash,
        'actualBuildEnvironmentSha256': environment_hash,
        'expectedSourceTreeSha256': expected_tree,
        'actualSourceTreeSha256': current_tree['sha256'],
        'currentSourceFileCount': current_tree['fileCount'],
        'pass': package_match and lock_match and tree_match and environment_match,
    }

def make_assets_manifest(root: Path, dist_dir: Path) -> dict:
    index = dist_dir / 'index.html'
    if not index.is_file():
        raise RuntimeError(f'最新前端构建没有生成 {index.relative_to(root)}；拒绝使用旧 Android 资源。')
    missing = check_html_local_references(index, dist_dir)
    if missing:
        raise RuntimeError('dist/index.html 引用缺失的本地资源：' + '; '.join(missing[:30]))
    package_path, lock_path = root / 'package.json', root / 'package-lock.json'
    if not package_path.is_file() or not lock_path.is_file():
        raise RuntimeError('缺少 package.json 或 package-lock.json，不能记录构建来源。')
    package, lock = json_read(package_path), json_read(lock_path)
    locked_vite = (lock.get('packages') or {}).get('node_modules/vite', {}).get('version')
    vite_installed_path = root / 'node_modules' / 'vite' / 'package.json'
    installed_vite = json_read(vite_installed_path).get('version') if vite_installed_path.is_file() else None
    if not installed_vite or (locked_vite and installed_vite != locked_vite):
        raise RuntimeError(f'本地 Vite 未安装或版本与锁文件不一致（locked={locked_vite}, installed={installed_vite}）。')
    files = {}
    for path in list_regular_files(dist_dir):
        rel = path.relative_to(dist_dir).as_posix()
        files[rel] = {'sha256': sha256_file(path), 'bytes': path.stat().st_size}
    digest_material = ''.join(f'{name}\0{meta["sha256"]}\n' for name, meta in sorted(files.items()))
    bundle_hash = hashlib.sha256(digest_material.encode('utf-8')).hexdigest()
    build_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + bundle_hash[:12]
    return {
        'schemaVersion': 1,
        'buildId': build_id,
        'generatedAtUtc': utc_now(),
        'source': {
            'packageJsonSha256': sha256_file(package_path),
            'packageLockSha256': sha256_file(lock_path),
            'sourceTreeSha256': source_fingerprint(root)['sha256'],
            'sourceFileCount': source_fingerprint(root)['fileCount'],
            'buildEnvironmentSha256': build_environment_fingerprint(),
            'packageName': package.get('name'),
            'packageVersion': package.get('version'),
            'viteVersion': installed_vite,
            'webDir': 'dist',
            'buildCommand': 'npm run build',
        },
        'distBundleSha256': bundle_hash,
        'syncStatus': 'PENDING',
        'assets': files,
        'staleAndroidAssets': [],
        'verification': None,
    }


def load_manifest(path: Path) -> dict:
    if not path.is_file():
        raise RuntimeError(f'构建资源清单不存在：{path}')
    payload = json_read(path)
    if payload.get('schemaVersion') != 1 or not isinstance(payload.get('assets'), dict) or not payload['assets']:
        raise RuntimeError(f'构建资源清单无效：{path}')
    digest_material = ''.join(f"{name}\0{meta.get('sha256')}\n" for name, meta in sorted(payload['assets'].items()))
    calculated = hashlib.sha256(digest_material.encode('utf-8')).hexdigest()
    if calculated != payload.get('distBundleSha256'):
        raise RuntimeError('构建资源清单内部哈希校验失败；清单可能损坏或被不完整写入。')
    for rel in payload['assets']:
        rel_path = Path(rel)
        if rel_path.is_absolute() or '..' in rel_path.parts:
            raise RuntimeError(f'构建资源清单包含不安全路径：{rel}')
    return payload


def verify_dist_to_android(root: Path, manifest: dict, dist_dir: Path, android_assets: Path) -> dict:
    source_check = verify_current_source_manifest(root, manifest)
    if not dist_dir.is_dir(): raise RuntimeError(f'dist 目录不存在：{dist_dir}')
    if not android_assets.is_dir(): raise RuntimeError(f'Android 内置资源目录不存在：{android_assets}')
    source_mismatches, missing_target, mismatched_target = [], [], []
    expected = manifest['assets']
    for rel, expected_meta in expected.items():
        # Prevent manifest path traversal before addressing either directory.
        rel_path = Path(rel)
        if rel_path.is_absolute() or '..' in rel_path.parts:
            source_mismatches.append(f'unsafe manifest path: {rel}')
            continue
        src = dist_dir / rel_path
        dst = android_assets / rel_path
        if not src.is_file():
            source_mismatches.append(rel)
            continue
        src_hash = sha256_file(src)
        if src_hash != expected_meta.get('sha256'):
            source_mismatches.append(rel)
            continue
        if not dst.is_file():
            missing_target.append(rel)
            continue
        dst_hash = sha256_file(dst)
        if dst_hash != expected_meta.get('sha256'):
            mismatched_target.append({'path': rel, 'expectedSha256': expected_meta.get('sha256'), 'actualSha256': dst_hash})
    dist_paths = set(expected.keys())
    android_paths = {p.relative_to(android_assets).as_posix() for p in android_assets.rglob('*') if p.is_file()}
    extras = sorted(p for p in android_paths - dist_paths if Path(p).suffix.lower() in {'.js', '.css', '.mjs'})
    report = {
        'checkedAtUtc': utc_now(),
        'buildId': manifest.get('buildId'),
        'currentSourceVerification': source_check,
        'sourceMismatches': source_mismatches,
        'missingAndroidAssets': missing_target,
        'mismatchedAndroidAssets': mismatched_target,
        'extraAndroidJsCss': extras,
        'expectedAssetCount': len(expected),
        'matchingAssetCount': len(expected) - len(source_mismatches) - len(missing_target) - len(mismatched_target),
        'pass': source_check['pass'] and not (source_mismatches or missing_target or mismatched_target),
    }
    return report


def apk_asset_hashes(apk_path: Path) -> dict[str, str]:
    import zipfile
    result = {}
    with zipfile.ZipFile(apk_path, 'r') as archive:
        names = archive.namelist()
        prefix = 'assets/public/'
        indexed = [name for name in names if name.startswith(prefix) and not name.endswith('/')]
        if not indexed:
            # Some APK packaging layouts include an outer app path; locate public/index.html suffix.
            indices = [name for name in names if name.endswith('/assets/public/index.html') or name == 'assets/public/index.html']
            if not indices: raise RuntimeError('APK 内未找到 assets/public/index.html。')
            idx = indices[0]
            prefix = idx[:-len('index.html')]
            indexed = [name for name in names if name.startswith(prefix) and not name.endswith('/')]
        for name in indexed:
            rel = name[len(prefix):]
            data = archive.read(name)
            result[rel] = hashlib.sha256(data).hexdigest()
    return result
