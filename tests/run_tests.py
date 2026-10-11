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
CATEGORIES = ("frontend", "dependencies", "resources", "apk", "dom_video", "integration", "regression", "build_toolchain")

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
        if 'vite' in deps:
            launcher=p.parent/'tests'/'frontend'/'run-vite.mjs'
            uses_launcher='run-vite.mjs' in str(scripts.get('build',''))
            if launcher.is_file() and uses_launcher and any(name in found for name in ('package-lock.json','npm-shrinkwrap.json')):
                add(r,'frontend',f'{rel}/vite-bootstrap','PASS','build 脚本经由 Vite 启动器；依赖缺失时只允许使用已验证的本地离线依赖包，不会在常规构建中临时联网下载。',[str(launcher.relative_to(root)),rel])
            elif launcher.is_file():
                add(r,'frontend',f'{rel}/vite-bootstrap','WARN','存在 Vite 启动器，但 build 脚本或 npm 锁文件尚未完整接入自动恢复。',[str(launcher.relative_to(root)),rel])
            else:
                add(r,'frontend',f'{rel}/vite-bootstrap','WARN','尚未发现本项目的 Vite 缺失依赖恢复启动器；node_modules 不完整时仍可能报 vite: not found。',[rel])
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
        if 'vite' in deps:
            vite_package=nm/'vite'/'package.json'
            vite_launcher=p.parent/'tests'/'frontend'/'run-vite.mjs'
            if vite_package.is_file():
                try:
                    vite_data=json.loads(vite_package.read_text(encoding='utf-8'))
                    vite_bin=vite_data.get('bin') or {}
                    vite_bin=vite_bin if isinstance(vite_bin,str) else vite_bin.get('vite')
                    vite_cli=(vite_package.parent/vite_bin).is_file() if isinstance(vite_bin,str) else False
                except Exception: vite_cli=False
                add(r,'dependencies',f'{rel}/local-vite-cli','PASS' if vite_cli else 'WARN','已找到可执行的本地 Vite CLI。' if vite_cli else 'Vite 元数据存在，但 CLI 文件缺失或无效。',[str(vite_package.relative_to(root))])
            elif vite_launcher.is_file():
                add(r,'dependencies',f'{rel}/local-vite-cli','WARN','本地 Vite 尚未安装；启动器只会从校验过的离线依赖归档恢复，常规构建不会联网下载。',[str(vite_launcher.relative_to(root))])
            else:
                add(r,'dependencies',f'{rel}/local-vite-cli','WARN','本地 Vite 尚未安装，且未找到自动恢复启动器。',[rel])
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

def scan_build_toolchain(root, files, r):
    required = [
        'tests/environment/frontend_bundle.py',
        'tests/environment/build_doctor.py',
        'tests/build/sync_android_assets.py',
        'tests/build/verify_android_assets.py',
        'tests/build/verify_apk_assets.py',
        'tests/build/android_build_pipeline.py',
    ]
    missing = [rel for rel in required if not (root/rel).is_file()]
    if missing:
        add(r,'build_toolchain','tooling-files','FAIL','构建可靠性工具不完整，缺少文件。',missing)
    else:
        add(r,'build_toolchain','tooling-files','PASS','构建依赖预置、环境诊断、Android 资源同步/哈希核验和 APK 核验工具均存在。',required)
    manifest=root/'tests'/'toolchain-cache'/'frontend-deps'/'manifest.json'
    if not manifest.is_file():
        add(r,'build_toolchain','offline-frontend-bundle','WARN','当前项目包尚未包含经验证的预置 node_modules 归档；空环境离线构建仍受阻。准备命令：python tests/environment/frontend_bundle.py --prepare。')
    else:
        add(r,'build_toolchain','offline-frontend-bundle','PASS','找到前端离线依赖包 manifest；实际文件哈希/平台校验需运行 build_doctor。',[str(manifest.relative_to(root))])

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
    dist=root/'dist'
    android_assets=root/'android'/'app'/'src'/'main'/'assets'/'public'
    if not (dist/'index.html').is_file():
        add(r,'integration','dist-to-android-content','UNVERIFIED','没有 dist/index.html；仅凭旧 Android assets 存在不能证明最新源码已进入 APP。')
    elif not android_assets.is_dir():
        add(r,'integration','dist-to-android-content','UNVERIFIED','Android assets/public 不存在，无法比较当前构建产物。')
    else:
        import hashlib
        def sha(path):
            h=hashlib.sha256()
            with path.open('rb') as stream:
                for chunk in iter(lambda:stream.read(1024*1024),b''): h.update(chunk)
            return h.hexdigest()
        expected={f.relative_to(dist).as_posix():f for f in dist.rglob('*') if f.is_file()}
        missing=[]; mismatched=[]
        for rel, src in expected.items():
            dst=android_assets/Path(rel)
            if not dst.is_file(): missing.append(rel)
            elif sha(src)!=sha(dst): mismatched.append(rel)
        state='PASS' if not missing and not mismatched else 'FAIL'
        add(r,'integration','dist-to-android-content',state,f'按文件内容核验 dist 与 Android assets：期望 {len(expected)} 个文件，缺失 {len(missing)}，哈希不一致 {len(mismatched)}。',missing[:30]+mismatched[:30])

def scan_regression(root, files, r):
    markers=['package.json','android/app/src/main/AndroidManifest.xml','android/app/src/main/assets/public/index.html']
    present=[m for m in markers if (root/m).is_file()]
    add(r,'regression','project-markers','PASS' if present else 'UNVERIFIED',f'识别 {len(present)}/{len(markers)} 个常见项目标记文件。',present)
    known=[p for p in files if p.suffix.lower() in {'.js','.css','.html','.java','.kt','.xml'}]
    add(r,'regression','change-surface','PASS' if known else 'UNVERIFIED',f'当前静态扫描发现 {len(known)} 个可审查的相关文件；这不是自动回归通过证明。',[str(p.relative_to(root)) for p in known[:40]])
    add(r,'regression','manual-scope-warning','WARN','回归范围应按本次变更文件及调用关系补充；未配置业务断言的功能不能标记为通过。')

def run_project_tool(root, r, category, check_name, script_rel, extra_args=None, timeout=1800):
    script = root / script_rel
    if not script.is_file():
        add(r, category, check_name, 'FAIL', f'缺少工具脚本：{script_rel}')
        return
    cmd = [sys.executable, str(script), '--root', str(root)] + list(extra_args or [])
    try:
        proc = subprocess.run(cmd, cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
        output = proc.stdout[-22000:]
        if proc.returncode == 0:
            status = 'PASS'
        elif proc.returncode == 2 or 'BLOCKED:' in output or '"status": "BLOCKED"' in output:
            status = 'BLOCKED'
        else:
            status = 'FAIL'
        add(r, category, check_name, status, f'执行退出码 {proc.returncode}。', [output])
    except subprocess.TimeoutExpired as exc:
        captured = (exc.stdout or b'').decode('utf-8', errors='replace') if isinstance(exc.stdout, bytes) else (exc.stdout or '')
        add(r, category, check_name, 'BLOCKED', f'操作超过 {timeout} 秒超时。', [captured[-12000:]])
    except Exception as exc:
        add(r, category, check_name, 'FAIL', f'执行工具失败：{exc}')

def run_opt_in(args, r, root):
    if args.android_build_pipeline:
        extra = ['--timeout', str(args.timeout)] + (['--release'] if args.release else [])
        run_project_tool(root, r, 'build_toolchain', 'android-build-pipeline', 'tests/build/android_build_pipeline.py', extra, args.timeout + 2400)
        return
    if args.build_doctor:
        extra = ['--node', '--android'] + (['--network'] if args.network_check else [])
        run_project_tool(root, r, 'build_toolchain', 'build-doctor', 'tests/environment/build_doctor.py', extra, 120)
    if args.frontend_bundle_prepare:
        run_project_tool(root, r, 'build_toolchain', 'frontend-bundle-prepare', 'tests/environment/frontend_bundle.py', ['--prepare', '--timeout', str(args.timeout)], args.timeout + 120)
    if args.android_assets_sync:
        run_project_tool(root, r, 'integration', 'android-assets-sync', 'tests/build/sync_android_assets.py', ['--timeout', str(args.timeout)], args.timeout + 120)
    if args.verify_android_assets:
        run_project_tool(root, r, 'integration', 'android-assets-sha256', 'tests/build/verify_android_assets.py', [], 120)
    if args.verify_apk_assets:
        if not args.apk_file:
            add(r, 'integration', 'apk-assets-sha256', 'FAIL', '使用 --verify-apk-assets 时必须同时提供 --apk-file 路径。')
        else:
            apk = Path(args.apk_file)
            if not apk.is_absolute(): apk = root / apk
            run_project_tool(root, r, 'integration', 'apk-assets-sha256', 'tests/build/verify_apk_assets.py', ['--apk', str(apk)], 120)
    if args.install_node_deps:
        p = root / 'package.json'
        if not p.is_file(): add(r,'dependencies','npm-install','UNVERIFIED','根目录没有 package.json；未执行依赖安装。')
        elif not shutil.which('npm'): add(r,'dependencies','npm-install','FAIL','找不到 npm。')
        elif not ((root/'package-lock.json').is_file() or (root/'npm-shrinkwrap.json').is_file()): add(r,'dependencies','npm-install','FAIL','没有 npm 锁文件；为避免不可复现安装，停止执行。')
        else:
            try:
                proc=subprocess.run(['npm','ci','--no-audit','--no-fund'],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=args.timeout)
                status = 'PASS' if proc.returncode == 0 else ('BLOCKED' if 'ENOTCACHED' in proc.stdout or 'ENOTFOUND' in proc.stdout or 'EAI_AGAIN' in proc.stdout else 'FAIL')
                add(r,'dependencies','npm-install',status,f'npm ci 退出码 {proc.returncode}。',[proc.stdout[-16000:]])
            except Exception as e: add(r,'dependencies','npm-install','FAIL',f'npm ci 未完成：{e}')
    if args.frontend_build:
        p=root/'package.json'
        if not p.is_file(): add(r,'frontend','npm-build','UNVERIFIED','根目录没有 package.json。')
        else:
            try: data=json.loads(p.read_text(encoding='utf-8'))
            except Exception as e: data={}; add(r,'frontend','npm-build','FAIL',f'package.json 解析失败：{e}')
            if data and 'build' not in (data.get('scripts') or {}): add(r,'frontend','npm-build','FAIL','package.json 没有 scripts.build。')
            elif data:
                try:
                    proc=subprocess.run(['npm','run','build'],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=args.timeout)
                    output=proc.stdout[-16000:]
                    status='PASS' if proc.returncode==0 else ('BLOCKED' if 'BLOCKED:' in output or 'No pre-provisioned' in output else 'FAIL')
                    add(r,'frontend','npm-build',status,f'npm run build 退出码 {proc.returncode}。',[output])
                except subprocess.TimeoutExpired as e: add(r,'frontend','npm-build','BLOCKED',f'前端构建超过 {args.timeout} 秒超时。')
                except Exception as e: add(r,'frontend','npm-build','FAIL',f'前端构建未完成：{e}')
    if args.apk_build:
        candidates=[(root/'android'/'gradlew',root/'android'),(root/'gradlew',root)]
        wrapper=next(((p,d) for p,d in candidates if p.is_file()),None)
        if not wrapper: add(r,'apk','assembleDebug','UNVERIFIED','未找到 gradlew；未执行 APK 构建。')
        elif not shutil.which('java'): add(r,'apk','assembleDebug','BLOCKED','找不到 Java；无法启动 Gradle。')
        else:
            p,cwd=wrapper
            try:
                if os.name!='nt' and not os.access(p,os.X_OK): add(r,'apk','gradlew-executable','WARN','gradlew 没有执行权限，将通过 sh gradlew 调用。')
                cmd=[str(p.resolve()),'assembleDebug'] if (os.name=='nt' or os.access(p,os.X_OK)) else ['sh',str(p.resolve()),'assembleDebug']
                proc=subprocess.run(cmd,cwd=cwd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=args.timeout)
                apk_paths=list((cwd/'app'/'build'/'outputs'/'apk').rglob('*.apk')) if (cwd/'app'/'build'/'outputs'/'apk').exists() else []
                ev=[proc.stdout[-18000:]]+[str(x.relative_to(root)) for x in apk_paths[:20]]
                status='PASS' if proc.returncode==0 and apk_paths else ('BLOCKED' if 'UnknownHostException' in proc.stdout or 'Could not resolve' in proc.stdout else 'FAIL')
                add(r,'apk','assembleDebug',status,f'Gradle 退出码 {proc.returncode}；发现 {len(apk_paths)} 个 APK 输出文件。',ev)
            except subprocess.TimeoutExpired: add(r,'apk','assembleDebug','BLOCKED',f'Gradle 构建超过 {args.timeout} 秒超时。')
            except Exception as e: add(r,'apk','assembleDebug','FAIL',f'APK 构建未完成：{e}')

def main():
    parser=argparse.ArgumentParser(description='MyBox test suite; defaults to static checks only.')
    parser.add_argument('--root',default=str(ROOT),help='项目根目录（默认 tests/ 的上一级）')
    parser.add_argument('--only',choices=CATEGORIES,help='只运行一个静态检查类别')
    parser.add_argument('--build-doctor',action='store_true',help='只读诊断前端/Gradle/Android SDK 工具链；不安装、不下载')
    parser.add_argument('--frontend-bundle-prepare',action='store_true',help='显式准备离线前端依赖归档；此操作可能执行 npm ci 和前端构建')
    parser.add_argument('--android-assets-sync',action='store_true',help='重新构建前端、同步 Android 内置资源并执行 SHA-256 核验')
    parser.add_argument('--verify-android-assets',action='store_true',help='按本次构建清单核验 dist 与 Android assets/public')
    parser.add_argument('--verify-apk-assets',action='store_true',help='核验指定 APK 中的前端资源内容')
    parser.add_argument('--apk-file',default=None,help='与 --verify-apk-assets 配合的 APK 路径')
    parser.add_argument('--network-check',action='store_true',help='与 --build-doctor 配合，显式检查相关域名 DNS；不下载数据')
    parser.add_argument('--android-build-pipeline',action='store_true',help='执行完整前端构建、Android 资源同步、Gradle 构建及 APK 内容核验')
    parser.add_argument('--release',action='store_true',help='与 --android-build-pipeline 配合，同时构建/核验 Release APK')
    parser.add_argument('--install-node-deps',action='store_true',help='显式安装根目录 npm 依赖（需要 package-lock.json/npm-shrinkwrap.json）')
    parser.add_argument('--frontend-build',action='store_true',help='显式运行 npm run build')
    parser.add_argument('--apk-build',action='store_true',help='显式运行 Gradle assembleDebug；不会安装 APK 或连接设备')
    parser.add_argument('--timeout',type=int,default=900,help='显式安装/构建操作的超时秒数')
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
    if not args.only or args.only=='build_toolchain': scan_build_toolchain(root,files,r)
    if args.install_node_deps or args.frontend_build or args.apk_build or args.build_doctor or args.frontend_bundle_prepare or args.android_assets_sync or args.verify_android_assets or args.verify_apk_assets or args.android_build_pipeline: run_opt_in(args,r,root)
    REPORT_DIR.mkdir(parents=True,exist_ok=True)
    counts={s:sum(1 for x in r.items if x['status']==s) for s in ('PASS','WARN','FAIL','BLOCKED','UNVERIFIED')}
    report={'project_root':str(root),'generated_at_utc':datetime.now(timezone.utc).isoformat(),'mode':'static plus explicitly selected operations','counts':counts,'results':r.items}
    # The report is in this tests suite path; for alternate --root this remains beside the test tool.
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
