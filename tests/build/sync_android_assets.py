#!/usr/bin/env python3
"""Build fresh Vite assets, copy via local Capacitor CLI, then verify SHA-256 parity."""
from __future__ import annotations
import argparse, json, os, shutil, subprocess, sys
from pathlib import Path
from build_common import json_write, make_assets_manifest, manifest_report_path, utc_now

SCRIPT = Path(__file__).resolve()
DEFAULT_ROOT = SCRIPT.parents[2]

def run_command(cmd, root: Path, timeout: int, log_path: Path):
    print('+ ' + ' '.join(map(str, cmd)), flush=True)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with log_path.open('w', encoding='utf-8') as log:
            proc = subprocess.run(list(map(str, cmd)), cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace', timeout=timeout, env=os.environ.copy())
            log.write(proc.stdout)
        print(proc.stdout[-10000:])
        return proc.returncode, proc.stdout
    except subprocess.TimeoutExpired as exc:
        tail = exc.stdout or ''
        if isinstance(tail, bytes): tail = tail.decode('utf-8', errors='replace')
        log_path.write_text(tail, encoding='utf-8')
        return 124, f'命令超过 {timeout} 秒超时。\n{tail}'
    except OSError as exc:
        return 127, f'无法启动命令：{exc}'

def main():
    p = argparse.ArgumentParser(description='构建当前前端源码、同步 Android Web 资源并逐文件核验。')
    p.add_argument('--root', default=str(DEFAULT_ROOT))
    p.add_argument('--timeout', type=int, default=900)
    args = p.parse_args()
    root = Path(args.root).resolve()
    report_dir = root / 'tests' / 'reports' / 'build'
    report_path = manifest_report_path(root)
    build_log, copy_log = report_dir / 'latest-frontend-build.log', report_dir / 'latest-capacitor-copy.log'
    status = {'startedAtUtc': utc_now(), 'status': 'RUNNING', 'buildLog': str(build_log.relative_to(root)), 'copyLog': str(copy_log.relative_to(root))}
    try:
        if not (root / 'package.json').is_file(): raise RuntimeError('项目根目录缺少 package.json。')
        code, output = run_command(['npm', 'run', 'build'], root, args.timeout, build_log)
        if code != 0:
            status.update({'status': 'BLOCKED' if 'BLOCKED:' in output or 'No pre-provisioned' in output else 'FAIL', 'stage': 'frontend-build', 'exitCode': code, 'errorTail': output[-5000:]})
            json_write(report_dir / 'latest-sync-result.json', status)
            print(f'{status["status"]}: 前端正式构建未成功；未执行 Android 资源复制。详情：{build_log.relative_to(root)}', file=sys.stderr)
            return 2 if status['status'] == 'BLOCKED' else 1
        manifest = make_assets_manifest(root, root / 'dist')
        manifest['syncStatus'] = 'PENDING'
        manifest['syncStartedAtUtc'] = utc_now()
        json_write(report_path, manifest)
        cap_cli = root / 'node_modules' / '@capacitor' / 'cli' / 'bin' / 'capacitor'
        if not cap_cli.is_file():
            status.update({'status': 'BLOCKED', 'stage': 'capacitor-cli', 'error': '本地 @capacitor/cli/bin/capacitor 不存在；拒绝使用 npx 联网临时下载。'})
            json_write(report_dir / 'latest-sync-result.json', status)
            raise RuntimeError(status['error'])
        code, output = run_command([shutil.which('node') or 'node', str(cap_cli), 'copy', 'android'], root, args.timeout, copy_log)
        if code != 0:
            status.update({'status': 'FAIL', 'stage': 'capacitor-copy', 'exitCode': code, 'errorTail': output[-5000:]})
            json_write(report_dir / 'latest-sync-result.json', status)
            raise RuntimeError(f'Capacitor 资源复制失败，退出码 {code}；详见 {copy_log.relative_to(root)}')
        # Run verification in-process through the shared helper; never infer freshness from filenames.
        from build_common import verify_dist_to_android
        verification = verify_dist_to_android(root, manifest, root / 'dist', root / 'android' / 'app' / 'src' / 'main' / 'assets' / 'public')
        manifest['verification'] = verification
        manifest['syncCompletedAtUtc'] = utc_now()
        manifest['staleAndroidAssets'] = verification['extraAndroidJsCss']
        if not verification['pass']:
            manifest['syncStatus'] = 'FAIL'
            json_write(report_path, manifest)
            status.update({'status': 'FAIL', 'stage': 'asset-hash-verification', 'verification': verification})
            json_write(report_dir / 'latest-sync-result.json', status)
            raise RuntimeError('Android 内置资源与本次 dist 内容不一致；请查看 latest-android-assets-verification.json 和资源清单。')
        manifest['syncStatus'] = 'PASS'
        json_write(report_path, manifest)
        status.update({'status': 'PASS', 'buildId': manifest['buildId'], 'assetCount': len(manifest['assets']), 'verification': verification})
        json_write(report_dir / 'latest-sync-result.json', status)
        print(f'PASS: Android 内置资源已按 SHA-256 与本次 dist 核对一致。buildId={manifest["buildId"]}, assets={len(manifest["assets"])}')
        if verification['extraAndroidJsCss']:
            print('WARN: 发现未纳入本次构建的旧/额外 JS/CSS（仅报告，不自动删除）：' + ', '.join(verification['extraAndroidJsCss'][:20]))
        print(f'清单：{report_path.relative_to(root)}')
        return 0
    except Exception as exc:
        if status.get('status') == 'RUNNING': status.update({'status': 'FAIL', 'error': str(exc)})
        json_write(report_dir / 'latest-sync-result.json', status)
        print(f'{status.get("status", "FAIL")}: {exc}', file=sys.stderr)
        return 2 if status.get('status') == 'BLOCKED' else 1

if __name__ == '__main__': raise SystemExit(main())
