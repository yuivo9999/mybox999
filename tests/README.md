# MyBox 测试工具箱（静态检查为主）

> AI 助手规则：先阅读项目根目录的 `AGENTS.md`。本目录只提供源码、配置、静态资源引用、Android 工程结构、DOM 视频架构线索和回归范围检查。

## 明确禁止：前端构建与 Android 前端资源同步

AI 助手不得运行前端构建命令，不得为构建安装/恢复依赖，不得执行 Android 前端资源复制/同步、dist 与 Android assets 哈希核验或相关流水线。禁止调用 `npm run build`、会触发构建的 `npm test`/`npm run lint`、`vite build`、Capacitor `copy/sync android` 或重新创建等价的测试工具。该规则需要用户明确撤销后才可更改。

本测试目录已删除前端构建/依赖归档准备工具、Android Web 资源同步和验收流水线及其命令行入口。正常开发所需的 npm 脚本位于根目录 `package.json`，但 AI 助手不得为了验证任务而运行前端构建。

## 静态检查入口

在项目根目录执行：

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
python tests/run_tests.py --only regression
```

这些检查不会安装依赖，不会执行 Vite 构建，不会复制/同步 Android 前端资源，也不会启动 Android 设备。默认检查可生成 `tests/reports/latest.json` 和 `tests/reports/latest.txt`。

`frontend` 只解析 `package.json`、锁文件和入口/源目录线索；`dependencies` 仅记录 Node/npm、依赖声明、锁文件及 `node_modules` 存在状态。它们不安装依赖、不验证前端构建产物。`resources` 检查 HTML/CSS 中可识别的本地静态引用；`apk` 检查 Android/Gradle 工程结构及内置资源目录存在性，不核验资源新旧；`dom_video` 仅检查源码中的视频/WebView 架构线索；`regression` 汇总可审查文件与项目标记。

## 独立 APK 构建

`python tests/run_tests.py --apk-build` 仅保留为独立 Gradle `assembleDebug` 入口。除非用户明确要求 APK 打包，AI 助手不要执行它。该操作不执行前端构建或 Android Web 资源同步，因此不能证明 APK 中的前端资源来自最新源码。

## 状态含义

- `PASS`：执行的静态断言通过。
- `WARN`：发现注意事项或可选文件缺失，不等于整个功能失败。
- `FAIL`：已执行的明确静态检查发现问题。
- `BLOCKED`：操作因环境或必要前置条件无法继续。
- `UNVERIFIED`：静态检查无法证明该行为，或当前缺少可检查对象。

静态检查不能证明实际页面交互、视频解码、真实 Android WebView 行为或 APK 的 Web 资源新鲜度。未执行的检查不得报告为通过。UI 任务禁止 AI 视觉测试、浏览器截图审查、视觉回归和截图对比。
