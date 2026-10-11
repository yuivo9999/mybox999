import { normalizeContent } from '../core__models__content.js';
import { ErrorCode, toAppError } from '../core__models__errors.js';
import { requestAdapter } from '../core__services__network__requestAdapter.js';

// JSON / TVBox result parsers
function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.movies)) return value.movies;
  if (Array.isArray(value?.vod)) return value.vod;
  if (Array.isArray(value?.list)) return value.list;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.result)) return value.result;
  return [];
}

function splitRoutes(value) {
  if (Array.isArray(value)) return value.map(item => String(item ?? '').trim()).filter(Boolean);
  return String(value ?? '').split('$$$').map(item => item.trim()).filter(Boolean);
}

function parseRouteEpisodes(route, routeIndex = 0, routeLabel = '') {
  return String(route ?? '')
    .split('#')
    .map((entry, index) => {
      const value = entry.trim();
      if (!value) return null;
      const separator = value.indexOf('$');
      if (separator < 0) return { title: value, episodeNumber: index + 1, playbackCandidates: [] };
      const title = value.slice(0, separator).trim() || `第${index + 1}集`;
      const url = value.slice(separator + 1).trim();
      return {
        title,
        episodeNumber: index + 1,
        playbackCandidates: url ? [{ mediaUrl: url, label: routeLabel || `线路${routeIndex + 1}`, metadata: { tvboxPlayFlag: routeLabel || `线路${routeIndex + 1}`, tvboxRouteIndex: routeIndex } }] : [],
      };
    })
    .filter(Boolean);
}

function asEpisodes(item) {
  const raw = item?.episodes ?? item?.eps ?? item?.playlists;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(/\s*[|,]\s*/).filter(Boolean).map(title => ({ title }));
  }
  const routes = splitRoutes(item?.vod_play_url);
  if (routes.length) {
    const routeLabels = splitRoutes(item?.vod_play_from);
    return routes.flatMap((route, index) => parseRouteEpisodes(route, index, routeLabels[index] || ''));
  }
  return [];
}

export function parseJSONMovies(input) {
  const value = typeof input === 'string' ? JSON.parse(input) : input;
  return asArray(value).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const episodes = asEpisodes(item);
    const urls = Array.isArray(item.urls) ? item.urls : [];
    const typeId = item.type_id != null ? String(item.type_id).trim() : (item.typeId != null ? String(item.typeId).trim() : '');
    const typeName = String(item.type_name ?? item.category ?? item.vod_class ?? item.group ?? item.categoryName ?? '未分类').trim();
    const rawDescription = String(item.description ?? item.desc ?? item.vod_content ?? '');
    const cleanDesc = rawDescription.replace(/<\/?[^>]+(>|$)/g, '').replace(/&nbsp;/g, ' ').trim();
    const updateInfo = String(item.updateInfo ?? item.vod_remarks ?? item.remarks ?? item.vod_state ?? item.note ?? '').trim();
    const poster = String(item.poster ?? item.pic ?? item.vod_pic ?? item.image ?? '').trim();
    const backdrop = String(item.backdrop ?? item.pic_slide ?? item.vod_pic_slide ?? '').trim();

    return [{
      sourceItemId: String(item.sourceItemId ?? item.vod_id ?? item.id ?? `item-${index + 1}`),
      title: String(item.title ?? item.name ?? item.vod_name ?? `内容 ${index + 1}`).trim(),
      titleEn: String(item.titleEn ?? item.vod_en ?? item.en ?? '').trim(),
      type: item.type ?? item.vod_type ?? item.contentType ?? item.mediaType ?? '',
      category: typeName,
      sourceCategoryId: typeId,
      sourceCategoryIds: typeId ? [typeId] : [],
      sourceCategoryName: typeName,
      sourceCategoryNames: [typeName],
      poster,
      backdrop,
      description: cleanDesc,
      year: String(item.year ?? item.vod_year ?? '').trim(),
      region: String(item.region ?? item.vod_area ?? '').trim(),
      director: String(item.director ?? item.vod_director ?? '').trim(),
      actors: Array.isArray(item.actors) ? item.actors : String(item.vod_actor ?? '').split(/[,，/\s]+/).filter(Boolean),
      popularity: Number(item.popularity ?? item.vod_hits ?? 0) || 0,
      updateInfo,
      rating: String(item.rating ?? item.vod_score ?? item.vod_douban_score ?? '').trim(),
      episodes: episodes.length ? episodes : (urls.length ? urls.map((url, i) => ({ title: `第${i + 1}集`, playbackCandidates: [{ mediaUrl: url }] })) : []),
    }];
  });
}

/**
 * Normalize a TVBox/CatVod Spider response into the same raw item shape used by
 * the normal movie pipeline. Accepts common vod_* and playback fields.
 */
export function parseTVBoxResult(input) {
  const value = typeof input === 'string' ? JSON.parse(input) : input;
  const list = asArray(value);
  return list.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const typeId = item.type_id != null ? String(item.type_id).trim() : (item.typeId != null ? String(item.typeId).trim() : '');
    const typeName = String(item.type_name ?? item.category ?? item.vod_class ?? item.group ?? item.categoryName ?? '').trim();
    const rawDesc = String(item.description ?? item.desc ?? item.vod_content ?? '');
    const cleanDesc = rawDesc.replace(/<\/?[^>]+(>|$)/g, '').replace(/&nbsp;/g, ' ').trim();

    return [{
      sourceItemId: String(item.sourceItemId ?? item.vod_id ?? item.id ?? `item-${index + 1}`),
      canonicalId: item.canonicalId ?? item.globalId ?? item.vod_id ?? item.id ?? '',
      title: String(item.title ?? item.name ?? item.vod_name ?? `内容 ${index + 1}`).trim(),
      type: item.type ?? item.contentType ?? item.vod_type ?? '',
      category: typeName,
      sourceCategoryId: typeId,
      sourceCategoryIds: typeId ? [typeId] : [],
      sourceCategoryName: typeName,
      sourceCategoryNames: typeName ? [typeName] : [],
      poster: String(item.poster ?? item.pic ?? item.vod_pic ?? item.image ?? '').trim(),
      backdrop: String(item.backdrop ?? item.vod_pic_slide ?? item.pic_slide ?? '').trim(),
      description: cleanDesc,
      year: String(item.year ?? item.vod_year ?? '').trim(),
      region: String(item.region ?? item.area ?? item.vod_area ?? '').trim(),
      director: String(item.director ?? item.vod_director ?? '').trim(),
      actors: Array.isArray(item.actors) ? item.actors : String(item.vod_actor ?? '').split(/[,，/\\s]+/).filter(Boolean),
      popularity: Number(item.popularity ?? item.vod_hits ?? 0) || 0,
      updateInfo: String(item.updateInfo ?? item.vod_remarks ?? item.vod_state ?? '').trim(),
      rating: String(item.rating ?? item.vod_score ?? item.vod_douban_score ?? '').trim(),
      episodes: asEpisodes(item),
    }];
  });
}

// Shared movie normalization
export function normalizeMovie({ sourceId, item, index = 0, sourceMetadata = {} }) {
  const playbackMetadata = Object.fromEntries(
    Object.entries({
      sourceCapability: sourceMetadata.sourceCapability,
      adapterType: sourceMetadata.adapterType,
      tvboxAdapterKind: sourceMetadata.tvboxAdapterKind,
      tvboxRequiresJar: sourceMetadata.tvboxRequiresJar,
      tvboxJar: sourceMetadata.tvboxJar,
      playerType: sourceMetadata.tvboxType ?? sourceMetadata.playerType,
      headers: sourceMetadata.headers,
      userAgent: sourceMetadata.userAgent,
      referer: sourceMetadata.referer,
      cookies: sourceMetadata.cookies,
      tvboxIJKProfiles: sourceMetadata.tvboxIJKProfiles,
      tvboxParseConfig: sourceMetadata.tvboxParseConfig,
    }).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
  const normalizeCandidate = (candidate = {}) => ({
    ...candidate,
    metadata: { ...playbackMetadata, ...(candidate.metadata ?? {}) },
    headers: { ...(sourceMetadata.headers ?? {}), ...(candidate.headers ?? {}) },
    userAgent: candidate.userAgent ?? sourceMetadata.userAgent,
    referer: candidate.referer ?? sourceMetadata.referer,
    cookies: candidate.cookies ?? sourceMetadata.cookies ?? '',
  });
  const episodes = (item.episodes ?? []).map((episode, episodeIndex) => {
    if (typeof episode === 'string') return { title: episode };
    return {
      sourceItemId: episode.sourceItemId ?? episode.id ?? `${item.sourceItemId ?? item.id}:episode:${episodeIndex + 1}`,
      canonicalEpisodeId: episode.canonicalEpisodeId ?? episode.globalId ?? '',
      title: episode.title ?? episode.name ?? `第${episodeIndex + 1}集`,
      description: episode.description ?? episode.desc ?? '',
      episodeNumber: episode.episodeNumber ?? episode.number ?? episodeIndex + 1,
      playbackCandidates: [
        ...(Array.isArray(episode.playbackCandidates) ? episode.playbackCandidates : []),
        ...(episode.url ? [{ mediaUrl: episode.url, protocol: episode.protocol, label: episode.label }] : []),
      ].filter(candidate => candidate.mediaUrl || candidate.url).map(normalizeCandidate),
    };
  });

  const actors = Array.isArray(item.actors) ? item.actors : (Array.isArray(item.cast) ? item.cast : []);
  const director = item.director ?? item.directors?.[0] ?? '';

  return normalizeContent({
    sourceId,
    sourceItemId: item.sourceItemId ?? item.id ?? `item-${index + 1}`,
    canonicalId: item.canonicalId ?? item.globalId ?? item.externalId ?? item.tmdbId ?? item.imdbId ?? '',
    title: item.title ?? item.name ?? '',
    titleEn: item.titleEn ?? item.vod_en ?? item.en ?? '',
    subtitle: item.subtitle ?? item.subTitle ?? '',
    type: item.type ?? item.contentType ?? '',
    sourceCategoryId: item.sourceCategoryId ?? '',
    sourceCategoryIds: item.sourceCategoryIds ?? (item.sourceCategoryId ? [item.sourceCategoryId] : []),
    sourceCategoryName: item.sourceCategoryName ?? item.category ?? '',
    sourceCategoryNames: item.sourceCategoryNames ?? (item.sourceCategoryName ? [item.sourceCategoryName] : []),
    rating: item.rating ?? item.vod_score ?? '',
    poster: item.poster ?? item.pic ?? item.cover ?? '',
    backdrop: item.backdrop ?? item.background ?? '',
    background: item.background ?? item.backdrop ?? '',
    description: item.description ?? item.desc ?? '',
    year: item.year ?? item.releaseYear ?? '',
    category: item.category ?? item.class ?? '',
    region: item.region ?? item.area ?? '',
    director,
    actors,
    cast: actors,
    popularity: item.popularity,
    updateInfo: item.updateInfo ?? item.updateStatus ?? item.status ?? '',
    totalEpisodes: item.totalEpisodes ?? item.episodeCount,
    episodeCount: item.episodeCount ?? item.totalEpisodes,
    currentEpisode: item.currentEpisode,
    createdAt: item.createdAt ?? null,
    updatedAt: item.updatedAt ?? null,
    episodes,
  });
}

// Movie source registry
export function normalizeMovieSourceDefinition(source = {}) {
  const sourceId = String(source.sourceId ?? '').trim();
  if (!sourceId) throw new Error('MOVIE_SOURCE_ID_REQUIRED');

  return {
    sourceId,
    name: String(source.name ?? sourceId).trim() || sourceId,
    type: 'movie',
    endpoint: String(source.sourceRef || source.url || source.endpoint || '').trim(),
    enabled: source.enabled !== false,
    priority: Number.isFinite(Number(source.priority)) ? Number(source.priority) : 0,
    capabilities: Array.isArray(source.capabilities) ? [...new Set(source.capabilities.filter(Boolean))] : [],
    status: String(source.status ?? 'unknown'),
    lastCheckedAt: source.lastCheckedAt ?? null,
  };
}

export function createMovieRegistry() {
  const adapters = new Map();

  return {
    register(adapter) {
      if (!adapter?.sourceId) throw new Error('MOVIE_ADAPTER_SOURCE_ID_REQUIRED');
      adapters.set(adapter.sourceId, adapter);
      return adapter;
    },
    unregister(sourceId) {
      adapters.delete(sourceId);
    },
    get(sourceId) {
      return adapters.get(sourceId) ?? null;
    },
    getDefinition(sourceId) {
      const adapter = adapters.get(sourceId);
      return adapter ? normalizeMovieSourceDefinition(adapter.getDefinition?.() ?? adapter.definition) : null;
    },
    getCapabilities(sourceId) {
      return [...(adapters.get(sourceId)?.getCapabilities?.() ?? [])];
    },
    list() {
      return [...adapters.values()].sort((a, b) =>
        (a.getDefinition?.().priority ?? 0) - (b.getDefinition?.().priority ?? 0)
      );
    },
    listDefinitions() {
      return [...adapters.values()].map(adapter =>
        normalizeMovieSourceDefinition(adapter.getDefinition?.() ?? adapter.definition)
      );
    },
    clear() {
      adapters.clear();
    },
  };
}

// HTTP movie source adapter
const DEFAULT_CAPABILITIES = Object.freeze([
  'search',
  'categories',
  'list',
  'filter',
  'sort',
  'detail',
  'episodes',
  'playUrl',
  'recommendations',
]);

export function createMovieAdapter(config, transport = null) {
  const sourceId = String(config.sourceId ?? '').trim();
  if (!sourceId) throw new Error('MOVIE_SOURCE_ID_REQUIRED');

  const sourceDefinition = Object.freeze({
    sourceId,
    name: String(config.name ?? sourceId),
    type: 'movie',
    endpoint: String(config.sourceRef || config.url || '').trim(),
    enabled: config.enabled !== false,
    priority: Number.isFinite(Number(config.priority)) ? Number(config.priority) : 0,
    capabilities: [...new Set(Array.isArray(config.capabilities) && config.capabilities.length ? config.capabilities : DEFAULT_CAPABILITIES)],
    sourceCapability: String(config.sourceCapability || '').trim() || undefined,
    adapterType: String(config.adapterType || '').trim() || undefined,
    tvboxAdapterKind: config.tvboxAdapterKind ?? undefined,
    tvboxRequiresJar: config.tvboxRequiresJar === true,
    tvboxJar: config.tvboxJar ?? undefined,
    tvboxType: config.tvboxType ?? undefined,
    timeoutMs: Number.isFinite(Number(config.timeoutMs)) ? Number(config.timeoutMs) : undefined,
    categories: Array.isArray(config.categories) ? config.categories : [],
  });

  let lastError = null;
  let lastCheckedAt = null;
  let status = config.enabled === false ? 'disabled' : String(config.status ?? 'unknown');

  const request = async (options = {}) => {
    if (sourceDefinition.adapterType === 'tvbox-extension') {
      throw toAppError(new Error('TVBOX_EXTENSION_UNSUPPORTED'), {
        code: ErrorCode.SOURCE,
        scope: 'movie-source-adapter',
        context: {
          sourceId,
          sourceCapability: sourceDefinition.sourceCapability,
          tvboxAdapterKind: sourceDefinition.tvboxAdapterKind,
        },
      });
    }
    if (!sourceDefinition.endpoint) {
      throw toAppError(new Error('MOVIE_SOURCE_ENDPOINT_REQUIRED'), {
        code: ErrorCode.SOURCE,
        scope: 'movie-source-request',
        context: { sourceId },
      });
    }
    let finalUrl = sourceDefinition.endpoint;
    if (finalUrl.includes('api.php') || finalUrl.includes('provide/vod') || finalUrl.includes('/vod/')) {
      const query = new URLSearchParams();
      const categoryOnly = options.categoryOnly === true;
      if (categoryOnly) {
        if (!/[?&]ac=/.test(finalUrl)) query.set('ac', 'list');
        else finalUrl = finalUrl.replace(/([?&])ac=[^&]*/i, '$1ac=list');
      } else {
        // 请求具体内容列表时，必须采用 ac=detail 才能准确抓取到海报图 vod_pic、角标 vod_remarks 和播放线路集数，绝不遗漏内容
        if (!/[?&]ac=/.test(finalUrl)) query.set('ac', 'detail');
        else finalUrl = finalUrl.replace(/([?&])ac=[^&]*/i, '$1ac=detail');
      }
      if (options.categoryId != null && String(options.categoryId).trim() && !/[?&]t=/.test(finalUrl)) query.set('t', String(options.categoryId).trim());
      if (options.page != null && Number(options.page) > 0 && !/[?&]pg=/.test(finalUrl)) query.set('pg', String(Math.max(1, Number(options.page))));
      if (options.keyword != null && String(options.keyword).trim() && !/[?&]wd=/.test(finalUrl)) query.set('wd', String(options.keyword).trim());
      if (options.limit != null && Number(options.limit) > 0 && !/[?&]limit=/.test(finalUrl)) query.set('limit', String(Math.min(100, Number(options.limit))));
      const suffix = query.toString();
      if (suffix) finalUrl += (finalUrl.includes('?') ? '&' : '?') + suffix;
    }

    const requestHeaders = { ...(config.headers ?? {}) };
    if (config.userAgent && !requestHeaders['User-Agent'] && !requestHeaders['user-agent']) requestHeaders['User-Agent'] = config.userAgent;
    if (config.referer && !requestHeaders.Referer && !requestHeaders.referer) requestHeaders.Referer = config.referer;
    if (config.cookies && !requestHeaders.Cookie && !requestHeaders.cookie) requestHeaders.Cookie = config.cookies;

    let response;
    try {
      response = config.localContent != null
        ? { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), text: async () => String(config.localContent) }
        : await requestAdapter.request(finalUrl, {
        headers: requestHeaders,
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? config.timeoutMs,
        transport,
      });
    } catch (error) {
      throw toAppError(error, {
        code: ErrorCode.NETWORK,
        retryable: true,
        scope: 'movie-source-request',
        context: { sourceId, endpoint: finalUrl },
      });
    }

    if (!response?.ok) {
      throw toAppError(new Error(`HTTP_${response?.status ?? 0}`), {
        code: ErrorCode.SOURCE_RESPONSE,
        scope: 'movie-source-response',
        context: { sourceId, status: response?.status ?? 0 },
      });
    }

    return response;
  };

  const load = async (options = {}) => {
    try {
      const response = await request(options);
      const body = await response.text();
      const normalizedBody = String(body ?? '').replace(/^\uFEFF/, '').trim();
      if (!normalizedBody) {
        throw toAppError(new Error('MOVIE_SOURCE_EMPTY_RESPONSE'), {
          code: ErrorCode.SOURCE_EMPTY,
          scope: 'movie-source-empty',
          context: { sourceId },
        });
      }
      const contentType = String(response?.headers?.get?.('content-type') ?? '').toLowerCase();
      if (contentType.includes('text/html') && !/^\s*(?:\{|\[)/.test(normalizedBody)) {
        throw toAppError(new Error('MOVIE_SOURCE_HTML_RESPONSE'), {
          code: ErrorCode.SOURCE_RESPONSE,
          scope: 'movie-source-response',
          context: { sourceId, contentType },
        });
      }

      let raw;
      try {
        raw = parseJSONMovies(normalizedBody);
      if (!raw || (Array.isArray(raw) && raw.length === 0) || (raw?.list && Array.isArray(raw.list) && raw.list.length === 0 && Number(raw.total ?? 0) === 0)) {
        return [];
      }
      } catch (error) {
        throw toAppError(error, {
          code: ErrorCode.PARSE,
          scope: 'movie-source-parse',
          context: { sourceId },
        });
      }

      if (!Array.isArray(raw)) {
        throw toAppError(new Error('MOVIE_SOURCE_INVALID_RESULT'), {
          code: ErrorCode.PARSE,
          scope: 'movie-source-parse',
          context: { sourceId },
        });
      }

      if (!raw.length) {
        throw toAppError(new Error('MOVIE_SOURCE_EMPTY_RESULT'), {
          code: ErrorCode.SOURCE_EMPTY,
          scope: 'movie-source-empty',
          context: { sourceId },
        });
      }

      const normalized = raw.map((item, index) => {
        try {
          if (!item || typeof item !== 'object') throw new Error('MOVIE_SOURCE_FIELD_MISSING');
          if (!(item.sourceItemId ?? item.id) || !(item.title ?? item.name)) throw new Error('MOVIE_SOURCE_FIELD_MISSING');
          return normalizeMovie({
            sourceId,
            item,
            index,
            sourceMetadata: {
              sourceCapability: config.sourceCapability,
              adapterType: config.adapterType,
              tvboxAdapterKind: config.tvboxAdapterKind,
              tvboxRequiresJar: config.tvboxRequiresJar,
              tvboxJar: config.tvboxJar,
              tvboxType: config.tvboxType,
              playerType: config.playerType,
              headers: config.headers,
              userAgent: config.userAgent,
              referer: config.referer,
              cookies: config.cookies,
              tvboxParseConfig: config.tvboxParseConfig,
            },
          });
        } catch (error) {
          throw toAppError(error, {
            code: ErrorCode.NORMALIZE,
            scope: 'movie-source-normalize',
            context: {
              sourceId,
              sourceItemId: item?.sourceItemId ?? item?.id ?? null,
              index,
            },
          });
        }
      });

      lastError = null;
      status = 'healthy';
      lastCheckedAt = Date.now();
      return normalized;
    } catch (error) {
      const normalized = toAppError(error, {
        context: { sourceId },
        scope: error?.scope ?? 'movie-source',
      });
      lastError = normalized;
      status = 'error';
      lastCheckedAt = Date.now();
      throw normalized;
    }
  };

  const ensureMovies = async (options = {}) => {
    if (Array.isArray(options.items)) return options.items;
    return load(options);
  };

  const requireCapability = (capability) => {
    if (!sourceDefinition.capabilities.includes(capability)) {
      throw toAppError(new Error(`MOVIE_CAPABILITY_UNSUPPORTED:${capability}`), {
        code: ErrorCode.SOURCE,
        scope: 'movie-source-capability',
        context: { sourceId, capability },
      });
    }
  };

  const getCategories = async (options = {}) => {
    requireCapability('categories');
    try {
      const response = await request({ ...options, categoryOnly: true, page: 1, limit: 1 });
      const body = String(await response.text()).replace(/^\uFEFF/, '').trim();
      const value = JSON.parse(body);
      const raw = value?.class ?? value?.classes ?? value?.categories ?? value?.type ?? value?.data?.class ?? [];
      const list = Array.isArray(raw) ? raw : [];
      if (list.length > 0) {
        return list.map((item, index) => ({
          id: String(item?.type_id ?? item?.typeId ?? item?.id ?? item?.value ?? index + 1),
          name: String(item?.type_name ?? item?.name ?? item?.label ?? item?.title ?? item ?? '').trim(),
        })).filter(item => item.name);
      }
    } catch {
      // Fallback to static category definition if offline or response lacks class list
    }
    if (Array.isArray(sourceDefinition.categories) && sourceDefinition.categories.length) {
      return sourceDefinition.categories.map((item, index) => {
        if (typeof item === 'string') {
          return { id: String(index + 1), name: item.trim() };
        }
        return {
          id: String(item?.type_id ?? item?.id ?? item?.typeId ?? item?.value ?? index + 1),
          name: String(item?.type_name ?? item?.name ?? item?.label ?? item?.title ?? '').trim(),
        };
      }).filter(item => item.name);
    }
    return [];
  };

  const filterItems = (movies, params = {}) => {
    requireCapability('filter');
    let result = movies;
    if (params.category) result = result.filter(item => item.category === params.category);
    if (params.year) result = result.filter(item => String(item.year) === String(params.year));
    if (params.type) result = result.filter(item => item.type === params.type || item.contentType === params.type);
    if (params.region) result = result.filter(item => item.region === params.region);
    return result;
  };

  const sortItems = (movies, params = {}) => {
    requireCapability('sort');
    const sortBy = params.sortBy ?? 'popularity';
    const direction = params.order === 'asc' ? 1 : -1;
    return [...movies].sort((a, b) => {
      const left = a?.[sortBy] ?? '';
      const right = b?.[sortBy] ?? '';
      if (left === right) return 0;
      return left > right ? direction : -direction;
    });
  };

  const getList = async (params = {}, options = {}) => {
    requireCapability('list');
    let movies = await ensureMovies(options);
    if (params.category || params.year || params.type || params.region) movies = filterItems(movies, params);
    if (params.sortBy) movies = sortItems(movies, params);
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(params.pageSize) || 20));
    return {
      items: movies.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: movies.length,
    };
  };

  const search = async (params = {}, options = {}) => {
    requireCapability('search');
    const query = String(params.query ?? params.keyword ?? '').trim().toLowerCase();
    if (!query) return getList(params, options);
    // Prefer source-side keyword search for HTTP VOD endpoints. This avoids
    // downloading an entire source catalogue just to find one title.
    const movies = await ensureMovies({
      ...options,
      keyword: query,
    });
    const filtered = movies.filter(item =>
      [item.title, item.subtitle, item.description, item.category, item.titleEn]
        .some(value => String(value ?? '').toLowerCase().includes(query))
    );
    return {
      ...await getList({ ...params, page: 1 }, { ...options, items: filtered }),
      items: filtered.slice(0, Math.max(1, Number(params.pageSize) || 20)),
      total: filtered.length,
    };
  };

  const getDetail = async (contentRef, options = {}) => {
    requireCapability('detail');
    const movies = await ensureMovies(options);
    const ref = typeof contentRef === 'string'
      ? contentRef
      : contentRef?.contentId ?? contentRef?.sourceItemId;
    return movies.find(item =>
      item.contentId === ref ||
      item.legacyContentId === ref ||
      item.sourceRefs?.some(source => source.sourceItemId === ref)
    ) ?? null;
  };

  const getEpisodes = async (contentRef, options = {}) => {
    requireCapability('episodes');
    const detail = await getDetail(contentRef, options);
    return detail?.episodes ?? [];
  };

  const getPlaybackCandidates = async (episodeRef, options = {}) => {
    requireCapability('playUrl');
    const episodeId = typeof episodeRef === 'string' ? episodeRef : episodeRef?.episodeId;
    const movies = await ensureMovies(options);
    return movies
      .flatMap(item => item.episodes ?? [])
      .find(episode => episode.episodeId === episodeId)
      ?.playbackCandidates ?? [];
  };

  const getRecommendations = async (contentRef, options = {}) => {
    requireCapability('recommendations');
    const movies = await ensureMovies(options);
    const current = await getDetail(contentRef, options);
    const category = current?.category;
    return movies
      .filter(item => item.contentId !== current?.contentId && (!category || item.category === category))
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
      .slice(0, Math.max(1, Math.min(50, Number(options.limit) || 12)));
  };

  const healthCheck = async (options = {}) => {
    if (sourceDefinition.adapterType === 'tvbox-extension') {
      return {
        ok: false,
        sourceId,
        status: 'unsupported',
        checkedAt: Date.now(),
        error: toAppError(new Error('TVBOX_EXTENSION_UNSUPPORTED'), {
          code: ErrorCode.SOURCE,
          scope: 'movie-source-adapter',
          context: {
            sourceId,
            sourceCapability: sourceDefinition.sourceCapability,
            tvboxAdapterKind: sourceDefinition.tvboxAdapterKind,
          },
        }),
      };
    }
    try {
      await load(options);
      return {
        ok: true,
        sourceId,
        status: 'healthy',
        checkedAt: lastCheckedAt,
        error: null,
      };
    } catch (error) {
      return {
        ok: false,
        sourceId,
        status: 'error',
        checkedAt: lastCheckedAt,
        error: toAppError(error, { context: { sourceId } }),
      };
    }
  };

  const getDefinition = () => ({
    ...sourceDefinition,
    status,
    lastCheckedAt,
  });

  return {
    sourceId,
    definition: getDefinition(),
    getDefinition,
    getCapabilities: () => [...sourceDefinition.capabilities],
    getMovies: load,
    search,
    getCategories,
    getList,
    filter: filterItems,
    sort: sortItems,
    getDetail,
    getEpisodes,
    getPlaybackCandidates,
    getRecommendations,
    healthCheck,
    getStatus: () => ({ status, lastCheckedAt, error: lastError }),
  };
}
