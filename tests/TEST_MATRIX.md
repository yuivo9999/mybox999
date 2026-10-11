# 测试矩阵与边界

| 类别 | 默认检查 | 需要真实运行环境的部分 | 默认是否修改项目 |
|---|---|---|---|
| 前端 | package.json、build 脚本、依赖声明、Vite 离线归档恢复接线、入口与文件数量 | 显式离线归档准备/恢复、npm run build、页面交互 | 否；缺少依赖时只从校验过的本地归档恢复；常规构建不联网 |
| 依赖 | node/npm、lockfile、node_modules 状态 | `npm ci` 安装及依赖实际可用性 | 否；显式参数才安装 |
| 资源 | HTML/CSS 可识别本地路径 | 动态 import、运行时 API、服务端资源 | 否 |
| APK/Gradle | Android 目录、Gradle 配置、wrapper、manifest | Gradle/SDK 环境和实际 assembleDebug | 否；显式参数才构建 |
| DOM 视频 | 静态搜寻 video/WebView/播放/全屏错误处理线索 | 实际 DOM 状态、视频解码、原生 WebView 行为 | 否 |
| 集成 | 前端入口与 Android 预置资源存在性/引用线索 | 确认二者为同次构建、实际加载版本 | 否 |
| 回归 | 关键文件与检查覆盖率提示 | 按本次改动定义场景并执行 | 否 |
| 构建工具链 | 预置前端依赖 manifest/文件存在性、同步和 APK 校验工具接线 | `--build-doctor`、离线归档恢复、前端真实构建、Capacitor copy、SHA-256 内容比较、Gradle 编译和 APK 内容核验 | 只有显式调用 `--frontend-bundle-prepare`、`--android-assets-sync` 或 `--android-build-pipeline` 时才可能安装/构建/写资源；普通静态检查不联网、不构建 |

状态必须区分 PASS、WARN、FAIL、BLOCKED、UNVERIFIED。没有运行的测试及无法由静态分析证明的行为，均不得描述为已经通过。

## UI 改动的测试限制

本项目禁止 AI 视觉测试：不得运行或添加浏览器截图审查、截图比较、视觉基线、Playwright/Chromium 视觉用例或 AI 视觉复核工具。UI 改动只使用源码审查、适用的静态/资源检查及现有非视觉功能测试；不得把这些检查表述为视觉审美验收。

## 资源新鲜度验收

- 文件存在检查、哈希文件名检查或静态 HTML 引用检查，都不足以证明 Android 内置 JS 来自当前源代码。
- 本次正式构建必须生成 `latest-assets-manifest.json`；仅 `syncStatus=PASS` 的清单可用于 APK 资源验收。
- `verify_android_assets.py` 比较 `dist/` 与 `android/app/src/main/assets/public/` 实际文件 SHA-256。
- `verify_apk_assets.py` 从最终 APK 读取 `assets/public/` 并与同一构建清单逐项比对。
- 如果 `dist/` 不存在或前端构建失败，资源同步必须 BLOCKED/FAIL，而不能回退使用旧 Android 资源。
- 平台专用 `node_modules` 归档需要与当前 `package.json`、锁文件、Node 主版本及平台架构匹配；没有归档时不宣称空环境可以离线构建。
