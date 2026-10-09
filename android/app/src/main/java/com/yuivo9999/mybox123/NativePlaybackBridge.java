package com.yuivo9999.mybox123;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Surface;
import android.view.TextureView;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.annotation.Nullable;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.SeekParameters;
import androidx.media3.exoplayer.analytics.AnalyticsListener;
import androidx.media3.exoplayer.mediacodec.MediaCodecInfo;
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import tv.danmaku.ijk.media.player.IjkMediaPlayer;
import tv.danmaku.ijk.media.player.IMediaPlayer;

/**
 * Single native playback boundary for the React/WebView application.
 *
 * Engines:
 *   EXO    -> AndroidX Media3 / ExoPlayer (primary)
 *   IJK    -> IJK/FFmpeg backend (fallback)
 *   NATIVE -> android.media.MediaPlayer (last fallback)
 *
 * The Web layer never talks to any engine directly.
 */
public final class NativePlaybackBridge {
    public static final String JS_NAME = "TVBoxAndroidBridge";

    private static final String ENGINE_EXO = "exo";
    private static final String ENGINE_IJK = "ijk";
    private static final String ENGINE_NATIVE = "native";

    // Live streams use a smoothness-first buffer policy. This is an upper
    // bound for forward/prepared media, not a promise that every network can
    // continuously fill a full 60 seconds.
    private static final int LIVE_BUFFER_MAX_MS = 60_000;
    private static final int VOD_BUFFER_MAX_MS = 200_000;
    private static final int LIVE_BUFFER_MIN_MS = 15_000;
    private static final int VOD_BUFFER_MIN_MS = 30_000;
    private static final int LIVE_BUFFER_FOR_PLAYBACK_MS = 1_500;
    private static final int LIVE_BUFFER_AFTER_REBUFFER_MS = 5_000;

    private final MainActivity activity;
    private final WebView webView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private TextureView textureView;
    private Surface surface;

    private String url;
    private String mediaProtocol = "";
    private Map<String, String> headers = Collections.emptyMap();
    private String cookies = "";
    private String decoderMode = "hardware";
    private Map<String, String> decoderModes = Collections.emptyMap();
    private Map<String, List<IjkOption>> ijkProfiles = Collections.emptyMap();
    private String ijkProfile = "";
    private boolean fallbackEnabled = true;
    private boolean livePlayback = false;
    private int liveBufferMaxMs = LIVE_BUFFER_MAX_MS;
    private int vodBufferMaxMs = VOD_BUFFER_MAX_MS;
    private List<String> configuredFallbackOrder = Collections.emptyList();
    private String selectedEngine = ENGINE_IJK;
    private String actualExoDecoderName = "";
    private List<String> engineOrder = Collections.emptyList();
    private int engineIndex = 0;
    private boolean prepared = false;
    private boolean wantPlay = false;
    private boolean released = false;
    private long lastPositionMs = 0L;
    // Monotonically increases for every load/fallback. Native callbacks from an
    // obsolete engine instance must never mutate the newly selected playback.
    private long playbackGeneration = 0L;

    private ExoPlayer exoPlayer;
    private IjkMediaPlayer ijkPlayer;
    private MediaPlayer nativePlayer;

    public NativePlaybackBridge(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        installTextureView();
    }

    private void installTextureView() {
        FrameLayout root = activity.findViewById(android.R.id.content);
        if (root == null) return;

        textureView = new TextureView(activity);
        textureView.setVisibility(TextureView.GONE);
        // The native surface must own the video pixels. Keeping this TextureView
        // transparent can expose the WebView poster/static image when no frame is
        // committed, which makes an audio-only playback look like a frozen picture.
        textureView.setOpaque(true);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        );
        root.addView(textureView, lp);

        textureView.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override public void onSurfaceTextureAvailable(android.graphics.SurfaceTexture st, int w, int h) {
                mainHandler.post(() -> {
                    try {
                        if (surface != null) surface.release();
                        surface = new Surface(st);
                        textureView.bringToFront();
                        attachSurface();
                    } catch (Throwable ignored) {}
                });
            }

            @Override public void onSurfaceTextureSizeChanged(android.graphics.SurfaceTexture st, int w, int h) {
                mainHandler.post(() -> {
                    try {
                        textureView.bringToFront();
                        attachSurface();
                    } catch (Throwable ignored) {}
                });
            }

            @Override public boolean onSurfaceTextureDestroyed(android.graphics.SurfaceTexture st) {
                // Detach the decoder before destroying the underlying Surface.
                detachSurface();
                if (surface != null) {
                    surface.release();
                    surface = null;
                }
                return true;
            }

            @Override public void onSurfaceTextureUpdated(android.graphics.SurfaceTexture st) {}
        });
    }

    @JavascriptInterface
    public synchronized String loadMedia(String payload) {
        if (released) return error("PLAYER_RELEASED");
        try {
            JSONObject input = new JSONObject(payload == null ? "{}" : payload);
            url = input.optString("url", "");
            if (url.isEmpty()) return error("PLAYER_URL_REQUIRED");
            playbackGeneration += 1L;
            mediaProtocol = normalizeProtocol(input.optString("protocol", ""), url);

            headers = readMap(input.optJSONObject("headers"));
            cookies = input.optString("cookies", "");

            JSONObject hint = input.optJSONObject("playerHint");
            String requested = hint == null ? ENGINE_IJK : hint.optString("engine", ENGINE_IJK);
            decoderMode = hint == null ? "hardware" : hint.optString("decoder", "hardware");
            decoderModes = readStringMap(hint == null ? null : hint.optJSONObject("decoderModes"));
            ijkProfiles = readIjkProfiles(hint == null ? null : hint.optJSONObject("ijkProfiles"));
            ijkProfile = hint == null ? "" : hint.optString("ijkProfile", "").trim();
            fallbackEnabled = hint == null || hint.optBoolean("fallbackEnabled", true);
            livePlayback = hint != null && hint.optBoolean("live", false);
            liveBufferMaxMs = livePlayback
                    ? Math.max(15_000, Math.min(LIVE_BUFFER_MAX_MS,
                            (int) Math.round((hint == null ? 60d : hint.optDouble("liveBufferMaxSeconds", 60d)) * 1000d)))
                    : LIVE_BUFFER_MAX_MS;
            vodBufferMaxMs = !livePlayback
                    ? Math.max(30_000, Math.min(VOD_BUFFER_MAX_MS,
                            (int) Math.round((hint == null ? 200d : hint.optDouble("vodBufferMaxSeconds", 200d)) * 1000d)))
                    : VOD_BUFFER_MAX_MS;
            configuredFallbackOrder = readStringList(hint == null ? null : hint.optJSONArray("fallbackOrder"));
            engineOrder = buildEngineOrder(requested, url, input.optString("protocol", ""));

            engineIndex = 0;
            selectedEngine = engineOrder.get(engineIndex);
            // Explicit UI selection wins over persisted per-engine defaults.
            // decoderModes is only the fallback when no decoder was requested for
            // this load.
            String requestedDecoder = hint == null ? "hardware" : hint.optString("decoder", "hardware").trim().toLowerCase();
            decoderMode = requestedDecoder.isEmpty() || "auto".equals(requestedDecoder)
                    ? decoderModes.getOrDefault(selectedEngine, "hardware")
                    : requestedDecoder;
            if (ENGINE_IJK.equals(selectedEngine) && !"software".equals(decoderMode)) {
                decoderMode = "hardware";
            } else if (ENGINE_EXO.equals(selectedEngine) && !"software".equals(decoderMode)) {
                decoderMode = "hardware";
            }
            prepared = false;
            wantPlay = false;
            releaseCurrentEngine();

            textureView.setVisibility(TextureView.VISIBLE);
            textureView.bringToFront();
            createCurrentEngine();
            attachSurface();
            return ok("engine", selectedEngine);
        } catch (Exception e) {
            return error("PLAYER_LOAD_ERROR:" + safeMessage(e));
        }
    }

    @JavascriptInterface
    public synchronized String setPlayerViewBounds(String payload) {
        try {
            JSONObject input = new JSONObject(payload == null ? "{}" : payload);
            final float leftCss = (float) Math.max(0d, input.optDouble("left", 0d));
            final float topCss = (float) Math.max(0d, input.optDouble("top", 0d));
            final float widthCss = (float) Math.max(0d, input.optDouble("width", 0d));
            final float heightCss = (float) Math.max(0d, input.optDouble("height", 0d));
            final float viewportWidthCss = (float) Math.max(1d, input.optDouble("viewportWidth", 1d));

            final int webWidthPx = Math.max(1, webView.getWidth());
            final float cssToPx = webWidthPx / viewportWidthCss;

            final int[] webLocation = new int[2];
            final int[] rootLocation = new int[2];
            webView.getLocationOnScreen(webLocation);
            FrameLayout root = activity.findViewById(android.R.id.content);
            if (root == null) return error("PLAYER_ROOT_UNAVAILABLE");
            root.getLocationOnScreen(rootLocation);

            final int left = Math.max(0, Math.round((webLocation[0] - rootLocation[0]) + leftCss * cssToPx));
            final int top = Math.max(0, Math.round((webLocation[1] - rootLocation[1]) + topCss * cssToPx));
            final int width = Math.max(1, Math.round(widthCss * cssToPx));
            final int height = Math.max(1, Math.round(heightCss * cssToPx));

            mainHandler.post(() -> {
                try {
                    if (width <= 0 || height <= 0) {
                        textureView.setVisibility(TextureView.GONE);
                        return;
                    }
                    FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) textureView.getLayoutParams();
                    if (lp == null) lp = new FrameLayout.LayoutParams(width, height);
                    lp.leftMargin = left;
                    lp.topMargin = top;
                    lp.width = width;
                    lp.height = height;
                    textureView.setLayoutParams(lp);
                    textureView.setVisibility(TextureView.VISIBLE);
                    textureView.bringToFront();
                    attachSurface();
                } catch (Throwable ignored) {}
            });
            return ok("updated", true);
        } catch (Throwable e) {
            return error("PLAYER_VIEW_BOUNDS_ERROR:" + safeMessage(e));
        }
    }

    @JavascriptInterface
    public synchronized String prepareMedia(String ignored) {
        if (released) return error("PLAYER_RELEASED");
        if (url == null || url.isEmpty()) return error("PLAYER_INPUT_REQUIRED");
        try {
            prepared = false;
            if (ENGINE_EXO.equals(selectedEngine)) {
                exoPlayer.prepare();
            } else if (ENGINE_IJK.equals(selectedEngine)) {
                ijkPlayer.prepareAsync();
            } else {
                nativePlayer.prepareAsync();
            }
            return ok("engine", selectedEngine);
        } catch (Throwable e) {
            return fallbackOrError("PLAYER_PREPARE_ERROR:" + safeMessage(e));
        }
    }

    @JavascriptInterface
    public synchronized String playMedia(String ignored) {
        if (released) return error("PLAYER_RELEASED");
        wantPlay = true;
        try {
            if (!prepared) return ok("queued", true);
            startCurrentEngine();
            return ok("engine", selectedEngine);
        } catch (Throwable e) {
            return fallbackOrError("PLAYER_PLAY_ERROR:" + safeMessage(e));
        }
    }

    @JavascriptInterface
    public synchronized String pauseMedia(String ignored) {
        wantPlay = false;
        try {
            if (ENGINE_EXO.equals(selectedEngine) && exoPlayer != null) exoPlayer.pause();
            else if (ENGINE_IJK.equals(selectedEngine) && ijkPlayer != null) ijkPlayer.pause();
            else if (nativePlayer != null) nativePlayer.pause();
            emit("paused", null);
            return ok("paused", true);
        } catch (Throwable e) {
            return error("PLAYER_PAUSE_ERROR:" + safeMessage(e));
        }
    }

    @JavascriptInterface
    public synchronized String seekMedia(String payload) {
        try {
            JSONObject input = new JSONObject(payload == null ? "{}" : payload);
            long seconds = Math.max(0L, input.optLong("seconds", 0L));
            long ms = seconds * 1000L;
            lastPositionMs = ms;

            if (ENGINE_EXO.equals(selectedEngine) && exoPlayer != null) exoPlayer.seekTo(ms);
            else if (ENGINE_IJK.equals(selectedEngine) && ijkPlayer != null) ijkPlayer.seekTo(ms);
            else if (nativePlayer != null && prepared) nativePlayer.seekTo((int) Math.min(Integer.MAX_VALUE, ms));

            return ok("seconds", seconds);
        } catch (Throwable e) {
            return error("PLAYER_SEEK_ERROR:" + safeMessage(e));
        }
    }

    @JavascriptInterface
    public synchronized String stopMedia(String ignored) {
        wantPlay = false;
        try {
            if (ENGINE_EXO.equals(selectedEngine) && exoPlayer != null) exoPlayer.stop();
            else if (ENGINE_IJK.equals(selectedEngine) && ijkPlayer != null) ijkPlayer.stop();
            else if (nativePlayer != null) nativePlayer.stop();
            prepared = false;
            emit("stopped", null);
            return ok("stopped", true);
        } catch (Throwable e) {
            return error("PLAYER_STOP_ERROR:" + safeMessage(e));
        }
    }

    @JavascriptInterface
    public synchronized String setVolume(String payload) {
        try {
            JSONObject input = new JSONObject(payload == null ? "{}" : payload);
            float value = (float) Math.max(0d, Math.min(1d, input.optDouble("value", 1d)));
            if (ENGINE_EXO.equals(selectedEngine) && exoPlayer != null) exoPlayer.setVolume(value);
            else if (ENGINE_IJK.equals(selectedEngine) && ijkPlayer != null) ijkPlayer.setVolume(value, value);
            else if (nativePlayer != null) nativePlayer.setVolume(value, value);
            return ok("value", value);
        } catch (Throwable e) {
            return error("PLAYER_VOLUME_ERROR:" + safeMessage(e));
        }
    }

    @JavascriptInterface
    public synchronized String getAudioTracks(String ignored) {
        return new JSONArray().toString();
    }

    @JavascriptInterface
    public synchronized String getSubtitleTracks(String ignored) {
        return new JSONArray().toString();
    }

    @JavascriptInterface
    public synchronized String selectAudioTrack(String ignored) {
        return ok("supported", false);
    }

    @JavascriptInterface
    public synchronized String selectSubtitleTrack(String ignored) {
        return ok("supported", false);
    }

    @JavascriptInterface
    public synchronized String getQualities(String ignored) {
        return new JSONArray().toString();
    }

    @JavascriptInterface
    public synchronized String selectQuality(String ignored) {
        return ok("supported", false);
    }

    @JavascriptInterface
    public synchronized String getState(String ignored) {
        JSONObject state = new JSONObject();
        try {
            state.put("engine", selectedEngine);
            state.put("decoder", actualDecoder());
            state.put("decoderMode", decoderMode);
            state.put("fallbackEnabled", fallbackEnabled);
            state.put("livePlayback", livePlayback);
            state.put("liveBufferMaxMs", liveBufferMaxMs);
            state.put("vodBufferMaxMs", vodBufferMaxMs);
            state.put("url", url == null ? "" : url);
            state.put("prepared", prepared);
            state.put("wantPlay", wantPlay);
            state.put("positionMs", currentPositionMs());
            state.put("durationMs", currentDurationMs());
        } catch (Exception stateError) {}
        return state.toString();
    }

    @JavascriptInterface
    public synchronized String saveUserData(String key, String value) {
        try {
            activity.getSharedPreferences("tvbox_user_data", Context.MODE_PRIVATE)
                    .edit()
                    .putString(key, value)
                    .apply();
            return ok("saved", true);
        } catch (Throwable e) {
            return error("STORAGE_SAVE_ERROR:" + safeMessage(e));
        }
    }

    @JavascriptInterface
    public synchronized String loadUserData(String key) {
        try {
            return activity.getSharedPreferences("tvbox_user_data", Context.MODE_PRIVATE)
                    .getString(key, "");
        } catch (Throwable e) {
            return "";
        }
    }

    @JavascriptInterface
    public synchronized String releaseMedia(String ignored) {
        // 软释放：仅停止并释放当前播放引擎、隐藏视频表面。
        // 该桥是 Activity 级单例，换台/离开页面都会调用本方法；
        // 这里绝不能把 released 置为 true，否则之后所有 loadMedia 都会返回 PLAYER_RELEASED，
        // 表现为“任何 m3u8 都无法播放”。永久释放只在 release()（Activity 销毁）中进行。
        if (released) return ok("released", true);
        playbackGeneration += 1L;
        wantPlay = false;
        prepared = false;
        pausedByHost = false;
        releaseCurrentEngine();
        if (textureView != null) {
            detachSurface();
            textureView.setVisibility(TextureView.GONE);
        }
        emit("released", null);
        return ok("released", true);
    }

    private boolean pausedByHost = false;

    public synchronized void onHostPause() {
        if (!released && wantPlay) {
            pausedByHost = true;
            pauseMedia("{}");
        }
    }

    public synchronized void onHostResume() {
        if (!released && pausedByHost) {
            pausedByHost = false;
            playMedia("{}");
        }
    }

    public synchronized void release() {
        // 永久释放：仅在 Activity.onDestroy 中调用
        if (released) return;
        releaseMedia("{}");
        released = true;
    }

    private static String normalizeProtocol(String protocol, String mediaUrl) {
        String explicit = protocol == null ? "" : protocol.trim().toLowerCase();
        String value = mediaUrl == null ? "" : mediaUrl.trim().toLowerCase();

        if ("hls/m3u8".equals(explicit)
                || "application/vnd.apple.mpegurl".equals(explicit)
                || "application/x-mpegurl".equals(explicit)) return "hls";

        // A URL with a media-specific signature wins over generic HTTP/HTTPS metadata.
        // This prevents protocol="http" from making a valid .m3u8 stream reach
        // ExoPlayer without MimeTypes.APPLICATION_M3U8.
        if (value.matches(".*\\.m3u8(?:[?#].*)?$")
                || value.contains("/pltv/")
                || value.contains("/tvod/")) return "hls";
        if (value.matches(".*\\.mpd(?:[?#].*)?$")) return "dash";
        if (value.startsWith("rtmp://")) return "rtmp";
        if (value.startsWith("rtsp://")) return "rtsp";
        if (value.matches(".*\\.flv(?:[?#].*)?$")) return "flv";

        if (!explicit.isEmpty()) return explicit;
        return (value.startsWith("http://") || value.startsWith("https://")) ? "http" : "";
    }

    private boolean isHlsProtocol() {
        return "hls".equals(mediaProtocol);
    }

    private boolean isIJKOnlyProtocol() {
        return "rtmp".equals(mediaProtocol) || "flv".equals(mediaProtocol);
    }

    private List<String> buildEngineOrder(String requested, String mediaUrl, String protocol) {
        ArrayList<String> result = new ArrayList<>();
        String normalized = requested == null ? "" : requested.trim().toLowerCase();
        if (!configuredFallbackOrder.isEmpty()) {
            result.addAll(configuredFallbackOrder);
            if (normalized.length() > 0) {
                result.remove(normalized);
                result.add(0, normalized);
            }
        } else if (ENGINE_IJK.equals(normalized)) {
            result.add(ENGINE_IJK); result.add(ENGINE_EXO); result.add(ENGINE_NATIVE);
        } else if (ENGINE_NATIVE.equals(normalized)) {
            result.add(ENGINE_NATIVE); result.add(ENGINE_EXO); result.add(ENGINE_IJK);
        } else {
            result.add(ENGINE_IJK); result.add(ENGINE_EXO); result.add(ENGINE_NATIVE);
        }
        ArrayList<String> unique = new ArrayList<>();
        for (String item : result) {
            if ((ENGINE_EXO.equals(item) || ENGINE_IJK.equals(item) || ENGINE_NATIVE.equals(item)) && !unique.contains(item)) unique.add(item);
        }

        // RTMP/FLV are IJK-only in this native playback path. This protocol rule
        // must take precedence over the generic "fallback disabled" shortcut.
        if (isIJKOnlyProtocol()) {
            unique.clear();
            unique.add(ENGINE_IJK);
            return unique;
        }

        if (!fallbackEnabled && !unique.isEmpty()) return Collections.singletonList(unique.get(0));

        // Live playback has a stricter fallback contract: when IJK hardware fails,
        // ExoPlayer must be the immediate next engine. Do not let a user-configured
        // fallback order insert native/IJK-software between IJK and Exo.
        if (livePlayback && ENGINE_IJK.equals(normalized) && fallbackEnabled) {
            unique.remove(ENGINE_IJK);
            unique.remove(ENGINE_EXO);
            unique.add(0, ENGINE_EXO);
            unique.add(0, ENGINE_IJK);
        }
        return unique;
    }

    private void createCurrentEngine() throws Exception {
        if (ENGINE_EXO.equals(selectedEngine)) createExo();
        else if (ENGINE_IJK.equals(selectedEngine)) createIjk();
        else createNative();
    }

    private void createExo() {
        final long generation = playbackGeneration;
        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory();
        if (!headers.isEmpty()) httpFactory.setDefaultRequestProperties(headers);
        if (!cookies.isEmpty()) {
            Map<String, String> merged = new LinkedHashMap<>(headers);
            merged.put("Cookie", cookies);
            httpFactory.setDefaultRequestProperties(merged);
        }

        DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(activity)
                .setEnableDecoderFallback(true)
                .setMediaCodecSelector(createDecoderSelector());

        ExoPlayer.Builder builder = new ExoPlayer.Builder(activity, renderersFactory)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(httpFactory));

        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMsForStreaming(
                        livePlayback ? LIVE_BUFFER_MIN_MS : VOD_BUFFER_MIN_MS,
                        livePlayback ? liveBufferMaxMs : vodBufferMaxMs,
                        livePlayback ? LIVE_BUFFER_FOR_PLAYBACK_MS : 2_500,
                        livePlayback ? LIVE_BUFFER_AFTER_REBUFFER_MS : 5_000)
                .setPrioritizeTimeOverSizeThresholdsForStreaming(true)
                .setBackBuffer(0, false)
                .build();
        builder.setLoadControl(loadControl);

        if (!livePlayback && isHlsProtocol()) {
            // Exact VOD HLS seeking prevents the seek request from being silently
            // snapped to a nearby keyframe. Media3 still resolves the seek using
            // the HLS timeline and loads fragments in their natural sequence.
            builder.setSeekParameters(SeekParameters.EXACT);
        }

        exoPlayer = builder.build();

        exoPlayer.addAnalyticsListener(new AnalyticsListener() {
            @Override public void onVideoDecoderInitialized(
                    EventTime eventTime,
                    String decoderName,
                    long initializedTimestampMs,
                    long initializationDurationMs) {
                if (generation != playbackGeneration || released) return;
                actualExoDecoderName = decoderName == null ? "" : decoderName;
                emit("decoderChanged", decoderObject());
            }
        });

        exoPlayer.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if (generation != playbackGeneration || released) return;
                if (state == Player.STATE_BUFFERING) emit("bufferingStart", null);
                if (state == Player.STATE_READY) {
                    prepared = true;
                    emit("prepared", null);
                    if (wantPlay) {
                        try { exoPlayer.play(); } catch (Throwable e) { fallbackOrError("EXO_PLAY:" + safeMessage(e)); }
                    }
                }
                if (state == Player.STATE_ENDED) emit("completed", null);
            }

            @Override public void onIsPlayingChanged(boolean isPlaying) {
                if (generation != playbackGeneration || released) return;
                emit(isPlaying ? "playing" : "paused", null);
            }

            @Override public void onPlayerError(PlaybackException error) {
                if (generation != playbackGeneration || released) return;
                fallbackOrError("EXO_ERROR:" + safeMessage(error), generation);
            }
        });

        // The bridge owns the TextureView Surface lifecycle for all engines.
        // Do not also call setVideoTextureView(), which installs a second
        // SurfaceTexture lifecycle on the same TextureView.
        MediaItem.Builder mediaItemBuilder = new MediaItem.Builder().setUri(Uri.parse(url));
        // Some live HLS endpoints do not end in .m3u8 (for example /pltv/ or
        // /tvod/ URLs). Explicitly declare the HLS MIME type so Media3 cannot
        // misclassify them as progressive HTTP and break the segment timeline.
        if (isHlsProtocol()) mediaItemBuilder.setMimeType(MimeTypes.APPLICATION_M3U8);
        exoPlayer.setMediaItem(mediaItemBuilder.build());
        attachSurface();
    }

    private MediaCodecSelector createDecoderSelector() {
        if (!"hardware".equals(decoderMode) && !"software".equals(decoderMode)) {
            return MediaCodecSelector.DEFAULT;
        }
        return (mimeType, requiresSecureDecoder, requiresTunnelingDecoder) -> {
            List<MediaCodecInfo> available = MediaCodecSelector.DEFAULT.getDecoderInfos(
                    mimeType, requiresSecureDecoder, requiresTunnelingDecoder);
            ArrayList<MediaCodecInfo> filtered = new ArrayList<>();
            boolean software = "software".equals(decoderMode);
            for (MediaCodecInfo info : available) {
                if (info.softwareOnly == software) {
                    filtered.add(info);
                }
            }
            return filtered;
        };
    }

    private void createIjk() throws IOException {
        final long generation = playbackGeneration;
        ijkPlayer = new IjkMediaPlayer();
        applyIjkProfile();
        if (!headers.isEmpty()) ijkPlayer.setDataSource(url, headers);
        else ijkPlayer.setDataSource(url);
        if (cookies.length() > 0) {
            ijkPlayer.setOption(IjkMediaPlayer.OPT_CATEGORY_FORMAT, "headers", "Cookie: " + cookies);
        }

        ijkPlayer.setOnPreparedListener(mp -> {
            if (generation != playbackGeneration || released) return;
            // IJK can silently fall back to FFmpeg when MediaCodec selection fails.
            // Treat that as a hardware-decoder failure when hardware was requested,
            // so Live goes directly to Exo and VOD gets the explicit IJK software step.
            if ("hardware".equals(decoderMode)) {
                try {
                    int actual = ijkPlayer.getVideoDecoder();
                    if (actual != 2) {
                        fallbackOrError("IJK_HARDWARE_NOT_ACTIVE:" + actual, generation);
                        return;
                    }
                } catch (Throwable e) {
                    fallbackOrError("IJK_HARDWARE_PROBE:" + safeMessage(e), generation);
                    return;
                }
            }

            prepared = true;
            emit("decoderChanged", decoderObject());
            emit("prepared", null);
            if (wantPlay) {
                try { ijkPlayer.start(); } catch (Throwable e) { fallbackOrError("IJK_PLAY:" + safeMessage(e), generation); }
            }
        });
        ijkPlayer.setOnCompletionListener(mp -> { if (generation == playbackGeneration && !released) emit("completed", null); });
        ijkPlayer.setOnBufferingUpdateListener((mp, percent) -> {
            if (generation != playbackGeneration || released) return;
            if (percent < 100) emit("buffering", null);
        });
        ijkPlayer.setOnErrorListener((mp, what, extra) -> {
            if (generation != playbackGeneration || released) return false;
            fallbackOrError("IJK_ERROR:" + what + ":" + extra, generation);
            return true;
        });

        attachSurface();
    }

    private static final class IjkOption {
        final int category;
        final String name;
        final String value;
        IjkOption(int category, String name, String value) {
            this.category = category;
            this.name = name;
            this.value = value;
        }
    }

    private static final java.util.Set<String> ALLOWED_IJK_OPTIONS =
            new java.util.HashSet<>(java.util.Arrays.asList(
                    "opensles", "overlay-format", "framedrop", "soundtouch",
                    "start-on-prepared", "http-detect-range-support", "fflags",
                    "skip_loop_filter", "reconnect", "max-buffer-size", "max_cached_duration",
                    "packet-buffering", "infbuf",
                    "enable-accurate-seek", "mediacodec", "mediacodec-auto-rotate",
                    "mediacodec-handle-resolution-change", "mediacodec-hevc",
                    "dns_cache_timeout"
            ));

    private Map<String, List<IjkOption>> readIjkProfiles(@Nullable JSONObject object) {
        if (object == null) return Collections.emptyMap();
        Map<String, List<IjkOption>> profiles = new LinkedHashMap<>();
        Iterator<String> groups = object.keys();
        while (groups.hasNext()) {
            String group = groups.next();
            JSONArray options = object.optJSONArray(group);
            if (options == null) continue;
            ArrayList<IjkOption> parsed = new ArrayList<>();
            for (int i = 0; i < options.length(); i++) {
                JSONObject option = options.optJSONObject(i);
                if (option == null) continue;
                int category = option.optInt("category", 0);
                String name = option.optString("name", "").trim();
                String value = option.optString("value", "");
                if (category < 1 || category > 4 || name.isEmpty()
                        || value.isEmpty() || !ALLOWED_IJK_OPTIONS.contains(name)) continue;
                parsed.add(new IjkOption(category, name, value));
            }
            if (!parsed.isEmpty()) profiles.put(group, parsed);
        }
        return profiles;
    }

    private void applyIjkProfile() {
        List<IjkOption> options = ijkProfiles.get(ijkProfile);
        if (options == null || options.isEmpty()) {
            // Preserve the existing project defaults when no TVBox profile is available.
            ijkPlayer.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "mediacodec", 1);
            ijkPlayer.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "mediacodec-auto-rotate", 1);
            ijkPlayer.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "mediacodec-handle-resolution-change", 1);
        } else {
        for (IjkOption option : options) {
            try {
                if (option.category == IjkMediaPlayer.OPT_CATEGORY_PLAYER
                        || option.category == IjkMediaPlayer.OPT_CATEGORY_FORMAT
                        || option.category == IjkMediaPlayer.OPT_CATEGORY_CODEC
                        || option.category == IjkMediaPlayer.OPT_CATEGORY_SWS) {
                    long numeric;
                    try {
                        numeric = Long.parseLong(option.value);
                        ijkPlayer.setOption(option.category, option.name, numeric);
                    } catch (NumberFormatException ignored) {
                        ijkPlayer.setOption(option.category, option.name, option.value);
                    }
                }
            } catch (Throwable ignored) {}
        }
        }

        // Playback policy is authoritative over an imported IJK profile.
        if ("hardware".equals(decoderMode)) {
            ijkPlayer.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "mediacodec", 1);
        } else if ("software".equals(decoderMode)) {
            ijkPlayer.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "mediacodec", 0);
        }

        // Live/VOD cache policy for the FlutterPlayer IJK fork. The fork's
        // max_cached_duration option follows the player's duration setting
        // convention, so pass seconds rather than milliseconds.
        ijkPlayer.setOption(
                IjkMediaPlayer.OPT_CATEGORY_PLAYER,
                "max_cached_duration",
                livePlayback ? 60 : Math.max(30, vodBufferMaxMs / 1000));
        ijkPlayer.setOption(
                IjkMediaPlayer.OPT_CATEGORY_PLAYER,
                "infbuf",
                0);
        ijkPlayer.setOption(
                IjkMediaPlayer.OPT_CATEGORY_PLAYER,
                "packet-buffering",
                1);

        // HLS VOD seeks must be accurate enough to land on the requested timeline
        // while FFmpeg continues reading the playlist/segments in order.
        if (!livePlayback && isHlsProtocol()) {
            ijkPlayer.setOption(
                    IjkMediaPlayer.OPT_CATEGORY_PLAYER,
                    "enable-accurate-seek",
                    1);
        }
    }

    private void createNative() throws IOException {
        final long generation = playbackGeneration;
        nativePlayer = new MediaPlayer();
        nativePlayer.setAudioAttributes(new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .build());

        nativePlayer.setOnPreparedListener(mp -> {
            if (generation != playbackGeneration || released) return;
            prepared = true;
            emit("prepared", null);
            if (wantPlay) {
                try { mp.start(); } catch (Throwable e) { emit("error", errorObject("NATIVE_PLAY:" + safeMessage(e))); }
            }
        });
        nativePlayer.setOnCompletionListener(mp -> { if (generation == playbackGeneration && !released) emit("completed", null); });
        nativePlayer.setOnBufferingUpdateListener((mp, percent) -> {
            if (generation != playbackGeneration || released) return;
            if (percent < 100) emit("buffering", null);
        });
        nativePlayer.setOnErrorListener((mp, what, extra) -> {
            if (generation != playbackGeneration || released) return true;
            emit("error", errorObject("NATIVE_ERROR:" + what + ":" + extra));
            return true;
        });

        Uri uri = Uri.parse(url);
        nativePlayer.setDataSource(activity, uri, headers.isEmpty() ? null : headers);
        if (surface != null) nativePlayer.setSurface(surface);
    }

    private void startCurrentEngine() {
        if (ENGINE_EXO.equals(selectedEngine) && exoPlayer != null) exoPlayer.play();
        else if (ENGINE_IJK.equals(selectedEngine) && ijkPlayer != null) ijkPlayer.start();
        else if (nativePlayer != null) nativePlayer.start();
        emit("playing", null);
    }

    private void attachSurface() {
        if (surface == null) return;
        try {
            if (ENGINE_EXO.equals(selectedEngine) && exoPlayer != null) {
                exoPlayer.setVideoSurface(surface);
            } else if (ENGINE_IJK.equals(selectedEngine) && ijkPlayer != null) {
                ijkPlayer.setSurface(surface);
            } else if (nativePlayer != null) {
                nativePlayer.setSurface(surface);
            }
        } catch (Throwable e) {
            emit("error", errorObject("VIDEO_SURFACE_ATTACH_ERROR:" + safeMessage(e)));
        }
    }

    private void detachSurface() {
        try { if (exoPlayer != null) exoPlayer.setVideoSurface(null); } catch (Throwable ignored) {}
        try { if (ijkPlayer != null) ijkPlayer.setSurface(null); } catch (Throwable ignored) {}
        try { if (nativePlayer != null) nativePlayer.setSurface(null); } catch (Throwable ignored) {}
    }

    private synchronized String fallbackOrError(String reason) {
        return fallbackOrError(reason, playbackGeneration);
    }

    private synchronized String fallbackOrError(String reason, long generation) {
        if (generation != playbackGeneration || released) return ok("stale", true);

        if (ENGINE_IJK.equals(selectedEngine)
                && "hardware".equals(decoderMode)
                && livePlayback
                && isIJKOnlyProtocol()
                && fallbackEnabled) {
            playbackGeneration += 1L;
            releaseCurrentEngine();
            decoderMode = "software";
            prepared = false;
            try {
                createCurrentEngine();
                emit("reconnecting", errorObject("fallback:ijk_hardware_to_software:" + reason));
                prepareMedia("{}");
                return ok("fallbackDecoder", "software");
            } catch (Throwable next) {
                emit("error", errorObject("IJK_SOFTWARE_FALLBACK:" + safeMessage(next)));
                return error("IJK_SOFTWARE_FALLBACK:" + safeMessage(next));
            }
        }

        if (ENGINE_IJK.equals(selectedEngine)
                && "hardware".equals(decoderMode)
                && !livePlayback
                && fallbackEnabled) {
            lastPositionMs = currentPositionMs();
            playbackGeneration += 1L;
            releaseCurrentEngine();
            decoderMode = "software";
            prepared = false;
            try {
                createCurrentEngine();
                emit("reconnecting", errorObject("fallback:ijk_hardware_to_software:" + reason));
                if (lastPositionMs > 0) {
                    seekMedia("{\"seconds\":" + (lastPositionMs / 1000L) + "}");
                }
                prepareMedia("{}");
                return ok("fallbackDecoder", "software");
            } catch (Throwable next) {
                return fallbackOrError("IJK_SOFTWARE_FALLBACK_" + safeMessage(next));
            }
        }

        if (engineIndex + 1 < engineOrder.size()) {
            lastPositionMs = currentPositionMs();
            playbackGeneration += 1L;
            releaseCurrentEngine();
            engineIndex++;
            selectedEngine = engineOrder.get(engineIndex);
            decoderMode = decoderModes.getOrDefault(selectedEngine, decoderMode);
            prepared = false;
            try {
                createCurrentEngine();
                emit("reconnecting", errorObject("fallback:" + reason));
                // A Live fallback should reconnect at the current live edge rather than
                // seeking ExoPlayer to the old IJK timeline position. VOD keeps its position.
                if (!livePlayback && lastPositionMs > 0) {
                    seekMedia("{\"seconds\":" + (lastPositionMs / 1000L) + "}");
                }
                prepareMedia("{}");
                return ok("fallbackEngine", selectedEngine);
            } catch (Throwable next) {
                return fallbackOrError("FALLBACK_" + safeMessage(next));
            }
        }
        emit("error", errorObject(reason));
        return error(reason);
    }

    private void releaseCurrentEngine() {
        try {
            if (exoPlayer != null) {
                exoPlayer.setVideoSurface(null);
                exoPlayer.release();
            }
        } catch (Throwable ignored) {}
        try {
            if (ijkPlayer != null) {
                ijkPlayer.setSurface(null);
                ijkPlayer.release();
            }
        } catch (Throwable ignored) {}
        try {
            if (nativePlayer != null) {
                nativePlayer.setSurface(null);
                nativePlayer.release();
            }
        } catch (Throwable ignored) {}

        exoPlayer = null;
        actualExoDecoderName = "";
        ijkPlayer = null;
        nativePlayer = null;
        prepared = false;
    }

    private long currentPositionMs() {
        try {
            if (ENGINE_EXO.equals(selectedEngine) && exoPlayer != null) return Math.max(0L, exoPlayer.getCurrentPosition());
            if (ENGINE_IJK.equals(selectedEngine) && ijkPlayer != null) return Math.max(0L, ijkPlayer.getCurrentPosition());
            if (nativePlayer != null && prepared) return Math.max(0L, nativePlayer.getCurrentPosition());
        } catch (Throwable ignored) {}
        return lastPositionMs;
    }

    private long currentDurationMs() {
        try {
            if (ENGINE_EXO.equals(selectedEngine) && exoPlayer != null) return Math.max(0L, exoPlayer.getDuration());
            if (ENGINE_IJK.equals(selectedEngine) && ijkPlayer != null) return Math.max(0L, ijkPlayer.getDuration());
            if (nativePlayer != null && prepared) return Math.max(0L, nativePlayer.getDuration());
        } catch (Throwable ignored) {}
        return 0L;
    }

    private Map<String, String> readStringMap(@Nullable JSONObject object) {
        if (object == null) return Collections.emptyMap();
        Map<String, String> result = new LinkedHashMap<>();
        Iterator<String> keys = object.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            String value = object.optString(key, "").trim().toLowerCase();
            if (ENGINE_EXO.equals(key) || ENGINE_IJK.equals(key) || ENGINE_NATIVE.equals(key)) {
                result.put(key, value);
            }
        }
        return result;
    }

    private List<String> readStringList(@Nullable JSONArray array) {
        if (array == null) return Collections.emptyList();
        ArrayList<String> result = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            String value = array.optString(i, "").trim().toLowerCase();
            if ((ENGINE_EXO.equals(value) || ENGINE_IJK.equals(value) || ENGINE_NATIVE.equals(value)) && !result.contains(value)) result.add(value);
        }
        return result;
    }

    private String actualDecoder() {
        if (ENGINE_IJK.equals(selectedEngine) && ijkPlayer != null) {
            try {
                int decoder = ijkPlayer.getVideoDecoder();
                if (decoder == 2) return "MediaCodec";
                if (decoder == 1) return "FFmpeg";
            } catch (Throwable ignored) {}
            return "Unknown";
        }
        if (ENGINE_EXO.equals(selectedEngine)) return actualExoDecoderName.isEmpty() ? "MediaCodec" : actualExoDecoderName;
        if (ENGINE_NATIVE.equals(selectedEngine)) return "System";
        return "Unknown";
    }

    private JSONObject decoderObject() {
        try { return new JSONObject().put("engine", selectedEngine).put("decoder", actualDecoder()).put("mode", decoderMode); }
        catch (Exception e) { return new JSONObject(); }
    }

    private Map<String, String> readMap(@Nullable JSONObject object) {
        if (object == null) return Collections.emptyMap();
        Map<String, String> result = new LinkedHashMap<>();
        Iterator<String> keys = object.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            result.put(key, object.optString(key, ""));
        }
        return result;
    }

    private String safeMessage(Throwable e) {
        return e == null ? "unknown" : String.valueOf(e.getMessage()).replace("\\", "/").replace("\"", "'");
    }

    private String ok(String key, Object value) {
        try { return new JSONObject().put("ok", true).put(key, value).toString(); }
        catch (Exception e) { return "{\"ok\":true}"; }
    }

    private String error(String code) {
        try { return new JSONObject().put("ok", false).put("code", code).toString(); }
        catch (Exception e) { return "{\"ok\":false}"; }
    }

    private JSONObject errorObject(String message) {
        try { return new JSONObject().put("message", message); }
        catch (Exception e) { return new JSONObject(); }
    }

    private void emit(String event, @Nullable Object data) {
        try {
            JSONObject payload = new JSONObject().put("event", event);
            if (data != null) payload.put("data", data);
            final String script = "window.TVBoxWebView&&window.TVBoxWebView.onPlayerEvent&&window.TVBoxWebView.onPlayerEvent(" + JSONObject.quote(payload.toString()) + ")";
            mainHandler.post(() -> webView.evaluateJavascript(script, null));
        } catch (Throwable ignored) {}
    }
}
