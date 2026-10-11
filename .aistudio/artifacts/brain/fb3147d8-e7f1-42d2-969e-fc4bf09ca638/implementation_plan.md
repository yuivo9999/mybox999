# Android 内置资源重构同步与 GitHub Actions 工作流恢复方案

针对 Android 内置资源（`android/app/src/main/assets/public/`）仍然引用旧版构建产物、缺失 `TVBoxLivePlayerBridge` 调用链的阻塞问题，通过重新构建 Vite 前端产物、全量同步最新 Web 资源至 Android 资产目录，并恢复 `.github/workflows/build-apk.yml` 自动化构建工作流，确保本地与云端 APK 均加载最新的前端播放引擎与原生桥接链路。

---

### User Review & Critical Decisions

> [!IMPORTANT]
> 基于前一阶段的问题确认，以下两项核心决策已由用户明确指示并纳入实施方案：

- **已确认决策 1（Web 产物重构与资产同步）**：执行 `npm run build` 生成包含 `TVBoxLivePlayerBridge` 的最新生产环境 `dist`，并完整同步替换 `android/app/src/main/assets/public/` 下的 HTML、JS、CSS 等所有静态资源。
- **已确认决策 2（GitHub Actions 工作流恢复）**：在 `.github/workflows/build-apk.yml` 中重建并完善 Android APK 自动打包流程，配置 Node 22 环境构建 Web 产物、同步至 Android 目录、运行 Gradle 构建带签名的 Release 与 Debug APK，并自动发布至 Release 附件供下载。

---

### 1. Overview & Core Concept

- **解决的核心问题**：
  此前 Android 壳层工程内的 `assets/public` 保留的是过往构建的 `index-B8XV_Kq7.js` 和 `index-rNvpc0ib.css`，导致 Android 客户端内运行的 Web 视图无法寻址 `window.TVBoxLivePlayerBridge`，进而导致播放器无法调用 `AndroidLivePlayerBridge` 原生 ExoPlayer/IJK 解码通道。同时，仓库缺少云端 CI 自动构建配置，无法自动输出包含最新 Web 产物的 APK。
- **目标受众**：
  Android 手机与电视盒子用户，以及需要自动化构建 APK 安装包的维护者。
- **核心价值**：
  打通从 Web 前端 `createAndroidLivePlayerAdapter` 到 Android 壳层 `TVBoxLivePlayerBridge` 的闭环，消除旧资源阻塞；实现云端推送即自动编译带最新资源 APK 的持续交付能力。

---

### 2. User Experience & Visual Design

- **关键用户流程**：
  1. 用户在 Android 设备上安装并启动最新 APK。
  2. 启动瞬间展示内置原生骨架屏（`#boot-skeleton`），无黑屏卡顿。
  3. WebView 加载内置最新的本地资源（`https://localhost/assets/index-[hash].js`），完成纯离线启动，无需初始网络请求。
  4. 进入直播频道或切换解码模式（IJK / Exo / 系统软硬解）时，前端适配器直接命中 `window.TVBoxLivePlayerBridge`，无缝拉起原生解码器与底座 TextureView 渲染画面。
- **视觉一致性与主题**：
  - **色彩基调**：深邃暗黑影音风格，主背景采用 `#0b0d12`，卡片与表面采用 `#151822` / `#202533`，强调色使用影视红 `#e50914`。
  - **排版层级**：针对移动端与大屏设备优化，顶部导航栏、分类 Tab 栏、视频海报网格与底部导航保持统一的 safe-area-inset 适配。
  - **离线与加载反馈**：内置骨架屏 shimmer 微光动效，网络仅在用户主动选择“源”或请求流媒体时触发，界面具备完整的断网重试与降级提示。

---

### 3. Key Product Decisions & Trade-Offs

- **决策 1：资源同步策略（增量同步 vs 全量覆盖）**
  - *选定方案*：清空 `android/app/src/main/assets/public/` 下的旧版本 `assets/` 与 `index.html`，将 `dist/` 编译产物进行全量清洁覆盖。
  - *原因*：Vite 构建带有 content-hash 文件名（如 `index-[newHash].js`）。若不清空旧产物，旧的废弃 JS/CSS 文件将残留并在 APK 内占用宝贵体积；全量覆盖能彻底杜绝旧哈希引用冲突。
- **决策 2：工作流健壮性与离线保证**
  - *选定方案*：在 GitHub Actions 构建工作流中，先执行前端安装与 `npm run build`，紧接着通过脚本自动将 `dist/` 同步至 Android assets，最后调用 `./gradlew assembleDebug` 与 `./gradlew assembleRelease`。
  - *原因*：确保 GitHub Actions 生成的每一个 APK 安装包内都严格打包了该 commit 对应的最新 Web 静态资源，避免出现“云端代码更新了但 APK 打包了旧代码”的一致性问题。

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌────────────────────────────────────────────────────────────────────────┐
│                        前端构建与资产同步链路                          │
└────────────────────────────────────────────────────────────────────────┘
          │
          ▼
   [ npm run build ] ────► 生成 dist/
                             ├── index.html
                             └── assets/
                                   ├── index-[hash].js (含 TVBoxLivePlayerBridge)
                                   └── index-[hash].css
          │
          ▼
   [ 资产同步同步流水线 ] ────► 覆盖拷贝至
                             android/app/src/main/assets/public/
                                   ├── index.html
                                   └── assets/
          │
          ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Android 运行时桥接通信架构                       │
└────────────────────────────────────────────────────────────────────────┘
   MainActivity.java
     │── WebView (透明底层 / 启用硬件加速)
     └── addJavascriptInterface(livePlayerBridge, "TVBoxLivePlayerBridge")
           ▲
           │ window.TVBoxLivePlayerBridge
           ▼
   src/core__player__androidLivePlayerAdapter.js
     └── 自动检测 window.TVBoxLivePlayerBridge
           ├── prepare(...) ──► AndroidLivePlayerBridge (Exo / IJK)
           ├── play / pause
           └── setBounds(...) ──► 动态更新原生 TextureView 渲染图层

┌────────────────────────────────────────────────────────────────────────┐
│                     GitHub Actions CI/CD 流水线                        │
└────────────────────────────────────────────────────────────────────────┘
   .github/workflows/build-apk.yml
     ├── 1. Checkout 代码
     ├── 2. Setup Node.js 22 & 安装前端依赖
     ├── 3. npm run build 生成最新 dist
     ├── 4. 同步 dist/ 到 android/app/src/main/assets/public/
     ├── 5. Setup JDK 21 & Android SDK (API 34/35)
     ├── 6. gradlew assembleDebug & assembleRelease
     └── 7. 上传 Artifacts 并发布 Release
```

- **实施步骤**：
  1. **构建前端产物**：运行 `npm run build` 验证最新代码编译正常，检查生成的 JS chunk 中包含 `TVBoxLivePlayerBridge`。
  2. **同步更新 Android 资产**：将 `dist/` 中的完整产物同步覆盖至 `android/app/src/main/assets/public/`，清理已废弃的旧版 `index-B8XV_Kq7.js` 和 `index-rNvpc0ib.css`。
  3. **恢复工作流配置**：创建 `.github/workflows/build-apk.yml`，设置触发条件（push、workflow_dispatch），配置完整的前端构建、资产同步与 Gradle 双目标（Release/Debug）打包步骤。
  4. **编译与验证**：执行 `lint_applet` 和 `compile_applet`，确保工程无任何破坏性错误。
