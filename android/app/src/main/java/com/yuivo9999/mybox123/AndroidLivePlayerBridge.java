package com.yuivo9999.mybox123;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.SurfaceTexture;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.mediacodec.MediaCodecInfo;
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;

import tv.danmaku.ijk.media.player.IjkMediaPlayer;
import tv.danmaku.ijk.media.player.IMediaPlayer;

/**
 * Dedicated playback backend for Android Live only. It intentionally has its
 * own bridge name, player lifecycle, and TextureView, independent of the
 * retired NativePlaybackBridge playback methods.
 */
@UnstableApi
public final class AndroidLivePlayerBridge {
    public static final String JS_NAME = "TVBoxLivePlayerBridge";

    private static final String EVENT_NAME = "tvbox-android-live-player-event";
    private static final int WEBVIEW_BACKGROUND_COLOR = 0xFF0B0D12;

    private final Activity activity;
    private final WebView webView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private FrameLayout outputLayer;
    private TextureView textureView;
    private ExoPlayer exoPlayer;
    private IjkMediaPlayer ijkPlayer;
    private Surface ijkSurface;
    private volatile String activeSessionId = "";
    private volatile String requestedSessionId = "";
    private volatile String activeEngine = "";
    private volatile String activeDecoder = "hardware";
    private volatile String activeUrl = "";
    private volatile String activeState = "idle";
    private String activeFitMode = "contain";
    private String pendingIjkHeaders = "";
    private boolean ijkPrepareRequested = false;
    private boolean ijkPrepared = false;
    private boolean exoPrepared = false;
    private boolean released = false;
    private boolean outputActive = false;
    private boolean resumeAfterHostPause = false;
    private boolean wasPlayingBeforePause = false;
    private int videoWidth = 0;
    private int videoHeight = 0;
    private float viewportScale = 1f;
    private float viewportLeft = 0f;
    private float viewportTop = 0f;
    private float viewportWidth = 1f;
    private float viewportHeight = 1f;
    private float viewportZoom = 1f;
    private float viewportPanX = 0f;
    private float viewportPanY = 0f;
    private int webViewOriginalBackground = WEBVIEW_BACKGROUND_COLOR;

    public AndroidLivePlayerBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        ensureOutputLayer();
    }

    private void ensureOutputLayer() {
        if (outputLayer != null || webView == null) return;
        View parentView = (View) webView.getParent();
        if (!(parentView instanceof ViewGroup)) return;
        ViewGroup parent = (ViewGroup) parentView;
        outputLayer = new FrameLayout(activity);
        outputLayer.setBackgroundColor(Color.TRANSPARENT);
        outputLayer.setClipChildren(true);
        outputLayer.setClipToPadding(true);
        textureView = new TextureView(activity);
        textureView.setOpaque(false);
        textureView.setBackgroundColor(Color.TRANSPARENT);
        textureView.setVisibility(View.GONE);
        outputLayer.addView(textureView, new FrameLayout.LayoutParams(1, 1));
        int webIndex = parent.indexOfChild(webView);
        ViewGroup.LayoutParams params = new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        parent.addView(outputLayer, Math.max(0, webIndex), params);
        outputLayer.setVisibility(View.GONE);
    }

    @JavascriptInterface
    public String loadMedia(String payload) {
        final JSONObject request;
        try {
            request = new JSONObject(payload == null ? "{}" : payload);
        } catch (Exception error) {
            return error("INVALID_LOAD_ARGUMENT");
        }
        String sessionId = request.optString("sessionId", "").trim();
        String engine = request.optString("engine", "ijk").trim().toLowerCase(Locale.ROOT);
        String decoder = request.optString("decoder", "hardware").trim().toLowerCase(Locale.ROOT);
        String url = request.optString("url", "").trim();
        if (sessionId.isEmpty() || url.isEmpty()) return error("LIVE_SESSION_AND_URL_REQUIRED");
        if (!(engine.equals("ijk") || engine.equals("exo"))) return error("UNSUPPORTED_LIVE_ENGINE");
        if (!(decoder.equals("hardware") || decoder.equals("software"))) return error("UNSUPPORTED_LIVE_DECODER");

        requestedSessionId = sessionId;
        mainHandler.post(() -> {
            if (released) {
                dispatchEvent(sessionId, "error", "PLAYER_RELEASED", "Live 播放器已释放");
                return;
            }
            releaseActivePlayer();
            activeSessionId = sessionId;
            requestedSessionId = sessionId;
            activeEngine = engine;
            activeDecoder = decoder;
            activeUrl = url;
            activeState = "loading";
            activeFitMode = request.optString("fitMode", activeFitMode);
            videoWidth = 0;
            videoHeight = 0;
            ijkPrepareRequested = false;
            ijkPrepared = false;
            exoPrepared = false;
            try {
                activateOutputLayer();
                if ("ijk".equals(engine)) {
                    createIjkPlayer(request);
                } else {
                    createExoPlayer(request);
                }
                dispatchEvent(sessionId, "loading", "", "正在初始化 " + ("ijk".equals(engine) ? "IJKPlayer" : "ExoPlayer"));
            } catch (Throwable error) {
                activeState = "error";
                dispatchEvent(sessionId, "error", "LIVE_PLAYER_INIT_FAILED", messageOf(error));
                releaseActivePlayer();
            }
        });
        return ok("sessionId", sessionId);
    }

    private void createIjkPlayer(JSONObject request) throws Exception {
        ensureOutputLayer();
        if (textureView == null) throw new IllegalStateException("LIVE_VIDEO_SURFACE_UNAVAILABLE");
        IjkMediaPlayer player = new IjkMediaPlayer();
        ijkPlayer = player;
        player.setAudioStreamType(AudioManager.STREAM_MUSIC);
        player.setScreenOnWhilePlaying(true);
        player.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "mediacodec", "hardware".equals(activeDecoder) ? 1 : 0);
        player.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "mediacodec-auto-rotate", 1);
        player.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "mediacodec-handle-resolution-change", 1);
        player.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "framedrop", 1);
        player.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "start-on-prepared", 0);
        pendingIjkHeaders = headersToString(request.optJSONObject("headers"));
        if (!pendingIjkHeaders.isEmpty()) {
            player.setOption(IjkMediaPlayer.OPT_CATEGORY_FORMAT, "headers", pendingIjkHeaders);
        }
        player.setOnPreparedListener(mp -> {
            if (player != ijkPlayer || released) return;
            ijkPrepared = true;
            activeState = "prepared";
            updateVideoSize(mp.getVideoWidth(), mp.getVideoHeight());
            dispatchEvent(activeSessionId, "prepared", "", "IJKPlayer 已准备就绪");
            applyTextureTransform();
        });
        player.setOnVideoSizeChangedListener((mp, width, height, sarNum, sarDen) -> {
            if (player == ijkPlayer) updateVideoSize(width, height);
        });
        player.setOnCompletionListener(mp -> {
            if (player == ijkPlayer) {
                activeState = "completed";
                dispatchEvent(activeSessionId, "completed", "", "播放结束");
            }
        });
        player.setOnErrorListener((mp, what, extra) -> {
            if (player == ijkPlayer) {
                activeState = "error";
                dispatchEvent(activeSessionId, "error", "IJK_PLAYBACK_ERROR_" + what, "IJKPlayer 播放失败 (" + what + ", " + extra + ")");
            }
            return true;
        });
        player.setOnInfoListener((mp, what, extra) -> {
            if (player != ijkPlayer) return true;
            if (what == IMediaPlayer.MEDIA_INFO_BUFFERING_START) {
                activeState = "buffering";
                dispatchEvent(activeSessionId, "bufferingStart", "", "正在缓冲");
            } else if (what == IMediaPlayer.MEDIA_INFO_BUFFERING_END) {
                activeState = mp.isPlaying() ? "playing" : "prepared";
                dispatchEvent(activeSessionId, "bufferingEnd", "", "缓冲完成");
                if (mp.isPlaying()) dispatchEvent(activeSessionId, "playing", "", "正在播放");
            } else if (what == IMediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) {
                activeState = "playing";
                dispatchEvent(activeSessionId, "playing", "", "IJK 视频画面已开始渲染");
            }
            return true;
        });
        player.setDataSource(activeUrl);
        TextureView.SurfaceTextureListener listener = new TextureView.SurfaceTextureListener() {
            @Override public void onSurfaceTextureAvailable(SurfaceTexture surfaceTexture, int width, int height) {
                if (player != ijkPlayer) return;
                attachIjkSurface(surfaceTexture);
                maybePrepareIjk(player);
            }
            @Override public void onSurfaceTextureSizeChanged(SurfaceTexture surfaceTexture, int width, int height) {
                applyTextureTransform();
            }
            @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture surfaceTexture) {
                if (player == ijkPlayer) {
                    try { player.setSurface(null); } catch (Exception ignored) {}
                    releaseIjkSurface();
                }
                return true;
            }
            @Override public void onSurfaceTextureUpdated(SurfaceTexture surfaceTexture) {}
        };
        textureView.setSurfaceTextureListener(listener);
        textureView.setVisibility(View.VISIBLE);
        if (textureView.isAvailable()) {
            attachIjkSurface(textureView.getSurfaceTexture());
            maybePrepareIjk(player);
        }
        applyViewportBounds();
    }

    private void attachIjkSurface(SurfaceTexture surfaceTexture) {
        if (ijkPlayer == null || surfaceTexture == null) return;
        releaseIjkSurface();
        ijkSurface = new Surface(surfaceTexture);
        ijkPlayer.setSurface(ijkSurface);
    }

    private void maybePrepareIjk(IjkMediaPlayer player) {
        if (player == null || player != ijkPlayer || ijkPrepareRequested || ijkSurface == null || released) return;
        ijkPrepareRequested = true;
        try {
            player.prepareAsync();
        } catch (Exception error) {
            activeState = "error";
            dispatchEvent(activeSessionId, "error", "IJK_PREPARE_FAILED", messageOf(error));
        }
    }

    private void createExoPlayer(JSONObject request) throws Exception {
        ensureOutputLayer();
        if (textureView == null) throw new IllegalStateException("LIVE_VIDEO_SURFACE_UNAVAILABLE");
        textureView.setSurfaceTextureListener(null);

        DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(activity)
            .setMediaCodecSelector(createCodecSelector(activeDecoder))
            .setEnableDecoderFallback(false);
        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true);
        JSONObject headers = request.optJSONObject("headers");
        if (headers != null) {
            java.util.HashMap<String, String> requestHeaders = new java.util.HashMap<>();
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                String value = headers.optString(key, "");
                if (!key.isEmpty() && !value.isEmpty()) requestHeaders.put(key, value);
            }
            if (!requestHeaders.isEmpty()) httpFactory.setDefaultRequestProperties(requestHeaders);
        }
        DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(activity, httpFactory);
        DefaultMediaSourceFactory mediaSourceFactory = new DefaultMediaSourceFactory(dataSourceFactory);
        ExoPlayer player = new ExoPlayer.Builder(activity, renderersFactory)
            .setMediaSourceFactory(mediaSourceFactory)
            .build();
        exoPlayer = player;
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int playbackState) {
                if (player != exoPlayer || released) return;
                if (playbackState == Player.STATE_BUFFERING) {
                    activeState = "buffering";
                    dispatchEvent(activeSessionId, "bufferingStart", "", "正在缓冲");
                } else if (playbackState == Player.STATE_READY) {
                    exoPrepared = true;
                    activeState = player.isPlaying() ? "playing" : "prepared";
                    dispatchEvent(activeSessionId, "prepared", "", "ExoPlayer 已准备就绪");
                    if (player.isPlaying()) dispatchEvent(activeSessionId, "playing", "", "正在播放");
                } else if (playbackState == Player.STATE_ENDED) {
                    activeState = "completed";
                    dispatchEvent(activeSessionId, "completed", "", "播放结束");
                }
            }
            @Override public void onIsPlayingChanged(boolean isPlaying) {
                if (player != exoPlayer || released) return;
                if (isPlaying) {
                    activeState = "playing";
                    dispatchEvent(activeSessionId, "playing", "", "ExoPlayer 正在播放");
                } else if (player.getPlaybackState() == Player.STATE_READY) {
                    activeState = "paused";
                    dispatchEvent(activeSessionId, "paused", "", "已暂停");
                }
            }
            @Override public void onPlayerError(PlaybackException error) {
                if (player != exoPlayer || released) return;
                activeState = "error";
                dispatchEvent(activeSessionId, "error", "EXO_PLAYBACK_ERROR_" + error.errorCode, error.getMessage() == null ? "ExoPlayer 播放失败" : error.getMessage());
            }
            @Override public void onVideoSizeChanged(VideoSize size) {
                if (player == exoPlayer) updateVideoSize(size.width, size.height);
            }
        });
        player.setVideoTextureView(textureView);
        player.setMediaItem(MediaItem.fromUri(activeUrl));
        player.prepare();
        textureView.setVisibility(View.VISIBLE);
        applyViewportBounds();
    }

    private MediaCodecSelector createCodecSelector(String decoderMode) {
        return (mimeType, requiresSecureDecoder, requiresTunnelingDecoder) -> {
            List<MediaCodecInfo> available = MediaCodecSelector.DEFAULT.getDecoderInfos(
                mimeType, requiresSecureDecoder, requiresTunnelingDecoder
            );
            if (mimeType == null || !mimeType.startsWith("video/")) return available;
            List<MediaCodecInfo> filtered = new ArrayList<>();
            for (MediaCodecInfo codec : available) {
                if ("software".equals(decoderMode) ? codec.softwareOnly : codec.hardwareAccelerated && !codec.softwareOnly) filtered.add(codec);
            }
            // An empty list is deliberate: unsupported decode modes fail explicitly
            // instead of silently falling back to the opposite decoder type.
            return filtered;
        };
    }

    @JavascriptInterface
    public String prepareMedia(String payload) {
        if (!isCurrentSession(payload)) return error("LIVE_SESSION_NOT_FOUND");
        return "{\"ok\":true,\"state\":\"" + escape(activeState) + "\"}";
    }

    @JavascriptInterface
    public String playMedia(String payload) {
        final String session = readSession(payload);
        if (session.isEmpty()) return error("INVALID_SESSION_ARGUMENT");
        mainHandler.post(() -> {
            if (!isCurrentSessionId(session)) return;
            try {
                if (exoPlayer != null) {
                    exoPlayer.setPlayWhenReady(true);
                    exoPlayer.play();
                } else if (ijkPlayer != null) {
                    if (!ijkPrepared) {
                        dispatchEvent(session, "error", "LIVE_PLAYER_NOT_PREPARED", "播放器尚未准备就绪");
                        return;
                    }
                    ijkPlayer.start();
                    activeState = "playing";
                    dispatchEvent(session, "playing", "", "IJKPlayer 正在播放");
                } else {
                    dispatchEvent(session, "error", "LIVE_PLAYER_NOT_INITIALIZED", "播放器尚未初始化");
                }
            } catch (Exception error) {
                dispatchEvent(session, "error", "LIVE_PLAY_START_FAILED", messageOf(error));
            }
        });
        return "{\"ok\":true}";
    }

    @JavascriptInterface
    public String pauseMedia(String payload) {
        final String session = readSession(payload);
        mainHandler.post(() -> {
            if (!isCurrentSessionId(session)) return;
            try {
                if (exoPlayer != null) exoPlayer.pause();
                else if (ijkPlayer != null && ijkPrepared && ijkPlayer.isPlaying()) ijkPlayer.pause();
                activeState = "paused";
                dispatchEvent(session, "paused", "", "已暂停");
            } catch (Exception error) {
                dispatchEvent(session, "error", "LIVE_PAUSE_FAILED", messageOf(error));
            }
        });
        return "{\"ok\":true}";
    }

    @JavascriptInterface
    public String seekMedia(String payload) {
        JSONObject request;
        try { request = new JSONObject(payload == null ? "{}" : payload); }
        catch (Exception error) { return error("INVALID_SEEK_ARGUMENT"); }
        final String session = request.optString("sessionId", "");
        final long positionMs = Math.max(0L, Math.round(request.optDouble("seconds", 0) * 1000d));
        mainHandler.post(() -> {
            if (!isCurrentSessionId(session)) return;
            try {
                if (exoPlayer != null) exoPlayer.seekTo(positionMs);
                else if (ijkPlayer != null) ijkPlayer.seekTo(positionMs);
            } catch (Exception error) {
                dispatchEvent(session, "error", "LIVE_SEEK_FAILED", messageOf(error));
            }
        });
        return "{\"ok\":true}";
    }

    @JavascriptInterface
    public String setVolume(String payload) {
        JSONObject request;
        try { request = new JSONObject(payload == null ? "{}" : payload); }
        catch (Exception error) { return error("INVALID_VOLUME_ARGUMENT"); }
        final String session = request.optString("sessionId", "");
        final float volume = Math.max(0f, Math.min(1f, (float) request.optDouble("volume", 1d)));
        mainHandler.post(() -> {
            if (!isCurrentSessionId(session)) return;
            if (exoPlayer != null) exoPlayer.setVolume(volume);
            else if (ijkPlayer != null) ijkPlayer.setVolume(volume, volume);
        });
        return "{\"ok\":true}";
    }

    @JavascriptInterface
    public String setPlaybackRate(String payload) {
        JSONObject request;
        try { request = new JSONObject(payload == null ? "{}" : payload); }
        catch (Exception error) { return error("INVALID_RATE_ARGUMENT"); }
        final String session = request.optString("sessionId", "");
        final float rate = (float) request.optDouble("rate", 1d);
        if (!(rate > 0f && Float.isFinite(rate))) return error("INVALID_PLAYBACK_RATE");
        if ("ijk".equals(activeEngine)) return error("IJK_PLAYBACK_RATE_UNAVAILABLE");
        mainHandler.post(() -> {
            if (isCurrentSessionId(session) && exoPlayer != null) exoPlayer.setPlaybackParameters(new PlaybackParameters(rate));
        });
        return "{\"ok\":true}";
    }

    @JavascriptInterface
    public String stopMedia(String payload) {
        final String session = readSession(payload);
        mainHandler.post(() -> {
            if (!session.isEmpty() && !isCurrentSessionId(session)) return;
            if (!activeSessionId.isEmpty()) dispatchEvent(activeSessionId, "stopped", "", "已停止");
            releaseActivePlayer();
            activeState = "stopped";
            deactivateOutputLayer();
        });
        return "{\"ok\":true}";
    }

    @JavascriptInterface
    public String releaseMedia(String payload) {
        final String session = readSession(payload);
        mainHandler.post(() -> {
            if (!session.isEmpty() && !activeSessionId.isEmpty() && !isCurrentSessionId(session)) return;
            releaseActivePlayer();
            activeSessionId = "";
            requestedSessionId = "";
            activeState = "released";
            deactivateOutputLayer();
        });
        return "{\"ok\":true}";
    }

    @JavascriptInterface
    public String setOutputActive(String payload) {
        JSONObject request;
        try { request = new JSONObject(payload == null ? "{}" : payload); }
        catch (Exception error) { return error("INVALID_OUTPUT_ARGUMENT"); }
        boolean enabled = request.optBoolean("enabled", false);
        mainHandler.post(() -> {
            if (enabled) activateOutputLayer();
            else deactivateOutputLayer();
        });
        return "{\"ok\":true}";
    }

    @JavascriptInterface
    public String setViewportBounds(String payload) {
        final JSONObject request;
        try { request = new JSONObject(payload == null ? "{}" : payload); }
        catch (Exception error) { return error("INVALID_VIEWPORT_ARGUMENT"); }
        viewportLeft = (float) request.optDouble("left", 0);
        viewportTop = (float) request.optDouble("top", 0);
        viewportWidth = Math.max(1f, (float) request.optDouble("width", 1));
        viewportHeight = Math.max(1f, (float) request.optDouble("height", 1));
        viewportScale = Math.max(0.1f, (float) request.optDouble("scale", 1));
        activeFitMode = request.optString("fitMode", activeFitMode);
        viewportZoom = Math.max(1f, (float) request.optDouble("zoom", 1));
        viewportPanX = (float) request.optDouble("panX", 0);
        viewportPanY = (float) request.optDouble("panY", 0);
        mainHandler.post(this::applyViewportBounds);
        return "{\"ok\":true}";
    }

    @JavascriptInterface
    public String getState(String payload) {
        JSONObject state = new JSONObject();
        try {
            state.put("ok", true);
            state.put("sessionId", activeSessionId);
            state.put("engine", activeEngine);
            state.put("decoder", activeDecoder);
            state.put("state", activeState);
            state.put("isPlaying", exoPlayer != null ? exoPlayer.isPlaying() : (ijkPlayer != null && ijkPlayer.isPlaying()));
            state.put("currentTime", exoPlayer != null ? exoPlayer.getCurrentPosition() / 1000d : (ijkPlayer != null ? ijkPlayer.getCurrentPosition() / 1000d : 0));
            state.put("duration", exoPlayer != null ? exoPlayer.getDuration() / 1000d : (ijkPlayer != null ? ijkPlayer.getDuration() / 1000d : 0));
        } catch (Exception ignored) {}
        return state.toString();
    }

    public void onHostPause() {
        mainHandler.post(() -> {
            if (released) return;
            boolean playing = exoPlayer != null ? exoPlayer.isPlaying() : (ijkPlayer != null && ijkPlayer.isPlaying());
            resumeAfterHostPause = playing;
            wasPlayingBeforePause = playing;
            if (playing) {
                if (exoPlayer != null) exoPlayer.pause();
                else if (ijkPlayer != null) ijkPlayer.pause();
            }
        });
    }

    public void onHostResume() {
        mainHandler.post(() -> {
            if (released || !resumeAfterHostPause || !wasPlayingBeforePause) return;
            resumeAfterHostPause = false;
            wasPlayingBeforePause = false;
            if (exoPlayer != null) exoPlayer.play();
            else if (ijkPlayer != null && ijkPrepared) ijkPlayer.start();
        });
    }

    private void activateOutputLayer() {
        if (released) return;
        ensureOutputLayer();
        if (outputLayer == null || textureView == null) return;
        outputActive = true;
        activity.getWindow().getDecorView().setBackgroundColor(WEBVIEW_BACKGROUND_COLOR);
        webView.setBackgroundColor(Color.TRANSPARENT);
        outputLayer.setVisibility(View.VISIBLE);
        textureView.setVisibility(View.VISIBLE);
        applyViewportBounds();
    }

    private void deactivateOutputLayer() {
        outputActive = false;
        if (textureView != null) textureView.setVisibility(View.GONE);
        if (outputLayer != null) outputLayer.setVisibility(View.GONE);
        if (webView != null) webView.setBackgroundColor(webViewOriginalBackground);
        if (activity.getWindow() != null) activity.getWindow().getDecorView().setBackgroundColor(WEBVIEW_BACKGROUND_COLOR);
    }

    private void applyViewportBounds() {
        if (released || !outputActive || webView == null || outputLayer == null || textureView == null) return;
        ViewGroup parent = (ViewGroup) outputLayer.getParent();
        if (parent == null) return;
        int[] webLocation = new int[2];
        int[] layerLocation = new int[2];
        webView.getLocationOnScreen(webLocation);
        outputLayer.getLocationOnScreen(layerLocation);
        float density = activity.getResources().getDisplayMetrics().density;
        float scale = viewportScale > 0.1f ? viewportScale : density;
        int left = webLocation[0] - layerLocation[0] + Math.round(viewportLeft * scale);
        int top = webLocation[1] - layerLocation[1] + Math.round(viewportTop * scale);
        int width = Math.max(1, Math.round(viewportWidth * scale));
        int height = Math.max(1, Math.round(viewportHeight * scale));
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(width, height);
        params.leftMargin = left;
        params.topMargin = top;
        textureView.setLayoutParams(params);
        applyTextureTransform();
    }

    private void updateVideoSize(int width, int height) {
        videoWidth = Math.max(0, width);
        videoHeight = Math.max(0, height);
        applyTextureTransform();
    }

    private void applyTextureTransform() {
        if (textureView == null || textureView.getWidth() <= 0 || textureView.getHeight() <= 0 || videoWidth <= 0 || videoHeight <= 0) return;
        float viewWidth = textureView.getWidth();
        float viewHeight = textureView.getHeight();
        float sourceAspect = (float) videoWidth / (float) videoHeight;
        float viewAspect = viewWidth / viewHeight;
        float scaleX = 1f;
        float scaleY = 1f;
        if ("contain".equalsIgnoreCase(activeFitMode)) {
            if (sourceAspect > viewAspect) scaleY = viewAspect / sourceAspect;
            else scaleX = sourceAspect / viewAspect;
        } else if ("crop".equalsIgnoreCase(activeFitMode) || "cover".equalsIgnoreCase(activeFitMode) || "fill".equalsIgnoreCase(activeFitMode)) {
            if (sourceAspect > viewAspect) scaleX = sourceAspect / viewAspect;
            else scaleY = viewAspect / sourceAspect;
        }
        scaleX *= viewportZoom;
        scaleY *= viewportZoom;
        Matrix matrix = new Matrix();
        matrix.setScale(scaleX, scaleY, viewWidth / 2f, viewHeight / 2f);
        if (viewportPanX != 0f || viewportPanY != 0f) {
            matrix.postTranslate(viewportPanX * viewWidth / 100f, viewportPanY * viewHeight / 100f);
        }
        textureView.setTransform(matrix);
    }

    private boolean isCurrentSession(String payload) {
        String session = readSession(payload);
        return isCurrentSessionId(session) || (session != null && !session.isEmpty() && session.equals(requestedSessionId));
    }

    private boolean isCurrentSessionId(String sessionId) {
        return sessionId != null && !sessionId.isEmpty() && sessionId.equals(activeSessionId) && !released;
    }

    private String readSession(String payload) {
        try { return new JSONObject(payload == null ? "{}" : payload).optString("sessionId", ""); }
        catch (Exception ignored) { return ""; }
    }

    private void releaseActivePlayer() {
        if (exoPlayer != null) {
            try { exoPlayer.clearVideoTextureView(textureView); } catch (Exception ignored) {}
            try { exoPlayer.release(); } catch (Exception ignored) {}
            exoPlayer = null;
        }
        if (ijkPlayer != null) {
            try { ijkPlayer.setSurface(null); } catch (Exception ignored) {}
            try { ijkPlayer.stop(); } catch (Exception ignored) {}
            try { ijkPlayer.release(); } catch (Exception ignored) {}
            ijkPlayer = null;
        }
        releaseIjkSurface();
        if (textureView != null) textureView.setSurfaceTextureListener(null);
        ijkPrepared = false;
        exoPrepared = false;
        ijkPrepareRequested = false;
        videoWidth = 0;
        videoHeight = 0;
    }

    private void releaseIjkSurface() {
        if (ijkSurface != null) {
            try { ijkSurface.release(); } catch (Exception ignored) {}
            ijkSurface = null;
        }
    }

    private String headersToString(JSONObject headers) {
        if (headers == null) return "";
        StringBuilder result = new StringBuilder();
        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            String value = headers.optString(key, "");
            if (!key.trim().isEmpty() && !value.isEmpty()) result.append(key.trim()).append(": ").append(value).append("\r\n");
        }
        return result.toString();
    }

    private void dispatchEvent(String sessionId, String event, String code, String message) {
        if (webView == null || sessionId == null || sessionId.isEmpty()) return;
        JSONObject detail = new JSONObject();
        try {
            detail.put("sessionId", sessionId);
            detail.put("event", event);
            if (code != null && !code.isEmpty()) detail.put("code", code);
            if (message != null && !message.isEmpty()) detail.put("message", message);
            detail.put("engine", activeEngine);
            detail.put("decoder", activeDecoder);
            detail.put("state", activeState);
            detail.put("currentTime", exoPlayer != null ? exoPlayer.getCurrentPosition() / 1000d : (ijkPlayer != null ? ijkPlayer.getCurrentPosition() / 1000d : 0));
            detail.put("duration", exoPlayer != null ? exoPlayer.getDuration() / 1000d : (ijkPlayer != null ? ijkPlayer.getDuration() / 1000d : 0));
        } catch (JSONException ignored) {}
        String script = "window.dispatchEvent(new CustomEvent('" + EVENT_NAME + "',{detail:" + detail.toString() + "}));";
        webView.post(() -> {
            if (!released || "released".equals(event)) webView.evaluateJavascript(script, null);
        });
    }

    private String ok(String key, String value) {
        JSONObject result = new JSONObject();
        try { result.put("ok", true); result.put(key, value); }
        catch (Exception ignored) {}
        return result.toString();
    }

    private static String error(String code) {
        JSONObject result = new JSONObject();
        try { result.put("ok", false); result.put("code", code); }
        catch (Exception ignored) {}
        return result.toString();
    }

    private static String messageOf(Throwable error) {
        String message = error == null ? "Unknown playback error" : error.getMessage();
        return message == null || message.trim().isEmpty() ? error.getClass().getSimpleName() : message;
    }

    private static String escape(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public void release() {
        if (released) return;
        released = true;
        mainHandler.post(() -> {
            releaseActivePlayer();
            activeSessionId = "";
            requestedSessionId = "";
            deactivateOutputLayer();
            if (outputLayer != null && outputLayer.getParent() instanceof ViewGroup) {
                ((ViewGroup) outputLayer.getParent()).removeView(outputLayer);
            }
            outputLayer = null;
            textureView = null;
        });
    }
}
