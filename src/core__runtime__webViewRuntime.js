import { isNativeHttpAvailable, nativeHttpRequest } from './core__runtime__nativeHttpBridge.js';

const BRIDGE_VERSION = 1;
const ALLOWED_BRIDGE_METHODS = new Set([
  'setFullscreen',
  'requestOrientation',
  'getAppState',
  'notifyLifecycle',
]);

function getBridge() {
  if (typeof window === 'undefined') return null;
  const candidates = [window.TVBoxAndroidBridge, window.Android, window.tvboxBridge];
  return candidates.find((item) => item && typeof item === 'object') ?? null;
}

function safeCall(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function serialize(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
}

export const webViewRuntime = {
  version: BRIDGE_VERSION,
  get capabilities() {
    const bridge = getBridge();
    return {
      webView: typeof window !== 'undefined',
      bridge: Boolean(bridge),
      nativeHttp: isNativeHttpAvailable(),
      fullscreen: typeof document !== 'undefined' && Boolean(document.fullscreenEnabled),
      storage: typeof window !== 'undefined' && Boolean(safeCall(() => window.localStorage)),
      cookie: typeof document !== 'undefined' && typeof document.cookie === 'string',
    };
  },

  nativeHttpRequest(request, options = {}) {
    return nativeHttpRequest(request, options);
  },

  call(method, payload = {}) {
    if (!ALLOWED_BRIDGE_METHODS.has(method)) {
      return { ok: false, code: 'BRIDGE_METHOD_NOT_ALLOWED' };
    }
    const bridge = getBridge();
    if (!bridge || typeof bridge[method] !== 'function') {
      return { ok: false, code: 'BRIDGE_UNAVAILABLE' };
    }
    try {
      const value = bridge[method](serialize({ version: BRIDGE_VERSION, ...payload }));
      return { ok: true, value };
    } catch (error) {
      return { ok: false, code: 'BRIDGE_ERROR', message: error?.message || String(error) };
    }
  },

  async setFullscreen(enabled) {
    const bridgeResult = this.call('setFullscreen', { enabled: Boolean(enabled) });
    if (bridgeResult.ok) return bridgeResult;

    if (typeof document === 'undefined') return bridgeResult;
    try {
      if (enabled && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else if (!enabled && document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, code: 'FULLSCREEN_ERROR', message: error?.message || String(error) };
    }
  },

  async requestOrientation(orientation = 'portrait') {
    const bridgeResult = this.call('requestOrientation', { orientation });
    if (bridgeResult.ok) return bridgeResult;

    try {
      if (typeof screen !== 'undefined' && screen.orientation?.lock) {
        await screen.orientation.lock(orientation);
        return { ok: true };
      }
    } catch {
      // Native host remains the preferred implementation.
    }
    return { ok: false, code: 'ORIENTATION_UNAVAILABLE' };
  },

  getAppState() {
    const result = this.call('getAppState');
    if (result.ok) return result.value;
    if (typeof document === 'undefined') return 'unknown';
    return document.visibilityState === 'hidden' ? 'background' : 'foreground';
  },

  notifyLifecycle(state) {
    return this.call('notifyLifecycle', { state });
  },

  mount({ onBack, onAppStateChange } = {}) {
    if (typeof window === 'undefined') return () => {};

    let disposed = false;
    const handleVisibility = () => {
      if (disposed) return;
      const state = document.visibilityState === 'hidden' ? 'background' : 'foreground';
      this.notifyLifecycle(state);
      onAppStateChange?.(state);
    };

    const handlePageHide = () => this.notifyLifecycle('background');
    const handlePageShow = () => this.notifyLifecycle('foreground');

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);

    // Android host can call this stable entry point for the system Back key.
    const previousBack = window.TVBoxWebView?.onBackPressed;
    window.TVBoxWebView = {
      ...(window.TVBoxWebView || {}),
      version: BRIDGE_VERSION,
      onBackPressed: () => Boolean(safeCall(() => onBack?.())),
    };

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      if (window.TVBoxWebView?.onBackPressed && previousBack) {
        window.TVBoxWebView.onBackPressed = previousBack;
      } else if (window.TVBoxWebView) {
        delete window.TVBoxWebView.onBackPressed;
      }
    };
  },
};
