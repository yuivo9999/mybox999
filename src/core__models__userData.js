import { DEFAULT_FONT_ID } from './me/preferences.js';

export const PLAYBACK_SCHEMES = Object.freeze([
  Object.freeze({ id: 'ijk_hardware', label: 'IJKPlayer 硬解', engine: 'ijk', decoder: 'hardware', platform: 'android' }),
  Object.freeze({ id: 'exo_hardware', label: 'ExoPlayer 硬解', engine: 'exo', decoder: 'hardware', platform: 'android' }),
  Object.freeze({ id: 'exo_software', label: 'ExoPlayer 软解', engine: 'exo', decoder: 'software', platform: 'android' }),
  Object.freeze({ id: 'ijk_software', label: 'IJKPlayer 软解', engine: 'ijk', decoder: 'software', platform: 'android' }),
  Object.freeze({ id: 'hls_lowlatency', label: 'HLS.js 低延时内核', engine: 'html5', decoder: 'hardware', platform: 'web' }),
  Object.freeze({ id: 'html5_hardware', label: 'HTML5 原生硬解', engine: 'html5', decoder: 'hardware', platform: 'web' }),
  Object.freeze({ id: 'hls_worker', label: 'HLS.js Worker分片', engine: 'html5', decoder: 'hardware', platform: 'web' }),
]);

export function getPlaybackSchemeId(engine = 'ijk', decoder = 'hardware') {
  const normalizedEngine = String(engine || 'ijk').trim().toLowerCase();
  const normalizedDecoder = String(decoder || 'hardware').trim().toLowerCase();
  if (normalizedEngine === 'html5') {
    return normalizedDecoder === 'hls_lowlatency' ? 'hls_lowlatency' : 'html5_hardware';
  }
  return PLAYBACK_SCHEMES.find(
    scheme => scheme.engine === normalizedEngine && scheme.decoder === normalizedDecoder,
  )?.id || 'ijk_hardware';
}

export function getPlaybackScheme(value = 'ijk_hardware') {
  return PLAYBACK_SCHEMES.find(scheme => scheme.id === String(value || '').trim())
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
  moviePlayer: 'ijk',
  livePlayer: 'ijk',
  moviePlaybackScheme: 'ijk_hardware',
  livePlaybackScheme: 'ijk_hardware',
  fallbackEnabled: true,
  fallbackOrder: ['ijk', 'exo', 'native'],
  decoder: { exo: 'hardware', ijk: 'hardware', native: 'system' },
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
  const decoder = input.decoder && typeof input.decoder === 'object' ? input.decoder : {};
  const order = Array.isArray(input.fallbackOrder) ? input.fallbackOrder.filter(item => ['exo', 'ijk', 'native'].includes(item)) : [];
  const fallbackOrder = [...new Set([...order, 'ijk', 'exo', 'native'])].slice(0, 3);
  const legacyMoviePlayer = ['exo', 'ijk', 'html5'].includes(input.moviePlayer) ? input.moviePlayer : 'ijk';
  const legacyLivePlayer = ['exo', 'ijk', 'html5'].includes(input.livePlayer) ? input.livePlayer : 'ijk';
  const movieDecoder = decoder[legacyMoviePlayer] === 'software' ? 'software' : 'hardware';
  const liveDecoder = decoder[legacyLivePlayer] === 'software' ? 'software' : 'hardware';
  const movieScheme = PLAYBACK_SCHEMES.some(scheme => scheme.id === input.moviePlaybackScheme)
    ? getPlaybackScheme(input.moviePlaybackScheme)
    : getPlaybackSchemeId(legacyMoviePlayer, movieDecoder);
  const liveScheme = PLAYBACK_SCHEMES.some(scheme => scheme.id === input.livePlaybackScheme)
    ? getPlaybackScheme(input.livePlaybackScheme)
    : getPlaybackSchemeId(legacyLivePlayer, liveDecoder);
  return {
    ...defaultPlaybackSettings(),
    ...input,
    moviePlayer: movieScheme.engine,
    livePlayer: liveScheme.engine,
    moviePlaybackScheme: movieScheme.id,
    livePlaybackScheme: liveScheme.id,
    fallbackEnabled: input.fallbackEnabled !== false,
    fallbackOrder,
    decoder: {
      exo: decoder.exo === 'software' ? 'software' : 'hardware',
      ijk: decoder.ijk === 'software' ? 'software' : 'hardware',
      native: 'system',
    },
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
