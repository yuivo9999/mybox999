import { liveRegistry } from './live/liveServices.js';
import { syncMovieSources } from './movies/movieServices.js';
import { createLiveAdapter } from './live/liveAdapters.js';

function resolveLiveSourceRef(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^proxy:\/\//i.test(raw)) {
    const match = raw.match(/(?:[?&]|^)ext=(.+)$/i);
    if (!match) return '';
    try {
      const decoded = decodeURIComponent(match[1]);
      return /^https?:\/\//i.test(decoded) ? decoded : '';
    } catch {
      return '';
    }
  }
  return raw;
}

function normalizeSource(source) {
  if (!source?.sourceId) throw new Error('SOURCE_ID_REQUIRED');
  const sourceRef = resolveLiveSourceRef(source.sourceRef || source.url);
  if (!sourceRef) throw new Error('LIVE_SOURCE_URL_INVALID');
  return { ...source, sourceRef };
}

export const sourceRegistryService = {
  clear() {
    liveRegistry.clear();
  },

  registerLiveSource(source, transport = null) {
    const normalized = normalizeSource(source);
    const adapter = createLiveAdapter(normalized, transport);
    liveRegistry.register(adapter);
    return adapter;
  },

  async testLiveSource(source, options = {}) {
    const normalized = normalizeSource(source);
    const adapter = createLiveAdapter(normalized, options.transport);
    const result = await adapter.healthCheck(options);
    return { ...result, detectedFormat: adapter.getSnapshotState?.().detectedFormat ?? null };
  },

  async syncMovieSources(sources, selectedSourceId = null, options = {}) {
    return syncMovieSources(sources, selectedSourceId, options);
  },

  async registerAll(sources) {
    this.clear();
    for (const source of sources.filter(item => item.sourceType === 'live' && item.liveMode !== 'tv1' && item.enabled !== false && (item.sourceRef || item.url))) {
      this.registerLiveSource(source);
    }
    return { movie: true, live: true };
  },
};
