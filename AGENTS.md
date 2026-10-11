# AI 项目执行与测试规则

本文件是 AI 助手的工作指南；`tests/`、其中的脚本和 `toolchain-cache/` 是供 AI 助手在当前开发执行环境中使用的辅助工具箱。它们不是 MyBox APP 的产品功能、运行时依赖或终端用户需求。

工具边界：不要为了准备 AI 自身的 Node/Vite、Python、Gradle 或 Android SDK 工具而修改产品部署流程、增加产品依赖或新增专门下载这些工具的 CI/YAML 工作流。优先复用已有工具，能完成的主要任务应先交付；可选工具或环境缺失时，记录阻塞并继续完成不受影响的工作，不要为非关键缺项拖延整体交付。

开始任何代码修改任务前，先阅读本文件及 `tests/README.md`；不要假定存在的测试已经执行或已经通过。

## 1. 任务开始前

1. 先确认本次任务涉及的文件、调用关系和可能受影响的功能。
2. 阅读 `tests/README.md` 与 `tests/TEST_MATRIX.md`，选择与本次变更直接相关的检查。
3. 测试应以当前项目源代码为依据。检查前端源代码与 Android 内置资源时，必须区分其来源与版本。

## 2. 修改后必须按变更范围选择检查

- 前端 JS/TS、HTML、CSS 或 UI：检查源码差异、前端配置、资源引用及相关静态/功能测试。禁止执行 AI 视觉测试、浏览器截图审查或视觉回归测试。
- `package.json`、锁文件、Node/npm 配置：运行依赖检查；不要把“存在 node_modules”当作所有依赖完整可用的证明。
- Android、Gradle、Manifest 或构建配置：运行 APK 静态前置检查；只有需要验证构建、且环境可用时，才明确启用 APK 构建。
- WebView、DOM video、播放器、原生全屏或视频生命周期：运行 `dom_video` 检查，并审查相关的 Android/WebView 集成与资源释放逻辑。
- Android 内置前端资源或资源复制流程：运行资源与集成检查，核对入口文件、资源路径和哈希资源引用。
- 共享模块或跨模块改动：根据调用关系增加必要的集成和回归检查。

测试入口：

```bash
python tests/run_tests.py
```

按类别检查：

```bash
python tests/run_tests.py --only frontend
python tests/run_tests.py --only dependencies
python tests/run_tests.py --only resources
python tests/run_tests.py --only apk
python tests/run_tests.py --only dom_video
python tests/run_tests.py --only integration
python tests/run_tests.py --only regression
```

UI 任务不得运行或新增 AI 视觉测试；只使用允许的源码检查、静态检查和非视觉功能测试。

## 3. 会改变环境或执行构建的命令必须明确启用

以下操作不是默认静态检查，不要为了形式而自动执行。仅当任务目标需要、用户允许且环境满足条件时才运行：

- `python tests/run_tests.py --install-node-deps`
- `python tests/run_tests.py --frontend-build`
- `python tests/run_tests.py --apk-build`
- `python tests/run_tests.py --frontend-bundle-prepare`（明确启用的维护操作，可能访问 npm registry 并生成平台专用依赖归档）
- `python tests/run_tests.py --android-assets-sync`（重新构建、复制 Android 资源并执行 SHA-256 核验）
- `python tests/run_tests.py --android-build-pipeline`（完整 Android 构建和 APK 内容核验）

执行之前先确认项目目录、锁文件、工具链及执行影响。依赖安装和构建失败时，保留关键错误并如实报告；不得声称没有实际执行的检查已经通过。

## 4. 测试结论必须可追溯

- 只将实际执行并满足断言的检查标记为通过。
- `PASS`、`WARN`、`FAIL`、`BLOCKED`、`UNVERIFIED` 含义不同，不得将警告或未验证描述为通过。
- 报告相关命令、关键输出、失败原因和输出报告路径。
- 代码静态扫描只能证明被检查到的静态条件；不能证明实际页面交互、服务器可用性、视频解码或 Android 原生行为一定正常。
- 单个子模块或静态检查的通过结果不能替代真实业务功能验证。
- Android 内置资源可能落后于源代码；测试之前应确认实际加载的资源版本，不能把旧资源的结果当作最新修改的验证。

## 5. 平台边界

项目以 Android 手机 App 和手机浏览器为目标。测试设计应优先考虑触摸交互、手机竖屏及用户主动切换横屏的场景，不引入无关的桌面鼠标使用假设。

不得安排或声称执行真实 Android 设备测试、实机演示。静态 DOM 视频架构检查和 APK 构建均不得冒充实机验证。

## 6. 控制测试范围

优先完成与本次修改直接相关的轻量检查。涉及共享代码、关键播放流程或资源同步的修改，再扩大到相关集成和回归检查。不要在没有新证据或依赖关系的情况下，反复重做已经完成且与当前改动无关的检查。

## 7. 前端与 UI 改动验证（禁止 AI 视觉测试）

- 本项目明确不进行 AI 视觉测试。AI 助手不得运行、恢复、安装、配置或新增用于视觉审查的 Playwright/Chromium 浏览器测试、截图采集、截图对比、视觉基线、截图联系表或 AI 视觉复核工具。
- 不得因 UI、布局、主题、播放器控件或触控交互发生变化而调用视觉测试命令；不要新增视觉测试依赖、测试目录、运行入口或 CI 工作流。
- UI 改动只按实际变更范围进行源码审查、差异检查、配置/资源静态检查及现有非视觉功能测试。若环境允许且任务确有需要，可执行已批准的前端构建或非视觉功能测试；构建和功能测试不能被描述成视觉审美验收。
- 报告中只列出实际执行的检查，并如实标明通过、失败、阻塞或未执行。不得声称查看了浏览器截图或完成了视觉验收。

## 8. 构建可复现性与 Android 前端资源来源（构建/资源任务必须遵守）

- 常规 `npm run build` 不得临时执行 `npm ci` 或联网获取依赖。Vite 缺失时，只允许由 `tests/environment/frontend_bundle.py --restore` 从预置且校验通过的 `node_modules` 归档恢复。
- 预置依赖包必须与当前 `package.json`、`package-lock.json` SHA-256、Node 主版本、操作系统及 CPU 架构匹配。更换锁文件或平台后必须重新准备，不能重用未匹配归档。
- `python tests/environment/frontend_bundle.py --prepare` 是明确的维护操作：可以安装依赖、执行正式前端构建并生成平台专用归档；执行前应确认环境允许访问 npm registry 或已有完整缓存。
- Android Web 资源的唯一权威源是本次成功构建的 `dist/`。不得将已存在的 Android `assets/public` 或旧 `dist/` 当作本次构建的成功结果。
- 资源同步必须先确认 `npm run build` 成功，再执行本地 Capacitor CLI `copy android`，随后按 SHA-256 比较 `dist/` 与 `android/app/src/main/assets/public/` 的每个文件。任一步失败都不得继续声称资源最新。
- APK 构建成功后，必须检查 APK 内 `assets/public/` 的文件是否与本次成功资源清单哈希匹配。Gradle 成功不单独证明前端资源最新。
- 不要自动删除来源不明确的额外 Android 资源；先报告可能过期的 JS/CSS，只有被可靠清单证明可安全删除时才清理。
- 推荐执行入口：`python tests/run_tests.py --build-doctor`（只读环境诊断）、`--android-assets-sync`（构建/同步/核验）、`--verify-android-assets`（资源再核验）和 `--android-build-pipeline`（完整流水线）。
- 预置依赖归档属于 AI 助手的可选辅助材料，不是 MyBox 产品交付的必需组件。若归档不存在或当前环境无法制作，应明确报告并继续交付其他已完成内容；不要为准备这类工具添加产品 CI/YAML 下载流程。
