# Configure for Android Phones (Android 10 to 16, 64-bit Only)

Optimize and configure the application exclusively for Android mobile phones, supporting Android 10 (API 29) through Android 16 (API 36), limiting CPU architectures to modern 64-bit ARM (`arm64-v8a`), and stripping out Android TV Leanback components.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following choices were confirmed in Phase 1:
> - **Target Platform**: Android mobile phones only (TV Leanback features removed).
> - **OS Version Range**: Android 10 (API 29) to Android 16 (API 36).
> - **Architecture**: 64-bit ARM only (`arm64-v8a`), reducing APK size and optimizing for modern phone processors.
> - **Distribution**: Automated direct `.apk` downloads via GitHub Actions & GitHub Releases.

---

## 1. Overview & Proposed Modifications

### 1. SDK Version Alignment (`android/variables.gradle`)
- **`minSdkVersion = 29`**: Strictly enforces Android 10 as the minimum supported operating system.
- **`compileSdkVersion = 36`**: Uses Android 16 API 36 tools for full modern platform support.
- **`targetSdkVersion = 36`**: Targets Android 16 behaviors and API features.
- Update fallback definitions in `android/capacitor-cordova-android-plugins/build.gradle` to match.

### 2. Architecture & Native Packaging (`android/app/build.gradle`)
- **ABI Filter**: Restrict `ndk.abiFilters` strictly to `'arm64-v8a'`.
  - Removes unused 32-bit (`armeabi-v7a`) and x86 libraries.
  - Significantly decreases APK download size and memory overhead on modern Android phones.
- **Native Packaging**: Retain `useLegacyPackaging = true` and `android:extractNativeLibs="true"` to prevent "解析软件包时出现问题" across Android 10 through 14 while running on Android 16 compile tools.

### 3. Phone-First Manifest Adjustments (`android/app/src/main/AndroidManifest.xml`)
- Remove TV Leanback feature flag: `<uses-feature android:name="android.software.leanback" ... />`.
- Remove TV launcher intent filter: `<category android:name="android.intent.category.LEANBACK_LAUNCHER" />`.
- Standardize touch screen requirement for mobile phones.

### 4. CI/CD Build Workflow (`.github/workflows/build-apk.yml`)
- Update Android SDK manager setup to install `platforms;android-36` and `build-tools;36.0.0`.
- Maintain dual APK generation (`TVBox-Phone-release.apk` and `TVBox-Phone-debug.apk`).
- Publish direct `.apk` files to GitHub Releases upon build completion.

---

## 2. Technical Architecture & Modifications Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                 Android Phone Configuration                 │
├─────────────────────────────────────────────────────────────┤
│  OS Target: Android 10 (API 29) ───► Android 16 (API 36)   │
│  Architecture: 64-bit ARM (arm64-v8a only)                  │
│  Form Factor: Smartphone (Touchscreen required, No Leanback)│
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 GitHub Actions CI/CD Pipeline               │
├─────────────────────────────────────────────────────────────┤
│  1. Node.js 22 + React Build                                │
│  2. Capacitor Sync                                          │
│  3. Android SDK 36 + JDK 21 Build                           │
│  4. Direct APK Publishing (GitHub Releases + Artifacts)     │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Verification Plan

1. **Compilation Check**:
   - Run `compile_applet` and `lint_applet` to confirm zero regressions in the web and Capacitor layers.
2. **Configuration Validation**:
   - Verify `minSdkVersion = 29`, `compileSdkVersion = 36`, and `targetSdkVersion = 36` in all Gradle files.
   - Confirm `abiFilters` contains only `'arm64-v8a'`.
   - Validate XML structure in `AndroidManifest.xml` (touchscreen enabled, Leanback removed).
3. **Workflow Syntax**:
   - Check YAML syntax and SDK 36 parameters in `.github/workflows/build-apk.yml`.
