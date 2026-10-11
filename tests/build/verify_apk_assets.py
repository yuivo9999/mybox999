#!/usr/bin/env python3
"""Verify the final APK embeds the exact files from the last PASS asset manifest."""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
from build_common import apk_asset_hashes, json_write, load_manifest, manifest_report_path, utc_now, verify_current_source_manifest, sha256_file

SCRIPT = Path(__file__).resolve()
DEFAULT_ROOT = SCRIPT.parents[2]

def main():
    p = argparse.ArgumentParser(description='检查 APK 内 assets/public 的内容是否与本次构建清单一致。')
    p.add_argument('--root', default=str(DEFAULT_ROOT))
    p.add_argument('--apk', required=True, help='要核验的 APK 文件路径')
    p.add_argument('--manifest', default=None)
    p.add_argument('--json-out', default=None)
    args = p.parse_args()
    root = Path(args.root).resolve()
    apk = Path(args.apk).resolve()
    manifest_path = Path(args.manifest).resolve() if args.manifest else manifest_report_path(root)
    output = Path(args.json_out).resolve() if args.json_out else root / 'tests' / 'reports' / 'build' / 'latest-apk-assets-verification.json'
    try:
        manifest = load_manifest(manifest_path)
        if manifest.get('syncStatus') != 'PASS':
            raise RuntimeError(f'最新资源清单尚未完成 Android 同步验收（syncStatus={manifest.get("syncStatus")}）。')
        if not apk.is_file(): raise RuntimeError(f'APK 文件不存在：{apk}')
        source_check = verify_current_source_manifest(root, manifest)
        if not source_check['pass']:
            raise RuntimeError('源代码或依赖锁文件自资源构建后发生变化；必须重新构建/同步后才能验收 APK。')
        actual = apk_asset_hashes(apk)
        missing, mismatched = [], []
        for rel, meta in manifest['assets'].items():
            if rel not in actual: missing.append(rel)
            elif actual[rel] != meta.get('sha256'):
                mismatched.append({'path': rel, 'expectedSha256': meta.get('sha256'), 'actualSha256': actual[rel]})
        extras = sorted(path for path in actual if path not in manifest['assets'] and Path(path).suffix.lower() in {'.js', '.css', '.mjs'})
        report = {
            'checkedAtUtc': utc_now(), 'apk': str(apk), 'apkSha256': sha256_file(apk),
            'buildId': manifest.get('buildId'), 'currentSourceVerification': source_check, 'expectedAssetCount': len(manifest['assets']),
            'apkPublicFileCount': len(actual), 'missingAssets': missing, 'mismatchedAssets': mismatched, 'extraUnmanifestedJsCss': extras,
            'pass': not (missing or mismatched), 'status': 'PASS' if not (missing or mismatched) else 'FAIL',
        }
        json_write(output, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report['pass'] else 1
    except Exception as exc:
        print(f'BLOCKED: {exc}', file=sys.stderr)
        return 2

if __name__ == '__main__': raise SystemExit(main())
