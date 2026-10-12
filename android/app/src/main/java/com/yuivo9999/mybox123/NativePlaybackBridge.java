package com.yuivo9999.mybox123;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Looper;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Android host bridge for the WebView-owned player.
 *
 * Video playback is intentionally owned by the HTMLVideoElement rendered inside
 * the current WebView page. This class MUST NOT create a TextureView, Surface,
 * ExoPlayer, IJK player, or any other independent video output surface.
 *
 * The bridge retains SharedPreferences storage, provides native Activity
 * fullscreen/orientation control, and rejects retired native playback methods.
 */
public final class NativePlaybackBridge {
    public static final String JS_NAME = "TVBoxAndroidBridge";
    private static final String STORAGE_NAME = "tvbox_user_data";
    private static final String DISABLED_CODE = "NATIVE_VIDEO_PLAYBACK_DISABLED";

    private static final int IMMERSIVE_SYSTEM_UI_FLAGS =
        View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;

    private final Activity activity;
    private final SharedPreferences storage;
    private final WebView webView;
    private volatile boolean released = false;
    private boolean nativeFullscreenActive = false;
    private int previousSystemUiVisibility = 0;
    private int previousRequestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;

    public NativePlaybackBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        storage = activity.getApplicationContext().getSharedPreferences(STORAGE_NAME, Context.MODE_PRIVATE);
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


    /**
     * Enter Android native immersive fullscreen for the page-owned DOM player.
     * The WebView still renders the video; only Activity system bars and screen
     * orientation are controlled here.
     */
    @JavascriptInterface
    public String setFullscreen(String payload) {
        if (released) return error("PLAYER_RELEASED");
        final boolean enabled;
        try {
            JSONObject request = new JSONObject(payload == null ? "{}" : payload);
            if (!request.has("enabled")) return error("FULLSCREEN_STATE_REQUIRED");
            enabled = request.optBoolean("enabled", false);
        } catch (Exception ignored) {
            return error("INVALID_FULLSCREEN_ARGUMENT");
        }

        activity.runOnUiThread(() -> applyNativeFullscreen(enabled));
        return "{\"ok\":true,\"enabled\":" + enabled + "}";
    }

    /** Native orientation fallback for WebView runtimes without Screen Orientation API support. */
    @JavascriptInterface
    public String requestOrientation(String payload) {
        if (released) return error("PLAYER_RELEASED");
        final int requestedOrientation;
        try {
            JSONObject request = new JSONObject(payload == null ? "{}" : payload);
            String orientation = request.optString("orientation", "portrait").trim().toLowerCase();
            switch (orientation) {
                case "portrait":
                    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
                    break;
                case "landscape":
                    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
                    break;
                case "sensor":
                    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR;
                    break;
                case "unspecified":
                case "default":
                    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
                    break;
                default:
                    return error("UNSUPPORTED_ORIENTATION");
            }
        } catch (Exception ignored) {
            return error("INVALID_ORIENTATION_ARGUMENT");
        }

        activity.runOnUiThread(() -> {
            if (!released && !activity.isFinishing() && !activity.isDestroyed()) {
                try { activity.setRequestedOrientation(requestedOrientation); } catch (Exception ignored) {}
            }
        });
        return "{\"ok\":true}";
    }

    private void applyNativeFullscreen(boolean enabled) {
        if (activity.isFinishing() || activity.isDestroyed()) return;
        Window window = activity.getWindow();
        View decor = window.getDecorView();

        if (enabled) {
            if (!nativeFullscreenActive) {
                previousSystemUiVisibility = decor.getSystemUiVisibility();
                previousRequestedOrientation = activity.getRequestedOrientation();
                nativeFullscreenActive = true;
            }
            try {
                activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            } catch (Exception ignored) {}

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController controller = window.getInsetsController();
                if (controller != null) {
                    controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    );
                    controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                } else {
                    decor.setSystemUiVisibility(IMMERSIVE_SYSTEM_UI_FLAGS);
                }
            } else {
                decor.setSystemUiVisibility(IMMERSIVE_SYSTEM_UI_FLAGS);
            }
            return;
        }

        if (!nativeFullscreenActive) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_DEFAULT);
                controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            }
        }
        decor.setSystemUiVisibility(previousSystemUiVisibility);
        try {
            activity.setRequestedOrientation(previousRequestedOrientation);
        } catch (Exception ignored) {}
        nativeFullscreenActive = false;
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
        if (nativeFullscreenActive) {
            activity.runOnUiThread(() -> applyNativeFullscreen(true));
        }
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
        if (nativeFullscreenActive) {
            if (Looper.myLooper() == Looper.getMainLooper()) {
                applyNativeFullscreen(false);
            } else {
                activity.runOnUiThread(() -> applyNativeFullscreen(false));
            }
        }
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
