package com.yuivo9999.mybox123;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Narrow bridge that exports non-sensitive UI metadata to MyBoxUiStateProvider.
 * Media URLs, source URLs, credentials and playback payloads are intentionally excluded.
 */
public final class MyBoxUiStateBridge {
    public static final String JS_NAME = "MyBoxUiStateBridge";
    static final String PREFS_NAME = "mybox_ui_state";
    static final String SNAPSHOT_KEY = "snapshot_json";
    private static final int MAX_PAYLOAD_CHARS = 16 * 1024;

    private final Context appContext;
    private final SharedPreferences preferences;
    private volatile String hostLifecycle = "foreground";

    public MyBoxUiStateBridge(Context context) {
        appContext = context.getApplicationContext();
        preferences = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public void update(String serializedState) {
        if (serializedState == null || serializedState.length() == 0 || serializedState.length() > MAX_PAYLOAD_CHARS) return;
        try {
            JSONObject input = new JSONObject(serializedState);
            JSONObject safe = new JSONObject();
            safe.put("schemaVersion", 1);
            safe.put("appId", "com.yuivo9999.mybox123");
            putText(safe, input, "runtime", 32);
            putText(safe, input, "currentPage", 48);
            putText(safe, input, "pageName", 96);
            putText(safe, input, "tab", 32);
            putText(safe, input, "route", 48);
            putEnum(safe, input, "displayMode", new String[]{"embedded", "immersive", "fullscreen"}, "embedded");
            safe.put("fullscreen", input.optBoolean("fullscreen", false));
            safe.put("immersive", input.optBoolean("immersive", false));
            putEnum(safe, input, "playerKind", new String[]{"html5", "none"}, "none");
            putEnum(safe, input, "playerState", new String[]{"idle", "paused", "playing", "buffering", "seeking", "ended", "error", "unknown"}, "unknown");
            putText(safe, input, "selectedTitle", 120);
            putText(safe, input, "currentChannel", 120);
            safe.put("menuOpen", input.optBoolean("menuOpen", false));
            safe.put("overlayOpen", input.optBoolean("overlayOpen", false));
            putText(safe, input, "activePanel", 48);
            safe.put("controlsVisible", input.optBoolean("controlsVisible", false));
            putEnum(safe, input, "documentVisibility", new String[]{"visible", "hidden", "prerender", "unknown"}, "unknown");
            safe.put("appLifecycle", hostLifecycle);
            safe.put("viewportWidth", clampDimension(input.optInt("viewportWidth", 0)));
            safe.put("viewportHeight", clampDimension(input.optInt("viewportHeight", 0)));
            safe.put("updatedAt", nowIso8601());
            persist(safe.toString());
        } catch (JSONException ignored) {
            // Invalid input is ignored. This bridge is diagnostic-only and has no write side effects.
        }
    }

    /** Called by the native host so the external reader can distinguish foreground from background. */
    public void setHostLifecycle(String state) {
        if (!("foreground".equals(state) || "background".equals(state) || "stopped".equals(state))) return;
        String raw = preferences.getString(SNAPSHOT_KEY, null);
        if (state.equals(hostLifecycle) && raw != null) {
            try {
                if (state.equals(new JSONObject(raw).optString("appLifecycle", "unknown"))) return;
            } catch (JSONException ignored) {
                // Repair a malformed stored snapshot below.
            }
        }
        hostLifecycle = state;
        JSONObject current;
        try {
            current = raw == null ? defaultSnapshotObject() : new JSONObject(raw);
        } catch (JSONException ignored) {
            current = defaultSnapshotObject();
        }
        try {
            current.put("appLifecycle", hostLifecycle);
            current.put("updatedAt", nowIso8601());
        } catch (JSONException ignored) {
            return;
        }
        persist(current.toString());
    }

    private void persist(String json) {
        String previous = preferences.getString(SNAPSHOT_KEY, null);
        if (json.equals(previous)) return;
        preferences.edit().putString(SNAPSHOT_KEY, json).apply();
        appContext.getContentResolver().notifyChange(MyBoxUiStateProvider.CONTENT_URI, null);
    }

    private static JSONObject defaultSnapshotObject() {
        JSONObject value = new JSONObject();
        try {
            value.put("schemaVersion", 1);
            value.put("appId", "com.yuivo9999.mybox123");
            value.put("runtime", "android-webview");
            value.put("currentPage", "unknown");
            value.put("pageName", "未知页面");
            value.put("tab", "home");
            value.put("route", "");
            value.put("displayMode", "embedded");
            value.put("fullscreen", false);
            value.put("immersive", false);
            value.put("playerKind", "none");
            value.put("playerState", "idle");
            value.put("selectedTitle", "");
            value.put("currentChannel", "");
            value.put("menuOpen", false);
            value.put("overlayOpen", false);
            value.put("activePanel", "");
            value.put("controlsVisible", false);
            value.put("documentVisibility", "unknown");
            value.put("appLifecycle", "unknown");
            value.put("viewportWidth", 0);
            value.put("viewportHeight", 0);
            value.put("updatedAt", "");
        } catch (JSONException ignored) {}
        return value;
    }

    private static void putText(JSONObject output, JSONObject input, String key, int maxLength) throws JSONException {
        Object raw = input.opt(key);
        String value = raw instanceof String ? ((String) raw).replaceAll("[\\p{Cntrl}]", " ").trim() : "";
        if (value.length() > maxLength) value = value.substring(0, maxLength);
        if ("selectedTitle".equals(key) || "currentChannel".equals(key)) {
            if (value.matches("(?i)^https?://.*")) value = "";
        }
        output.put(key, value);
    }

    private static void putEnum(JSONObject output, JSONObject input, String key, String[] allowed, String fallback) throws JSONException {
        String value = input.optString(key, fallback);
        for (String candidate : allowed) {
            if (candidate.equals(value)) {
                output.put(key, value);
                return;
            }
        }
        output.put(key, fallback);
    }

    private static int clampDimension(int value) {
        return Math.max(0, Math.min(value, 10000));
    }

    private static String nowIso8601() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }
}
