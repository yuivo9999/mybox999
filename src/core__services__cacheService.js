import { cacheStorage, CacheNamespace } from './core__storage__cache.js';

export const cacheService = {
  clearAll() {
    cacheStorage.clearAll();
    return cacheStorage.stats();
  },

  clearNamespace(namespace) {
    cacheStorage.clear(namespace);
    return cacheStorage.stats();
  },

  prune() {
    Object.values(CacheNamespace).forEach((namespace) => cacheStorage.prune(namespace));
    return cacheStorage.stats();
  },

  stats() {
    return cacheStorage.stats();
  },

  policy: Object.freeze({
    source: '6h',
    movie: '30m',
    detail: '6h',
    episode: '6h',
    liveChannel: '5m',
    epg: '2m',
    image: '24h',
    playbackTemp: 'session-memory-only',
  }),
};
