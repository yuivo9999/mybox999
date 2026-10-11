> AI 编码助手规则：请先阅读项目根目录的 `AGENTS.md`。本文件说明测试工具的能力与命令；测试模块必须按当前任务选择，未执行的测试不得报告为通过。

# MyBox 项目测试工具集

这是一套可放在 MyBox 项目根目录下的 `tests/` 工具集。默认执行的是**静态检查**，不安装依赖、不执行前端构建、不执行 APK 构建，也不连接 Android 实机。需要这些有副作用的动作时，必须通过明确的命令参数单独启用。

## 目录

- `run_tests.py`：统一入口，检查前端配置、依赖环境、资源引用、Android/Gradle 项目结构、DOM 视频相关架构线索、集成链路与回归基线。
- `frontend/`：前端文件、构建脚本、Vite/React 等声明、缺失依赖恢复启动器与启动器单元测试。
- `dependencies/`：运行环境、依赖声明、锁文件及 `node_modules` 状态检查；默认不安装依赖。
- `resources/`：HTML/CSS 静态资源引用完整性检查。
- `apk/`：Android/Gradle 工程和 APK 构建前置条件检查；仅使用 `--apk-build` 才实际运行 Gradle 构建。
- `dom_video/`：静态搜索 DOM 视频元素、播放事件、WebView 桥接/全屏接口等线索；不等价于真实设备播放验证。
- `integration/`：Android 内置 `assets/public` 与前端入口的链接关系检查。
- `regression/`：确认关键项目文件和测试定义是否存在，并汇总诊断状态。
- `ai_visual_test/`：Playwright/Chromium 浏览器视觉测试，包括 Demo 自检、真实 Vite 页面测试、DOM 定位、坐标/尺寸、手机视口溢出、截图、错误监控、视觉基线、trace、截图联系表与 AI 视觉复核记录。

## 快速开始

在项目根目录执行：

```bash
python tests/run_tests.py
```

这会生成 `tests/reports/latest.json` 和 `tests/reports/latest.txt`。命令只做静态检查，不改写项目业务文件。

只检查某个类别：

```bash
python tests/run_tests.py --only frontend
python tests/run_tests.py --only dependencies
python tests/run_tests.py --only resources
python tests/run_tests.py --only apk
python tests/run_tests.py --only dom_video
python tests/run_tests.py --only integration
python tests/run_tests.py --only regression
python tests/run_tests.py --only ai_visual
```

## Vite 缺失时的自动恢复

前端 `dev`、`build`、`preview`、`lint` 和 `test` 命令通过 `tests/frontend/run-vite.mjs` 启动本地 Vite。如果未安装或 Vite 文件不完整，启动器会在存在锁文件时尝试 `npm ci --no-audit --no-fund`，然后重新核对 CLI。该机制依赖可用的 Node.js 22+、npm 和网络/registry；离线或安装失败时会明确报出依赖安装错误，不能凭启动器绕过下载限制。恢复机制本身可用 `npm run test:frontend-bootstrap` 进行无网络单元测试。

## 显式启用依赖安装、构建或浏览器测试

这些操作默认关闭，只有在明确指定参数时才会尝试执行：

```bash
# 仅检查依赖，不安装
python tests/run_tests.py --only dependencies

# 按锁文件执行 npm ci；如果没有锁文件则停止并要求先确认项目依赖策略
python tests/run_tests.py --install-node-deps

# 执行 package.json 中已声明的 build 脚本；如果本地 Vite 缺失，会由启动器尝试恢复依赖
python tests/run_tests.py --frontend-build

# 执行 Android Gradle assembleDebug（不安装、不运行 APK、不连接设备）
python tests/run_tests.py --apk-build

# 启动内置 Demo 的本地 HTTP 服务并执行 Playwright 测试
python tests/run_tests.py --visual
```

`--install-node-deps`、`--frontend-build`、`--apk-build` 彼此独立。需要同时执行时，需显式同时给出参数。执行依赖安装或构建前，先检查当前分支、项目配置与网络/SDK 环境。当前环境若没有 Android SDK、Gradle wrapper 或下载权限，APK 构建可能无法运行；报告会记录失败原因，不会声称通过。

## 真实页面视觉验证与 AI 复核

`python tests/run_tests.py --visual-app` 会通过项目中的 `tests/frontend/run-vite.mjs` 启动真实 MyBox Vite 页面，使用 `config.mybox.example.json` 点击底部“直播”导航，再检查 LIVE 主界面。该命令是显式的运行型检查，依赖缺失时可能按锁文件恢复 npm 依赖；若环境无网络、依赖安装失败或 Chromium 不可启动，必须记录实际错误，不得把 Demo 测试当成真实页面通过。

`python tests/run_tests.py --visual` 只用于测试工具自身的 Demo 自检。Demo 页面通过不能证明 MyBox 的实际 UI 已通过。

每次视觉测试会在 `tests/ai_visual_test/artifacts/` 保存 PNG 截图、Playwright trace，在 `tests/ai_visual_test/reports/` 保存测试摘要、元素坐标/尺寸、控制台和资源错误信息及 `AI_REVIEW.md`。运行器会尽力生成 `contact-sheet.png` 作为截图总览。需要检查具体细节时，仍须打开原始截图，不可只看缩略图。

AI/开发者必须实际查看真实页面截图，检查布局、层级、遮挡、文字截断、配色与手机视口表现；通过自动化断言不等于视觉审美验收。使用 `ai_visual_test/review-template.md` 记录结论。报告中的 AI 视觉复核会保持 `PENDING`，直到执行者实际检查截图并填写记录。

要改测其他真实页面，可复制 `config.mybox.example.json`，配置 `base_url`、启动动作、关键选择器、交互及视口；不要把 Demo 专用选择器留给真实页面。Android 内置资源测试需另行确认资源确为本次源码的构建产物。

## 状态解释

- `PASS`：该静态断言通过。
- `WARN`：有需要注意的风险或可选文件缺失，但不能据此断言整个功能失败。
- `FAIL`：执行的明确检查发现缺陷，或显式启动的操作实际失败。
- `UNVERIFIED`：当前项目缺少可检查对象或该行为必须在其他运行环境验证。

浏览器测试不能替代 Android 原生行为、真实设备 WebView、原生全屏或真实视频解码测试。DOM 视频扫描是静态架构审查，不保证直播源真实可播放。
