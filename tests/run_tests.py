#!/usr/bin/env python3
"""MyBox test orchestrator. Standard-library static checks; active operations are opt-in."""
from __future__ import annotations
import argparse, json, os, re, shutil, subprocess, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parent
REPORT_DIR = TESTS_DIR / "reports"
SKIP_DIRS = {".git", "node_modules", ".gradle", "build", "dist", "out", "target", "coverage", "reports", "artifacts", "__pycache__"}
CATEGORIES = ("frontend", "dependencies", "resources", "apk", "dom_video", "integration", "regression")

class Result:
    def __init__(self): self.items=[]
    def add(self, category, name, status, message, evidence=None):
        self.items.append({"category":category,"check":name,"status":status,"message":message,"evidence":evidence or []})

def project_files(root: Path):
    for p in root.rglob('*'):
        try: rel = p.relative_to(root)
        except ValueError: continue
        if any(part in SKIP_DIRS for part in rel.parts): continue
        if p.is_file(): yield p

def read_text(path: Path, limit=2_000_000):
    try:
        if path.stat().st_size > limit: return None
        return path.read_text(encoding='utf-8', errors='replace')
    except (OSError, UnicodeError): return None

def add(r, cat, name, status, msg, evidence=None): r.add(cat,name,status,msg,evidence)

def scan_frontend(root, files, r):
    packages = [p for p in files if p.name == 'package.json' and 'node_modules' not in p.parts]
    if not packages:
        add(r,'frontend','package.json','UNVERIFIED','项目中未找到 package.json；无法静态检查 npm 前端配置。')
        return
    for p in packages:
        try: data=json.loads(p.read_text(encoding='utf-8'))
        except Exception as e:
            add(r,'frontend',f'{p.relative_to(root)}/JSON','FAIL',f'package.json 不是有效 JSON：{e}'); continue
        scripts=data.get('scripts') or {}
        deps={**(data.get('dependencies') or {}), **(data.get('devDependencies') or {})}
        rel=str(p.relative_to(root))
        add(r,'frontend',f'{rel}/JSON','PASS','package.json 可解析。',[rel])
        if 'build' in scripts:
            add(r,'frontend',f'{rel}/build-script','PASS',f'存在 build 脚本：{scripts["build"]}',[rel])
            build_script=str(scripts['build'])
            if re.search(r'\bvite\b', build_script) and 'vite' not in deps:
                add(r,'frontend',f'{rel}/vite-declaration','FAIL','build 脚本调用 Vite，但 package.json 未声明 vite 依赖。',[rel])
        else:
            add(r,'frontend',f'{rel}/build-script','WARN','未声明 scripts.build；不能通过 npm run build 进行前端构建。',[rel])
        lock_candidates=['package-lock.json','npm-shrinkwrap.json','pnpm-lock.yaml','yarn.lock']
        found=[name for name in lock_candidates if (p.parent/name).is_file()]
        if found: add(r,'frontend',f'{rel}/lockfile','PASS','找到依赖锁文件。',[str((p.parent/n).relative_to(root)) for n in found])
        else: add(r,'frontend',f'{rel}/lockfile','WARN','该 package.json 同目录未发现常见依赖锁文件；依赖复现性可能不足。',[rel])
        source_roots=[p.parent/x for x in ('src','app','public','index.html') if (p.parent/x).exists()]
        if source_roots: add(r,'frontend',f'{rel}/source-entry','PASS','找到前端入口/源目录线索。',[str(x.relative_to(root)) for x in source_roots])
        else: add(r,'frontend',f'{rel}/source-entry','WARN','未在 package.json 同目录发现 src、app、public 或 index.html。',[rel])
    js_files=[p for p in files if p.suffix.lower() in {'.js','.jsx','.ts','.tsx','.mjs','.cjs'}]
    if js_files: add(r,'frontend','source-files','PASS',f'发现 {len(js_files)} 个 JS/TS 源或运行文件。',[str(p.relative_to(root)) for p in js_files[:20]])
    else: add(r,'frontend','source-files','UNVERIFIED','没有发现可检查的 JavaScript/TypeScript 文件。')

def scan_dependencies(root, files, r):
    node=shutil.which('node'); npm=shutil.which('npm')
    if node: add(r,'dependencies','node-runtime','PASS',f'Node.js 可执行文件：{node}')
    else: add(r,'dependencies','node-runtime','UNVERIFIED','当前 PATH 中找不到 node。')
    if npm: add(r,'dependencies','npm-runtime','PASS',f'npm 可执行文件：{npm}')
    else: add(r,'dependencies','npm-runtime','UNVERIFIED','当前 PATH 中找不到 npm。')
    manifests=[p for p in files if p.name=='package.json']
    if not manifests:
        add(r,'dependencies','dependency-manifest','UNVERIFIED','未发现 package.json，无法检查项目 npm 依赖。'); return
    for p in manifests:
        try: data=json.loads(p.read_text(encoding='utf-8'))
        except Exception: continue
        deps={**(data.get('dependencies') or {}), **(data.get('devDependencies') or {})}
        rel=str(p.relative_to(root)); nm=p.parent/'node_modules'
        if nm.is_dir(): add(r,'dependencies',f'{rel}/node_modules','PASS','发现 node_modules 目录；这不保证所有包安装完整。',[str(nm.relative_to(root))])
        else: add(r,'dependencies',f'{rel}/node_modules','WARN','未发现 node_modules；本次仅记录状态，没有安装依赖。',[rel])
        lock=any((p.parent/name).is_file() for name in ('package-lock.json','npm-shrinkwrap.json','pnpm-lock.yaml','yarn.lock'))
        if lock: add(r,'dependencies',f'{rel}/lock-consistency','PASS','存在锁文件，可用于可复现安装。',[rel])
        else: add(r,'dependencies',f'{rel}/lock-consistency','WARN','没有常见锁文件；自动安装前应确认项目依赖策略。',[rel])
        if deps: add(r,'dependencies',f'{rel}/declared-count','PASS',f'声明了 {len(deps)} 个直接依赖；没有执行安装。',[rel])
        else: add(r,'dependencies',f'{rel}/declared-count','WARN','package.json 中未发现 dependencies/devDependencies。',[rel])

def static_resource_checks(root, files, r):
    html_files=[p for p in files if p.suffix.lower()=='.html']
    css_files=[p for p in files if p.suffix.lower()=='.css']
    if not html_files and not css_files:
        add(r,'resources','html-css-presence','UNVERIFIED','未找到 HTML/CSS 文件。'); return
    add(r,'resources','html-css-presence','PASS',f'发现 {len(html_files)} 个 HTML、{len(css_files)} 个 CSS 文件。')
    missing=[]; total=0
    class Parser(HTMLParser):
        def __init__(self): super().__init__(); self.refs=[]
        def handle_starttag(self, tag, attrs):
            a=dict(attrs)
            for attr in ('src','href','poster'):
                v=a.get(attr)
                if v: self.refs.append(v.strip())
    def is_external(value):
        low=value.lower()
        return (not value or value.startswith('#') or low.startswith(('http:','https:','data:','blob:','javascript:','mailto:','tel:','//'))) or '{' in value or '}' in value
    def candidates(base_file, raw):
        val=urllib.parse.unquote(raw.split('?',1)[0].split('#',1)[0])
        val=val.replace('\\','/')
        roots=[]
        # URL-root references can resolve from the static public/www/dist root or the project root.
        for anc in [base_file.parent, *base_file.parents]:
            if anc.name.lower() in {'public','www','web','dist','build'}:
                roots.append(anc)
        roots.append(base_file.parent)
        roots.append(root)
        result=[]
        for base in roots:
            cand=base / val.lstrip('/')
            if cand not in result: result.append(cand)
        return result
    for p in html_files:
        text=read_text(p)
        if text is None: continue
        parser=Parser()
        try: parser.feed(text)
        except Exception: continue
        for ref in parser.refs:
            if is_external(ref): continue
            # Ignore client-side routes in anchor elements; test only file-like refs.
            total += 1
            cs=candidates(p,ref)
            if not any(c.is_file() for c in cs): missing.append({'html':str(p.relative_to(root)),'ref':ref,'tried':[str(c.relative_to(root)) if c.is_relative_to(root) else str(c) for c in cs[:3]]})
    for p in css_files:
        text=read_text(p)
        if text is None: continue
        for match in re.finditer(r'url\(\s*[\"\']?([^\"\')]+)',text,re.I):
            ref=match.group(1).strip()
            if is_external(ref): continue
            total += 1
            val=urllib.parse.unquote(ref.split('?',1)[0].split('#',1)[0]).replace('\\','/')
            candidates_css=[p.parent / val.lstrip('/'), root / val.lstrip('/')]
            for anc in p.parents:
                if anc.name.lower() in {'public','www','web','dist','build'}: candidates_css.append(anc / val.lstrip('/'))
            if not any(c.is_file() for c in candidates_css): missing.append({'css':str(p.relative_to(root)),'ref':ref,'tried':[str(c.relative_to(root)) if c.is_relative_to(root) else str(c) for c in candidates_css[:3]]})
    if missing:
        add(r,'resources','local-reference-integrity','FAIL',f'发现 {len(missing)} 个疑似缺失的本地 HTML/CSS 资源引用（共检查 {total} 项）。',missing[:100])
    else:
        add(r,'resources','local-reference-integrity','PASS',f'未发现缺失的静态 HTML/CSS 资源引用（共检查 {total} 项）。')

def scan_android(root, files, r):
    android=root/'android'
    if not android.is_dir():
        add(r,'apk','android-directory','UNVERIFIED','项目根目录没有 android/；不能检查 Android/Gradle 结构。')
        add(r,'integration','android-web-assets','UNVERIFIED','没有 android/ 目录，跳过 Android Web 资源集成检查。')
        return
    add(r,'apk','android-directory','PASS','发现 android/ 目录。')
    wrappers=[p for p in (android/'gradlew',android/'gradlew.bat',root/'gradlew',root/'gradlew.bat') if p.is_file()]
    appgradle=[p for p in files if p.name in {'build.gradle','build.gradle.kts'} and 'app' in p.parts and 'android' in p.parts]
    manifest=[p for p in files if p.name=='AndroidManifest.xml' and 'android' in p.parts]
    settings=[p for p in files if p.name in {'settings.gradle','settings.gradle.kts'} and 'android' in p.parts]
    wrapperprops=[p for p in files if p.name=='gradle-wrapper.properties' and 'android' in p.parts]
    for name,arr in [('Gradle wrapper',wrappers),('app Gradle config',appgradle),('AndroidManifest',manifest),('Gradle settings',settings),('wrapper properties',wrapperprops)]:
        if arr: add(r,'apk',name,'PASS',f'找到 {len(arr)} 个相关文件。',[str(p.relative_to(root)) for p in arr[:10]])
        else: add(r,'apk',name,'WARN',f'未找到{name}；APK 构建可能无法执行。')
    if wrappers:
        executable=shutil.which('java')
        add(r,'apk','java-runtime','PASS' if executable else 'UNVERIFIED',f'Java 可执行文件：{executable}' if executable else 'PATH 中未找到 java；仅静态检查，未启动 Gradle。')
    assets=android/'app'/'src'/'main'/'assets'/'public'
    index=assets/'index.html'
    if assets.is_dir():
        entries=list(assets.rglob('*'))
        add(r,'integration','android-public-assets','PASS',f'发现 Android public 资源目录，含 {sum(p.is_file() for p in entries)} 个文件。',[str(assets.relative_to(root))])
        if index.is_file(): add(r,'integration','android-public-index','PASS','Android 内置 public/index.html 存在。',[str(index.relative_to(root))])
        else: add(r,'integration','android-public-index','WARN','Android 内置 public 目录存在，但未找到 index.html。',[str(assets.relative_to(root))])
    else:
        add(r,'integration','android-public-assets','WARN','未找到 android/app/src/main/assets/public；请确认项目实际资源目录。')
    # Compare apparent front-end source/bundle files with Android asset bundles by basename only.
    js_css=[p for p in files if p.suffix.lower() in {'.js','.css'} and 'assets' in p.parts]
    asset_js_css=[p for p in files if p.suffix.lower() in {'.js','.css'} and 'android' in p.parts and 'assets' in p.parts]
    if js_css and asset_js_css:
        basenames={p.name for p in js_css if 'android' not in p.parts}
        bundled={p.name for p in asset_js_css}
        intersection=sorted(basenames & bundled)
        add(r,'integration','bundle-name-overlap','PASS' if intersection else 'WARN',f'源资源与 Android 资源按文件名匹配 {len(intersection)} 个文件。文件名不同可能是构建哈希变化，不足以单独证明资源过期。',intersection[:30])
    else: add(r,'integration','bundle-name-overlap','UNVERIFIED','缺少可用于比较的源资源或 Android 资源。')

def scan_dom_video(root, files, r):
    exts={'.html','.js','.jsx','.ts','.tsx','.java','.kt','.xml'}
    candidates=[p for p in files if p.suffix.lower() in exts and ('src' in p.parts or 'android' in p.parts or 'assets' in p.parts or p.name=='index.html')]
    patterns={
        'video_element':r'<video\b|createElement\s*\(\s*[\"\']video[\"\']|HTMLVideoElement',
        'playback_api':r'\.play\s*\(|\.pause\s*\(|currentTime|loadedmetadata|timeupdate|canplay|waiting|stalled',
        'webview_bridge':r'WebView|addJavascriptInterface|evaluateJavascript|@JavascriptInterface',
        'native_fullscreen':r'WebChromeClient|onShowCustomView|onHideCustomView|CustomViewCallback|SYSTEM_UI_FLAG_FULLSCREEN|WindowInsetsController',
        'video_error_handling':r'addEventListener\s*\(\s*[\"\']error|onerror|MEDIA_ERR|networkState|readyState'
    }
    counts={k:[] for k in patterns}
    for p in candidates:
        text=read_text(p,1_500_000)
        if text is None: continue
        for k,pat in patterns.items():
            if re.search(pat,text,re.I): counts[k].append(str(p.relative_to(root)))
    found=sum(len(v) for v in counts.values())
    if not candidates:
        add(r,'dom_video','scan-scope','UNVERIFIED','未找到适合静态检查的 HTML/JS/Java/Kotlin/XML 源或运行文件。')
        return
    add(r,'dom_video','scan-scope','PASS',f'扫描 {len(candidates)} 个候选文件；这是静态架构线索检查，不执行真实播放器。')
    for key, paths in counts.items():
        if paths: add(r,'dom_video',key,'PASS',f'发现相关架构线索，涉及 {len(paths)} 个文件。',paths[:50])
        else: add(r,'dom_video',key,'UNVERIFIED','未检测到此类静态标记；可能是不同实现方式，也可能缺少对应处理。')
    add(r,'dom_video','runtime-limit','UNVERIFIED','本检查不能证明真实视频源可播放、DOM/原生切换正常或设备解码成功；只依据源码中的可见线索。')

def scan_integration(root, files, r):
    pkg=[p for p in files if p.name=='package.json']
    android_index=root/'android/app/src/main/assets/public/index.html'
    source_html=[p for p in files if p.name=='index.html' and 'android' not in p.parts and 'node_modules' not in p.parts]
    if pkg and android_index.is_file():
        add(r,'integration','frontend-to-android-present','PASS','同时找到 npm 前端清单与 Android 预置入口；需进一步确认它们是否对应同一版本。',[str(pkg[0].relative_to(root)),str(android_index.relative_to(root))])
    elif pkg or android_index.is_file(): add(r,'integration','frontend-to-android-present','WARN','只找到前端清单或 Android 预置入口中的一方，无法完整核对同步链路。')
    else: add(r,'integration','frontend-to-android-present','UNVERIFIED','未找到可用于核对的前端清单和 Android 预置入口。')
    if source_html and android_index.is_file():
        add(r,'integration','entrypoint-comparison','PASS','发现项目网页入口与 Android 内置入口，可对比其中资源引用。',[str(p.relative_to(root)) for p in source_html[:10]]+[str(android_index.relative_to(root))])
    else: add(r,'integration','entrypoint-comparison','UNVERIFIED','缺少成对的网页入口，不能比对实际引用。')

def scan_regression(root, files, r):
    markers=['package.json','android/app/src/main/AndroidManifest.xml','android/app/src/main/assets/public/index.html']
    present=[m for m in markers if (root/m).is_file()]
    add(r,'regression','project-markers','PASS' if present else 'UNVERIFIED',f'识别 {len(present)}/{len(markers)} 个常见项目标记文件。',present)
    known=[p for p in files if p.suffix.lower() in {'.js','.css','.html','.java','.kt','.xml'}]
    add(r,'regression','change-surface','PASS' if known else 'UNVERIFIED',f'当前静态扫描发现 {len(known)} 个可审查的相关文件；这不是自动回归通过证明。',[str(p.relative_to(root)) for p in known[:40]])
    add(r,'regression','manual-scope-warning','WARN','回归范围应按本次变更文件及调用关系补充；未配置业务断言的功能不能标记为通过。')

def run_opt_in(args, r):
    if args.install_node_deps:
        p=ROOT/'package.json'
        if not p.is_file(): add(r,'dependencies','npm-install','UNVERIFIED','根目录没有 package.json；未执行依赖安装。')
        elif not shutil.which('npm'): add(r,'dependencies','npm-install','FAIL','找不到 npm。')
        elif not ((ROOT/'package-lock.json').is_file() or (ROOT/'npm-shrinkwrap.json').is_file()): add(r,'dependencies','npm-install','FAIL','没有 npm 锁文件；为避免不可复现安装，停止执行。请先确认是否应该使用 npm install。')
        else:
            try:
                proc=subprocess.run(['npm','ci'],cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=args.timeout)
                log=proc.stdout[-12000:]
                add(r,'dependencies','npm-install','PASS' if proc.returncode==0 else 'FAIL',f'npm ci 退出码 {proc.returncode}。', [log])
            except Exception as e: add(r,'dependencies','npm-install','FAIL',f'npm ci 未完成：{e}')
    if args.frontend_build:
        p=ROOT/'package.json'
        if not p.is_file(): add(r,'frontend','npm-build','UNVERIFIED','根目录没有 package.json。')
        else:
            try: data=json.loads(p.read_text(encoding='utf-8'))
            except Exception as e: data={}; add(r,'frontend','npm-build','FAIL',f'package.json 解析失败：{e}')
            if data and 'build' not in (data.get('scripts') or {}): add(r,'frontend','npm-build','FAIL','package.json 没有 scripts.build。')
            elif data:
                try:
                    proc=subprocess.run(['npm','run','build'],cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=args.timeout)
                    add(r,'frontend','npm-build','PASS' if proc.returncode==0 else 'FAIL',f'npm run build 退出码 {proc.returncode}。',[proc.stdout[-16000:]])
                except Exception as e: add(r,'frontend','npm-build','FAIL',f'前端构建未完成：{e}')
    if args.apk_build:
        candidates=[(ROOT/'android'/'gradlew',ROOT/'android'),(ROOT/'gradlew',ROOT)]
        wrapper=next(((p,d) for p,d in candidates if p.is_file()),None)
        if not wrapper: add(r,'apk','assembleDebug','UNVERIFIED','未找到 gradlew；未执行 APK 构建。')
        elif not shutil.which('java'): add(r,'apk','assembleDebug','FAIL','找不到 Java；无法启动 Gradle。')
        else:
            p,cwd=wrapper
            try:
                if os.name!='nt' and not os.access(p,os.X_OK): add(r,'apk','gradlew-executable','WARN','gradlew 没有执行权限，将通过 sh gradlew 调用。')
                cmd=[str(p.resolve()),'assembleDebug'] if (os.name=='nt' or os.access(p,os.X_OK)) else ['sh',str(p.resolve()),'assembleDebug']
                proc=subprocess.run(cmd,cwd=cwd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=args.timeout)
                apk_paths=list((cwd/'app'/'build'/'outputs'/'apk').rglob('*.apk')) if (cwd/'app'/'build'/'outputs'/'apk').exists() else []
                ev=[proc.stdout[-18000:]]+[str(x.relative_to(ROOT)) for x in apk_paths[:20]]
                add(r,'apk','assembleDebug','PASS' if proc.returncode==0 and apk_paths else 'FAIL',f'Gradle 退出码 {proc.returncode}；发现 {len(apk_paths)} 个 APK 输出文件。',ev)
            except Exception as e: add(r,'apk','assembleDebug','FAIL',f'APK 构建未完成：{e}')
    if args.visual:
        visual_root=TESTS_DIR/'ai_visual_test'
        pytest=shutil.which('pytest')
        if not pytest: add(r,'ai_visual_test','playwright-run','UNVERIFIED','找不到 pytest；未执行视觉测试。请按 README 准备可选测试环境。')
        else:
            server_script=visual_root/'server.py'; demo=visual_root/'demo'; port=args.port
            # If port is busy, do not kill another process. Report and ask the caller to choose another port.
            import socket
            with socket.socket() as sock:
                busy=sock.connect_ex(('127.0.0.1',port))==0
            server=None
            try:
                if not busy: server=subprocess.Popen([sys.executable,str(server_script),'--root',str(demo),'--port',str(port)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                deadline=time.time()+10
                while time.time()<deadline:
                    try:
                        with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=1) as response:
                            if response.status<400: break
                    except Exception: time.sleep(0.2)
                env=os.environ.copy(); env['AI_VISUAL_BASE_URL']=f'http://127.0.0.1:{port}/'
                env.setdefault('AI_VISUAL_CONFIG',str(visual_root/'config.example.json'))
                proc=subprocess.run([pytest,'-q',str(visual_root/'tests')],cwd=ROOT,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=args.timeout)
                add(r,'ai_visual_test','playwright-run','PASS' if proc.returncode==0 else 'FAIL',f'Playwright 退出码 {proc.returncode}。',[proc.stdout[-18000:]])
            except Exception as e: add(r,'ai_visual_test','playwright-run','FAIL',f'视觉测试未完成：{e}')
            finally:
                if server:
                    server.terminate()
                    try: server.wait(timeout=3)
                    except subprocess.TimeoutExpired: server.kill()

def main():
    parser=argparse.ArgumentParser(description='MyBox test suite; defaults to static checks only.')
    parser.add_argument('--root',default=str(ROOT),help='项目根目录（默认 tests/ 的上一级）')
    parser.add_argument('--only',choices=CATEGORIES,help='只运行一个静态检查类别')
    parser.add_argument('--install-node-deps',action='store_true',help='显式安装根目录 npm 依赖（需要 package-lock.json/npm-shrinkwrap.json）')
    parser.add_argument('--frontend-build',action='store_true',help='显式运行 npm run build')
    parser.add_argument('--apk-build',action='store_true',help='显式运行 Gradle assembleDebug；不会安装 APK 或连接设备')
    parser.add_argument('--visual',action='store_true',help='启动 Demo HTTP 服务并运行 Playwright 视觉测试')
    parser.add_argument('--port',type=int,default=4173,help='视觉 Demo 服务端口')
    parser.add_argument('--timeout',type=int,default=900,help='显式安装/构建/视觉运行的超时秒数')
    args=parser.parse_args(); root=Path(args.root).expanduser().resolve()
    if not root.is_dir(): print(f'项目目录不存在：{root}',file=sys.stderr); return 2
    r=Result(); files=list(project_files(root))
    if not args.only or args.only=='frontend': scan_frontend(root,files,r)
    if not args.only or args.only=='dependencies': scan_dependencies(root,files,r)
    if not args.only or args.only=='resources': static_resource_checks(root,files,r)
    if not args.only or args.only=='apk': scan_android(root,files,r)
    if not args.only or args.only=='dom_video': scan_dom_video(root,files,r)
    if not args.only or args.only=='integration':
        # Scan android structures as this also records assets directory integrity.
        scan_integration(root,files,r)
    if not args.only or args.only=='regression': scan_regression(root,files,r)
    if args.install_node_deps or args.frontend_build or args.apk_build or args.visual: run_opt_in(args,r)
    REPORT_DIR.mkdir(parents=True,exist_ok=True)
    counts={s:sum(1 for x in r.items if x['status']==s) for s in ('PASS','WARN','FAIL','UNVERIFIED')}
    report={'project_root':str(root),'generated_at_utc':datetime.now(timezone.utc).isoformat(),'mode':'static plus explicitly selected operations','counts':counts,'results':r.items}
    # The report is in this tests suite path; for alternate --root this remains beside the test tool.
    (REPORT_DIR/'latest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    lines=[f'MyBox 测试检查报告',f'项目根目录：{root}',f'生成时间（UTC）：{report["generated_at_utc"]}',f'汇总：PASS={counts["PASS"]} WARN={counts["WARN"]} FAIL={counts["FAIL"]} UNVERIFIED={counts["UNVERIFIED"]}','']
    for item in r.items:
        lines.append(f'[{item["status"]}] {item["category"]} / {item["check"]}: {item["message"]}')
        for ev in item.get('evidence',[])[:5]: lines.append('    - '+(str(ev).replace('\n',' ')[:800]))
    (REPORT_DIR/'latest.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('\n'.join(lines))
    print(f'\nJSON 报告：{REPORT_DIR / "latest.json"}')
    return 1 if counts['FAIL'] else 0

if __name__=='__main__': raise SystemExit(main())
