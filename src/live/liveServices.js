import { mergeLiveChannels, normalizeLiveChannel } from './liveModels.js';
import { createLiveRegistry } from './liveAdapters.js';
import { parseTXTLiveMetadataStream, parseTXTLiveLineStreams } from './liveParsers.js';
import { cacheStorage, CacheNamespace, createCacheKey } from '../core__storage__cache.js';
import { errorService } from '../core__services__errorService.js';
import { requestManager } from '../core__services__network__requestManager.js';
import { requestAdapter } from '../core__services__network__requestAdapter.js';
import { getEpgProgramStatus } from '../core__models__live.js';
import { normalizePlaybackCandidate, PlaybackKind } from '../core__models__playback.js';

// Standard live source lifecycle and channel operations
export const liveRegistry = createLiveRegistry();

function normalizeRange(range = {}) {
  return { startAt: range.startAt ?? null, endAt: range.endAt ?? null };
}

function filterEPG(programs = [], range = {}) {
  return programs.filter((program) =>
    (!range.startAt || (program.endTime ?? program.endAt) >= range.startAt) &&
    (!range.endAt || (program.startTime ?? program.startAt) <= range.endAt)
  );
}

function sourceCacheKey(sourceId) {
  return createCacheKey({ namespace: CacheNamespace.LIVE_SOURCE, sourceId, contentId: 'live-channels', params: { type: 'channels' }, version: 2 });
}

function liveChannelCacheKey(channelRef) {
  const sourceId = channelRef?.sourceRefs?.map((ref) => ref.sourceId).sort().join(',') || 'aggregate';
  return createCacheKey({ namespace: CacheNamespace.LIVE_CHANNEL, sourceId, contentId: channelRef?.channelId ?? '', params: { sourceItems: channelRef?.sourceRefs ?? [] } });
}

function epgCacheKey(channelRef, range) {
  const normalized = normalizeRange(range);
  const sourceId = channelRef?.sourceRefs?.map((ref) => ref.sourceId).sort().join(',') || 'aggregate';
  return createCacheKey({ namespace: CacheNamespace.EPG, sourceId, contentId: channelRef?.channelId ?? '', params: normalized });
}

async function loadSourceChannels(adapter) {
  const key = sourceCacheKey(adapter.sourceId);
  const cached = cacheStorage.get(CacheNamespace.LIVE_SOURCE, key, { allowStale: true });
  if (cached.hit && !cached.stale) return { value: cached.value, cached: true };

  try {
    const value = await requestManager.run(`live:channels:${adapter.sourceId}`, (signal) => adapter.getChannels({ signal }));
    const detectedFormat = adapter.getSnapshotState?.().detectedFormat ?? null;
    if (detectedFormat === 'txt') {
      cacheStorage.remove(CacheNamespace.LIVE_SOURCE, key);
      return { value: Array.isArray(value) ? value : [], cached: false, runtimeType: 'tv1', detectedFormat };
    }
    if (Array.isArray(value) && value.length) {
      cacheStorage.set(CacheNamespace.LIVE_SOURCE, key, value);
      return { value, cached: false, runtimeType: 'generic', detectedFormat };
    }
    if (cached.hit) return { value: cached.value, cached: true, stale: true };
    throw errorService.normalize(new Error('LIVE_SOURCE_EMPTY'), { code: 'SourceEmptyError', context: { sourceId: adapter.sourceId, scope: 'live-source' } });
  } catch (error) {
    if (cached.hit) return { value: cached.value, cached: true, stale: true, error };
    throw error;
  }
}

function sortChannels(channels, { order = 'system', userOrder = [] } = {}) {
  const userIndex = new Map(userOrder.map((id, index) => [id, index]));
  return [...channels].sort((a, b) => {
    if (order === 'user') {
      const ai = userIndex.has(a.channelId) ? userIndex.get(a.channelId) : Number.MAX_SAFE_INTEGER;
      const bi = userIndex.has(b.channelId) ? userIndex.get(b.channelId) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
    }
    if (order === 'system') {
      const categoryCompare = String(a.category ?? '').localeCompare(String(b.category ?? ''));
      if (categoryCompare) return categoryCompare;
      const priorityCompare = (a.sourcePriority ?? 0) - (b.sourcePriority ?? 0);
      if (priorityCompare) return priorityCompare;
      const nameCompare = String(a.name ?? '').localeCompare(String(b.name ?? ''));
      if (nameCompare) return nameCompare;
    }
    const aOrder = order === 'source' ? a.sourceOrder : a.systemOrder;
    const bOrder = order === 'source' ? b.sourceOrder : b.systemOrder;
    return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
  });
}

export const liveService = {
  async sync(sourceIds = null) {
    const adapters = liveRegistry.list().filter((adapter) => !sourceIds || sourceIds.includes(adapter.sourceId));
    const settled = await Promise.all(adapters.map(async (adapter) => {
      try {
        const loaded = await loadSourceChannels(adapter);
        return {
          status: 'fulfilled',
          value: loaded.value,
          sourceId: adapter.sourceId,
          cached: loaded.cached,
          stale: loaded.stale ?? false,
          capabilities: adapter.capabilities,
          adapterStatus: adapter.getSnapshotState?.() ?? null,
          runtimeType: loaded.runtimeType ?? 'generic',
          detectedFormat: loaded.detectedFormat ?? adapter.getSnapshotState?.().detectedFormat ?? null,
        };
      } catch (reason) {
        return {
          status: 'rejected',
          reason: errorService.classifySource(reason, { scope: 'live-source', sourceId: adapter.sourceId }),
          sourceId: adapter.sourceId,
          capabilities: adapter.capabilities,
          adapterStatus: adapter.getSnapshotState?.() ?? null,
        };
      }
    }));
    const channels = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    return { channels: mergeLiveChannels(channels), results: settled };
  },

  getChannels: (items = [], options = {}) => sortChannels(mergeLiveChannels(items), options),
  getCurrentEPG: (channel, now = Date.now()) => (channel?.epg ?? []).map(program => ({ ...program, status: getEpgProgramStatus(program, now) })),
  getCategories: (items = []) => ['全部', ...new Set(items.map((channel) => channel.category).filter(Boolean))],
  listChannels: (items = [], { category = '全部', order = 'system', userOrder = [] } = {}) => {
    const channels = mergeLiveChannels(items);
    const filtered = category && category !== '全部' ? channels.filter((channel) => channel.category === category) : channels;
    return sortChannels(filtered, { order, userOrder });
  },
  getById: (items = [], channelId) => items.find((item) => item.channelId === channelId) ?? null,

  async refreshSource(sourceId) {
    return this.sync([sourceId]);
  },

  async refreshChannel(channelRef) {
    const streams = await this.getStreams(channelRef);
    const epg = await this.getEPG(channelRef);
    return { channel: { ...channelRef, streams, epg }, streams, epg };
  },

  async getStreams(channelRef, options = {}) {
    const cacheKey = liveChannelCacheKey(channelRef);
    if (!options.forceRefresh) {
      const cached = cacheStorage.get(CacheNamespace.LIVE_CHANNEL, cacheKey, { allowStale: false });
      if (cached.hit && !cached.stale) return cached.value?.streams ?? [];
    } else {
      cacheStorage.remove(CacheNamespace.LIVE_CHANNEL, cacheKey);
    }
    const adapters = liveRegistry.list().filter((adapter) => channelRef?.sourceRefs?.some((ref) => ref.sourceId === adapter.sourceId));
    const reqKey = options.forceRefresh ? `live:streams:${Date.now()}:` : 'live:streams:';
    const results = await Promise.allSettled(adapters.map((adapter) =>
      requestManager.run(`${reqKey}${adapter.sourceId}:${channelRef?.channelId ?? ''}`, (signal) => adapter.getStreams(channelRef, { signal })),
    ));
    const streams = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    if (streams.length) {
      const expiries = streams.map(stream => typeof stream.expiresAt === 'number' ? stream.expiresAt : Date.parse(stream.expiresAt ?? '')).filter(Number.isFinite);
      const minExpiry = expiries.length ? Math.min(...expiries) - Date.now() : 60000;
      const ttl = Math.max(1000, Math.min(60000, minExpiry));
      cacheStorage.set(CacheNamespace.LIVE_CHANNEL, cacheKey, { streams }, { ttl });
      return streams;
    }
    const cached = cacheStorage.get(CacheNamespace.LIVE_CHANNEL, cacheKey, { allowStale: true });
    if (cached.hit) return cached.value?.streams ?? [];
    return channelRef?.streams ?? [];
  },

  async getEPG(channelRef, range = {}) {
    const normalizedRange = normalizeRange(range);
    const key = epgCacheKey(channelRef, normalizedRange);
    const cached = cacheStorage.get(CacheNamespace.EPG, key, { allowStale: true });
    if (cached.hit && !cached.stale) return cached.value;

    const adapters = liveRegistry.list().filter((adapter) => channelRef?.sourceRefs?.some((ref) => ref.sourceId === adapter.sourceId));
    const results = await Promise.allSettled(adapters.map((adapter) =>
      requestManager.run(`live:epg:${adapter.sourceId}:${channelRef?.channelId ?? ''}:${normalizedRange.startAt ?? ''}:${normalizedRange.endAt ?? ''}`, (signal) => adapter.getEPG(channelRef, normalizedRange, { signal })),
    ));
    const epg = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    if (epg.length) {
      const normalized = epg.map(program => ({ ...program, status: getEpgProgramStatus(program) }));
      cacheStorage.set(CacheNamespace.EPG, key, normalized);
      return normalized;
    }
    if (cached.hit) return cached.value.map(program => ({ ...program, status: getEpgProgramStatus(program) }));
    return filterEPG(channelRef?.epg ?? [], normalizedRange).map(program => ({ ...program, status: getEpgProgramStatus(program) }));
  },

  getPlaybackCandidates(channelRef, streams = null) {
    const sourceStreams = (streams ?? channelRef?.streams ?? []).filter((stream) => { const expiresAt = typeof stream.expiresAt === 'number' ? stream.expiresAt : Date.parse(stream.expiresAt ?? ''); return !stream.expiresAt || !Number.isFinite(expiresAt) || expiresAt > Date.now(); });
    return sourceStreams
      .filter((stream) => stream?.url && stream.status !== 'failed')
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((stream) => normalizePlaybackCandidate({
        kind: PlaybackKind.LIVE,
        sourceId: stream.sourceId,
        streamId: stream.streamId,
        channelId: channelRef?.channelId,
        mediaUrl: stream.url,
        protocol: stream.protocol,
        headers: stream.headers,
        cookies: stream.cookies,
        referer: stream.referer,
        userAgent: stream.userAgent,
        priority: stream.priority,
        metadata: { label: stream.label, quality: stream.quality, resolution: stream.resolution, sourceChannelId: stream.sourceChannelId },
      }));
  },

  updateStreamStatus(channelRef, streamId, patch = {}) {
    if (!channelRef?.streams) return null;
    const stream = channelRef.streams.find((item) => item.streamId === streamId);
    if (!stream) return null;
    Object.assign(stream, {
      status: patch.status ?? stream.status,
      lastCheckedAt: patch.lastCheckedAt ?? Date.now(),
      failureCode: patch.failureCode ?? null,
      failureCount: patch.failureCount == null ? (patch.status === 'failed' ? stream.failureCount + 1 : stream.failureCount) : patch.failureCount,
      updatedAt: Date.now(),
    });
    channelRef.status = channelRef.streams.some((item) => item.status !== 'failed') ? 'available' : 'unavailable';
    return stream;
  },

  clearEPGCache() { cacheStorage.clear(CacheNamespace.EPG); },
  // 源生命周期变化时只清理 Live 运行时缓存，不能误伤影视 SOURCE 缓存。
  clearRuntimeCache() {
    cacheStorage.clear(CacheNamespace.LIVE_SOURCE);
    cacheStorage.clear(CacheNamespace.LIVE_CHANNEL);
    cacheStorage.clear(CacheNamespace.EPG);
  },
  clearCache() { cacheStorage.clear(CacheNamespace.LIVE_SOURCE); cacheStorage.clear(CacheNamespace.SOURCE); cacheStorage.clear(CacheNamespace.LIVE_CHANNEL); cacheStorage.clear(CacheNamespace.EPG); },
  async healthCheck() { return (await Promise.allSettled(liveRegistry.list().map((adapter) => adapter.healthCheck()))).flatMap((result) => result.status === 'fulfilled' ? [result.value] : []); },
};

// TV1 deferred TXT source lifecycle
function isTv1Source(source) {
  return source?.sourceType === 'live' && source?.liveMode === 'tv1';
}

const sessions = new Map();

async function fetchBody(source, options = {}) {
  const response = source.localContent != null
    ? { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/plain' }), text: async () => String(source.localContent) }
    : await requestAdapter.request(source.sourceRef || source.url, {
        headers: source.headers ?? {},
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        transport: options.transport,
      });
  if (!response.ok) throw new Error('HTTP_' + response.status);
  return response.text();
}

function createSession(source, body) {
  const lines = String(body).replace(/^\uFEFF/, '').split(/\r?\n/);
  const session = { sourceId: source.sourceId, lines, metadata: [], createdAt: Date.now() };
  sessions.set(source.sourceId, session);
  return session;
}

export const tv1LiveService = {
  isSupportedSource: isTv1Source,

  async loadMetadata(source, options = {}) {
    if (!isTv1Source(source)) throw new Error('TV1_SOURCE_REQUIRED');
    const existing = sessions.get(source.sourceId);
    if (existing && Array.isArray(existing.channels) && existing.channels.length > 0 && !options.force) {
      if (typeof options.onChannel === 'function') {
        for (const channel of existing.channels) {
          options.onChannel(channel);
        }
      }
      return existing.channels;
    }

    const body = await fetchBody(source, options);
    const session = createSession(source, body);
    const capabilities = { search: true, categories: true, multiStream: true, epg: false, currentProgram: false, upcomingProgram: false };
    const result = [];
    session.metadata = [];
    await parseTXTLiveMetadataStream(body, async item => {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      session.metadata.push(item);
      const channel = normalizeLiveChannel({
        sourceId: source.sourceId,
        item,
        index: result.length,
        capabilities,
      });
      result.push(channel);
      if (typeof options.onChannel === 'function') options.onChannel(channel);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    session.channels = result;
    return result;
  },

  async getStreams(source, channelRef, options = {}) {
    if (!isTv1Source(source)) throw new Error('TV1_SOURCE_REQUIRED');
    const session = sessions.get(source.sourceId);
    if (!session) await this.loadMetadata(source, options);
    const activeSession = sessions.get(source.sourceId);
    const lineIndices = channelRef?.deferredRef?.lineIndices ?? (channelRef?.deferredRef?.lineIndex != null ? [channelRef.deferredRef.lineIndex] : []);
    if (!lineIndices.length) return [];
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    let rawStreams = [];
    for (const idx of lineIndices) {
      if (activeSession.lines[idx]) {
        const lineStreams = parseTXTLiveLineStreams(activeSession.lines[idx]);
        rawStreams.push(...lineStreams);
      }
    }

    return rawStreams.map((stream, index) => ({
      ...stream,
      label: stream.label === '线路 1' || /^线路 \d+$/.test(stream.label) ? `线路 ${index + 1}` : stream.label,
      streamId: 'stream:' + source.sourceId + ':' + channelRef.sourceItemId + ':' + (index + 1),
      sourceId: source.sourceId,
      sourceChannelId: source.sourceId + ':' + channelRef.sourceItemId,
      sourceItemId: channelRef.sourceItemId,
      protocol: stream.protocol || (() => {
        const value = String(stream.url || '').trim().toLowerCase();
        if (/\.m3u8(?:[?#]|$)/i.test(value) || value.includes('/pltv/') || value.includes('/tvod/')) return 'hls';
        if (value.startsWith('rtmp://')) return 'rtmp';
        if (value.startsWith('rtsp://')) return 'rtsp';
        if (/\.flv(?:[?#]|$)/i.test(value)) return 'flv';
        if (/\.mpd(?:[?#]|$)/i.test(value)) return 'dash';
        return 'http';
      })(),
      priority: index,
      status: 'unknown',
      lastCheckedAt: null,
      failureCode: null,
      failureCount: 0,
      updatedAt: Date.now(),
    }));
  },

  async load(source, options = {}) {
    return this.loadMetadata(source, options);
  },

  async healthCheck(source, options = {}) {
    try {
      const channels = await this.loadMetadata(source, options);
      return { ok: channels.length > 0, sourceId: source.sourceId, status: channels.length ? 'healthy' : 'empty', checkedAt: Date.now(), error: null };
    } catch (error) {
      return { ok: false, sourceId: source.sourceId, status: 'error', checkedAt: Date.now(), error };
    }
  },

  clear(sourceId = null) {
    if (sourceId) sessions.delete(sourceId);
    else sessions.clear();
  },
};


// Shared live cache and TV1 stream resolution
// Global Live State Cache across Tab Navigations
export const globalLiveCache = {
  tv1Channels: [],
  selectedChannelId: '',
  selectedCategory: '全部',
  resolvedStreams: {},
  activeStreamIndex: 0,
  decoderEngine: null,
  isImmersive: false,
};

export async function resolveLiveChannelStreams(channel, { sources = [], signal } = {}) {
  if (!channel) return [];
  if (Array.isArray(channel.streams) && channel.streams.length) return channel.streams;
  if (!channel.deferredRef) return [];

  const tv1Source = channel.sourceRefs?.find(ref =>
    sources.some(source =>
      source.sourceId === ref.sourceId
      && source.sourceType === 'live'
      && source.liveMode === 'tv1'
      && source.enabled !== false
    )
  );
  const source = tv1Source
    ? sources.find(item => item.sourceId === tv1Source.sourceId)
    : null;

  if (source) {
    return requestManager.run(
      'tv1-streams:' + source.sourceId + ':' + channel.channelId,
      requestSignal => tv1LiveService.getStreams(source, channel, {
        signal: signal || requestSignal,
      }),
    );
  }

  return requestManager.run(
    'live-deferred-streams:' + channel.channelId,
    requestSignal => liveService.getStreams(channel, {
      signal: signal || requestSignal,
    }),
  );
}
