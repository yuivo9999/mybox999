import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(projectRoot, relativePath), 'utf8');

const manifest = JSON.parse(read('public/manifest.json'));
const reporter = read('src/core__state__uiStateReporter.js');
const main = read('src/main.jsx');
const activity = read('android/app/src/main/java/com/yuivo9999/mybox123/MainActivity.java');
const bridge = read('android/app/src/main/java/com/yuivo9999/mybox123/MyBoxUiStateBridge.java');
const provider = read('android/app/src/main/java/com/yuivo9999/mybox123/MyBoxUiStateProvider.java');
const androidManifest = read('android/app/src/main/AndroidManifest.xml');
const docs = read('docs/ui-state-api.md');

test('manifest describes the MyBox app and known UI page states', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.app.id, 'com.yuivo9999.mybox123');
  const pageIds = new Set(manifest.pageCatalog.map((page) => page.id));
  for (const pageId of ['home', 'live', 'movie-playback', 'live-playback', 'favorites', 'settings']) {
    assert.ok(pageIds.has(pageId), `missing page catalog entry: ${pageId}`);
  }
});

test('manifest exposes the same read-only Android provider contract as source', () => {
  assert.equal(manifest.runtimeState.android.contentUri, 'content://com.yuivo9999.mybox123.ui-state/state');
  assert.equal(manifest.runtimeState.android.authority, 'com.yuivo9999.mybox123.ui-state');
  assert.equal(manifest.runtimeState.android.readOnly, true);
  assert.ok(manifest.runtimeState.android.columns.includes('json'));
  assert.match(provider, /content:\/\/+" \+ AUTHORITY \+ "\/state/);
  assert.match(provider, /UnsupportedOperationException\("MyBox UI state provider is read-only"\)/);
  assert.match(androidManifest, /android:name="\.MyBoxUiStateProvider"/);
  assert.match(androidManifest, /android:exported="true"/);
  assert.match(androidManifest, /com\.yuivo9999\.mybox123\.permission\.READ_UI_STATE/);
  assert.match(androidManifest, /android:name="com\.yuivo9999\.mybox123\.permission\.WRITE_UI_STATE"[\s\S]*?android:protectionLevel="signature"/);
});

test('UI state reporter publishes JS access, DOM events, and native updates without exposing media URLs', () => {
  assert.match(reporter, /window\.MyBoxUIState/);
  assert.match(reporter, /mybox:ui-state-change/);
  assert.match(reporter, /sessionStateStore\.subscribe/);
  assert.match(reporter, /window\.MyBoxUiStateBridge\.update/);
  assert.match(reporter, /currentPage/);
  assert.match(reporter, /playerState/);
  assert.match(reporter, /activePanel/);
  assert.doesNotMatch(reporter, /currentSrc\s*:/);
  assert.match(main, /startUiStateReporter\(\)/);
});

test('native bridge whitelists fields and Android lifecycle updates the shared snapshot', () => {
  assert.match(bridge, /MAX_PAYLOAD_CHARS/);
  assert.match(bridge, /new JSONObject\(\)/);
  assert.match(bridge, /setHostLifecycle/);
  assert.match(bridge, /notifyChange\(MyBoxUiStateProvider\.CONTENT_URI/);
  assert.match(activity, /addJavascriptInterface\(uiStateBridge, MyBoxUiStateBridge\.JS_NAME\)/);
  assert.match(activity, /setHostLifecycle\("background"\)/);
  assert.match(activity, /setHostLifecycle\("foreground"\)/);
  assert.match(activity, /setHostLifecycle\("stopped"\)/);
});

test('documented cross-app API matches manifest URI and permission', () => {
  assert.ok(docs.includes(manifest.runtimeState.android.contentUri));
  assert.ok(docs.includes(manifest.runtimeState.android.readPermission));
  assert.ok(docs.includes('ContentObserver'));
});
