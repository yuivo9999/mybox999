# Fix Skeleton Hang and Enforce Offline-First Launch

Resolve the issue where the APK remains stuck on the skeleton loading screen, and redesign the startup architecture so the application opens 100% offline with zero network dependency on launch, strictly deferring all network requests to explicit user actions (selecting or refreshing a source).

## User Review & Critical Decisions

> [!IMPORTANT]
> The following core decisions address the user's feedback and screenshot:
> - **Skeleton Screen Fix**: In `src/main.jsx`, change top-level `document.getElementById('root')` execution to a robust `DOMContentLoaded` / DOM-ready retry loop so the React app always mounts cleanly into `#root` even when scripts execute in `<head>`, instantly replacing `#boot-skeleton`.
> - **Strict Offline-First Startup**: Remove automatic `reloadSources` on app mount in `App.jsx`. The APK will launch with zero network requests, instantly displaying local content without waiting for or depending on any network connection.
> - **Network Deferred to User Action**: Network fetching will exclusively occur when the user manually selects a source in the UI, clicks a "Refresh / 刷新" button, or opens source management.
> - **Remove Web Pages Legacy Script**: Strip the GitHub Pages SPA query-param redirection script from `index.html` so it does not interfere with Android WebView `window.history`.

---

## 1. Overview & Root Cause Analysis

### 1. Why the Screen Remained on the Skeleton Screen
- In `src/main.jsx`, `const rootElement = document.getElementById('root');` and its validation `if (!rootElement) throw new Error('ROOT_ELEMENT_NOT_FOUND');` were executed synchronously at the top level of the module.
- Because `<script type="module">` is in `<head>`, if the script evaluates before the parser finishes constructing the `#root` element, `rootElement` is null.
- Inside `renderBootError`, there was an early return `if (!rootElement) return;`, causing the boot error to abort silently and leaving the `#boot-skeleton` stuck on screen indefinitely.

### 2. Network Activity on App Launch
- In `App.jsx` line 131, an automatic background call `void reloadSources(undefined, { background: true });` ran on every single app startup.
- If there is no internet, slow internet, or if remote sources fail, this network call stalled state updates or caused empty source results.
- The user specifically requested that the installed APK must act as a true standalone local app: **startup must be 100% offline with zero network calls**, with network activity triggered only when the user explicitly chooses or refreshes a source.

---

## 2. Technical Architecture & Modifications

```
┌─────────────────────────────────────────────────────────────┐
│                 Offline-First Launch Flow                   │
├─────────────────────────────────────────────────────────────┤
│  1. App Opens ──► WebView loads local assets               │
│  2. DOM Ready ──► mountApp() attaches React to #root       │
│  3. Instantly renders local interface (0 Network Calls)     │
│  4. User browses offline cached content / static list       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼ User clicks "切换源" / "刷新"
┌─────────────────────────────────────────────────────────────┐
│                 On-Demand Network Loading                   │
├─────────────────────────────────────────────────────────────┤
│  User selects or refreshes a source ──► HTTP fetch runs     │
│  Displays loading spinner only on the specific source card  │
│  Updates content seamlessly                                 │
└─────────────────────────────────────────────────────────────┘
```

### Proposed Changes

### 1. DOM-Ready Mount in `src/main.jsx`
- Wrap app bootstrapping in a resilient `mountApp` function that checks `document.readyState`.
- If the DOM is still loading, listen for `DOMContentLoaded`; if `#root` is not yet attached, retry cleanly.
- Ensure `renderBootError` can fall back to `document.body` if `#root` is ever missing, preventing silent error suppression.

### 2. Defer Network Activity in `src/App.jsx`
- Remove `void reloadSources(undefined, { background: true });` from initial mount `useEffect`.
- Keep the home page populated with local data and cached favorites/history.
- Trigger `reloadSources` **only** when:
  - User taps to switch a movie or live source (`setSourceActive`).
  - User clicks the test/refresh button (`testSource` or manual reload button).
  - User adds or updates sources in "我的 -> 内容源管理".

### 3. Remove Legacy SPA Script in `index.html`
- Remove the GitHub Pages `Single Page Apps for GitHub Pages` redirect script in `<head>`.
- Keep the pure, clean offline HTML skeleton and module script tag.

### 4. Font Loading Resilience in `src/me/preferences.js`
- Ensure typography defaults gracefully to system fonts (`system-ui, -apple-system, sans-serif`) without making network requests to Google Fonts on startup.

---

## 3. Verification Plan

1. **Local Build & Compilation**:
   - Run `compile_applet` and `lint_applet` to verify clean build.
2. **Mount Verification**:
   - Verify that `#boot-skeleton` is immediately replaced by the React app without any delay.
3. **Network Isolation on Startup**:
   - Verify through network tracing that no `fetch` or HTTP requests are issued when the application initializes.
4. **Capacitor Sync**:
   - Sync the production build into `android/app/src/main/assets/public/` so the APK contains the offline-first bundle.
