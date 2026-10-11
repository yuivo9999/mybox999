import { classifyMedia } from './movies/movieCatalog.js';

export const ContentType = Object.freeze({
  MOVIE: 'movie',
  SERIES: 'series',
  ANIME: 'anime',
  VARIETY: 'variety',
  DOCUMENTARY: 'documentary',
  SHORT_DRAMA: 'short-drama',
  OTHER: 'other',
});

function cleanIdentity(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cleanTitle(value) {
  return cleanIdentity(value).replace(/[\[\]【】()（）:：,，.!！？?·'"]/g, '').replace(/\s+/g, '');
}

export function createContentIdentity({ canonicalId = '', title = '', year = '', type = '', region = '' } = {}) {
  const canonical = cleanIdentity(canonicalId);
  if (canonical) return `canonical:${canonical}`;
  return '';
}

export function createContentMatchKey({ title = '', year = '', type = '', region = '' } = {}) {
  const normalizedTitle = cleanTitle(title);
  const normalizedYear = cleanIdentity(year);
  const normalizedType = cleanIdentity(type);
  const normalizedRegion = cleanIdentity(region);
  if (!normalizedTitle || !normalizedYear) return '';
  return `metadata:${normalizedTitle}|${normalizedYear}|${normalizedType}|${normalizedRegion}`;
}

export function createContentId(sourceId, sourceItemId) {
  return `content:${sourceId}:${sourceItemId}`;
}

export function createEpisodeId(contentId, sourceId, sourceItemId, canonicalEpisodeId = '') {
  const canonical = cleanIdentity(canonicalEpisodeId);
  return canonical ? `episode:${contentId}:canonical:${canonical}` : `episode:${contentId}:${sourceId}:${sourceItemId}`;
}

export function normalizeEpisode({ contentId, sourceId, sourceItemId, canonicalEpisodeId = '', number, title, description = '', playbackCandidates = [] }) {
  const episodeIdentity = cleanIdentity(canonicalEpisodeId) ? `canonical:${cleanIdentity(canonicalEpisodeId)}` : '';
  const sourceRelations = [{ sourceId, sourceItemId }];
  return {
    episodeId: createEpisodeId(contentId, sourceId, sourceItemId, canonicalEpisodeId),
    episodeIdentity,
    contentId,
    sourceId,
    sourceItemId,
    episodeNumber: number,
    title,
    episodeTitle: title,
    description,
    sourceRefs: sourceRelations,
    sourceRelations,
    playbackCandidates: playbackCandidates.map((candidate) => ({ ...candidate, sourceId: candidate.sourceId ?? sourceId })),
  };
}

export function normalizeContent({
  sourceId,
  sourceItemId,
  canonicalId = '',
  title,
  subtitle = '',
  type,
  sourceCategoryId = '',
  sourceCategoryIds = [],
  sourceCategoryName = '',
  sourceCategoryNames = [],
  rating = '',
  poster = '',
  backdrop = '',
  background = backdrop,
  description = '',
  year = '',
  category = '',
  region = '',
  director = '',
  actors = [],
  cast = actors,
  popularity = 0,
  status = '',
  updateStatus = status,
  updateInfo = updateStatus,
  totalEpisodes = null,
  episodeCount = totalEpisodes,
  currentEpisode = null,
  createdAt = null,
  updatedAt = null,
  episodes = [],
}) {
  const legacyContentId = createContentId(sourceId, sourceItemId);
  const classification = classifyMedia({ type, category, region, title, episodes });
  const contentIdentity = createContentIdentity({ canonicalId, title, year, type, region });
  const contentId = `content:${contentIdentity || legacyContentId}`;
  const normalizedEpisodes = episodes.map((episode, index) => normalizeEpisode({
    contentId,
    sourceId,
    sourceItemId: episode.sourceItemId ?? `${sourceItemId}:episode:${index + 1}`,
    canonicalEpisodeId: episode.canonicalEpisodeId ?? episode.globalId ?? '',
    number: episode.episodeNumber ?? index + 1,
    title: episode.title ?? episode,
    description: episode.description ?? '',
    playbackCandidates: episode.playbackCandidates ?? [],
  }));
  const resolvedEpisodeCount = episodeCount == null ? normalizedEpisodes.length : Math.max(0, Number(episodeCount) || 0);
  const sourceRelations = [{ sourceId, sourceItemId }];

  const resolvedCatId = String(sourceCategoryId || (sourceCategoryIds[0] ?? '')).trim();
  const resolvedCatIds = Array.isArray(sourceCategoryIds) && sourceCategoryIds.length
    ? sourceCategoryIds.map(String)
    : (resolvedCatId ? [resolvedCatId] : []);
  const resolvedCatName = String(sourceCategoryName || (sourceCategoryNames[0] ?? category ?? '')).trim();
  const resolvedCatNames = Array.isArray(sourceCategoryNames) && sourceCategoryNames.length
    ? sourceCategoryNames.map(String)
    : (resolvedCatName ? [resolvedCatName] : (category ? [String(category)] : []));

  return {
    contentId,
    mediaType: classification.mediaType,
    categoryIds: classification.categoryIds,
    categoryLabels: classification.categoryLabels,
    sourceType: type || '',
    sourceCategory: category || '',
    sourceCategoryId: resolvedCatId,
    sourceCategoryIds: resolvedCatIds,
    sourceCategoryName: resolvedCatName,
    sourceCategoryNames: resolvedCatNames,
    rating: String(rating ?? '').trim(),
    legacyContentId,
    contentIdentity,
    contentMatchKey: createContentMatchKey({ title, year, type, region }),
    sourceId,
    sourceItemId,
    type: type || ContentType.OTHER,
    contentType: type || ContentType.OTHER,
    title,
    subtitle,
    poster,
    backdrop: backdrop || background || '',
    background: background || backdrop || '',
    description,
    year,
    category: classification.categoryLabels[0] || category || '',
    region,
    director,
    directors: director ? [director] : [],
    cast: Array.isArray(cast) ? cast : [],
    actors: Array.isArray(actors) ? actors : (Array.isArray(cast) ? cast : []),
    popularity: Number(popularity) || 0,
    updateInfo: updateInfo || '',
    updateStatus: updateInfo || '',
    status: updateInfo || '',
    episodeCount: resolvedEpisodeCount,
    totalEpisodes: resolvedEpisodeCount,
    currentEpisode: currentEpisode == null ? (normalizedEpisodes.length || null) : Math.max(0, Number(currentEpisode) || 0),
    availableSourceCount: 1,
    createdAt: createdAt == null ? null : createdAt,
    updatedAt: updatedAt == null ? null : updatedAt,
    sourceRefs: sourceRelations,
    sourceRelations,
    episodes: normalizedEpisodes,
    syncAt: Date.now(),
  };
}
