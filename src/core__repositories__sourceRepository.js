import { storage } from './core__storage__storage.js';

function createSourceId(source) {
  if (source?.sourceId) return String(source.sourceId);
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `local-${crypto.randomUUID()}`;
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeSource(source = {}) {
  const sourceId = createSourceId(source);
  return {
    ...source,
    sourceId,
    bundleId: String(source.bundleId || ('bundle_' + sourceId)).trim(),
    sourceKey: String(source.sourceKey || sourceId).trim(),
    name: String(source.name ?? sourceId).trim() || sourceId,
    sourceType: source.sourceType === 'live' ? 'live' : 'movie',
    sourceRef: String(source.sourceRef || source.url || '').trim(),
    url: String(source.url || source.sourceRef || '').trim(),
    enabled: source.enabled !== false,
    status: source.status ?? '未测试',
    capabilities: Array.isArray(source.capabilities) ? [...new Set(source.capabilities.filter(Boolean))] : [],
  };
}

export const sourceRepository = {
  getAll: (fallback = []) => {
    const raw = storage.read('sources', fallback);
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const unique = [];
    for (const item of raw) {
      const id = item?.sourceId ? String(item.sourceId) : null;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      unique.push(item);
    }
    return unique;
  },
  saveAll: (sources) => {
    const items = (Array.isArray(sources) ? sources : []).map(normalizeSource);
    const seen = new Set();
    const unique = [];
    for (const item of items) {
      if (seen.has(item.sourceId)) continue;
      seen.add(item.sourceId);
      unique.push(item);
    }
    return storage.write('sources', unique);
  },
};
