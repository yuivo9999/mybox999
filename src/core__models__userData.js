import { DEFAULT_FONT_ID } from './me/preferences.js';

export const PLAYBACK_SCHEMES = Object.freeze([
  Object.freeze({ id: 'html5_auto', label: 'HTML5 自动适配', engine: 'html5', decoder: 'browser_auto', mode: 'auto', platform: 'both' }),
  Object.freeze({ id: 'hls_lowlatency', label: 'HTML5 + HLS.js 低延迟直播', engine: 'html5', decoder: 'browser_auto', mode: 'hls_lowlatency', platform: 'both' }),
  Object.freeze({ id: 'html5_hardware', label: 'HTML5 原生媒体优先', engine: 'html5', decoder: 'browser_auto', mode: 'native_hardware', platform: 'both' }),
  Object.freeze({ id: 'hls_worker', label: 'HLS.js / MSE 播放', engine: 'html5', decoder: 'browser_auto', mode: 'hls_worker', platform: 'both' }),
]);

export const PLAYBACK_FALLBACK_ORDER = Object.freeze(['hls', 'native', 'mpegts']);

export function getPlaybackSchemeId(engine = 'html5', decoder = 'browser_auto') {
  const normalizedEngine = String(engine || 'html5').trim().toLowerCase();
  const normalizedDecoder = String(decoder || 'browser_auto').trim().toLowerCase();
  if (normalizedEngine === 'html5') {
    if (normalizedDecoder === 'hls_lowlatency') return 'hls_lowlatency';
    if (normalizedDecoder === 'hls_worker') return 'hls_worker';
    if (normalizedDecoder === 'native_hardware' || normalizedDecoder === 'hardware') return 'html5_hardware';
    return 'html5_auto';
  }
  // Retired native engine values are intentionally not valid playback engines.
  return 'html5_auto';
}

export function getPlaybackScheme(value = 'html5_auto') {
  const requested = String(value || '').trim().toLowerCase();
  const normalizedLegacy = /^exo_(hardware|software)$/.test(requested)
    ? 'html5_auto'
    : requested;
  return PLAYBACK_SCHEMES.find(scheme => scheme.id === normalizedLegacy)
    || PLAYBACK_SCHEMES[0];
}

export function createFavoriteId(targetType, targetId) {
  return `favorite:${targetType}:${targetId}`;
}

export function createHistoryId(targetType, targetId, episodeId = '') {
  return `history:${targetType}:${targetId}:${episodeId || 'live'}`;
}

export function createProgressId(contentId, episodeId = '') {
  return `progress:${contentId}:${episodeId || 'content'}`;
}

export function createSearchId(keyword) {
  return `search:${encodeURIComponent(keyword.trim().toLowerCase())}`;
}

export const defaultPlaybackSettings = () => ({
  moviePlayer: 'html5',
  livePlayer: 'html5',
  moviePlaybackScheme: 'html5_auto',
  livePlaybackScheme: 'hls_lowlatency',
  fallbackEnabled: true,
  fallbackOrder: [...PLAYBACK_FALLBACK_ORDER],
  decoder: { html5: 'browser_auto' },
});

export const defaultSettings = () => ({
  initialized: false,
  autoplayResume: true,
  defaultMovieSource: null,
  defaultLiveSource: null,
  theme: 'sangtian',
  fontSize: 'medium',
  fontFamily: DEFAULT_FONT_ID,
  cardStyle: 'poster',
  density: 'comfortable',
  playback: defaultPlaybackSettings(),
});

export const normalizePlaybackSettings = (value = {}) => {
  const input = value && typeof value === 'object' ? value : {};
  const requestedFallbackOrder = Array.isArray(input.fallbackOrder) ? input.fallbackOrder : [];
  const fallbackOrder = [...new Set([
    ...requestedFallbackOrder.filter(item => PLAYBACK_FALLBACK_ORDER.includes(item)),
    ...PLAYBACK_FALLBACK_ORDER,
  ])].slice(0, PLAYBACK_FALLBACK_ORDER.length);

  const normalizeScheme = (schemeValue, legacyPlayer, legacyDecoder, scope) => {
    const requested = String(schemeValue || '').trim().toLowerCase();
    const valid = PLAYBACK_SCHEMES.find(scheme => scheme.id === requested);
    if (valid) return valid;
    if (/^exo_(hardware|software)$/.test(requested)) {
      return getPlaybackScheme(scope === 'live' ? 'hls_lowlatency' : 'html5_auto');
    }
    const legacy = String(legacyPlayer || '').trim().toLowerCase();
    if (legacy && legacy !== 'html5') {
      return getPlaybackScheme(scope === 'live' ? 'hls_lowlatency' : 'html5_auto');
    }
    if (!requested && !legacy) {
      return getPlaybackScheme(scope === 'live' ? 'hls_lowlatency' : 'html5_auto');
    }
    const normalizedId = getPlaybackSchemeId(legacy || 'html5', legacyDecoder || 'browser_auto');
    return getPlaybackScheme(normalizedId);
  };

  const movieScheme = normalizeScheme(
    input.moviePlaybackScheme,
    input.moviePlayer,
    input.decoder?.[input.moviePlayer],
    'movie',
  );
  const liveScheme = normalizeScheme(
    input.livePlaybackScheme,
    input.livePlayer,
    input.decoder?.[input.livePlayer],
    'live',
  );
  return {
    ...defaultPlaybackSettings(),
    ...input,
    moviePlayer: 'html5',
    livePlayer: 'html5',
    moviePlaybackScheme: movieScheme.id,
    livePlaybackScheme: liveScheme.id,
    fallbackEnabled: input.fallbackEnabled !== false,
    fallbackOrder,
    decoder: { html5: 'browser_auto' },
  };
};

export const normalizeSettings = (value = {}) => {
  const input = value && typeof value === 'object' ? value : {};
  return { ...defaultSettings(), ...input, fontFamily: typeof input.fontFamily === 'string' && input.fontFamily ? input.fontFamily : DEFAULT_FONT_ID, playback: normalizePlaybackSettings(input.playback) };
};

export const emptyUserData = () => ({
  favorites: [],
  history: [],
  progress: [],
  searches: [],
  settings: defaultSettings(),
  selectedSources: { movie: null, live: null },
});
