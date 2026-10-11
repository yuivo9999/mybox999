#!/usr/bin/env python3
"""One explicit, fail-fast pipeline: fresh web build -> asset sync/hash -> Gradle -> APK hash check."""
from __future__ import annotations
import argparse, json, os, shutil, socket, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
from build_common import json_write, manifest_report_path, utc_now

SCRIPT = Path(__file__).resolve()
DEFAULT_ROOT = SCRIPT.parents[2]

def run(cmd, root: Path, timeout: int, log: Path):
    print('+ ' + ' '.join(map(str, cmd)), flush=True)
    log.parent.mkdir(parents=True, exist_ok=True)
    try:
        p = subprocess.run(list(map(str, cmd)), cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, errors='replace', timeout=timeout)
        log.write_text(p.stdout, encoding='utf-8')
        print(p.stdout[-9000:])
        return p.returncode, p.stdout
    except subprocess.TimeoutExpired as exc:
        text = exc.stdout or ''
        if isinstance(text, bytes): text = text.decode('utf-8', errors='replace')
        log.write_text(text, encoding='utf-8')
        return 124, f'命令超过 {timeout} 秒超时。\n{text}'
    except OSError as exc:
        return 127, f'无法启动命令：{exc}'

def gradle_preflight(root: Path):
    java = shutil.which('java')
    if not java: return False, 'PATH 中找不到 Java。'
    if not (root/'android'/'local.properties').exists() and not (os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')):
        # SDK may be installed under common environment defaults; perform a broader check below.
        pass
    props = root/'android'/'gradle'/'wrapper'/'gradle-wrapper.properties'
    if not props.is_file(): return False, '找不到 android/gradle/wrapper/gradle-wrapper.properties。'
    import re
    match = re.search(r'gradle-([0-9.]+)-(all|bin)\.zip', props.read_text(encoding='utf-8', errors='replace'))
    if not match: return False, '无法确定 Gradle Wrapper 发行版版本。'
    version, flavor = match.group(1), match.group(2)
    home = Path(os.environ.get('GRADLE_USER_HOME', str(Path.home()/'.gradle'))).expanduser()
    dist_root = home/'wrapper'/'dists'/f'gradle-{version}-{flavor}'
    cached = dist_root.exists() and any(dist_root.rglob('bin/gradle'))
    if not cached:
        try: socket.getaddrinfo('services.gradle.org', 443, type=socket.SOCK_STREAM)
        except Exception as exc:
            return False, f'Gradle {version} 不在本地 Wrapper 缓存中，且 services.gradle.org DNS 不可用（{exc}）；拒绝开始必然失败的下载。'
    sdk_candidates = [os.environ.get('ANDROID_HOME'), os.environ.get('ANDROID_SDK_ROOT'), str(Path.home()/'Android'/'Sdk'), '/usr/local/lib/android/sdk']
    sdk = next((Path(x).expanduser() for x in sdk_candidates if x and (Path(x).expanduser()/'platform-tools').is_dir()), None)
    if sdk is None:
        local_props = root/'android'/'local.properties'
        if local_props.is_file():
            text = local_props.read_text(encoding='utf-8', errors='replace')
            found = re.search(r'^sdk\.dir=(.+)$', text, re.M)
            if found:
                cand = Path(found.group(1).replace('\\:', ':')).expanduser()
                if (cand/'platform-tools').is_dir(): sdk = cand
    if sdk is None: return False, '未找到 Android SDK/platform-tools；先准备 SDK 后才能执行 Gradle。'
    return True, f'Gradle {version} 缓存={"yes" if cached else "no (DNS permits wrapper download)"}；Android SDK={sdk}。'

def main():
    p=argparse.ArgumentParser(description='明确启用的一键 Android 构建流水线；任一必要阶段失败就停止。')
    p.add_argument('--root',default=str(DEFAULT_ROOT)); p.add_argument('--timeout',type=int,default=1800)
    p.add_argument('--release',action='store_true',help='在 Debug 外，同时构建并验证 Release APK')
    args=p.parse_args(); root=Path(args.root).resolve(); report_dir=root/'tests'/'reports'/'build'
    report={'schemaVersion':1,'startedAtUtc':utc_now(),'status':'RUNNING','steps':[]}
    report_path=report_dir/'latest-android-build-pipeline.json'
    def record(name,status,message,log=None):
        item={'step':name,'status':status,'message':message}
        if log: item['log']=str(log.relative_to(root)) if log.is_relative_to(root) else str(log)
        report['steps'].append(item)
    try:
        # First step builds freshly from source and copies only after build success.
        sync_script=root/'tests'/'build'/'sync_android_assets.py'
        sync_log=report_dir/'pipeline-sync.log'
        code,out=run([sys.executable,str(sync_script),'--root',str(root),'--timeout',str(args.timeout)],root,args.timeout+60,sync_log)
        if code != 0:
            status='BLOCKED' if 'BLOCKED:' in out or 'No pre-provisioned' in out else 'FAIL'
            record('frontend-build-and-android-sync',status,f'源代码构建或资源同步未通过（退出码 {code}）。',sync_log)
            report['status']=status; report['finishedAtUtc']=utc_now(); json_write(report_path,report)
            return 2 if status=='BLOCKED' else 1
        record('frontend-build-and-android-sync','PASS','已生成 dist，执行 Capacitor copy，并通过 Android assets SHA-256 核验。',sync_log)
        ok, message=gradle_preflight(root)
        if not ok:
            record('android-build-preflight','BLOCKED',message)
            report['status']='BLOCKED'; report['finishedAtUtc']=utc_now(); json_write(report_path,report)
            print('BLOCKED: '+message,file=sys.stderr); return 2
        record('android-build-preflight','PASS',message)
        wrapper=root/'android'/'gradlew'
        if not wrapper.is_file():
            record('gradle-build','BLOCKED','不存在 android/gradlew。'); report['status']='BLOCKED'; report['finishedAtUtc']=utc_now(); json_write(report_path,report); return 2
        tasks=['assembleDebug'] + (['assembleRelease'] if args.release else [])
        gradle_log=report_dir/'latest-gradle-build.log'
        cmd=[str(wrapper.resolve()),*tasks,'--no-daemon','--stacktrace']
        if os.name != 'nt' and not os.access(wrapper,os.X_OK): cmd=['sh',str(wrapper.resolve()),*tasks,'--no-daemon','--stacktrace']
        code,out=run(cmd,root/'android',args.timeout,gradle_log)
        if code != 0:
            status='BLOCKED' if ('UnknownHostException' in out or 'Could not resolve' in out or 'Could not GET' in out or 'timed out' in out.lower()) else 'FAIL'
            record('gradle-build',status,f'Gradle 任务 {tasks} 失败，退出码 {code}。',gradle_log)
            report['status']=status; report['finishedAtUtc']=utc_now(); json_write(report_path,report)
            return 2 if status=='BLOCKED' else 1
        record('gradle-build','PASS',f'Gradle 任务执行成功：{tasks}。',gradle_log)
        apk_targets=[('debug',root/'android'/'app'/'build'/'outputs'/'apk'/'debug'/'app-debug.apk')]
        if args.release:
            release_dir=root/'android'/'app'/'build'/'outputs'/'apk'/'release'
            release_apks=sorted(release_dir.glob('*.apk')) if release_dir.is_dir() else []
            release_apk=next((x for x in release_apks if 'unsigned' in x.name), release_apks[0] if release_apks else release_dir/'app-release-unsigned.apk')
            apk_targets.append(('release',release_apk))
        verifier=root/'tests'/'build'/'verify_apk_assets.py'
        for label,apk in apk_targets:
            v_log=report_dir/f'latest-apk-assets-{label}.log'
            if not apk.is_file():
                record(f'apk-assets-{label}','FAIL',f'构建命令成功但找不到预期 APK：{apk.relative_to(root)}')
                report['status']='FAIL'; report['finishedAtUtc']=utc_now(); json_write(report_path,report); return 1
            v_code,v_out=run([sys.executable,str(verifier),'--root',str(root),'--apk',str(apk)],root,120,v_log)
            if v_code != 0:
                status='BLOCKED' if 'BLOCKED:' in v_out else 'FAIL'
                record(f'apk-assets-{label}',status,'APK 内置前端资源核验未通过。',v_log)
                report['status']=status; report['finishedAtUtc']=utc_now(); json_write(report_path,report)
                return 2 if status=='BLOCKED' else 1
            record(f'apk-assets-{label}','PASS',f'APK 内 assets/public 与构建清单哈希一致：{apk.relative_to(root)}。',v_log)
        report['status']='PASS'; report['finishedAtUtc']=utc_now(); json_write(report_path,report)
        print(f'PASS: Android 构建流水线完成。报告：{report_path.relative_to(root)}')
        return 0
    except Exception as exc:
        report['status']='FAIL'; report['error']=str(exc); report['finishedAtUtc']=utc_now(); json_write(report_path,report)
        print(f'FAIL: {exc}',file=sys.stderr); return 1

if __name__=='__main__': raise SystemExit(main())
