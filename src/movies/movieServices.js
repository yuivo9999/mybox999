import { contentService } from '../core__services__contentService.js';
import { MEDIA_TYPE, MEDIA_TAXONOMY } from './movieCatalog.js';
import { cacheStorage, CacheNamespace, createCacheKey } from '../core__storage__cache.js';
import { createMovieRegistry, createMovieAdapter } from './movieAdapters.js';
import { createSourceAdapter } from '../core__adapters__sourceAdapterFactory.js';
import { requestManager } from '../core__services__network__requestManager.js';
import { errorService } from '../core__services__errorService.js';

// List, search, detail and recommendation operations
function sourceIdentity(movies = []) {
  const sourceIds = new Set();
  movies.forEach((movie) => (movie.sourceRefs ?? []).forEach((ref) => ref?.sourceId && sourceIds.add(ref.sourceId)));
  return [...sourceIds].sort().join(',') || 'aggregate';
}
function cachedDetail(movies, contentId) {
  const movie = contentService.getById(movies, contentId);
  if (!movie) return null;
  const key = createCacheKey({ namespace: CacheNamespace.DETAIL, sourceId: sourceIdentity([movie]), contentId: movie.contentId, params: { kind: 'detail' } });
  const cached = cacheStorage.get(CacheNamespace.DETAIL, key, { allowStale: true });
  if (cached.hit && !cached.stale) return cached.value;
  cacheStorage.set(CacheNamespace.DETAIL, key, movie); return movie;
}
function normalizeText(value) { return String(value ?? '').trim().toLowerCase(); }
function applyFilters(items, filters = {}) {
  return items.filter((movie) => {
    if (filters.year && String(movie.year) !== String(filters.year)) return false;
    if (filters.type && filters.type !== '全部' && movie.type !== filters.type) return false;
    if (filters.region && filters.region !== '全部' && movie.region !== filters.region) return false;
    if (filters.status && filters.status !== '全部' && movie.status !== filters.status) return false;
    if (filters.mediaType && filters.mediaType !== 'all' && movie.mediaType !== filters.mediaType) return false;
    if (filters.categoryId && filters.categoryId !== 'all' && !(movie.categoryIds ?? []).includes(filters.categoryId)) return false;
    return true;
  });
}
function sortItems(items, sort = 'default') {
  return [...items].sort((a, b) => {
    if (sort === 'latest') return Number(b.year || 0) - Number(a.year || 0) || String(b.title).localeCompare(String(a.title));
    if (sort === 'title') return String(a.title).localeCompare(String(b.title), 'zh-Hans');
    if (sort === 'popular') return Number(b.popularity ?? b.rating ?? 0) - Number(a.popularity ?? a.rating ?? 0);
    if (sort === 'time') return Number(b.updatedAt ?? b.year ?? 0) - Number(a.updatedAt ?? a.year ?? 0);
    return 0;
  });
}
function getContinueWatching({ movies = [], history = [], progress = [], limit = 4 } = {}) {
  const progressById = new Map(progress.map(item => [item.progressId, item]));
  return [...history]
    .filter(item => item.targetType === 'content')
    .sort((a, b) => Number(b.lastPlayedAt ?? 0) - Number(a.lastPlayedAt ?? 0))
    .map(item => {
      const movie = cachedDetail(movies, item.targetId);
      if (!movie) return null;
      const progressId = `progress:${item.targetId}:${item.episodeId || 'content'}`;
      const currentProgress = progressById.get(progressId);
      const merged = { ...item, ...(currentProgress ?? {}) };
      if (merged.completed) return null;
      const episodeIndex = Math.max(0, movie.episodes?.findIndex(episode => episode.episodeId === item.episodeId) ?? 0);
      return { movie, episodeIndex, history: merged, progress: currentProgress ?? null };
    })
    .filter(Boolean)
    .slice(0, limit);
}
export const movieService = {
  list({ movies = [], category = '全部', page = 1, pageSize = 50, filters = {}, sort = 'default' } = {}) {
    const safePage = Math.max(1, Number(page) || 1), safePageSize = Math.max(1, Number(pageSize) || 50);
    const key = createCacheKey({ namespace: CacheNamespace.MOVIE, sourceId: sourceIdentity(movies), contentId: 'list', params: { category, page: safePage, pageSize: safePageSize, filters, sort } });
    const cached = cacheStorage.get(CacheNamespace.MOVIE, key, { allowStale: true });
    if (cached.hit && !cached.stale) return cached.value;
    let filtered = movies.filter((movie) => {
      if (category === '全部') return true;
      if (category === '电影') return movie.mediaType === MEDIA_TYPE.MOVIE;
      if (category === '电视剧') return movie.mediaType === MEDIA_TYPE.TV;
      if (category === '综艺') return movie.mediaType === MEDIA_TYPE.VARIETY;
      return (movie.categoryIds ?? []).includes(category) || (movie.categoryLabels ?? []).includes(category) || movie.category === category;
    });
    filtered = sortItems(applyFilters(filtered, filters), sort);
    const start = (safePage - 1) * safePageSize;
    const value = { items: filtered.slice(start, start + safePageSize), page: safePage, pageSize: safePageSize, total: filtered.length, hasMore: start + safePageSize < filtered.length };
    cacheStorage.set(CacheNamespace.MOVIE, key, value); return value;
  },
  search({ movies = [], keyword = '' } = {}) {
    const clean = normalizeText(keyword); if (!clean) return [];
    const key = createCacheKey({ namespace: CacheNamespace.MOVIE, sourceId: sourceIdentity(movies), contentId: 'search', params: { keyword: clean } });
    const cached = cacheStorage.get(CacheNamespace.MOVIE, key, { allowStale: true });
    if (cached.hit && !cached.stale) return cached.value;
    const value = movies.filter((movie) => normalizeText(movie.title).includes(clean) || normalizeText(movie.titleEn).includes(clean) || normalizeText(movie.description).includes(clean) || normalizeText(movie.category).includes(clean) || (movie.categoryLabels ?? []).some(label => normalizeText(label).includes(clean)));
    cacheStorage.set(CacheNamespace.MOVIE, key, value); return value;
  },
  getDetail({ movies = [], contentId } = {}) { return cachedDetail(movies, contentId); },
  getEpisode({ movies = [], contentId, episodeId } = {}) {
    const content = cachedDetail(movies, contentId); if (!content) return null;
    const key = createCacheKey({ namespace: CacheNamespace.EPISODE, sourceId: sourceIdentity([content]), contentId: content.contentId, params: { episodeId: episodeId ?? '' } });
    const cached = cacheStorage.get(CacheNamespace.EPISODE, key, { allowStale: true });
    if (cached.hit && !cached.stale) return cached.value;
    const value = content.episodes?.find((episode) => episode.episodeId === episodeId) ?? null;
    if (value) cacheStorage.set(CacheNamespace.EPISODE, key, value); return value;
  },
  getRelated({ movies = [], movie, limit = 6 } = {}) {
    if (!movie) return [];
    return movies.filter((item) => item.contentId !== movie.contentId && item.category === movie.category).slice(0, limit);
  },
  getHome({ movies = [], history = [], progress = [], limit = 4 } = {}) {
    const continueWatching = getContinueWatching({ movies, history, progress, limit });
    const categories = ['电影', '电视剧', '综艺'];
    const taxonomy = {
      movie: MEDIA_TAXONOMY.movie.map(item => item.label),
      tv: MEDIA_TAXONOMY.tv.map(item => item.label),
      variety: MEDIA_TAXONOMY.variety.map(item => item.label),
    };
    const regions = [...new Set(movies.map((movie) => movie.region).filter(Boolean))];
    const years = [...new Set(movies.map((movie) => movie.year).filter(Boolean))].sort((a,b) => Number(b)-Number(a));
    const statuses = [...new Set(movies.map((movie) => movie.status).filter(Boolean))];
    const types = [...new Set(movies.map((movie) => movie.type).filter(Boolean))];
    const byType = (mediaType) => movies.filter(movie => movie.mediaType === mediaType);
    const latest = [...movies].sort((a,b)=>Number(b.year||0)-Number(a.year||0));
    return {
      continueWatching,
      recommended: movies.slice(0, limit),
      popular: movies.slice(0, limit),
      latest: latest.slice(0, limit),
      popularMovies: byType(MEDIA_TYPE.MOVIE).slice(0, limit),
      popularSeries: byType(MEDIA_TYPE.TV).slice(0, limit),
      popularVariety: byType(MEDIA_TYPE.VARIETY).slice(0, limit),
      movieRanking: [...byType(MEDIA_TYPE.MOVIE)].sort((a,b)=>Number(b.popularity??b.rating??0)-Number(a.popularity??a.rating??0)).slice(0, limit),
      tvRanking: [...byType(MEDIA_TYPE.TV)].sort((a,b)=>Number(b.popularity??b.rating??0)-Number(a.popularity??a.rating??0)).slice(0, limit),
      varietyRanking: [...byType(MEDIA_TYPE.VARIETY)].sort((a,b)=>Number(b.popularity??b.rating??0)-Number(a.popularity??a.rating??0)).slice(0, limit),
      categories,
      taxonomy,
      filters: { types, regions, years, statuses },
    };
  },
  clearCache() { cacheStorage.clear(CacheNamespace.MOVIE); cacheStorage.clear(CacheNamespace.DETAIL); cacheStorage.clear(CacheNamespace.EPISODE); },
};

// Source dispatch, cache and cross-source search
export const movieRegistry = createMovieRegistry();

/**
 * Movie adapter dispatch boundary.
 *
 * Only standard HTTP VOD sources are allowed into the generic HTTP adapter.
 * TVBox extension sources stay out of the generic HTTP adapter path.
 * Dedicated adapters are created through sourceAdapterFactory.
 *
 * Local/user-created movie sources do not carry sourceCapability, so they
 * continue to use the existing generic adapter path.
 */
export function canUseHttpMovieAdapter(source = {}) {
  const capability = String(source.sourceCapability || '').trim();
  const adapterType = String(source.adapterType || '').trim();

  if (capability.startsWith('tvbox-') || adapterType.startsWith('tvbox-')) return false;
  if (!capability && !adapterType) return true;

  return capability === 'direct-http-vod' && adapterType === 'http-vod';
}

function cacheKey(sourceId, params = {}) {
  return createCacheKey({
    namespace: CacheNamespace.SOURCE,
    sourceId,
    contentId: 'movies',
    params: {
      type: 'movies',
      categoryId: params.categoryId ?? '',
      page: Number(params.page) || 1,
      pageSize: Number(params.pageSize) || 24,
      keyword: String(params.keyword ?? ''),
    },
  });
}

async function load(adapter, options = {}) {
  const key = cacheKey(adapter.sourceId, options);
  const cached = cacheStorage.get(CacheNamespace.SOURCE, key, { allowStale: true });
  if (cached.hit && !cached.stale) return { value: cached.value, stale: false, fromCache: true };

  try {
    const value = await requestManager.run(
      `movie:source:${adapter.sourceId}`,
      signal => adapter.getMovies({ ...options, signal, page: options.page ?? 1, limit: options.pageSize ?? options.limit ?? 24 }),
    );

    if (Array.isArray(value) && value.length) {
      cacheStorage.set(CacheNamespace.SOURCE, key, value);
      return { value, stale: false };
    }

    if (cached.hit) return { value: cached.value, stale: true };
    return { value: [], stale: false };
  } catch (error) {
    if (cached.hit) {
      return {
        value: cached.value,
        stale: true,
        error: errorService.classifySource(error, {
          scope: 'movie-source-cache-fallback',
          sourceId: adapter.sourceId,
        }),
      };
    }
    throw error;
  }
}

export async function testMovieSource(source, options = {}) {
  const adapter = createMovieAdapter({
    ...source,
    sourceRef: source?.sourceRef || source?.url,
  }, options.transport);

  return adapter.healthCheck({ signal: options.signal });
}

export async function syncMovieSources(sourceConfigs = [], selectedSourceId = null, options = {}) {
  movieRegistry.clear();

  const enabledMovieSources = sourceConfigs.filter(source =>
    source.enabled !== false
    && source.sourceType === 'movie'
  );

  const preferredSource = selectedSourceId
    ? enabledMovieSources.find(source => source.sourceId === selectedSourceId) ?? null
    : null;
  const orderedSources = [
    ...(preferredSource ? [preferredSource] : []),
    ...enabledMovieSources.filter(source => source.sourceId !== preferredSource?.sourceId),
  ];

  const adapters = [];
  const unsupported = [];
  for (const source of orderedSources) {
    // 已知不可执行的 TVBox 源不能阻塞后面的可运行源。
    if (source.runtimeSupported === false || source.status === '待适配') {
      unsupported.push({
        sourceId: source.sourceId,
        name: source.name || '',
        adapterType: source.adapterType || null,
        sourceCapability: source.sourceCapability || null,
        error: new Error(source.tvboxUnsupportedReason || 'SOURCE_RUNTIME_UNSUPPORTED'),
      });
      continue;
    }
    try {
      const adapter = canUseHttpMovieAdapter(source)
        ? createMovieAdapter({
          ...source,
          sourceRef: source.sourceRef || source.url,
        })
        : createSourceAdapter(source);
      adapters.push(adapter);
      // 影视页只建立一个当前源的运行时；选中的源不可用时再回退到下一个。
      break;
    } catch (error) {
      unsupported.push({
        sourceId: source.sourceId,
        name: source.name || '',
        adapterType: source.adapterType || null,
        sourceCapability: source.sourceCapability || null,
        error,
      });
    }
  }

  adapters.forEach(adapter => movieRegistry.register(adapter));

  const settled = await Promise.all(movieRegistry.list().map(async adapter => {
    try {
      // 第一阶段只取得分类索引；第二阶段只请求当前分类第一页。
      const categoryKey = createCacheKey({
        namespace: CacheNamespace.SOURCE,
        sourceId: adapter.sourceId,
        contentId: 'categories',
        params: { type: 'movie-categories' },
      });
      const cachedCategories = cacheStorage.get(CacheNamespace.SOURCE, categoryKey, { allowStale: true });
      const categories = cachedCategories.hit
        ? cachedCategories.value
        : (typeof adapter.getCategories === 'function'
          ? await adapter.getCategories({ signal: options.signal, timeoutMs: options.timeoutMs ?? 5000 })
          : []);
      if (!cachedCategories.hit && Array.isArray(categories) && categories.length) {
        cacheStorage.set(CacheNamespace.SOURCE, categoryKey, categories);
      }
      const rawCategories = (Array.isArray(categories) ? categories : [])
        .map((item, index) => ({
          id: String(item?.id ?? item?.type_id ?? '').trim(),
          name: String(item?.name ?? item?.type_name ?? item?.label ?? item ?? '').trim(),
          sourceId: adapter.sourceId,
        }))
        .filter(item => item.name && item.name !== '全部');

      const allCategory = { id: 'all', name: '全部', sourceId: adapter.sourceId };
      const normalizedCategories = [allCategory, ...rawCategories];

      const requestedCategoryId = options.categoryId != null ? String(options.categoryId).trim() : '';
      const requestedCategoryName = String(options.categoryName ?? '').trim();

      const activeCategory = (requestedCategoryId || requestedCategoryName)
        ? (normalizedCategories.find(item =>
            (requestedCategoryId && item.id === requestedCategoryId)
            || (requestedCategoryName && item.name === requestedCategoryName)
          ) || allCategory)
        : allCategory;

      const isAll = !activeCategory || activeCategory.id === 'all' || activeCategory.name === '全部';

      const result = await load(adapter, {
        categoryId: isAll ? '' : activeCategory.id,
        categoryName: isAll ? '' : activeCategory.name,
        keyword: options.keyword ?? '',
        page: Number(options.page) || 1,
        pageSize: Number(options.pageSize) || 24,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });

      const taggedValue = (result.value ?? []).map(item => ({
        ...item,
        sourceCategoryId: item.sourceCategoryId || (isAll ? '' : activeCategory.id),
        sourceCategoryName: item.sourceCategoryName || (isAll ? (item.category || '') : activeCategory.name),
      }));

      return {
        status: 'fulfilled',
        sourceId: adapter.sourceId,
        value: taggedValue,
        categories: normalizedCategories,
        activeCategory,
        stale: result.stale,
        fromCache: result.fromCache,
        capabilities: typeof adapter.getCapabilities === 'function' ? adapter.getCapabilities() : [],
        definition: typeof adapter.getDefinition === 'function' ? adapter.getDefinition() : (adapter.definition ?? null),
        adapterStatus: typeof adapter.getStatus === 'function' ? adapter.getStatus() : null,
      };
    } catch (reason) {
      return {
        status: 'rejected',
        sourceId: adapter.sourceId,
        reason: errorService.classifySource(reason, {
          scope: 'movie-source',
          sourceId: adapter.sourceId,
        }),
        categories: [],
        activeCategory: null,
        capabilities: adapter.getCapabilities(),
        definition: adapter.getDefinition(),
        adapterStatus: adapter.getStatus(),
      };
    }
  }));

  return {
    movies: contentService.getMovies(
      settled.flatMap(result => result.status === 'fulfilled' ? result.value : []),
    ),
    categories: settled.flatMap(result => result.status === 'fulfilled' ? result.categories : []),
    activeCategory: settled.find(result => result.status === 'fulfilled' && result.activeCategory)?.activeCategory ?? null,
    results: [...settled, ...unsupported.map(item => ({
      status: 'rejected',
      ...item,
      categories: [],
      activeCategory: null,
    }))],
  };
}

export async function searchMovieSources(sourceConfigs = [], keyword = '', options = {}) {
  const query = String(keyword ?? '').trim();
  if (!query) return { query: '', results: [], failed: [], completed: 0 };

  const candidates = sourceConfigs.filter(source =>
    source?.sourceType === 'movie'
    && source?.enabled !== false
  );
  const pageSize = Math.max(1, Math.min(20, Number(options.pageSize) || 12));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 4500);
  const results = [];
  const failed = [];
  let completedCount = 0;
  const onSourceResult = typeof options.onSourceResult === 'function' ? options.onSourceResult : null;

  if (!candidates.length) {
    return { query, results: [], failed: [], completed: 0 };
  }

  // Concurrent execution across all enabled movie sources
  const searchTasks = candidates.map(async (source, index) => {
    if (options.signal?.aborted) {
      const error = new Error('Search aborted');
      error.name = 'AbortError';
      throw error;
    }

    let entry;
    try {
      const adapter = createSourceAdapter({
        ...source,
        sourceRef: source.sourceRef || source.url,
      }, options);
      if (typeof adapter.search !== 'function') throw new Error('MOVIE_SOURCE_SEARCH_UNSUPPORTED');
      const response = await adapter.search(
        { query, page: 1, pageSize },
        { signal: options.signal, timeoutMs },
      );
      entry = {
        sourceId: source.sourceId,
        sourceName: source.name || source.sourceId,
        status: 'fulfilled',
        items: Array.isArray(response?.items) ? response.items : [],
      };
      results.push(entry);
    } catch (error) {
      if (error?.name === 'AbortError' || options.signal?.aborted) throw error;
      entry = {
        sourceId: source.sourceId,
        sourceName: source.name || source.sourceId,
        status: 'rejected',
        reason: errorService.classifySource(error, {
          scope: 'movie-source-search',
          sourceId: source.sourceId,
        }),
      };
      failed.push(entry);
    }

    completedCount += 1;
    onSourceResult?.(entry, { index: index + 1, total: candidates.length, completed: completedCount });
    return entry;
  });

  await Promise.allSettled(searchTasks);

  return { query, results, failed, completed: candidates.length };
}

// Feature facade used by homepage and movie tab
export function createMovieFeature({movies=[],history=[],progress=[]}={}){return{
 getHome:(options)=>movieService.getHome({movies,history,progress,...(options??{})}),
 getList:(options)=>movieService.list({movies,...(options??{})}),
 search:(keyword)=>movieService.search({movies,keyword}),
 getDetail:(contentId)=>movieService.getDetail({movies,contentId}),
 getEpisode:(contentId,episodeId)=>movieService.getEpisode({movies,contentId,episodeId}),
 getRelated:(movie)=>movieService.getRelated({movies,movie}),
};}
