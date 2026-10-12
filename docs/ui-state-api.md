# MyBox UI State API (schema v1)

This interface exposes a read-only snapshot of the current UI. It intentionally omits media URLs, source URLs, credentials, cookies, and full playback requests.

## Manifest

The static project manifest is served from `/manifest.json` after the web assets are deployed. It describes the page catalog and the available runtime-state transports.

## JavaScript in the same WebView

```js
const initialState = window.MyBoxUIState?.getSnapshot();
const unsubscribe = window.MyBoxUIState?.subscribe((state) => {
  console.log('MyBox UI state changed', state);
});

// Alternative: DOM event with the same snapshot in event.detail.
window.addEventListener('mybox:ui-state-change', (event) => {
  renderState(event.detail);
});

// When finished observing:
unsubscribe?.();
```

The API becomes available as the app boots. `getSnapshot()` may return `null` before the first report. Browser-only sessions also persist the latest JSON under `mybox.ui-state.v1` in that WebView's local storage; local storage is not shared between separate apps.

## Reading from another Android app

The Android host publishes one read-only ContentProvider URI:

- URI: `content://com.yuivo9999.mybox123.ui-state/state`
- Permission: `com.yuivo9999.mybox123.permission.READ_UI_STATE`
- Cursor columns: `_id` (`long`) and `json` (`String`)
- Change notifications: enabled; register a `ContentObserver` on the URI and query again when notified.

The client app must declare the permission in its own `AndroidManifest.xml`:

```xml
<uses-permission android:name="com.yuivo9999.mybox123.permission.READ_UI_STATE" />

<!-- Needed for explicit provider visibility on Android 11+ when applicable. -->
<queries>
    <provider android:authorities="com.yuivo9999.mybox123.ui-state" />
</queries>
```

A WebView's JavaScript context cannot directly call Android `ContentResolver` or reliably open this `content://` URI. The receiving app must query it in its Android/Kotlin/Java layer and pass the JSON into its own WebView (for example through its own narrowly scoped `addJavascriptInterface` method). If the second app has no native-side integration, it cannot read MyBox's live state merely by loading `manifest.json`.

Kotlin/Java query example:

```java
Uri uri = Uri.parse("content://com.yuivo9999.mybox123.ui-state/state");
try (Cursor cursor = getContentResolver().query(uri, new String[]{"json"}, null, null, null)) {
    if (cursor != null && cursor.moveToFirst()) {
        String json = cursor.getString(cursor.getColumnIndexOrThrow("json"));
        // Parse this JSON to show the current page/player/UI status.
    }
}
```

Register a `ContentObserver` on `uri`, then repeat the query inside `onChange()` to receive subsequent state. Example:

```java
ContentObserver observer = new ContentObserver(new Handler(Looper.getMainLooper())) {
    @Override public void onChange(boolean selfChange, Uri changedUri) {
        readMyBoxUiStateAgain(); // call the query helper above, then pass JSON into this app's WebView
    }
};
getContentResolver().registerContentObserver(uri, false, observer);
// Call unregisterContentObserver(observer) when the observing screen stops.
```

Do not read or infer state from MyBox's private app files.

## Fields

The JSON uses `schemaVersion: 1` and includes `currentPage`, `pageName`, `tab`, `route`, `displayMode`, `fullscreen`, `immersive`, `playerKind`, `playerState`, `selectedTitle`, `currentChannel`, `menuOpen`, `overlayOpen`, `activePanel`, `controlsVisible`, `documentVisibility`, `appLifecycle`, `viewportWidth`, `viewportHeight`, and `updatedAt`.

`playerKind` is `html5` when a page-owned `<video>` element is present and `none` otherwise. `playerState` is a best-effort read of the current DOM video element; this interface does not claim that a stream is actually decodable or that a particular hardware decoder is active. In the Android ContentProvider snapshot, `appLifecycle` is set by the native Activity and can be `foreground`, `background`, or `stopped`; the browser-only JavaScript snapshot approximates it from `document.visibilityState` and therefore exposes only `foreground`/`background`.

The Android bridge filters and bounds the values it stores. The provider does not support insert, update, or delete. It is exported only with the declared read permission. Consumers should treat state as diagnostic metadata, not as a stable playback-control API.

## Deployment note

This change updates editable source files only. Per the project restrictions, it does not run Vite, install dependencies, build an APK, or synchronize `public/manifest.json` into `android/app/src/main/assets/public`. The next approved build/package pipeline must include the normal web asset build for the manifest and JavaScript reporter to become active in an installed APK; the native ContentProvider is included by the Android source build.
