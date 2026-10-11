import { ErrorCode } from './core__models__errors.js';
import { errorService } from './core__services__errorService.js';
import {
  idbGet,
  idbSet,
  idbDelete,
  idbClearNamespace,
  idbClearAll,
  idbPruneLRU,
} from './core__storage__indexedDb.js';

const CACHE_PREFIX = 'tvbox:cache:v1:';
const CACHE_VERSION = 1;

export const CacheNamespace = Object.freeze({
  SOURCE: 'source',
  MOVIE: 'movie',
  DETAIL: 'detail',
  EPISODE: 'episode',
  LIVE_SOURCE: 'live-source',
  LIVE_CHANNEL: 'live-channel',
  EPG: 'epg',
  IMAGE: 'image',
  PLAYBACK_TEMP: 'playback-temp',
});

export const CacheTTL = Object.freeze({
  [CacheNamespace.SOURCE]: 24 * 60 * 60 * 1000,
  [CacheNamespace.MOVIE]: 2 * 60 * 60 * 1000,
  [CacheNamespace.DETAIL]: 7 * 24 * 60 * 60 * 1000, // 7 days TTL
  [CacheNamespace.EPISODE]: 24 * 60 * 60 * 1000,
  [CacheNamespace.LIVE_SOURCE]: 60 * 60 * 1000,
  [CacheNamespace.LIVE_CHANNEL]: 60 * 1000, // 60s TTL for live stream URLs
  [CacheNamespace.EPG]: 3 * 24 * 60 * 60 * 1000, // 3 days EPG retention
  [CacheNamespace.IMAGE]: 3 * 24 * 60 * 60 * 1000,
  [CacheNamespace.PLAYBACK_TEMP]: 10 * 60 * 1000,
});

export const CacheMaxEntries = Object.freeze({
  [CacheNamespace.DETAIL]: 500, // Up to 500 detail items
  [CacheNamespace.EPG]: 1000, // 3-day EPG limit
  [CacheNamespace.SOURCE]: 200,
  [CacheNamespace.MOVIE]: 200,
  [CacheNamespace.EPISODE]: 200,
  [CacheNamespace.LIVE_SOURCE]: 200,
  [CacheNamespace.LIVE_CHANNEL]: 500,
  [CacheNamespace.IMAGE]: 500,
  [CacheNamespace.PLAYBACK_TEMP]: 50,
});

// L1 Memory Cache for lightning-fast sync access
const l1Cache = new Map();

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

export function createCacheKey({ namespace, sourceId = '', contentId = '', params = {}, version = CACHE_VERSION } = {}) {
  if (!namespace) throw new Error('CACHE_NAMESPACE_REQUIRED');
  return `${namespace}:v${version}:s=${String(sourceId)}:c=${String(contentId)}:p=${encodeURIComponent(stable(params))}`;
}

function storageKey(key) {
  return `${CACHE_PREFIX}${key}`;
}

function pruneL1(namespace) {
  const maxEntries = CacheMaxEntries[namespace] || 100;
  const entries = [];
  const now = Date.now();

  for (const [k, v] of l1Cache.entries()) {
    if (v.namespace === namespace) {
      if (v.expiresAt > 0 && v.expiresAt <= now) {
        l1Cache.delete(k);
      } else {
        entries.push({ key: k, lastAccessedAt: v.lastAccessedAt || v.createdAt || 0 });
      }
    }
  }

  if (entries.length > maxEntries) {
    entries.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    const toDelete = entries.slice(0, entries.length - maxEntries);
    toDelete.forEach((e) => l1Cache.delete(e.key));
  }
}

function set(namespace, key, value, { ttl = CacheTTL[namespace] } = {}) {
  const now = Date.now();
  const entry = {
    version: CACHE_VERSION,
    namespace,
    createdAt: now,
    lastAccessedAt: now,
    expiresAt: ttl == null ? 0 : now + Math.max(0, ttl),
    value,
  };

  const fullKey = storageKey(key);
  l1Cache.set(fullKey, entry);
  pruneL1(namespace);

  // Background IndexedDB persistence & LRU pruning (no 5MB storage limit)
  void (async () => {
    try {
      await idbSet(fullKey, entry);
      const maxEntries = CacheMaxEntries[namespace] || 100;
      await idbPruneLRU(namespace, maxEntries);
    } catch {}
  })();

  return value;
}

function get(namespace, key, { allowStale = false } = {}) {
  const fullKey = storageKey(key);
  const now = Date.now();

  let entry = l1Cache.get(fullKey);

  if (!entry) {
    // Attempt to read from IndexedDB asynchronously for next time
    void (async () => {
      try {
        const idbEntry = await idbGet(fullKey);
        if (idbEntry && (!idbEntry.expiresAt || idbEntry.expiresAt > Date.now() || allowStale)) {
          l1Cache.set(fullKey, idbEntry);
        }
      } catch {}
    })();
    return { value: null, hit: false, stale: false };
  }

  const stale = entry.expiresAt > 0 && entry.expiresAt <= now;
  if (stale && !allowStale) {
    remove(namespace, key);
    return { value: null, hit: false, stale: true };
  }

  entry.lastAccessedAt = now;
  return { value: entry.value, hit: true, stale };
}

async function getAsync(namespace, key, { allowStale = false } = {}) {
  const fullKey = storageKey(key);
  const now = Date.now();

  let entry = l1Cache.get(fullKey);
  if (!entry) {
    try {
      entry = await idbGet(fullKey);
      if (entry) l1Cache.set(fullKey, entry);
    } catch {}
  }

  if (!entry) return { value: null, hit: false, stale: false };

  const stale = entry.expiresAt > 0 && entry.expiresAt <= now;
  if (stale && !allowStale) {
    remove(namespace, key);
    return { value: null, hit: false, stale: true };
  }

  entry.lastAccessedAt = now;
  return { value: entry.value, hit: true, stale };
}

function remove(namespace, key) {
  const fullKey = storageKey(key);
  l1Cache.delete(fullKey);
  void idbDelete(fullKey);
  return true;
}

function clear(namespace) {
  for (const [k, v] of l1Cache.entries()) {
    if (v.namespace === namespace) l1Cache.delete(k);
  }
  void idbClearNamespace(namespace);
}

function clearAll() {
  l1Cache.clear();
  void idbClearAll();
}

function prune(namespace) {
  pruneL1(namespace);
  const maxEntries = CacheMaxEntries[namespace] || 100;
  void idbPruneLRU(namespace, maxEntries);
}

function stats() {
  return Object.values(CacheNamespace).reduce((result, namespace) => {
    let count = 0;
    for (const v of l1Cache.values()) {
      if (v.namespace === namespace) count++;
    }
    result[namespace] = { entries: count };
    return result;
  }, {});
}

export const cacheStorage = Object.freeze({
  prefix: CACHE_PREFIX,
  version: CACHE_VERSION,
  createKey: createCacheKey,
  get,
  getAsync,
  set,
  remove,
  clear,
  clearAll,
  prune,
  stats,
});
