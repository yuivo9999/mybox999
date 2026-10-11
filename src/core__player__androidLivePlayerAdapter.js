import { createHtml5PlayerAdapter } from './core__player__html5PlayerAdapter.js';
import { createPlayerAdapterContract } from './core__player__playerInterface.js';

const NATIVE_SCHEMES = new Set(['ijk_hardware', 'ijk_software', 'exo_hardware', 'exo_software']);
const PREPARE_TIMEOUT_MS = 30000;

function parseBridgeResult(value, fallbackCode = 'ANDROID_LIVE_BRIDGE_ERROR') {
  let result = value;
  if (typeof value === 'string') {
    try { result = JSON.parse(value); } catch { result = null; }
  }
  if (!result || typeof result !== 'object') throw new Error(fallbackCode);
  if (result.ok === false) throw new Error(result.code || fallbackCode);
  return result;
}

function makeSessionId() {
  return `live-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Android Live-only adapter. IJK/Exo use the dedicated TVBoxLivePlayerBridge;
 * HTML5/HLS options continue to use the page-owned video element. This adapter
 * deliberately does not call the retired TVBoxAndroidBridge playback methods.
 */
export function createAndroidLivePlayerAdapter(video, hooks = {}) {
  if (!video) throw new Error('PLAYER_ELEMENT_REQUIRED');
  const bridge = typeof window !== 'undefined' ? window.TVBoxLivePlayerBridge : null;
  const htmlPlayer = createHtml5PlayerAdapter(video, {
    ...hooks,
    requireVideoFrame: true,
    allowMixedContent: true,
    onEvent: (event) => {
      if (backend === 'html5') hooks.onEvent?.(event);
    },
  });

  let backend = 'html5';
  let input = null;
  let released = false;
  let nativeSessionId = '';
  let nativePrepared = false;
  let nativePreparePromise = null;
  let resolveNativePrepared = null;
  let rejectNativePrepared = null;
  let nativePrepareTimer = null;
  let viewportTimer = null;
  let resizeObserver = null;
  let nativeActive = false;
  let savedVideoVisibility = '';
  let savedVideoOpacity = '';
  let savedVideoPointerEvents = '';
  let activeWindow = null;
  let activeBoundsElement = null;
  let lastBoundsSignature = '';
  let transparentAncestorNodes = [];

  const emit = (event, detail = {}) => hooks.onEvent?.({ event, ...detail });
  const serialize = (payload) => JSON.stringify(payload ?? {});

  const bridgeCall = (method, payload = {}) => {
    if (!bridge || typeof bridge[method] !== 'function') throw new Error('ANDROID_LIVE_BRIDGE_UNAVAILABLE');
    return parseBridgeResult(bridge[method](serialize(payload)), `ANDROID_LIVE_${method.toUpperCase()}_FAILED`);
  };

  const clearPrepareWait = (reason = '') => {
    if (nativePrepareTimer) clearTimeout(nativePrepareTimer);
    nativePrepareTimer = null;
    if (reason) rejectNativePrepared?.(new Error(reason));
    resolveNativePrepared = null;
    rejectNativePrepared = null;
    nativePreparePromise = null;
  };

  const stopBoundsTracking = () => {
    if (viewportTimer) clearInterval(viewportTimer);
    viewportTimer = null;
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', syncViewportBounds);
      window.removeEventListener('orientationchange', syncViewportBounds);
      window.removeEventListener('scroll', syncViewportBounds, true);
      window.removeEventListener('transitionend', syncViewportBounds, true);
    }
  };

  function syncViewportBounds() {
    if (!nativeActive || backend !== 'native' || released || !activeBoundsElement) return;
    const rect = activeBoundsElement.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width < 1 || rect.height < 1) return;
    const windowNode = activeWindow;
    const payload = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      scale: Number(window.devicePixelRatio) || 1,
      fitMode: windowNode?.dataset?.fitMode || 'contain',
      zoom: windowNode?.dataset?.zoomEnabled === 'true' ? Number.parseFloat(getComputedStyle(windowNode).getPropertyValue('--video-zoom')) || 1 : 1,
      panX: windowNode ? Number.parseFloat(getComputedStyle(windowNode).getPropertyValue('--video-pan-x')) || 0 : 0,
      panY: windowNode ? Number.parseFloat(getComputedStyle(windowNode).getPropertyValue('--video-pan-y')) || 0 : 0,
    };
    const signature = Object.values(payload).map(value => typeof value === 'number' ? value.toFixed(2) : String(value)).join('|');
    if (signature === lastBoundsSignature) return;
    lastBoundsSignature = signature;
    try { parseBridgeResult(bridge.setViewportBounds(serialize(payload)), 'ANDROID_LIVE_BOUNDS_SYNC_FAILED'); } catch {}
  }

  const startBoundsTracking = () => {
    stopBoundsTracking();
    activeBoundsElement = video.closest('.sangtian-window-body') || video;
    activeWindow = video.closest('.sangtian-window');
    lastBoundsSignature = '';
    syncViewportBounds();
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(syncViewportBounds);
      resizeObserver.observe(activeBoundsElement);
      if (video !== activeBoundsElement) resizeObserver.observe(video);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', syncViewportBounds, { passive: true });
      window.addEventListener('orientationchange', syncViewportBounds, { passive: true });
      window.addEventListener('scroll', syncViewportBounds, true);
      window.addEventListener('transitionend', syncViewportBounds, true);
    }
    // Fullscreen and immersive transitions often animate position without
    // changing the video box size; track briefly at a low rate to keep the
    // native texture aligned throughout those transitions.
    viewportTimer = setInterval(syncViewportBounds, 100);
  };

  const setNativeDomMask = (enabled) => {
    if (enabled) {
      if (!nativeActive) {
        savedVideoVisibility = video.style.visibility;
        savedVideoOpacity = video.style.opacity;
        savedVideoPointerEvents = video.style.pointerEvents;
      }
      nativeActive = true;
      activeWindow = video.closest('.sangtian-window');
      activeWindow?.classList.add('is-android-live-native');
      document.documentElement?.classList.add('android-live-native-active');
      document.body?.classList.add('android-live-native-active');
      const boundsNode = video.closest('.sangtian-window-body') || video;
      transparentAncestorNodes = [];
      for (let node = boundsNode; node; node = node.parentElement) {
        node.classList?.add('android-live-native-transparent-ancestor');
        transparentAncestorNodes.push(node);
        if (node === document.body) break;
      }
      if (document.documentElement && !transparentAncestorNodes.includes(document.documentElement)) {
        document.documentElement.classList.add('android-live-native-transparent-ancestor');
        transparentAncestorNodes.push(document.documentElement);
      }
      video.style.visibility = 'hidden';
      video.style.opacity = '0';
      video.style.pointerEvents = 'none';
    } else {
      nativeActive = false;
      activeWindow?.classList.remove('is-android-live-native');
      document.documentElement?.classList.remove('android-live-native-active');
      document.body?.classList.remove('android-live-native-active');
      transparentAncestorNodes.forEach(node => node.classList?.remove('android-live-native-transparent-ancestor'));
      transparentAncestorNodes = [];
      video.style.visibility = savedVideoVisibility;
      video.style.opacity = savedVideoOpacity;
      video.style.pointerEvents = savedVideoPointerEvents;
      activeWindow = null;
      activeBoundsElement = null;
    }
  };

  const deactivateNativeOutput = (release = true) => {
    stopBoundsTracking();
    if (release && nativeSessionId && bridge && typeof bridge.releaseMedia === 'function') {
      try { bridgeCall('releaseMedia', { sessionId: nativeSessionId }); } catch {}
    } else if (bridge && typeof bridge.setOutputActive === 'function') {
      try { bridgeCall('setOutputActive', { enabled: false, sessionId: nativeSessionId }); } catch {}
    }
    nativeSessionId = '';
    nativePrepared = false;
    clearPrepareWait('ANDROID_LIVE_SESSION_REPLACED');
    setNativeDomMask(false);
  };

  const onNativeEvent = (event) => {
    const detail = event?.detail ?? {};
    if (released || backend !== 'native' || !nativeSessionId || detail.sessionId !== nativeSessionId) return;
    const rawName = String(detail.event || '');
    const name = ({
      bufferingstart: 'bufferingStart',
      bufferingend: 'bufferingEnd',
    })[rawName.toLowerCase()] || rawName;
    if (name === 'prepared') {
      nativePrepared = true;
      if (nativePrepareTimer) clearTimeout(nativePrepareTimer);
      nativePrepareTimer = null;
      resolveNativePrepared?.(input);
      resolveNativePrepared = null;
      rejectNativePrepared = null;
      emit('prepared', detail);
    } else if (name === 'error') {
      const error = new Error(detail.code || detail.message || 'ANDROID_LIVE_PLAYBACK_FAILED');
      if (nativePrepareTimer) clearTimeout(nativePrepareTimer);
      nativePrepareTimer = null;
      rejectNativePrepared?.(error);
      resolveNativePrepared = null;
      rejectNativePrepared = null;
      emit('error', { nativeError: error, message: detail.message || error.message, code: detail.code || 'ANDROID_LIVE_PLAYBACK_FAILED' });
    } else if (name) {
      emit(name, detail);
    }
  };

  if (typeof window !== 'undefined') window.addEventListener('tvbox-android-live-player-event', onNativeEvent);

  const nativeLoad = (next) => {
    if (!bridge) throw new Error('ANDROID_LIVE_BRIDGE_UNAVAILABLE');
    const engine = String(next.playerHint?.engine || 'ijk').toLowerCase();
    const decoder = String(next.playerHint?.decoder || 'hardware').toLowerCase();
    if (!['ijk', 'exo'].includes(engine) || !['hardware', 'software'].includes(decoder)) {
      throw new Error('ANDROID_LIVE_UNSUPPORTED_PLAYER_MODE');
    }
    backend = 'native';
    input = next;
    nativeSessionId = makeSessionId();
    nativePrepared = false;
    setNativeDomMask(true);
    nativePreparePromise = new Promise((resolve, reject) => {
      resolveNativePrepared = resolve;
      rejectNativePrepared = reject;
      nativePrepareTimer = setTimeout(() => {
        nativePrepareTimer = null;
        rejectNativePrepared?.(new Error('ANDROID_LIVE_PREPARE_TIMEOUT'));
        resolveNativePrepared = null;
        rejectNativePrepared = null;
      }, PREPARE_TIMEOUT_MS);
    });
    // Prevent transient unhandled-rejection reports if a session is replaced
    // before the playback core reaches prepare(); callers still receive it.
    nativePreparePromise.catch(() => {});
    const headers = { ...(next.headers || {}) };
    if (next.referer && !Object.keys(headers).some(key => key.toLowerCase() === 'referer')) headers.Referer = next.referer;
    if (next.userAgent && !Object.keys(headers).some(key => key.toLowerCase() === 'user-agent')) headers['User-Agent'] = next.userAgent;
    try {
      startBoundsTracking();
      bridgeCall('loadMedia', {
        sessionId: nativeSessionId,
        engine,
        decoder,
        url: next.url || next.mediaUrl,
        headers,
        fitMode: activeWindow?.dataset?.fitMode || 'contain',
        autoplay: false,
        live: true,
      });
    } catch (error) {
      if (nativePrepareTimer) clearTimeout(nativePrepareTimer);
      nativePrepareTimer = null;
      // No caller awaits the prepare promise until load() returns, so discard
      // the failed pending waiter rather than creating an unhandled rejection.
      clearPrepareWait();
      try { bridgeCall('releaseMedia', { sessionId: nativeSessionId }); } catch {}
      nativeSessionId = '';
      nativePrepared = false;
      stopBoundsTracking();
      setNativeDomMask(false);
      throw error;
    }
    emit('loading', { engine, decoder, sessionId: nativeSessionId, renderSurface: 'android-live-native' });
    return input;
  };

  const adapter = {
    get capabilities() {
      if (backend === 'html5') return htmlPlayer.capabilities;
      return Object.freeze({ seek: true, volume: true, pause: true, autoplay: true, customHeaders: true, liveReconnect: true });
    },
    load(next) {
      if (released) throw new Error('PLAYER_ADAPTER_RELEASED');
      input = next;
      const engine = String(next.playerHint?.engine || 'html5').toLowerCase();
      const decoder = String(next.playerHint?.decoder || 'browser_auto').toLowerCase();
      const nativeRequested = NATIVE_SCHEMES.has(`${engine}_${decoder}`)
        || (next.playerHint?.nativeLivePlayer === true && ['ijk', 'exo'].includes(engine));
      if (nativeRequested) {
        if (backend === 'native') {
          deactivateNativeOutput(true);
        } else {
          try { htmlPlayer.stop(); } catch {}
        }
        backend = 'native';
        return nativeLoad(next);
      }
      if (backend === 'native') deactivateNativeOutput(true);
      backend = 'html5';
      setNativeDomMask(false);
      return htmlPlayer.load(next);
    },
    prepare() {
      if (!input) throw new Error('PLAYER_INPUT_REQUIRED');
      if (backend === 'native') {
        if (nativePrepared) return Promise.resolve(input);
        bridgeCall('prepareMedia', { sessionId: nativeSessionId });
        return nativePreparePromise || Promise.reject(new Error('ANDROID_LIVE_PREPARE_NOT_STARTED'));
      }
      return htmlPlayer.prepare();
    },
    async play() {
      if (!input) throw new Error('PLAYER_INPUT_REQUIRED');
      if (backend === 'native') {
        bridgeCall('playMedia', { sessionId: nativeSessionId });
        return true;
      }
      return htmlPlayer.play();
    },
    pause() {
      if (backend === 'native') return bridgeCall('pauseMedia', { sessionId: nativeSessionId });
      return htmlPlayer.pause();
    },
    seek(seconds) {
      if (backend === 'native') return bridgeCall('seekMedia', { sessionId: nativeSessionId, seconds });
      return htmlPlayer.seek(seconds);
    },
    setPlaybackRate(rate) {
      if (backend === 'native') return bridgeCall('setPlaybackRate', { sessionId: nativeSessionId, rate });
      return htmlPlayer.setPlaybackRate?.(rate) ?? 1;
    },
    setVolume(value) {
      if (backend === 'native') return bridgeCall('setVolume', { sessionId: nativeSessionId, volume: value });
      return htmlPlayer.setVolume(value);
    },
    getState() {
      if (backend === 'native') {
        try { return bridgeCall('getState', { sessionId: nativeSessionId }); }
        catch { return { state: nativePrepared ? 'prepared' : 'loading', input, sessionId: nativeSessionId }; }
      }
      return htmlPlayer.getState();
    },
    getAudioTracks() { return backend === 'html5' ? htmlPlayer.getAudioTracks?.() ?? [] : []; },
    getSubtitleTracks() { return backend === 'html5' ? htmlPlayer.getSubtitleTracks?.() ?? [] : []; },
    selectAudioTrack(id) { return backend === 'html5' ? htmlPlayer.selectAudioTrack?.(id) ?? false : false; },
    selectSubtitleTrack(id) { return backend === 'html5' ? htmlPlayer.selectSubtitleTrack?.(id) ?? false : false; },
    getQualities() { return backend === 'html5' ? htmlPlayer.getQualities?.() ?? [] : []; },
    selectQuality(id) { return backend === 'html5' ? htmlPlayer.selectQuality?.(id) ?? false : false; },
    stop() {
      if (backend === 'native') {
        try { bridgeCall('stopMedia', { sessionId: nativeSessionId }); } finally { deactivateNativeOutput(false); }
      } else htmlPlayer.stop();
      input = null;
      return true;
    },
    release() {
      if (released) return;
      const wasNative = backend === 'native';
      if (wasNative) deactivateNativeOutput(true);
      released = true;
      if (typeof window !== 'undefined') window.removeEventListener('tvbox-android-live-player-event', onNativeEvent);
      try { htmlPlayer.release(); } catch {}
      input = null;
      if (wasNative) emit('released');
    },
  };
  return createPlayerAdapterContract(adapter);
}
