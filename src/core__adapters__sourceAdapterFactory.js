import { createMovieAdapter } from './movies/movieAdapters.js';
import { createTVBoxExtensionAdapter } from './core__adapters__tvbox__tvboxExtensionAdapter.js';
import { createTVBoxJarAdapter } from './core__adapters__tvbox__tvboxJarAdapter.js';
import { createTVBoxExtJsonAdapter } from './core__adapters__tvbox__tvboxExtJsonAdapter.js';

export const SOURCE_ADAPTER_TYPE = Object.freeze({
  HTTP_VOD: 'http-vod',
  TVBOX_EXTENSION: 'tvbox-extension',
  LIVE_REFERENCE: 'live-reference',
  TVBOX_LIVE_EXTENSION: 'tvbox-live-extension',
});

function isSafeExtJsonSource(source) {
  if (source?.tvboxAdapterKind !== 'ext') return false;
  if (source?.tvboxExtFormat && !['json-vod', 'remote-json', 'remote-resource', 'inline-json'].includes(source.tvboxExtFormat)) return false;
  const ext = source?.tvboxExt;
  if (ext && typeof ext === 'object' && !Array.isArray(ext)) {
    const serialized = JSON.stringify(ext);
    return serialized.length <= 5 * 1024 * 1024
      && (Array.isArray(ext.movies) || Array.isArray(ext.vod) || Array.isArray(ext.list)
        || Array.isArray(ext.data) || Array.isArray(ext.result)
        || Array.isArray(ext.data?.list) || Array.isArray(ext.result?.list));
  }
  if (typeof ext !== 'string') return false;
  const value = ext.trim();
  if (/^https?:\/\//i.test(value)) return source?.tvboxExtFormat === 'remote-resource' || /\.json(?:[?#].*)?$/i.test(value);
  return (value.startsWith('{') || value.startsWith('[')) && value.length <= 5 * 1024 * 1024;
}

export function createSourceAdapter(source, options = {}) {
  if (!source || typeof source !== 'object') throw new Error('SOURCE_ADAPTER_SOURCE_REQUIRED');

  const adapterType = String(source.adapterType || '').trim();
  const sourceType = source.sourceType === 'live' ? 'live' : 'movie';

  if (sourceType === 'movie' && adapterType === SOURCE_ADAPTER_TYPE.TVBOX_EXTENSION) {
    if (source.tvboxRequiresJar === true || source.tvboxAdapterKind === 'jar' || source.sourceCapability === 'tvbox-jar' || source.sourceCapability === 'tvbox-http-vod-with-jar') {
      return createTVBoxJarAdapter(source, options.jarRuntime);
    }
    if (isSafeExtJsonSource(source)) {
      return createTVBoxExtJsonAdapter(source, options.transport ?? null);
    }
    if (source.tvboxAdapterKind === 'ext' && source.tvboxExtFormat) {
      throw new Error(`TVBOX_EXT_FORMAT_UNSUPPORTED:${source.tvboxExtFormat}`);
    }
    return createTVBoxExtensionAdapter(source, options.runtime);
  }

  if (sourceType === 'movie' && (adapterType === SOURCE_ADAPTER_TYPE.HTTP_VOD || !adapterType)) {
    return createMovieAdapter(source, options.transport ?? null);
  }

  if (sourceType === 'live' && adapterType === SOURCE_ADAPTER_TYPE.TVBOX_LIVE_EXTENSION) {
    throw new Error('TVBOX_LIVE_EXTENSION_RUNTIME_NOT_READY');
  }

  if (sourceType === 'live' && adapterType === SOURCE_ADAPTER_TYPE.LIVE_REFERENCE) {
    throw new Error('LIVE_REFERENCE_ADAPTER_USE_LIVE_SERVICE');
  }

  throw new Error(`SOURCE_ADAPTER_UNSUPPORTED:${adapterType || 'unknown'}`);
}

export function createSourceAdapters(sources = [], options = {}) {
  const adapters = [];
  const unsupported = [];

  for (const source of Array.isArray(sources) ? sources : []) {
    if (source?.enabled === false) continue;
    try {
      adapters.push(createSourceAdapter(source, options));
    } catch (error) {
      unsupported.push({
        sourceId: source?.sourceId ?? null,
        name: source?.name ?? '',
        adapterType: source?.adapterType ?? null,
        sourceCapability: source?.sourceCapability ?? null,
        error,
      });
    }
  }

  return { adapters, unsupported };
}
