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
| AI 视觉 | Playwright 页面、元素坐标、截图、错误与视觉回归 | 安装可用 Playwright/Chromium、真实项目页面配置 | 否；运行时会写 reports/artifacts |

状态必须区分 PASS、WARN、FAIL、UNVERIFIED。没有运行的测试、缺少真实页面的测试及无法由静态分析证明的行为，均不得描述为已经通过。
