#!/usr/bin/env python3
"""Diagnose frontend and Android build prerequisites without downloading anything."""
from __future__ import annotations
import argparse, json, os, shutil, socket, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT = Path(__file__).resolve()
DEFAULT_ROOT = SCRIPT.parents[2]

class Findings:
    def __init__(self): self.rows=[]
    def add(self, status, check, message, evidence=None): self.rows.append({'status':status,'check':check,'message':message,'evidence':evidence or []})

def command_version(cmd, cwd):
    if not shutil.which(cmd): return None
    try:
        p=subprocess.run([cmd,'--version'],cwd=cwd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=10)
        return p.stdout.strip().splitlines()[0] if p.returncode == 0 and p.stdout.strip() else None
    except Exception: return None

def check_node(root, out):
    node=shutil.which('node'); npm=shutil.which('npm')
    if not node: out.add('BLOCKED','node','PATH 中找不到 Node.js，不能执行前端构建。')
    else:
        v=command_version(node,root) or 'unknown'
        try: major=int(v.lstrip('v').split('.')[0])
        except Exception: major=0
        out.add('PASS' if major > 22 or (major == 22 and len(v.lstrip('v').split('.')) > 1 and int(v.lstrip('v').split('.')[1]) >= 12) else 'BLOCKED','node',f'Node.js：{v}；锁定的 Vite 要求 >=22.12.0。',[node])
    if not npm: out.add('BLOCKED','npm','PATH 中找不到 npm。')
    else: out.add('PASS','npm',f'npm：{command_version(npm,root) or "版本读取失败"}',[npm])
    package_path, lock_path = root/'package.json', root/'package-lock.json'
    if not package_path.is_file() or not lock_path.is_file():
        out.add('FAIL','npm-lock','缺少 package.json 或 package-lock.json。')
        return
    try:
        package=json.loads(package_path.read_text(encoding='utf-8')); lock=json.loads(lock_path.read_text(encoding='utf-8'))
        lock_vite=(lock.get('packages') or {}).get('node_modules/vite',{}).get('version')
        declared=(package.get('dependencies') or {}).get('vite') or (package.get('devDependencies') or {}).get('vite')
        if not declared or not lock_vite: out.add('FAIL','vite-lock','package.json 或 package-lock.json 未明确声明/锁定 Vite。')
        else: out.add('PASS','vite-lock',f'Vite 声明={declared}，锁定版本={lock_vite}。')
    except Exception as exc:
        out.add('FAIL','npm-lock',f'依赖 JSON 无法解析：{exc}'); return
    nm=root/'node_modules'; vite=nm/'vite'/'package.json'
    installed_complete = False
    if vite.is_file():
        try:
            installed=json.loads(vite.read_text(encoding='utf-8')).get('version')
            status='PASS' if installed == lock_vite else 'FAIL'
            out.add(status,'vite-installed',f'node_modules 中 Vite={installed}，锁定版本={lock_vite}。',[str(vite.relative_to(root))])
            if status == 'PASS':
                sys.path.insert(0,str(SCRIPT.parent))
                from frontend_bundle import check_direct_dependencies
                try:
                    check_direct_dependencies(root, lock, lock_vite); installed_complete = True
                    out.add('PASS','direct-dependencies','所有 package.json 直接依赖均存在且版本与 lockfile 对应。')
                except Exception as dep_exc:
                    out.add('WARN','direct-dependencies',str(dep_exc))
        except Exception as exc: out.add('FAIL','vite-installed',f'Vite package.json 无法解析：{exc}')
    else:
        out.add('WARN','vite-installed','本地 Vite CLI 不存在；常规构建只会从预置离线依赖包恢复，不会临时联网下载。')
    bundle_manifest=root/'tests'/'toolchain-cache'/'frontend-deps'/'manifest.json'
    if not bundle_manifest.is_file():
        severity = 'WARN' if installed_complete else 'BLOCKED'
        message = ('当前 node_modules 直接依赖检查通过，但未预置离线依赖归档；本工作目录可能能构建，干净环境仍无法保证离线恢复。' if installed_complete else '未找到预置前端依赖包 manifest。当前无完整 node_modules 时无法离线恢复；需在可访问 npm registry 的维护环境显式运行 `python tests/environment/frontend_bundle.py --prepare`。')
        out.add(severity,'frontend-offline-bundle',message,[str(bundle_manifest.relative_to(root))])
    else:
        try:
            sys.path.insert(0,str(SCRIPT.parent))
            from frontend_bundle import load_and_verify_manifest
            m=load_and_verify_manifest(root)
            out.add('PASS','frontend-offline-bundle',f'预置前端依赖包有效：Vite {m["viteVersion"]}，{m["runtime"]["platform"]}/{m["runtime"]["architecture"]}，{m["archiveBytes"]:,} bytes。',[str(bundle_manifest.relative_to(root))])
        except Exception as exc: out.add('BLOCKED','frontend-offline-bundle',f'预置依赖包不可用：{exc}')

def check_android(root, out):
    java=shutil.which('java')
    if not java: out.add('BLOCKED','java','PATH 中找不到 Java，Gradle 无法运行。')
    else:
        try:
            p=subprocess.run([java,'-version'],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=10)
            text=p.stdout.strip().splitlines()
            out.add('PASS' if p.returncode==0 else 'FAIL','java',text[0] if text else 'Java 版本读取失败',[java])
        except Exception as exc: out.add('FAIL','java',f'Java 版本检查失败：{exc}')
    props=root/'android'/'gradle'/'wrapper'/'gradle-wrapper.properties'
    gradle_version=None
    if props.is_file():
        import re
        match=re.search(r'gradle-([0-9.]+)-(?:all|bin)\.zip',props.read_text(encoding='utf-8',errors='replace'))
        gradle_version=match.group(1) if match else None
    if not gradle_version:
        out.add('FAIL','gradle-wrapper','无法从 Gradle Wrapper 配置读取 Gradle 发行版版本。')
    else:
        home=Path(os.environ.get('GRADLE_USER_HOME',str(Path.home()/'.gradle'))).expanduser()
        dist_root=home/'wrapper'/'dists'/f'gradle-{gradle_version}-all'
        zip_found=any(dist_root.rglob(f'gradle-{gradle_version}-all.zip')) if dist_root.exists() else False
        executable_found=any(dist_root.rglob('bin/gradle')) if dist_root.exists() else False
        if zip_found or executable_found:
            out.add('PASS','gradle-distribution',f'发现 Gradle {gradle_version} 的本地发行版缓存。',[str(dist_root)])
        else:
            out.add('BLOCKED','gradle-distribution',f'Gradle {gradle_version} 未在常用 Wrapper 缓存目录中找到；若网络/DNS 不可用，Android 编译会在下载发行版时阻塞。',[str(dist_root)])
    sdk_candidates=[os.environ.get('ANDROID_HOME'),os.environ.get('ANDROID_SDK_ROOT'),str(Path.home()/'Android'/'Sdk'),'/usr/local/lib/android/sdk']
    sdk=next((Path(x).expanduser() for x in sdk_candidates if x and (Path(x).expanduser()/'platform-tools').is_dir()),None)
    if sdk:
        platforms=sdk/'platforms'; build_tools=sdk/'build-tools'
        out.add('PASS','android-sdk',f'发现 Android SDK：{sdk}；platforms={len(list(platforms.iterdir())) if platforms.is_dir() else 0}，build-tools={len(list(build_tools.iterdir())) if build_tools.is_dir() else 0}。',[str(sdk)])
    else: out.add('BLOCKED','android-sdk','未在 ANDROID_HOME/ANDROID_SDK_ROOT 或常见路径发现完整 Android SDK（platform-tools）。')

def check_network(out):
    # Opt-in only; never probe network as a side effect of static checks.
    for host, port, label in [('registry.npmjs.org',443,'npm registry'),('services.gradle.org',443,'Gradle distribution')]:
        try:
            addr=socket.getaddrinfo(host,port,type=socket.SOCK_STREAM)
            out.add('PASS',f'network-{label}',f'{host} DNS 解析成功。',[x[4][0] for x in addr[:3]])
        except Exception as exc: out.add('WARN',f'network-{label}',f'{host} DNS 解析失败：{exc}')

def main():
    p=argparse.ArgumentParser(description='只诊断，不下载、不安装、不清理任何依赖。')
    p.add_argument('--root',default=str(DEFAULT_ROOT)); p.add_argument('--node',action='store_true'); p.add_argument('--android',action='store_true'); p.add_argument('--network',action='store_true',help='显式启用只读 DNS 检查')
    p.add_argument('--json',dest='json_out',default=None)
    args=p.parse_args(); root=Path(args.root).resolve(); out=Findings()
    if not args.node and not args.android: args.node=True; args.android=True
    if args.node: check_node(root,out)
    if args.android: check_android(root,out)
    if args.network: check_network(out)
    counts={s:sum(x['status']==s for x in out.rows) for s in ('PASS','WARN','FAIL','BLOCKED')}
    report={'projectRoot':str(root),'generatedAtUtc':datetime.now(timezone.utc).isoformat(),'counts':counts,'results':out.rows}
    if args.json_out:
        dest=Path(args.json_out); dest=dest if dest.is_absolute() else root/dest; dest.parent.mkdir(parents=True,exist_ok=True); dest.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 1 if counts['FAIL'] or counts['BLOCKED'] else 0

if __name__=='__main__': raise SystemExit(main())
