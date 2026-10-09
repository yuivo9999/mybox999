# Eliminate Startup Black Screen & Optimize Mobile UX

Resolve the complete black screen issue when opening the APK on Android phones by converting dynamic module loading into direct synchronous boot, embedding an instant visual skeleton directly in `index.html`, configuring Android WebView hardware acceleration and mixed-content support, and enhancing mobile gestures and full-screen layouts.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following choices were confirmed in Phase 1:
> - **Issue Diagnosis**: The phone displays a complete pitch-black screen with no text or UI on launch.
> - **Primary Fix**: Replace asynchronous dynamic chunk import (`import('./App.jsx')`) in `src/main.jsx` with direct synchronous import (`import { AppRoot } from './App.jsx'`) to prevent deferred chunk fetch delays and failure states.
> - **Visual Skeleton**: Embed a high-fidelity visual skeleton with pulse animations directly into `#root` in `index.html`, ensuring the screen renders instant UI the moment the webview opens.
> - **Mobile UX Optimizations**:
>   - Add safe-area insets (`env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`) for notch and gesture bar compliance.
>   - Optimize mobile gestures for smooth tab transitions and child page swipe-back.
>   - Enable Android WebView mixed content and hardware acceleration in `MainActivity.java` so HTTP media streams play without blockage.

---

## 1. Overview & Root Cause Analysis

### Why the Screen Was Completely Black
1. **Asynchronous Chunk Import Bottleneck**:
   - `src/main.jsx` used `import('./App.jsx')` wrapped in `.then(...)`. In a production Vite bundle, this breaks `App.jsx` into a separate dynamic chunk (`App-*.js` over 1 MB).
   - On Android WebView, dynamic chunk requests across local schemes can stall or execute asynchronously with no fallback visual indicators, leaving `<div id="root"></div>` completely empty. Because the body background is `#07080b`, the user sees an opaque pitch-black screen.
2. **Missing Pre-Render Skeleton**:
   - `index.html` contained only `<div id="root"></div>`. Until React mounts, nothing exists in the DOM.
3. **Android WebView Mixed Content & Web Settings**:
   - Under `https://localhost/` (Capacitor default scheme), HTTP API calls and media streams are blocked as mixed content unless explicitly allowed.
   - Remote debugging was disabled, making runtime inspection difficult.

---

## 2. Technical Architecture & Modifications

```
┌─────────────────────────────────────────────────────────────┐
│                 App Launch Lifecycle                        │
├─────────────────────────────────────────────────────────────┤
│  1. Android Activity Launch (Theme + Splash)                │
│     │                                                       │
│     ▼                                                       │
│  2. WebView Loads index.html                                │
│     ├─► Instant Pre-Rendered Visual Skeleton Displayed      │
│     │   (App Logo + Hero Card Skeleton + Bottom Nav)        │
│     │                                                       │
│     ▼                                                       │
│  3. Synchronous Module Boot (src/main.jsx)                  │
│     ├─► Direct import { AppRoot } from './App.jsx'          │
│     ├─► React Mounts Seamlessly into #root                  │
│     │                                                       │
│     ▼                                                       │
│  4. Interactive UI Ready (0-Delay Visual Continuity)        │
└─────────────────────────────────────────────────────────────┘
```

### Proposed Changes

### 1. Direct Startup Import in `src/main.jsx`
- Replace asynchronous `import('./App.jsx')` with direct `import { AppRoot } from './App.jsx'`.
- Mount `createRoot(rootElement).render(<AppRoot />)` synchronously on script execution.
- Maintain global error capture with defensive error UI.

### 2. Instant Visual Skeleton in `index.html`
- Populate `<div id="root">` with an embedded, zero-dependency HTML/CSS skeleton:
  - Top app brand header with glowing badge.
  - Hero banner shimmering skeleton card.
  - Section title and movie card grid placeholders.
  - Bottom navigation bar placeholder.
- Disappears automatically the moment React renders `<AppRoot />`.

### 3. Android WebView Settings in `MainActivity.java`
- Enable `WebView.setWebContentsDebuggingEnabled(true)`.
- Configure `settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW)` to support HTTP live/VOD streams on HTTPS schemes.
- Enable DOM storage, database, and file access.

### 4. Mobile Layout & Gesture Tuning in `src/app.css` & `src/App.jsx`
- Add CSS safe-area insets (`padding-top: env(safe-area-inset-top)` and `padding-bottom: env(safe-area-inset-bottom)`) so top status bars and bottom navigation gesture bars do not clip UI controls.
- Tune mobile touch responsiveness and edge swipe-back gesture ergonomics.
- Ensure full viewport height (`100dvh` / `100vh`) adapts smoothly across mobile keyboard appearances and orientation shifts.

---

## 3. Verification Plan

1. **Compilation Check**:
   - Run `compile_applet` and `lint_applet` to verify clean build.
2. **Local Preview Check**:
   - Verify index.html renders the instant skeleton before React mounts and smoothly swaps into the full application.
3. **Android Build Alignment**:
   - Check `MainActivity.java` and `AndroidManifest.xml` syntax for flawless Gradle compilation.
