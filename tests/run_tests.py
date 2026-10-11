#!/usr/bin/env python3
"""MyBox test orchestrator. Standard-library static checks; active operations are opt-in."""
from __future__ import annotations
import argparse, json, os, re, shutil, subprocess, sys, urllib.parse
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parent
REPORT_DIR = TESTS_DIR / "reports"
SKIP_DIRS = {".git", "node_modules", ".gradle", "build", "dist", "out", "target", "coverage", "reports", "artifacts", "__pycache__"}
CATEGORIES = ("frontend", "dependencies", "resources", "apk", "dom_video", "regression")

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
    """Inspect frontend source/configuration only; never invoke a build."""
    packages = [p for p in files if p.name == 'package.json' and 'node_modules' not in p.parts]
    if not packages:
        add(r,'frontend','package.json','UNVERIFIED','项目中未找到 package.json；无法静态检查前端配置。')
        return
    for p in packages:
        try: data=json.loads(p.read_text(encoding='utf-8'))
        except Exception as e:
            add(r,'frontend',f'{p.relative_to(root)}/JSON','FAIL',f'package.json 不是有效 JSON：{e}'); continue
        rel=str(p.relative_to(root))
        add(r,'frontend',f'{rel}/JSON','PASS','package.json 可解析。',[rel])
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
    """Read-only dependency inventory; never installs packages or prepares build caches."""
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
        if lock: add(r,'dependencies',f'{rel}/lock-consistency','PASS','存在锁文件；本项只确认文件存在，不安装或解析依赖。',[rel])
        else: add(r,'dependencies',f'{rel}/lock-consistency','WARN','没有常见锁文件；本次不执行依赖安装。',[rel])
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
        add(r,'apk','android-public-assets-structure','PASS',f'发现 Android public 资源目录，含 {sum(p.is_file() for p in entries)} 个文件；未比较、不验证其是否与前端源码同步。',[str(assets.relative_to(root))])
        if index.is_file(): add(r,'apk','android-public-index-structure','PASS','Android 内置 public/index.html 存在；本项不判断内容新旧。',[str(index.relative_to(root))])
        else: add(r,'apk','android-public-index-structure','WARN','Android 内置 public 目录存在，但未找到 index.html。',[str(assets.relative_to(root))])
    else:
        add(r,'apk','android-public-assets-structure','WARN','未找到 android/app/src/main/assets/public；本项只记录工程结构，不执行同步。')

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

def scan_regression(root, files, r):
    markers=['package.json','android/app/src/main/AndroidManifest.xml','android/app/src/main/assets/public/index.html']
    present=[m for m in markers if (root/m).is_file()]
    add(r,'regression','project-markers','PASS' if present else 'UNVERIFIED',f'识别 {len(present)}/{len(markers)} 个常见项目标记文件。',present)
    known=[p for p in files if p.suffix.lower() in {'.js','.css','.html','.java','.kt','.xml'}]
    add(r,'regression','change-surface','PASS' if known else 'UNVERIFIED',f'当前静态扫描发现 {len(known)} 个可审查的相关文件；这不是自动回归通过证明。',[str(p.relative_to(root)) for p in known[:40]])
    add(r,'regression','manual-scope-warning','WARN','回归范围应按本次变更文件及调用关系补充；未配置业务断言的功能不能标记为通过。')

def run_opt_in(args, r, root):
    """The only optional operation retained here is a standalone Gradle APK build.

    AI assistants must not invoke it unless the task specifically requires APK packaging.
    It does not rebuild or synchronize web assets.
    """
    if not args.apk_build:
        return
    candidates=[(root/'android'/'gradlew',root/'android'),(root/'gradlew',root)]
    wrapper=next(((p,d) for p,d in candidates if p.is_file()),None)
    if not wrapper:
        add(r,'apk','assembleDebug','UNVERIFIED','未找到 gradlew；未执行 APK 构建。')
    elif not shutil.which('java'):
        add(r,'apk','assembleDebug','BLOCKED','找不到 Java；无法启动 Gradle。')
    else:
        p,cwd=wrapper
        try:
            if os.name!='nt' and not os.access(p,os.X_OK):
                add(r,'apk','gradlew-executable','WARN','gradlew 没有执行权限，将通过 sh gradlew 调用。')
            cmd=[str(p.resolve()),'assembleDebug'] if (os.name=='nt' or os.access(p,os.X_OK)) else ['sh',str(p.resolve()),'assembleDebug']
            proc=subprocess.run(cmd,cwd=cwd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=args.timeout)
            apk_paths=list((cwd/'app'/'build'/'outputs'/'apk').rglob('*.apk')) if (cwd/'app'/'build'/'outputs'/'apk').exists() else []
            ev=[proc.stdout[-18000:]]+[str(x.relative_to(root)) for x in apk_paths[:20]]
            status='PASS' if proc.returncode==0 and apk_paths else ('BLOCKED' if 'UnknownHostException' in proc.stdout or 'Could not resolve' in proc.stdout else 'FAIL')
            add(r,'apk','assembleDebug',status,f'Gradle 退出码 {proc.returncode}；发现 {len(apk_paths)} 个 APK 输出文件。此操作不证明 Android 内置前端资源为最新版本。',ev)
        except subprocess.TimeoutExpired:
            add(r,'apk','assembleDebug','BLOCKED',f'Gradle 构建超过 {args.timeout} 秒超时。')
        except Exception as e:
            add(r,'apk','assembleDebug','FAIL',f'APK 构建未完成：{e}')

def main():
    parser=argparse.ArgumentParser(description='MyBox tests: static checks only for frontend/assets; no frontend build or Android asset synchronization.')
    parser.add_argument('--root',default=str(ROOT),help='项目根目录（默认 tests/ 的上一级）')
    parser.add_argument('--only',choices=CATEGORIES,help='只运行一个静态检查类别')
    parser.add_argument('--apk-build',action='store_true',help='显式运行 Gradle assembleDebug；不会同步 Android 前端资源，仅在任务明确需要时使用')
    parser.add_argument('--timeout',type=int,default=900,help='可选 APK 构建操作的超时秒数')
    args=parser.parse_args(); root=Path(args.root).expanduser().resolve()
    if not root.is_dir(): print(f'项目目录不存在：{root}',file=sys.stderr); return 2
    r=Result(); files=list(project_files(root))
    if not args.only or args.only=='frontend': scan_frontend(root,files,r)
    if not args.only or args.only=='dependencies': scan_dependencies(root,files,r)
    if not args.only or args.only=='resources': static_resource_checks(root,files,r)
    if not args.only or args.only=='apk': scan_android(root,files,r)
    if not args.only or args.only=='dom_video': scan_dom_video(root,files,r)
    if not args.only or args.only=='regression': scan_regression(root,files,r)
    if args.apk_build: run_opt_in(args,r,root)
    REPORT_DIR.mkdir(parents=True,exist_ok=True)
    counts={s:sum(1 for x in r.items if x['status']==s) for s in ('PASS','WARN','FAIL','BLOCKED','UNVERIFIED')}
    report={'project_root':str(root),'generated_at_utc':datetime.now(timezone.utc).isoformat(),'mode':'static checks; optional standalone APK build only when explicitly requested','counts':counts,'results':r.items}
    (REPORT_DIR/'latest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    lines=[f'MyBox 测试检查报告',f'项目根目录：{root}',f'生成时间（UTC）：{report["generated_at_utc"]}',f'汇总：PASS={counts["PASS"]} WARN={counts["WARN"]} FAIL={counts["FAIL"]} BLOCKED={counts["BLOCKED"]} UNVERIFIED={counts["UNVERIFIED"]}','']
    for item in r.items:
        lines.append(f'[{item["status"]}] {item["category"]} / {item["check"]}: {item["message"]}')
        for ev in item.get('evidence',[])[:5]: lines.append('    - '+(str(ev).replace('\n',' ')[:800]))
    (REPORT_DIR/'latest.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('\n'.join(lines))
    print(f'\nJSON 报告：{REPORT_DIR / "latest.json"}')
    return 2 if counts['BLOCKED'] else (1 if counts['FAIL'] else 0)

if __name__=='__main__': raise SystemExit(main())
