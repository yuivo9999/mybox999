# 测试矩阵与边界

| 类别 | 默认检查 | 明确不检查 | 默认是否修改项目 |
|---|---|---|---|
| 前端 | `package.json`/锁文件可解析、入口/源目录线索、JS/TS 文件存在 | Vite 运行、前端构建、构建产物有效性 | 否 |
| 依赖 | Node/npm 可用状态、依赖声明、锁文件及 `node_modules` 目录状态 | 安装依赖、恢复离线归档、实际依赖完整性验证 | 否 |
| 资源 | HTML/CSS 可识别的本地静态资源引用 | 动态 import、运行时 API、前端构建产物与 Android 资源同步 | 否 |
| APK | Android 目录、Gradle 配置、wrapper、Manifest、内置资源目录存在性 | Gradle/APK 构建（除非单独显式授权）、APK 内 Web 资源核验 | 否 |
| DOM 视频 | 静态搜寻 video/WebView/播放/全屏错误处理线索 | 真实 DOM 状态、视频解码、原生 WebView 行为 | 否 |
| 回归 | 关键项目文件及可审查文件范围提示 | 未配置场景的业务行为断言 | 否 |

## AI 执行限制

本项目禁止 AI 助手主动执行前端构建与 Android 前端资源同步。不得运行 `npm run build`、会触发构建的 `npm test`/`npm run lint`、`vite build`、前端依赖归档准备/恢复、Capacitor 资源 `copy/sync android`、dist 与 Android assets 哈希核验或任何等价流水线。相关测试脚本和入口已移除；AI 不得重新创建它们。只有用户明确撤销此限制后，才重新评估对应任务。

`tests/run_tests.py --only apk` 仅检查 Android/Gradle/内置目录的静态结构。可选 `--apk-build` 是独立的 Gradle APK 打包操作，只有用户明确要求 APK 打包时才使用；它不会同步前端资源，也不证明 Android 内置资源对应当前源码。

本项目禁止 AI 视觉测试：不得运行或添加浏览器截图审查、截图比较、视觉基线、Playwright/Chromium 视觉用例或 AI 视觉复核工具。UI 改动只使用源码审查、适用的静态检查及允许的非视觉功能测试。

必须区分 `PASS`、`WARN`、`FAIL`、`BLOCKED`、`UNVERIFIED`。没有运行的检查及不能由静态分析证明的行为，均不得描述为已经通过。
