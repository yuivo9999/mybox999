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
| AI 视觉 | `--visual` 自检 Demo；`--visual-app` 启动真实 Vite 页面进入 LIVE；元素可见性/几何、手机宽度溢出、交互、控制台/请求错误、截图、trace、基线对比与 AI 复核清单 | Python Playwright/pytest/Pillow、可用 Chromium、真实页面启动及资源环境 | 运行时会写 `tests/ai_visual_test/reports/` 和 `artifacts/`；真实页面模式只从经过校验的本地离线归档恢复缺失依赖，正常构建不联网下载 |

状态必须区分 PASS、WARN、FAIL、BLOCKED、UNVERIFIED。没有运行的测试、缺少真实页面的测试及无法由静态分析证明的行为，均不得描述为已经通过。

## AI 视觉复核补充要求

- `python tests/run_tests.py --visual` 仅验证 Demo 测试链路；真实应用 UI 必须使用 `python tests/run_tests.py --visual-app` 或等效的真实页面配置。
- 真实页面模式会自动进入配置指定的 LIVE 页面并在 320/360/390/412 CSS px 宽度下截图及检查，测试目标、选择器与启动动作保存在 `tests/ai_visual_test/config.mybox.example.json`。
- 测试摘要、截图联系表、元素几何 JSON、浏览器错误信息和 trace 均应保留为诊断证据。联系表只供快速浏览，不代替原始截图。
- `AI_REVIEW.md` 的视觉结论默认是 `PENDING`。只有 AI/开发者实际查看真实页面截图后，才可据证据填写 PASS/FAIL/UNVERIFIED。

| 构建工具链 | 预置前端依赖 manifest/文件存在性、同步和 APK 校验工具接线 | `--build-doctor`、离线归档恢复、前端真实构建、Capacitor copy、SHA-256 内容比较、Gradle 编译和 APK 内容核验 | 只有显式调用 `--frontend-bundle-prepare`、`--android-assets-sync` 或 `--android-build-pipeline` 时才可能安装/构建/写资源；普通静态检查不联网、不构建 |

## 资源新鲜度验收

- 文件存在检查、哈希文件名检查或静态 HTML 引用检查，都不足以证明 Android 内置 JS 来自当前源代码。
- 本次正式构建必须生成 `latest-assets-manifest.json`；仅 `syncStatus=PASS` 的清单可用于 APK 资源验收。
- `verify_android_assets.py` 比较 `dist/` 与 `android/app/src/main/assets/public/` 实际文件 SHA-256。
- `verify_apk_assets.py` 从最终 APK 读取 `assets/public/` 并与同一构建清单逐项比对。
- 如果 `dist/` 不存在或前端构建失败，资源同步必须 BLOCKED/FAIL，而不能回退使用旧 Android 资源。
- 平台专用 `node_modules` 归档需要与当前 `package.json`、锁文件、Node 主版本及平台架构匹配；没有归档时不宣称空环境可以离线构建。
