# Android 工程目录精简、去重与整合方案

精简与整合根目录 `android` 下过度冗余的嵌套与空目录，将总目录数量从 44 个大幅精简至约 28 个，同时保证 Android 原生构建与 GitHub Actions APK 打包流程的完整性。

## User Review & Critical Decisions

> [!IMPORTANT]
> 经与用户确认，本方案将执行深度精简与去重策略：
> - **已确认策略 1**：移除完全为空且未使用的 `capacitor-cordova-android-plugins` 模块，并同步解耦 `settings.gradle` 和 `app/build.gradle`。
> - **已确认策略 2**：合并 10 个重复的多分辨率横屏/竖屏 `splash.png` 目录，统一由 `drawable/splash.png` 提供。
> - **核心技术约束**：Android SDK 与 Gradle 构建体系严格要求保留核心模块结构（`app` 模块、`gradle/wrapper` 包装器、Java 包名层级与 AAPT2 资源类型目录），无法将全部文件拍平成单层，但本次精简将所有可去除的冗余彻底清理。

---

## 1. 现状分析与优化空间

| 优化项 | 当前现状 | 优化后状态 | 减少目录数 |
| :--- | :--- | :--- | :--- |
| **Java 源码包路径** | `Spider.java` 错误地深层嵌套在 `mybox123/com/github/catvod/crawler/` | 规范移动至 `java/com/github/catvod/crawler/`，清理冗余嵌套目录 | 去重冗余 `com` 树 |
| **Cordova 插件模块** | `capacitor-cordova-android-plugins` 为 5 层完全为空的存根目录 | 彻底删除该目录，并在 Gradle 配置中清理引用 | 减少 5 个目录 |
| **启动图切图目录** | `drawable-land-*` (5个) 与 `drawable-port-*` (5个) 存放完全相同的 `splash.png` | 统一合并至 `drawable/splash.png`，删除这 10 个重复目录 | 减少 10 个目录 |
| **总目录计数** | 44 个文件夹 | 约 28 个必要标准文件夹 | 净减少约 16 个冗余文件夹 |

---

## 2. 系统架构与精简后目录结构

```
android/
├── app/
│   ├── build.gradle
│   ├── capacitor.build.gradle
│   ├── proguard-rules.pro
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── assets/
│       │   └── public/               (Capacitor 网页打包资产)
│       ├── java/
│       │   └── com/
│       │       ├── github/catvod/crawler/Spider.java  (爬虫接口规范路径)
│       │       └── yuivo9999/mybox123/MainActivity.java
│       └── res/
│           ├── drawable/             (包含统一 splash.png 及背景矢量)
│           ├── drawable-v24/         (API 24+ 前景矢量)
│           ├── layout/               (主界面布局 xml)
│           ├── mipmap-*/             (应用高清启动图标)
│           ├── values/               (字符串与主题样式配置)
│           └── xml/                  (网络与文件安全配置)
├── build.gradle
├── capacitor.settings.gradle
├── gradle/wrapper/                   (Gradle 构建包装器)
├── gradlew & gradlew.bat
├── settings.gradle
└── variables.gradle
```

---

## 3. 具体执行步骤

### 步骤 1：规范化 Java 爬虫源文件路径并清理嵌套冗余
- 将 `android/app/src/main/java/com/yuivo9999/mybox123/com/github/catvod/crawler/Spider.java` 移动到标准包路径 `android/app/src/main/java/com/github/catvod/crawler/Spider.java`。
- 删除空出来的深层嵌套文件夹 `com/yuivo9999/mybox123/com`。

### 步骤 2：解耦并彻底移除 Cordova 插件模块
- 从 `android/settings.gradle` 中移除 `include ':capacitor-cordova-android-plugins'` 及路径定义。
- 从 `android/app/build.gradle` 中移除 `flatDir` 对该模块 libs 的检索及 `implementation project(':capacitor-cordova-android-plugins')` 依赖声明。
- 递归删除 `android/capacitor-cordova-android-plugins` 整个空目录。

### 步骤 3：精简合并冗余的多分辨率 Splash 目录
- 确保 `android/app/src/main/res/drawable/splash.png` 保留完整。
- 确认 `styles.xml` 中的 `windowBackground` 指向 `@drawable/splash`。
- 批量删除 10 个重复存放同名启动图的空目录：
  * `drawable-land-hdpi`, `drawable-land-mdpi`, `drawable-land-xhdpi`, `drawable-land-xxhdpi`, `drawable-land-xxxhdpi`
  * `drawable-port-hdpi`, `drawable-port-mdpi`, `drawable-port-xhdpi`, `drawable-port-xxhdpi`, `drawable-port-xxxhdpi`

### 步骤 4：验证与构建检查
- 运行目录统计命令，校验目录数量由 44 个降至约 28 个。
- 运行 `compile_applet` 确保前端构建正常，并核对 Gradle 配置文件语法无任何断裂。
