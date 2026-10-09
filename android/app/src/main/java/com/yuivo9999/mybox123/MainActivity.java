package com.yuivo9999.mybox123;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private NativePlaybackBridge playbackBridge;
    private TVBoxExtensionBridge tvBoxExtensionBridge;
    private TVBoxJarBridge tvBoxJarBridge;
    private long lastBackPressTime = 0;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TVBoxHttpPlugin.class);
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        playbackBridge = new NativePlaybackBridge(this, webView);
        webView.addJavascriptInterface(playbackBridge, NativePlaybackBridge.JS_NAME);

        tvBoxExtensionBridge = new TVBoxExtensionBridge();
        webView.addJavascriptInterface(tvBoxExtensionBridge, TVBoxExtensionBridge.JS_NAME);

        tvBoxJarBridge = new TVBoxJarBridge(this);
        webView.addJavascriptInterface(tvBoxJarBridge, TVBoxJarBridge.JS_NAME);
    }

    @Override
    public void onPause() {
        super.onPause();
        if (playbackBridge != null) {
            playbackBridge.onHostPause();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
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
        if (playbackBridge != null) {
            playbackBridge.release();
            playbackBridge = null;
        }
        tvBoxExtensionBridge = null;
        if (tvBoxJarBridge != null) {
            tvBoxJarBridge.release();
            tvBoxJarBridge = null;
        }
        super.onDestroy();
    }
}

