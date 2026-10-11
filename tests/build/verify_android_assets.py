#!/usr/bin/env python3
"""Verify Android's embedded public assets match a specific successful dist build."""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
from build_common import json_write, load_manifest, manifest_report_path, verify_dist_to_android, utc_now

SCRIPT = Path(__file__).resolve()
DEFAULT_ROOT = SCRIPT.parents[2]

def main():
    p = argparse.ArgumentParser(description='按真实文件 SHA-256 验证 dist 与 Android assets/public 的一致性。')
    p.add_argument('--root', default=str(DEFAULT_ROOT))
    p.add_argument('--manifest', default=None)
    p.add_argument('--allow-pending', action='store_true', help='供同步流水线内部在首次校验时使用；独立验收不要使用。')
    p.add_argument('--json-out', default=None)
    args = p.parse_args()
    root = Path(args.root).resolve()
    dist = root / 'dist'
    android_assets = root / 'android' / 'app' / 'src' / 'main' / 'assets' / 'public'
    manifest_path = Path(args.manifest).resolve() if args.manifest else manifest_report_path(root)
    out = Path(args.json_out).resolve() if args.json_out else root / 'tests' / 'reports' / 'build' / 'latest-android-assets-verification.json'
    try:
        manifest = load_manifest(manifest_path)
        if manifest.get('syncStatus') != 'PASS' and not args.allow_pending:
            raise RuntimeError(f'该构建清单尚未通过同步验收（syncStatus={manifest.get("syncStatus")}）；不能宣称 Android 内置资源为最新。')
        report = verify_dist_to_android(root, manifest, dist, android_assets)
        report['manifestPath'] = str(manifest_path.relative_to(root)) if manifest_path.is_relative_to(root) else str(manifest_path)
        report['status'] = 'PASS' if report['pass'] else 'FAIL'
        report['extraAndroidJsCssPolicy'] = 'WARNING_ONLY_UNREFERENCED_FILES_ARE_NOT_DELETED'
        json_write(out, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if report['extraAndroidJsCss']:
            print('WARN: Android assets 中仍有未包含于本次 dist 的 JS/CSS；未自动删除，避免误删插件或遗留资源。')
        return 0 if report['pass'] else 1
    except Exception as exc:
        print(f'BLOCKED: {exc}', file=sys.stderr)
        return 2

if __name__ == '__main__': raise SystemExit(main())
