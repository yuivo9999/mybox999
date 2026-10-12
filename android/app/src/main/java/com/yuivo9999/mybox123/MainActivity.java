package com.yuivo9999.mybox123;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private NativePlaybackBridge playbackBridge;
    private MyBoxUiStateBridge uiStateBridge;
    private TVBoxExtensionBridge tvBoxExtensionBridge;
    private TVBoxJarBridge tvBoxJarBridge;
    private long lastBackPressTime = 0;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        try {
            registerPlugin(TVBoxHttpPlugin.class);
        } catch (Throwable t) {
            android.util.Log.e("MainActivity", "Failed to register TVBoxHttpPlugin", t);
        }

        super.onCreate(savedInstanceState);

        WebView webView = null;
        try {
            if (getBridge() != null) {
                webView = getBridge().getWebView();
            }
        } catch (Throwable t) {
            android.util.Log.e("MainActivity", "Failed to get WebView from Bridge", t);
        }

        if (webView != null) {
            try {
                WebView.setWebContentsDebuggingEnabled(true);
                android.webkit.WebSettings settings = webView.getSettings();
                settings.setJavaScriptEnabled(true);
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setMediaPlaybackRequiresUserGesture(false);
                settings.setAllowFileAccess(true);
                settings.setAllowContentAccess(true);
                settings.setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                webView.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null);
                webView.setBackgroundColor(0xFF0B0D12);
            } catch (Throwable t) {
                android.util.Log.e("MainActivity", "Failed to configure WebSettings", t);
            }

            try {
                playbackBridge = new NativePlaybackBridge(this, webView);
                webView.addJavascriptInterface(playbackBridge, NativePlaybackBridge.JS_NAME);
            } catch (Throwable t) {
                android.util.Log.e("MainActivity", "Failed to attach NativePlaybackBridge", t);
            }

            try {
                uiStateBridge = new MyBoxUiStateBridge(getApplicationContext());
                webView.addJavascriptInterface(uiStateBridge, MyBoxUiStateBridge.JS_NAME);
            } catch (Throwable t) {
                android.util.Log.e("MainActivity", "Failed to attach MyBoxUiStateBridge", t);
            }

            try {
                tvBoxExtensionBridge = new TVBoxExtensionBridge();
                webView.addJavascriptInterface(tvBoxExtensionBridge, TVBoxExtensionBridge.JS_NAME);
            } catch (Throwable t) {
                android.util.Log.e("MainActivity", "Failed to attach TVBoxExtensionBridge", t);
            }

            try {
                tvBoxJarBridge = new TVBoxJarBridge(this);
                webView.addJavascriptInterface(tvBoxJarBridge, TVBoxJarBridge.JS_NAME);
            } catch (Throwable t) {
                android.util.Log.e("MainActivity", "Failed to attach TVBoxJarBridge", t);
            }
        }
    }

    @Override
    public void onPause() {
        if (uiStateBridge != null) {
            uiStateBridge.setHostLifecycle("background");
        }
        if (playbackBridge != null) {
            playbackBridge.onHostPause();
        }
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (uiStateBridge != null) {
            uiStateBridge.setHostLifecycle("foreground");
        }
        if (playbackBridge != null) {
            playbackBridge.onHostResume();
        }
    }

    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.evaluateJavascript(
                "(function(){ try { return Boolean(window.TVBoxWebView && typeof window.TVBoxWebView.onBackPressed === 'function' && window.TVBoxWebView.onBackPressed()); } catch(e) { return false; } })()",
                value -> {
                    if ("true".equals(value)) {
                        // Handled by React Web layer (e.g. exited fullscreen, closed dialog, or navigated back)
                        return;
                    }
                    mainHandler.post(() -> {
                        long now = System.currentTimeMillis();
                        if (now - lastBackPressTime < 2000) {
                            MainActivity.super.onBackPressed();
                        } else {
                            lastBackPressTime = now;
                            Toast.makeText(MainActivity.this, "再按一次退出应用", Toast.LENGTH_SHORT).show();
                        }
                    });
                }
            );
        } else {
            super.onBackPressed();
        }
    }

    @Override
    public void onDestroy() {
        if (uiStateBridge != null) {
            uiStateBridge.setHostLifecycle("stopped");
        }
        if (playbackBridge != null) {
            playbackBridge.release();
            playbackBridge = null;
        }
        tvBoxExtensionBridge = null;
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            try { webView.removeJavascriptInterface(MyBoxUiStateBridge.JS_NAME); } catch (Throwable ignored) {}
        }
        uiStateBridge = null;
        if (tvBoxJarBridge != null) {
            tvBoxJarBridge.release();
            tvBoxJarBridge = null;
        }
        super.onDestroy();
    }
}

