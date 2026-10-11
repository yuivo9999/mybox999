# 测试矩阵与边界

| 类别 | 默认检查 | 需要真实运行环境的部分 | 默认是否修改项目 |
|---|---|---|---|
| 前端 | package.json、build 脚本、依赖声明、Vite 自动恢复接线、入口与文件数量 | npm run build（启动器在本地 Vite 缺失时会尝试 npm ci）、页面交互 | 否；依赖恢复只由启动器在明确运行前端脚本时触发 |
| 依赖 | node/npm、lockfile、node_modules 状态 | `npm ci` 安装及依赖实际可用性 | 否；显式参数才安装 |
| 资源 | HTML/CSS 可识别本地路径 | 动态 import、运行时 API、服务端资源 | 否 |
| APK/Gradle | Android 目录、Gradle 配置、wrapper、manifest | Gradle/SDK 环境和实际 assembleDebug | 否；显式参数才构建 |
| DOM 视频 | 静态搜寻 video/WebView/播放/全屏错误处理线索 | 实际 DOM 状态、视频解码、原生 WebView 行为 | 否 |
| 集成 | 前端入口与 Android 预置资源存在性/引用线索 | 确认二者为同次构建、实际加载版本 | 否 |
| 回归 | 关键文件与检查覆盖率提示 | 按本次改动定义场景并执行 | 否 |
| AI 视觉 | `--visual` 自检 Demo；`--visual-app` 启动真实 Vite 页面进入 LIVE；元素可见性/几何、手机宽度溢出、交互、控制台/请求错误、截图、trace、基线对比与 AI 复核清单 | Python Playwright/pytest/Pillow、可用 Chromium、真实页面启动及资源环境 | 运行时会写 `tests/ai_visual_test/reports/` 和 `artifacts/`；真实页面模式可能按锁文件恢复 npm 依赖 |

状态必须区分 PASS、WARN、FAIL、UNVERIFIED。没有运行的测试、缺少真实页面的测试及无法由静态分析证明的行为，均不得描述为已经通过。

## AI 视觉复核补充要求

- `python tests/run_tests.py --visual` 仅验证 Demo 测试链路；真实应用 UI 必须使用 `python tests/run_tests.py --visual-app` 或等效的真实页面配置。
- 真实页面模式会自动进入配置指定的 LIVE 页面并在 320/360/390/412 CSS px 宽度下截图及检查，测试目标、选择器与启动动作保存在 `tests/ai_visual_test/config.mybox.example.json`。
- 测试摘要、截图联系表、元素几何 JSON、浏览器错误信息和 trace 均应保留为诊断证据。联系表只供快速浏览，不代替原始截图。
- `AI_REVIEW.md` 的视觉结论默认是 `PENDING`。只有 AI/开发者实际查看真实页面截图后，才可据证据填写 PASS/FAIL/UNVERIFIED。
