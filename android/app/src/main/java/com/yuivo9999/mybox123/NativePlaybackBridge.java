package com.yuivo9999.mybox123;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Compatibility-only bridge for the former native video player.
 *
 * Video playback is intentionally owned by the HTMLVideoElement rendered inside
 * the current WebView page. This class MUST NOT create a TextureView, Surface,
 * ExoPlayer, IJK player, or any other independent video output surface.
 *
 * The storage bridge is retained because the web application uses it as a
 * SharedPreferences fallback. Playback methods fail explicitly so an old web
 * bundle cannot silently start an invisible native playback session.
 */
public final class NativePlaybackBridge {
    public static final String JS_NAME = "TVBoxAndroidBridge";
    private static final String STORAGE_NAME = "tvbox_user_data";
    private static final String DISABLED_CODE = "NATIVE_VIDEO_PLAYBACK_DISABLED";

    private final SharedPreferences storage;
    private final WebView webView;
    private volatile boolean released = false;

    public NativePlaybackBridge(Context context, WebView webView) {
        this.webView = webView;
        storage = context.getApplicationContext().getSharedPreferences(STORAGE_NAME, Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public String saveUserData(String key, String value) {
        if (key == null || key.isEmpty() || value == null) return error("INVALID_STORAGE_ARGUMENT");
        boolean saved = storage.edit().putString(key, value).commit();
        return saved ? "{\"ok\":true}" : error("STORAGE_WRITE_FAILED");
    }

    @JavascriptInterface
    public String loadUserData(String key) {
        if (key == null || key.isEmpty()) return null;
        return storage.getString(key, null);
    }

    @JavascriptInterface
    public String loadMedia(String payload) { return disabled(); }

    @JavascriptInterface
    public String prepareMedia(String payload) { return disabled(); }

    @JavascriptInterface
    public String playMedia(String payload) { return disabled(); }

    @JavascriptInterface
    public String pauseMedia(String payload) { return disabled(); }

    @JavascriptInterface
    public String seekMedia(String payload) { return disabled(); }

    @JavascriptInterface
    public String stopMedia(String payload) { return disabled(); }

    @JavascriptInterface
    public String setVolume(String payload) { return disabled(); }

    @JavascriptInterface
    public String getState(String payload) { return disabled(); }

    @JavascriptInterface
    public String getAudioTracks(String payload) { return new JSONArray().toString(); }

    @JavascriptInterface
    public String getSubtitleTracks(String payload) { return new JSONArray().toString(); }

    @JavascriptInterface
    public String getQualities(String payload) { return new JSONArray().toString(); }

    @JavascriptInterface
    public String selectAudioTrack(String payload) { return error("TRACK_SELECTION_UNAVAILABLE"); }

    @JavascriptInterface
    public String selectSubtitleTrack(String payload) { return error("TRACK_SELECTION_UNAVAILABLE"); }

    @JavascriptInterface
    public String selectQuality(String payload) { return error("QUALITY_SELECTION_UNAVAILABLE"); }

    @JavascriptInterface
    public String releaseMedia(String payload) { return "{\"ok\":true,\"released\":true}"; }

    public void onHostPause() {
        dispatchHostEvent("tvbox-host-pause");
    }

    public void onHostResume() {
        dispatchHostEvent("tvbox-host-resume");
    }

    private void dispatchHostEvent(String eventName) {
        if (webView == null || released) return;
        webView.post(() -> {
            if (released) return;
            webView.evaluateJavascript(
                "window.dispatchEvent(new Event('" + eventName + "'));",
                null
            );
        });
    }

    public void release() {
        released = true;
    }

    private String disabled() {
        return error(released ? "PLAYER_RELEASED" : DISABLED_CODE);
    }

    private static String error(String code) {
        try {
            JSONObject value = new JSONObject();
            value.put("ok", false);
            value.put("code", code);
            return value.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"code\":\"NATIVE_VIDEO_PLAYBACK_DISABLED\"}";
        }
    }
}
