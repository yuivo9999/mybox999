# AI 项目执行与测试规则

本文件是项目级工作指令。开始任何代码修改任务前，先阅读本文件及 `tests/README.md`；不要假定存在的测试已经执行或已经通过。

## 1. 任务开始前

1. 先确认本次任务涉及的文件、调用关系和可能受影响的功能。
2. 阅读 `tests/README.md` 与 `tests/TEST_MATRIX.md`，选择与本次变更直接相关的检查。
3. 测试应以当前项目源代码为依据。检查前端源代码、Android 内置资源和独立 Demo 时，必须区分其来源与版本。

## 2. 修改后必须按变更范围选择检查

- 前端 JS/TS、HTML、CSS 或 UI：运行前端与资源检查；涉及界面布局/交互时，检查视觉测试配置，条件允许时运行浏览器测试。
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

AI 浏览器视觉测试（需要可用的 Playwright/pytest/Chromium 环境）：

```bash
python tests/run_tests.py --visual
```

## 3. 会改变环境或执行构建的命令必须明确启用

以下操作不是默认静态检查，不要为了形式而自动执行。仅当任务目标需要、用户允许且环境满足条件时才运行：

- `python tests/run_tests.py --install-node-deps`
- `python tests/run_tests.py --frontend-build`
- `python tests/run_tests.py --apk-build`

执行之前先确认项目目录、锁文件、工具链及执行影响。依赖安装和构建失败时，保留关键错误并如实报告；不得声称没有实际执行的检查已经通过。

## 4. 测试结论必须可追溯

- 只将实际执行并满足断言的检查标记为通过。
- `PASS`、`WARN`、`FAIL`、`UNVERIFIED` 含义不同，不得将警告或未验证描述为通过。
- 报告相关命令、关键输出、失败原因和输出报告路径。
- 代码静态扫描只能证明被检查到的静态条件；不能证明实际页面交互、服务器可用性、视频解码或 Android 原生行为一定正常。
- 独立 Demo 的通过结果不能替代 MyBox 实际页面的测试结果。
- Android 内置资源可能落后于源代码；测试之前应确认实际加载的资源版本，不能把旧资源的结果当作最新修改的验证。

## 5. 平台边界

项目以 Android 手机 App 和手机浏览器为目标。测试设计应优先考虑触摸交互、手机竖屏及用户主动切换横屏的场景，不引入无关的桌面鼠标使用假设。

不得安排或声称执行真实 Android 设备测试、实机演示。浏览器视觉测试、静态 DOM 视频架构检查和 APK 构建均不得冒充实机验证。

## 6. 控制测试范围

优先完成与本次修改直接相关的轻量检查。涉及共享代码、关键播放流程或资源同步的修改，再扩大到相关集成和回归检查。不要在没有新证据或依赖关系的情况下，反复重做已经完成且与当前改动无关的检查。
