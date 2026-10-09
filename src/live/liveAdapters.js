import { parseJSONLive, parseM3U, parseXMLLive, parseXMLEPG, parseTXTLive, parseTXTLiveMetadata, parseTXTLiveLineStreams, isTXTGenreFormat } from './liveParsers.js';
import { normalizeLiveChannel, defaultLiveCapabilities, normalizeLiveCapabilities } from './liveModels.js';
import { requestAdapter } from '../core__services__network__requestAdapter.js';
import { createTVBoxExtensionAdapter } from '../core__adapters__tvbox__tvboxExtensionAdapter.js';
import { inferLiveProtocolFromUrl } from '../core__playback__streamSniffer.js';

// Adapter selection, source parsing and live channel normalization
export function createLiveAdapter(config, transport = null) {
  const sourceId = config.sourceId;
  // TVBox Live Provider（CSP/Drpy/JAR/ext）不是直接 URL。
  // 必须经过独立扩展运行时解析，严禁送入普通 HTTP Live Adapter。
  if (config.adapterType === 'tvbox-live-extension' || config.sourceCapability === 'tvbox-live-provider') {
    const extensionAdapter = createTVBoxExtensionAdapter({
      ...config,
      sourceType: 'live',
      adapterType: 'tvbox-live-extension',
      sourceCapability: 'tvbox-live-provider',
    }, config.tvboxRuntime ?? null);

    return {
      sourceId,
      capabilities: {},
      getChannels: async (options = {}) => extensionAdapter.load({}, options),
      getCategories: async () => [],
      getStreams: async (channelRef, options = {}) => {
        const streams = await extensionAdapter.execute('streams', { channelRef }, options);
        return Array.isArray(streams) ? streams : [];
      },
      getEPG: (channelRef, range = {}, options = {}) => extensionAdapter.execute('epg', { channelRef, range }, options),
      getSnapshotState: () => ({
        lastAttemptAt: null,
        lastSuccessfulAt: null,
        stale: false,
        lastError: extensionAdapter.isRuntimeAvailable() ? null : 'TVBOX_EXTENSION_RUNTIME_UNAVAILABLE',
        detectedFormat: null,
      }),
      healthCheck: extensionAdapter.healthCheck,
    };
  }
  let snapshot = [];
  let lastSuccessfulSnapshot = [];
  let lastError = null;
  let lastAttemptAt = null;
  let lastSuccessfulAt = null;
  let detectedFormat = config.format || null;
  let capabilities = normalizeLiveCapabilities({
    ...defaultLiveCapabilities,
    ...(config.capabilities ?? {}),
    search: Boolean(config.capabilities?.search),
  });

  const load = async (options = {}) => {
    lastAttemptAt = Date.now();
    try {
      const response = config.localContent != null
        ? { ok: true, status: 200, headers: new Headers({ 'content-type': config.localFormat === 'json' ? 'application/json' : 'text/plain' }), text: async () => String(config.localContent) }
        : await requestAdapter.request(config.sourceRef, {
        headers: config.headers ?? {},
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        transport,
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const body = await response.text();
      const format = detectFormat(config.format, response.headers?.get?.('content-type') || '', body);
      detectedFormat = format;
      if (format === 'xml' && config.capabilities?.epg === undefined) capabilities = normalizeLiveCapabilities({ ...capabilities, epg: true, currentProgram: true, upcomingProgram: true });
      const raw = format === 'm3u'
        ? parseM3U(body)
        : format === 'xml'
        ? parseXMLLive(body)
        : format === 'txt'
        ? parseTXTLiveMetadata(body)
        : parseJSONLive(body);
      const epgPrograms = format === 'xml' ? parseXMLEPG(body) : [];
      const withEPG = raw.map((item) => ({
        ...item,
        epg: [...(item.epg ?? []), ...epgPrograms.filter((program) => program.channelRef === item.sourceItemId || program.channelRef === item.channelKey)],
      }));
      const normalized = withEPG.map((item, index) => normalizeLiveChannel({ sourceId, item, index, capabilities }));
      snapshot = normalized;
      lastSuccessfulSnapshot = normalized;
      lastSuccessfulAt = Date.now();
      lastError = null;
      return normalized;
    } catch (error) {
      lastError = { code: error?.message || 'LIVE_ADAPTER_ERROR', sourceId, at: Date.now() };
      throw error;
    }
  };

  const current = () => snapshot.length ? snapshot : lastSuccessfulSnapshot;

  return {
    sourceId,
    capabilities,
    getChannels: load,
    getCategories: async () => [...new Set(current().map((channel) => channel.category))],
    getStreams: async (channelRef, options = {}) => {
      const channels = current();
      const sourceRef = channelRef?.sourceRefs?.find((ref) => ref.sourceId === sourceId);
      const channel = channels.find((item) => item.channelId === channelRef?.channelId || item.sourceRefs?.some((ref) => ref.sourceChannelId === sourceRef?.sourceChannelId));
      if (!channel) return [];
      const lineIndices = channel.deferredRef?.lineIndices ?? (channel.deferredRef?.lineIndex != null ? [channel.deferredRef.lineIndex] : []);
      if (detectedFormat === 'txt' && lineIndices.length > 0) {
        const body = config.localContent != null
          ? String(config.localContent)
          : await (async () => {
              const response = await requestAdapter.request(config.sourceRef, {
                headers: config.headers ?? {},
                signal: options.signal,
                timeoutMs: options.timeoutMs,
                transport,
              });
              if (!response.ok) throw new Error(`HTTP_${response.status}`);
              return response.text();
            })();
        const lines = String(body).replace(/^\uFEFF/, '').split(/\r?\n/);
        let rawStreams = [];
        for (const idx of lineIndices) {
          if (lines[idx]) {
            const lineStreams = parseTXTLiveLineStreams(lines[idx]);
            rawStreams.push(...lineStreams);
          }
        }
        return rawStreams.map((stream, index) => ({
          ...stream,
          label: stream.label === '线路 1' || /^线路 \d+$/.test(stream.label) ? `线路 ${index + 1}` : stream.label,
          streamId: 'stream:' + sourceId + ':' + channel.sourceItemId + ':' + (index + 1),
          sourceId,
          sourceItemId: channel.sourceItemId,
          sourceChannelId: sourceId + ':' + channel.sourceItemId,
          protocol: inferLiveProtocolFromUrl(stream.url),
          priority: index,
          status: 'unknown',
          updatedAt: Date.now(),
        }));
      }
      return channel.streams ?? [];
    },
    getEPG: async (channelRef, range = {}) => {
      const channels = current();
      const sourceRef = channelRef?.sourceRefs?.find((ref) => ref.sourceId === sourceId);
      const channel = channels.find((item) => item.channelId === channelRef?.channelId || item.sourceRefs?.some((ref) => ref.sourceChannelId === sourceRef?.sourceChannelId));
      return (channel?.epg ?? []).filter((program) => (!range.startAt || program.endAt >= range.startAt) && (!range.endAt || program.startAt <= range.endAt));
    },
    getSnapshotState: () => ({
      lastAttemptAt,
      lastSuccessfulAt,
      stale: Boolean(lastSuccessfulSnapshot.length && lastError),
      lastError,
      detectedFormat,
    }),
    healthCheck: async (options = {}) => {
      try {
        await load(options);
        return { ok: true, sourceId, status: 'healthy', checkedAt: Date.now(), error: null };
      } catch (error) {
        return { ok: false, sourceId, status: 'error', checkedAt: Date.now(), error };
      }
    },
  };
}

function detectFormat(explicit, contentType = '', body = '') {
  if (explicit) return explicit;
  const trimmed = String(body || '').trim();
  if (/mpegurl|m3u/i.test(contentType) || /^#EXTM3U/i.test(trimmed)) return 'm3u';
  if (/xml/i.test(contentType) || /^<\?xml|^<tv[\s>]/i.test(trimmed)) return 'xml';
  if (/#genre#/i.test(trimmed) || isTXTGenreFormat(trimmed)) return 'txt';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  return isTXTGenreFormat(trimmed) ? 'txt' : 'json';
}

// Source adapter registry
export function createLiveRegistry() {
  const adapters = new Map();
  return {
    register(adapter) { adapters.set(adapter.sourceId, adapter); return adapter; },
    unregister(sourceId) { adapters.delete(sourceId); },
    get(sourceId) { return adapters.get(sourceId) ?? null; },
    list() { return [...adapters.values()]; },
    clear() { adapters.clear(); },
  };
}
