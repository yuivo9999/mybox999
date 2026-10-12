/**
 * 8 路线统一调度中心 (8-Route Playback Strategy Dispatcher)
 *
 * 构成维度 (2 x 2 x 2 = 8 条全生命周期路线):
 * 1. Platform Runtime: android | web
 * 2. Media Source Kind: vod (影视点播) | live (电视直播)
 * 3. View Hierarchy: main (主界面分栏/嵌入窗) | immersive (次界面/沉浸全屏)
 */

export const RUNTIME_ENV = Object.freeze({
  ANDROID: 'android',
  WEB: 'web',
});

export const MEDIA_KIND = Object.freeze({
  VOD: 'vod',
  LIVE: 'live',
});

export const VIEW_TIER = Object.freeze({
  MAIN: 'main',
  IMMERSIVE: 'immersive',
});

/**
 * 探测当前宿主运行环境 (Android 原生容器 vs 手机/桌面 Web 浏览器)
 */
export function detectRuntimeEnv() {
  if (typeof window === 'undefined') return RUNTIME_ENV.WEB;
  
  // Only native-specific bridges identify the Android APK. TVBoxWebView is a
  // generic UI bridge installed by webViewRuntime on regular browsers too, so
  // it must not be used as an Android signal.
  if (window.TVBoxAndroidBridge || window.Android || window.tvboxBridge) {
    return RUNTIME_ENV.ANDROID;
  }

  if (window.Capacitor?.isNativePlatform?.()) {
    return RUNTIME_ENV.ANDROID;
  }

  const ua = navigator.userAgent || '';
  if (/TVBoxContainer|AndroidCapacitor|YuivoApp/i.test(ua)) {
    return RUNTIME_ENV.ANDROID;
  }

  return RUNTIME_ENV.WEB;
}

/**
 * 平台硬件与 API 综合能力检测矩阵
 */
export function getRuntimeCapabilities() {
  const isAndroid = detectRuntimeEnv() === RUNTIME_ENV.ANDROID;
  const isBrowser = !isAndroid;
  const hasMediaSource = typeof window !== 'undefined' && Boolean(window.MediaSource);
  const hasFullscreenApi = typeof document !== 'undefined' && Boolean(
    document.fullscreenEnabled || document.webkitFullscreenEnabled
  );

  return {
    runtime: isAndroid ? RUNTIME_ENV.ANDROID : RUNTIME_ENV.WEB,
    isAndroid,
    isWeb: isBrowser,
    // All playback uses the page-owned HTML media element. There is no
    // dedicated Android live player or native decoding bridge.
    supportsExoPlayer: false,
    supportsAndroidNativePlayer: false,
    supportsHlsJs: hasMediaSource,
    supportsHtml5Video: typeof window !== 'undefined',
    // 网络与权限支持
    supportsNativeHttp: isAndroid,
    // HTMLMediaElement restricts arbitrary media headers. HLS.js/mpegts.js can
    // apply safe headers where browser CORS policy permits it, but this is not
    // equivalent to the former native request-header capability.
    supportsCustomHeadersOnMedia: false,
    needsCorsProxyOnWeb: isBrowser,
    // 界面与传感器支持
    supportsOrientationLock: isAndroid || (typeof screen !== 'undefined' && Boolean(screen.orientation?.lock)),
    supportsFullscreen: hasFullscreenApi,
  };
}

const ANDROID_VOD_DOM_ENGINES = [
  { id: 'html5_auto', name: 'HTML5 自动适配（内嵌播放器）', engine: 'html5', decoder: 'browser_auto', mode: 'auto', isNative: false, badge: '默认' },
  { id: 'hls_worker', name: 'HLS.js / MSE 播放', engine: 'html5', decoder: 'browser_auto', mode: 'hls_worker', isNative: false },
  { id: 'html5_hardware', name: 'HTML5 原生媒体优先', engine: 'html5', decoder: 'browser_auto', mode: 'native_hardware', isNative: false },
];

const ANDROID_LIVE_HTML5_ENGINES = [
  { id: 'hls_lowlatency', name: 'HTML5 + HLS.js 低延迟直播', engine: 'html5', decoder: 'browser_auto', mode: 'hls_lowlatency', isNative: false, badge: '默认' },
  { id: 'html5_auto', name: 'HTML5 自动适配', engine: 'html5', decoder: 'browser_auto', mode: 'auto', isNative: false },
  { id: 'html5_hardware', name: 'HTML5 原生媒体优先', engine: 'html5', decoder: 'browser_auto', mode: 'native_hardware', isNative: false },
  { id: 'hls_worker', name: 'HLS.js / MSE 播放', engine: 'html5', decoder: 'browser_auto', mode: 'hls_worker', isNative: false },
];

/**
 * 8 条路线标准化配置字典
 */
const ROUTE_DEFINITIONS = {
  // ① 路线 1: Android · 影视点播 · 主界面
  'android_vod_main': {
    routeIndex: 1,
    routeKey: 'android_vod_main',
    label: '路线 ① [Android · 点播 · 主界]',
    runtime: RUNTIME_ENV.ANDROID,
    kind: MEDIA_KIND.VOD,
    viewTier: VIEW_TIER.MAIN,
    defaultEngine: 'html5',
    defaultDecoder: 'browser_auto',
    networkChannel: 'webview_dom_media',
    surfaceSync: false,
    uiLayout: 'embedded_dom',
    description: '由当前页面内嵌 HTML 视频元素显示，跟随网页布局、滚动和裁剪',
    engines: ANDROID_VOD_DOM_ENGINES,
  },

  // ② 路线 2: Android · 影视点播 · 次界面(沉浸全屏)
  'android_vod_immersive': {
    routeIndex: 2,
    routeKey: 'android_vod_immersive',
    label: '路线 ② [Android · 点播 · 沉浸]',
    runtime: RUNTIME_ENV.ANDROID,
    kind: MEDIA_KIND.VOD,
    viewTier: VIEW_TIER.IMMERSIVE,
    defaultEngine: 'html5',
    defaultDecoder: 'browser_auto',
    networkChannel: 'webview_dom_media',
    surfaceSync: false,
    uiLayout: 'embedded_dom_fullscreen',
    autoOrientation: 'landscape',
    description: '全屏布局继续复用页面内视频元素，手势、选集和控制菜单不再与独立视频表面分离',
    engines: ANDROID_VOD_DOM_ENGINES,
  },

  // ③ 路线 3: Android · Live直播 · 主界面
  'android_live_main': {
    routeIndex: 3,
    routeKey: 'android_live_main',
    label: '路线 ③ [Android · 直播 · 主界]',
    runtime: RUNTIME_ENV.ANDROID,
    kind: MEDIA_KIND.LIVE,
    viewTier: VIEW_TIER.MAIN,
    defaultEngine: 'hls_lowlatency',
    defaultDecoder: 'browser_auto',
    networkChannel: 'webview_dom_media',
    surfaceSync: false,
    uiLayout: 'embedded_dom',
    description: 'Android Live 直接使用页面内 HTML5 video，由 HLS.js/MSE 或浏览器原生媒体能力播放',
    engines: ANDROID_LIVE_HTML5_ENGINES,
  },

  // ④ 路线 4: Android · Live直播 · 次界面(沉浸全屏)
  'android_live_immersive': {
    routeIndex: 4,
    routeKey: 'android_live_immersive',
    label: '路线 ④ [Android · 直播 · 沉浸]',
    runtime: RUNTIME_ENV.ANDROID,
    kind: MEDIA_KIND.LIVE,
    viewTier: VIEW_TIER.IMMERSIVE,
    defaultEngine: 'hls_lowlatency',
    defaultDecoder: 'browser_auto',
    networkChannel: 'webview_dom_media',
    surfaceSync: false,
    uiLayout: 'embedded_dom_fullscreen',
    autoOrientation: 'landscape',
    description: 'Android 沉浸直播仍复用页面内 HTML5 video；全屏仅切换布局，不创建独立原生视频表面',
    engines: ANDROID_LIVE_HTML5_ENGINES,
  },

  // ⑤ 路线 5: Web 浏览器 · 影视点播 · 主界面
  'web_vod_main': {
    routeIndex: 5,
    routeKey: 'web_vod_main',
    label: '路线 ⑤ [Web · 点播 · 主界]',
    runtime: RUNTIME_ENV.WEB,
    kind: MEDIA_KIND.VOD,
    viewTier: VIEW_TIER.MAIN,
    defaultEngine: 'hls_worker',
    defaultDecoder: 'browser_auto',
    networkChannel: 'direct_browser',
    surfaceSync: false,
    uiLayout: 'responsive_web',
    description: 'HLS.js 与 HTML5 直接访问源站；源站需允许浏览器跨域访问',
    engines: [
      { id: 'hls_worker', name: 'HLS.js 增强内核 (Worker 分片加速)', engine: 'html5', mode: 'hls_worker', isNative: false },
      { id: 'html5_hardware', name: 'HTML5 原生硬解 (浏览器硬件加速)', engine: 'html5', mode: 'native_hardware', isNative: false },
    ],
  },

  // ⑥ 路线 6: Web 浏览器 · 影视点播 · 次界面(沉浸全屏)
  'web_vod_immersive': {
    routeIndex: 6,
    routeKey: 'web_vod_immersive',
    label: '路线 ⑥ [Web · 点播 · 沉浸]',
    runtime: RUNTIME_ENV.WEB,
    kind: MEDIA_KIND.VOD,
    viewTier: VIEW_TIER.IMMERSIVE,
    defaultEngine: 'hls_worker',
    defaultDecoder: 'browser_auto',
    networkChannel: 'direct_browser',
    surfaceSync: false,
    uiLayout: 'web_fullscreen_overlay',
    description: '浏览器 Fullscreen API 影院模式，支持画中画 (PiP) 与大缓冲区平滑快进；媒体请求直接访问源站；媒体请求直接访问源站',
    engines: [
      { id: 'hls_worker', name: 'HLS.js 大缓冲内核 (影院平滑模式)', engine: 'html5', mode: 'hls_worker', isNative: false },
      { id: 'html5_hardware', name: 'HTML5 原生硬解 (低功耗模式)', engine: 'html5', mode: 'native_hardware', isNative: false },
    ],
  },

  // ⑦ 路线 7: Web 浏览器 · Live直播 · 主界面
  'web_live_main': {
    routeIndex: 7,
    routeKey: 'web_live_main',
    label: '路线 ⑦ [Web · 直播 · 主界]',
    runtime: RUNTIME_ENV.WEB,
    kind: MEDIA_KIND.LIVE,
    viewTier: VIEW_TIER.MAIN,
    defaultEngine: 'hls_lowlatency',
    defaultDecoder: 'browser_auto',
    networkChannel: 'direct_browser',
    surfaceSync: false,
    uiLayout: 'responsive_web',
    description: 'HLS.js 低延迟追赶直播切片，分类快速换台；直播源直接访问，不经过外部代理',
    engines: [
      { id: 'hls_lowlatency', name: 'HLS.js 低延时内核 (直播追帧首选)', engine: 'html5', mode: 'hls_lowlatency', isNative: false, badge: 'Web首选' },
      { id: 'html5_hardware', name: 'HTML5 原生解码 (硬件加速)', engine: 'html5', mode: 'native_hardware', isNative: false, badge: '浏览器硬解' },
    ],
  },

  // ⑧ 路线 8: Web 浏览器 · Live直播 · 次界面(沉浸全屏)
  'web_live_immersive': {
    routeIndex: 8,
    routeKey: 'web_live_immersive',
    label: '路线 ⑧ [Web · 直播 · 沉浸]',
    runtime: RUNTIME_ENV.WEB,
    kind: MEDIA_KIND.LIVE,
    viewTier: VIEW_TIER.IMMERSIVE,
    defaultEngine: 'hls_lowlatency',
    defaultDecoder: 'browser_auto',
    networkChannel: 'direct_browser',
    surfaceSync: false,
    uiLayout: 'web_fullscreen_overlay',
    description: '沉浸全屏遮罩，顶部横屏/铺满/退出，底部快捷切换直播线路，断流自动重试',
    engines: [
      { id: 'hls_lowlatency', name: 'HLS.js 沉浸直播引擎 (自动重试/追帧)', engine: 'html5', mode: 'hls_lowlatency', isNative: false, badge: 'Web首选' },
      { id: 'html5_hardware', name: 'HTML5 原生解码 (硬件加速)', engine: 'html5', mode: 'native_hardware', isNative: false, badge: '浏览器硬解' },
    ],
  },
};

/**
 * 核心调度器：根据 (runtime, kind, viewTier) 获取精准路线策略
 */
export function getPlaybackRouteConfig({ runtime, kind = MEDIA_KIND.VOD, viewTier = VIEW_TIER.MAIN } = {}) {
  const currentRuntime = runtime || detectRuntimeEnv();
  const normalizedKind = kind === MEDIA_KIND.LIVE ? MEDIA_KIND.LIVE : MEDIA_KIND.VOD;
  const normalizedTier = viewTier === VIEW_TIER.IMMERSIVE ? VIEW_TIER.IMMERSIVE : VIEW_TIER.MAIN;

  const routeKey = `${currentRuntime}_${normalizedKind}_${normalizedTier}`;
  const config = ROUTE_DEFINITIONS[routeKey];
  if (config) return config;

  // 兜底返回路线 ⑤
  return ROUTE_DEFINITIONS['web_vod_main'];
}

/**
 * 解析用户选择的 engineId，转换成播放器所需的实际指令与参数
 */
export function resolveEngineSelection(selectedId, currentRoute) {
  const isAndroid = currentRoute.runtime === RUNTIME_ENV.ANDROID;

  if (isAndroid) {
    // Android Live and VOD both stay on the page-owned HTMLMediaElement.
    // Legacy player selections fall back to HTML5 auto mode.
    let mode = 'auto';
    if (selectedId === 'hls_worker') mode = 'hls_worker';
    else if (selectedId === 'hls_lowlatency') mode = 'hls_lowlatency';
    else if (selectedId === 'html5_hardware' || selectedId === 'native_media' || selectedId === 'native') mode = 'native_hardware';

    return {
      engine: 'html5',
      decoder: 'browser_auto',
      mode,
      isWeb: false,
      playerHint: {
        engine: 'html5',
        decoder: 'browser_auto',
        webMode: mode,
        live: currentRoute.kind === MEDIA_KIND.LIVE,
        nativeLivePlayer: false,
        routeId: currentRoute.routeKey,
      },
    };
  }

  // Web 浏览器处理：
  let webEngine = 'html5';
  let mode = 'hls_worker';
  if (selectedId === 'html5_hardware' || selectedId === 'html5') {
    mode = 'native_hardware';
  } else if (selectedId === 'hls_lowlatency' || currentRoute.kind === MEDIA_KIND.LIVE) {
    mode = 'hls_lowlatency';
  }

  return {
    engine: webEngine,
    decoder: 'browser_auto',
    mode,
    isWeb: true,
    playerHint: {
      engine: 'html5',
      webMode: mode,
      live: currentRoute.kind === MEDIA_KIND.LIVE,
      routeId: currentRoute.routeKey,
    },
  };
}
