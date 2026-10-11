function episodeMergeKey(episode) {
  if (episode?.episodeIdentity) return episode.episodeIdentity;
  const number = Number(episode?.episodeNumber);
  const title = String(episode?.title ?? '').trim().toLowerCase();
  return Number.isFinite(number) && number > 0 && title ? `number:${number}|title:${title}` : episode?.episodeId;
}

function mergeSourceRelations(existing = [], incoming = []) {
  const result = [...existing];
  for (const relation of incoming) {
    if (!relation?.sourceId) continue;
    if (!result.some(item => item.sourceId === relation.sourceId && item.sourceItemId === relation.sourceItemId)) result.push(relation);
  }
  return result;
}

function mergeEpisodes(existing, incoming) {
  const byKey = new Map(existing.map(episode => [episodeMergeKey(episode), episode]));

  for (const episode of incoming) {
    const key = episodeMergeKey(episode);
    const current = byKey.get(key);

    if (!current) {
      const sourceRelations = mergeSourceRelations(episode.sourceRelations ?? episode.sourceRefs ?? [], []);
      byKey.set(key, {
        ...episode,
        sourceRefs: sourceRelations,
        sourceRelations,
        playbackCandidates: [...(episode.playbackCandidates ?? [])],
      });
      continue;
    }

    const sourceRelations = mergeSourceRelations(
      current.sourceRelations ?? current.sourceRefs ?? [],
      episode.sourceRelations ?? episode.sourceRefs ?? [],
    );
    current.sourceRefs = sourceRelations;
    current.sourceRelations = sourceRelations;
    current.playbackCandidates = [
      ...(current.playbackCandidates ?? []),
      ...(episode.playbackCandidates ?? []).filter(candidate =>
        !current.playbackCandidates.some(item =>
          (item.candidateId && item.candidateId === candidate.candidateId) ||
          (item.sourceId && item.sourceId === candidate.sourceId && item.mediaUrl === candidate.mediaUrl)
        )
      ),
    ];
    if (!current.description && episode.description) current.description = episode.description;
  }

  return [...byKey.values()];
}

function mergeContentInto(current, item) {
  const sourceRelations = mergeSourceRelations(
    current.sourceRelations ?? current.sourceRefs ?? [],
    item.sourceRelations ?? item.sourceRefs ?? [],
  );

  current.sourceRefs = sourceRelations;
  current.sourceRelations = sourceRelations;
  current.categoryIds = [...new Set([...(current.categoryIds ?? []), ...(item.categoryIds ?? [])])];
  current.categoryLabels = [...new Set([...(current.categoryLabels ?? []), ...(item.categoryLabels ?? [])])];
  current.sourceCategories = [...new Set([...(current.sourceCategories ?? []), item.sourceCategory].filter(Boolean))];
  current.sourceCategoryIds = [...new Set([...(current.sourceCategoryIds ?? []), item.sourceCategoryId].filter(value => value !== undefined && value !== null && value !== ''))];
  current.sourceCategoryNames = [...new Set([...(current.sourceCategoryNames ?? []), item.sourceCategoryName].filter(Boolean))];
  current.sourceTypes = [...new Set([...(current.sourceTypes ?? []), item.sourceType].filter(Boolean))];
  current.episodes = mergeEpisodes(current.episodes ?? [], item.episodes ?? []);

  if (!current.poster && item.poster) current.poster = item.poster;
  if (!current.backdrop && item.backdrop) current.backdrop = item.backdrop;
  if (!current.background && item.background) current.background = item.background;
  if (!current.description && item.description) current.description = item.description;
  if (!current.subtitle && item.subtitle) current.subtitle = item.subtitle;
  if (!current.director && item.director) current.director = item.director;
  if (!(current.cast?.length) && item.cast?.length) current.cast = [...item.cast];
  if (!(current.actors?.length) && item.actors?.length) current.actors = [...item.actors];
  if (!current.updateInfo && item.updateInfo) current.updateInfo = item.updateInfo;
  current.updateStatus = current.updateInfo ?? current.updateStatus ?? '';
  current.status = current.updateInfo ?? current.status ?? '';
  current.episodeCount = Math.max(current.episodeCount ?? 0, item.episodeCount ?? 0, current.episodes.length);
  current.totalEpisodes = current.episodeCount;
  current.currentEpisode = Math.max(current.currentEpisode ?? 0, item.currentEpisode ?? 0);
  current.availableSourceCount = new Set(sourceRelations.map(ref => ref.sourceId).filter(Boolean)).size;
  current.createdAt = current.createdAt ?? item.createdAt ?? null;
  current.updatedAt = Math.max(current.updatedAt ?? 0, item.updatedAt ?? 0) || null;
  current.popularity = Math.max(current.popularity ?? 0, item.popularity ?? 0);
  current.syncAt = Math.max(current.syncAt ?? 0, item.syncAt ?? 0);
  return current;
}

function identityKeys(item) {
  return [
    item?.contentIdentity,
    item?.contentMatchKey,
    item?.contentId,
  ].filter(Boolean);
}

export function mergeContents(items = []) {
  const byIdentity = new Map();

  for (const item of items) {
    if (!item?.contentId) continue;

    const keys = identityKeys(item);
    let key = keys.find(candidate => byIdentity.has(candidate)) ?? keys[0];
    const current = byIdentity.get(key);

    if (!current) {
      const sourceRelations = [...(item.sourceRelations ?? item.sourceRefs ?? [])];
      const copy = {
        ...item,
        sourceRefs: sourceRelations,
        sourceRelations,
        categoryIds: [...new Set(item.categoryIds ?? [])],
        categoryLabels: [...new Set(item.categoryLabels ?? [])],
        sourceCategories: item.sourceCategory ? [item.sourceCategory] : [],
        sourceCategoryIds: item.sourceCategoryId != null && item.sourceCategoryId !== '' ? [item.sourceCategoryId] : [],
        sourceCategoryNames: item.sourceCategoryName ? [item.sourceCategoryName] : [],
        sourceTypes: item.sourceType ? [item.sourceType] : [],
        episodes: mergeEpisodes([], item.episodes ?? []),
        availableSourceCount: Math.max(1, new Set(sourceRelations.map(ref => ref.sourceId).filter(Boolean)).size),
      };
      byIdentity.set(key, copy);

      // Once a metadata identity resolves two source-qualified records, keep all aliases
      // pointing at the same canonical object so later sources join the same record.
      for (const alias of keys) byIdentity.set(alias, copy);
      continue;
    }

    const merged = mergeContentInto(current, item);
    for (const alias of keys) byIdentity.set(alias, merged);
  }

  return [...new Set(byIdentity.values())];
}

export const contentService = {
  getMovies: (items = []) => mergeContents(items),
  getById: (items, contentId) => items.find((item) => item.contentId === contentId || item.legacyContentId === contentId) ?? null,
  mergeContents,
};
