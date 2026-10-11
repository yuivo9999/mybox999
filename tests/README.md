> AI 助手规则：先阅读项目根目录的 `AGENTS.md`。本文件介绍供 AI 助手执行开发、排障、构建及验证任务时使用的辅助工具；未实际执行的测试不得报告为通过。

# AI 辅助开发工具箱（随项目源码保存）

本目录及其中的脚本和依赖缓存主要服务于 AI 助手在当前开发执行环境中的工作。它们不是 MyBox APP 的产品功能、运行时依赖或最终 APK 的组成部分。工具可以检查和构建真实项目，但不因此成为产品需求。

默认执行的是**静态检查**，不安装依赖、不执行前端构建、不执行 APK 构建，也不连接 Android 实机。有副作用的动作必须通过明确命令启用。不要为了下载或安装 AI 助手自身的工具而修改产品部署流程或新增专用 CI/YAML 工作流。缺少可选工具时，应记录阻塞并继续完成其他可交付工作，不要让非关键环境问题拖延整体交付。

## 目录

- `run_tests.py`：统一入口，检查前端配置、依赖环境、资源引用、Android/Gradle 项目结构、DOM 视频相关架构线索、集成链路与回归基线。
- `frontend/`：前端文件、构建脚本、Vite/React 等声明、缺失依赖恢复启动器与启动器单元测试。
- `dependencies/`：运行环境、依赖声明、锁文件及 `node_modules` 状态检查；默认不安装依赖。
- `resources/`：HTML/CSS 静态资源引用完整性检查。
- `apk/`：Android/Gradle 工程和 APK 构建前置条件检查；仅使用 `--apk-build` 才实际运行 Gradle 构建。
- `environment/`：构建环境诊断及可校验的前端 `node_modules` 离线归档准备/恢复工具。
- `build/`：前端正式构建、Capacitor Android 资源同步、逐文件 SHA-256 校验、APK 内资源核验和 fail-fast 完整流水线。
- `toolchain-cache/frontend-deps/`：用于存放与当前锁文件和执行平台匹配的预置依赖包。
- `dom_video/`：静态搜索 DOM 视频元素、播放事件、WebView 桥接/全屏接口等线索；不等价于真实设备播放验证。
- `integration/`：Android 内置 `assets/public` 与前端入口的链接关系检查。
- `regression/`：确认关键项目文件和测试定义是否存在，并汇总诊断状态。

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
```

## Vite 缺失时：预置离线依赖，不在正常构建时随机下载

`dev`、`build`、`preview`、`lint` 和 `test` 都经由 `tests/frontend/run-vite.mjs`。如果本地 Vite 缺失，启动器只检查并恢复 `tests/toolchain-cache/frontend-deps/` 中的已验证归档，不会在正常构建时自动执行 `npm ci` 或访问 npm registry。

在有网络或完整 npm 缓存的维护环境中，明确运行一次：

```bash
python tests/environment/frontend_bundle.py --prepare
```

预置归档应由 AI 助手在条件合适的维护环境中显式准备并放回该目录；本项目不设置专门的 CI/YAML 工作流替 AI 下载工具。若当前环境无法准备归档，应报告阻塞，不要等待该可选项而延迟其他工作。

该命令会执行 `npm ci`、检查锁定的直接依赖版本、完成真实 `npm run build`，再打包 `node_modules` 并生成含 SHA-256、Node 版本、平台/架构、`package.json` 与 lockfile 哈希的 manifest。生成的归档和 `manifest.json` 必须一起随项目交付。当前项目包没有包含可用预置归档时，空环境离线构建仍然会 BLOCKED；不要用不完整 npm cache 假装预置完成。

检查、恢复和准备命令：

```bash
python tests/environment/frontend_bundle.py --verify
python tests/environment/frontend_bundle.py --restore
python tests/environment/frontend_bundle.py --check-installed
python tests/environment/build_doctor.py
```

`--prepare` 是显式维护操作，可能联网；`--restore` 与 `--verify` 不下载依赖。锁文件、项目依赖声明、Node 主版本、操作系统或 CPU 架构不匹配时，恢复应立即停止。

## 显式启用依赖安装或构建

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
```

`--install-node-deps`、`--frontend-build`、`--apk-build` 彼此独立。需要同时执行时，需显式同时给出参数。执行依赖安装或构建前，先检查当前分支、项目配置与网络/SDK 环境。当前环境若没有 Android SDK、Gradle wrapper 或下载权限，APK 构建可能无法运行；报告会记录失败原因，不会声称通过。

## UI 改动验证边界

本项目不包含 AI 视觉测试，不运行浏览器截图审查、视觉回归、截图差异比较或 AI 视觉复核。AI 助手不得重新引入这类测试工具、配置、依赖或运行命令。UI 变更通过源码审查、适用的静态检查、资源检查和现有非视觉功能测试进行验证；只有在任务需要且明确允许时，才执行前端构建。上述检查不代表已完成视觉审美验收。

## 状态解释

- `PASS`：该静态断言通过。
- `WARN`：有需要注意的风险或可选文件缺失，但不能据此断言整个功能失败。
- `FAIL`：执行的明确检查发现缺陷，或显式启动的操作实际失败。
- `BLOCKED`：因为缺少必要依赖、缓存、权限或环境前置条件，操作无法继续。
- `UNVERIFIED`：当前项目缺少可检查对象或该行为必须在其他运行环境验证。

源码和静态检查不能替代 Android 原生行为、真实设备 WebView、原生全屏或真实视频解码测试。DOM 视频扫描是静态架构审查，不保证直播源真实可播放。

## Android 内置前端资源同步与 APK 资源验收

不得把“Android assets 目录存在”当作最新 JS 已经进入 APP 的证据。资源权威源是本次成功构建的 `dist/`，构建清单保存在 `tests/reports/build/latest-assets-manifest.json`。

```bash
# 只读检查 Node/npm、预置依赖包、Java、Gradle 缓存和 Android SDK
python tests/run_tests.py --build-doctor

# 从源码重新构建，使用本地 Capacitor CLI 复制 Android 资源，然后逐文件核验 SHA-256
python tests/run_tests.py --android-assets-sync

# 对已有 PASS 清单再次核验 dist 与 Android assets/public
python tests/run_tests.py --verify-android-assets

# 完整流水线：前端构建、资源复制/核验、Gradle assembleDebug、APK 内资源哈希核验
python tests/run_tests.py --android-build-pipeline

# 同时构建和核验 Release APK
python tests/run_tests.py --android-build-pipeline --release

# 单独检查某个已构建 APK
python tests/run_tests.py --verify-apk-assets --apk-file android/app/build/outputs/apk/debug/app-debug.apk
```

同步脚本在前端构建失败时会停止，不执行复制；它不使用 `npx` 临时下载 Capacitor CLI。同步成功需要 `dist/` 与 Android `assets/public/` 每个期望文件内容哈希一致。APK 构建成功后，独立的 APK 检查会继续比较 APK 内的 `assets/public/` 与同一清单。旧/额外 JS/CSS 只会被报告，不会在没有来源证明时自动删除。

完整流水线报告与日志写入 `tests/reports/build/`。`PASS` 只表示对应实际步骤成功；`BLOCKED` 表示缺少本地依赖归档、Gradle 缓存、SDK 或网络条件等环境前置项；不得将未运行的 Gradle/APK 检查当作通过。
