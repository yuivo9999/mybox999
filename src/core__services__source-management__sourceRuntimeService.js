import { sourceRepository } from './core__repositories__sourceRepository.js';
import { testMovieSource } from './movies/movieServices.js';
import { liveService } from './live/liveServices.js';
import { sourceRegistryService } from './core__services__source-management__sourceRegistryService.js';
import { userDataService } from './me/userDataService.js';
import { tv1LiveService } from './live/liveServices.js';
import { createSourceAdapter } from './core__adapters__sourceAdapterFactory.js';

export async function testSource(source, options = {}) {
  if (!source?.sourceId) throw new Error('SOURCE_ID_REQUIRED');

  const capability = String(source.sourceCapability || '').trim();
  const adapterType = String(source.adapterType || '').trim();
  const tvboxKind = String(source.tvboxAdapterKind || '').trim().toLowerCase();
  const safeExtFormats = new Set(['json-vod', 'remote-json', 'remote-resource', 'inline-json']);
  const tvboxRuntimeSupported = (
    capability === 'tvbox-jar'
    || capability === 'tvbox-http-vod-with-jar'
    || (capability === 'tvbox-ext' && tvboxKind === 'ext' && safeExtFormats.has(String(source.tvboxExtFormat || '').trim()))
  );

  // 已经有实际执行器的 JAR / 安全 JSON EXT 源允许进入测试路径；
  // Drpy/CSP/未知扩展仍保持“待适配”，避免把不存在的运行时误报成网络故障。
  if ((capability.startsWith('tvbox-') || adapterType.startsWith('tvbox-')) && !tvboxRuntimeSupported) {
    return {
      ok: false,
      sourceId: source.sourceId,
      status: 'unsupported',
      reason: source.tvboxUnsupportedReason || 'TVBox 扩展源当前未适配',
      checkedAt: Date.now(),
    };
  }

  if (tvboxRuntimeSupported) {
    try {
      const adapter = createSourceAdapter(source);
      if (typeof adapter.healthCheck === 'function') return adapter.healthCheck(options);
      if (typeof adapter.isRuntimeAvailable === 'function' && adapter.isRuntimeAvailable()) {
        return { ok: true, sourceId: source.sourceId, status: 'healthy', checkedAt: Date.now(), error: null, runtimeOnly: true };
      }
      return { ok: false, sourceId: source.sourceId, status: 'unsupported', reason: 'TVBox 执行运行时不可用', checkedAt: Date.now() };
    } catch (error) {
      return { ok: false, sourceId: source.sourceId, status: 'error', error, checkedAt: Date.now() };
    }
  }

  if (source.sourceType === 'movie') {
    return testMovieSource(source, options);
  }

  if (source.sourceType === 'live') {
    if (source.liveMode === 'tv1') return tv1LiveService.healthCheck(source, options);
    const result = await sourceRegistryService.testLiveSource(source, options);
    if (result.ok && result.detectedFormat === 'txt') {
      const currentSources = sourceRepository.getAll();
      sourceRepository.saveAll(currentSources.map(item => (
        item.sourceId === source.sourceId
          ? { ...item, liveMode: 'tv1' }
          : item
      )));
      return { ...result, promotedTo: 'tv1' };
    }
    return result;
  }

  return { ok: false, sourceId: source.sourceId, status: 'unsupported', checkedAt: Date.now() };
}

export async function syncAllSources({ movieSourceId = null, includeMovie = true, includeLive = true, liveSourceIds = null, movieCategoryId = null, movieCategoryName = '', movieKeyword = '', moviePage = 1, moviePageSize = 24 } = {}) {
  let sources = sourceRepository.getAll().filter(source => source.enabled !== false);
  const movieResult = includeMovie
    ? await sourceRegistryService.syncMovieSources(sources, movieSourceId, { categoryId: movieCategoryId, categoryName: movieCategoryName, keyword: movieKeyword, page: moviePage, pageSize: moviePageSize })
    : { movies: [], results: [] };

  if (!includeLive) {
    return {
      sources,
      movies: movieResult.movies,
      movieCategories: movieResult.categories ?? [],
      movieActiveCategory: movieResult.activeCategory ?? null,
      channels: [],
      results: movieResult.results,
    };
  }

  sourceRegistryService.clear();
  // 停用/删除/重新导入 Live 源后，不允许旧频道、旧播放地址或旧 EPG
  // 从运行时缓存重新进入当前源集合；影视 SOURCE 缓存保持不动。
  liveService.clearRuntimeCache();
  sources
     .filter(source => source.sourceType === 'live' && source.liveMode !== 'tv1' && (source.sourceRef || source.url))
    .forEach(source => sourceRegistryService.registerLiveSource(source));

  const liveResult = await liveService.sync(liveSourceIds);
  userDataService.migrateContentIdentities(movieResult.movies);

  const detectedTv1SourceIds = new Set(
    liveResult.results
      .filter(result => result.status === 'fulfilled' && result.adapterStatus?.detectedFormat === 'txt')
      .map(result => result.sourceId),
  );

  if (detectedTv1SourceIds.size) {
    const promotedSources = sourceRepository.getAll().map(source => (
      detectedTv1SourceIds.has(source.sourceId) && source.sourceType === 'live' && source.liveMode !== 'tv1'
        ? { ...source, liveMode: 'tv1' }
        : source
    ));
    sourceRepository.saveAll(promotedSources);
    sources = promotedSources.filter(source => source.enabled !== false);
  }

  const resultBySource = new Map(
    [...movieResult.results, ...liveResult.results].map(result => [result.sourceId, result]),
  );

  const updatedSources = sources.map(source => {
    const result = resultBySource.get(source.sourceId);
    if (!result) return source;

    const capabilities = result.capabilities
      ?? movieResult.results.find(item => item.sourceId === source.sourceId)?.capabilities
      ?? source.capabilities
      ?? [];

    const failed = result.status === 'rejected';
    return {
      ...source,
      capabilities,
      status: failed
        ? (result.reason?.code === 'SourceEmptyError' ? '空结果' : '异常')
        : (result.stale ? '使用缓存' : '正常'),
      lastCheckedAt: result.adapterStatus?.lastCheckedAt ?? Date.now(),
    };
  });

  sourceRepository.saveAll(updatedSources);

  return {
    sources: updatedSources,
    movies: movieResult.movies,
    movieCategories: movieResult.categories ?? [],
    movieActiveCategory: movieResult.activeCategory ?? null,
    channels: liveResult.channels,
    results: [...movieResult.results, ...liveResult.results],
  };
}
