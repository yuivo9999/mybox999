import { userDataRepository } from '../core__repositories__userDataRepository.js';
import { createContentId } from '../core__models__content.js';
import { normalizeSettings } from '../core__models__userData.js';

function shouldWriteProgress(previous, next) {
  if (!previous) return true;
  if (previous.completed && !next.completed && next.positionSeconds <= previous.positionSeconds) return false;
  if (!next.completed && next.positionSeconds === 0 && previous.positionSeconds > 0) return false;
  return next.updatedAt >= previous.updatedAt;
}

export const userDataService = {
  getSettings() { return normalizeSettings(userDataRepository.getSettings()); },
  saveSettings(value) { const next = normalizeSettings(value); userDataRepository.saveSettings(next); return next; },
  updateSettings(patch = {}) { return this.saveSettings({ ...this.getSettings(), ...patch }); },
  getSnapshot() {
    return {
      favorites: userDataRepository.getFavorites(),
      history: userDataRepository.getHistory(),
      progress: userDataRepository.getProgress(),
      searches: userDataRepository.getSearches(),
      settings: normalizeSettings(userDataRepository.getSettings()),
      selectedSources: userDataRepository.getSelectedSources(),
      migration: userDataRepository.getMigrationState(),
    };
  },
  saveSelectedSources(value = { movie: null, live: null }) {
    userDataRepository.saveSelectedSources(value);
    return value;
  },
  setSelectedSource(sourceType, sourceId) {
    const current = userDataRepository.getSelectedSources();
    const next = { ...current, [sourceType]: sourceId || null };
    userDataRepository.saveSelectedSources(next);
    return next;
  },
  clearSelectedSource(sourceType, sourceId) {
    const current = userDataRepository.getSelectedSources();
    if (sourceId && current[sourceType] !== sourceId) return current;
    const next = { ...current, [sourceType]: null };
    userDataRepository.saveSelectedSources(next);
    return next;
  },
  migrateContentIdentities(contents = []) {
    const contentMap = new Map();
    const episodeMap = new Map();
    contents.forEach(content => {
      if (!content?.contentId) return;
      for (const ref of content.sourceRefs ?? []) {
        const legacyContentId = createContentId(ref.sourceId, ref.sourceItemId);
        if (legacyContentId !== content.contentId) contentMap.set(legacyContentId, content.contentId);
      }
      (content.episodes ?? []).forEach(episode => {
        for (const contentRef of content.sourceRefs ?? []) {
          const legacyContentId = createContentId(contentRef.sourceId, contentRef.sourceItemId);
          for (const episodeRef of episode.sourceRefs ?? []) {
            const legacyEpisodeId = `episode:${legacyContentId}:${episodeRef.sourceId}:${episodeRef.sourceItemId}`;
            episodeMap.set(legacyEpisodeId, episode.episodeId);
          }
        }
      });
    });
    if (!contentMap.size) return false;
    const favorites = [...new Map(userDataRepository.getFavorites().map(item => {
      const targetId = contentMap.get(item.targetId) ?? item.targetId;
      return [userDataRepository.ids.createFavoriteId(item.targetType, targetId), { ...item, targetId, favoriteId: userDataRepository.ids.createFavoriteId(item.targetType, targetId) }];
    })).values()];
    const history = [...new Map(userDataRepository.getHistory().map(item => {
      if (!contentMap.has(item.targetId)) return [item.historyId, item];
      const targetId = contentMap.get(item.targetId);
      const episodeId = episodeMap.get(item.episodeId) ?? item.episodeId;
      return [userDataRepository.ids.createHistoryId(item.targetType, targetId, episodeId), { ...item, targetId, episodeId, historyId: userDataRepository.ids.createHistoryId(item.targetType, targetId, episodeId) }];
    })).values()];
    const progress = [...new Map(userDataRepository.getProgress().map(item => {
      if (!contentMap.has(item.contentId)) return [item.progressId, item];
      const contentId = contentMap.get(item.contentId);
      const episodeId = episodeMap.get(item.episodeId) ?? item.episodeId;
      return [userDataRepository.ids.createProgressId(contentId, episodeId), { ...item, contentId, episodeId, progressId: userDataRepository.ids.createProgressId(contentId, episodeId) }];
    })).values()];
    userDataRepository.saveFavorites(favorites);
    userDataRepository.saveHistory(history);
    userDataRepository.saveProgress(progress);
    return true;
  },
  touchFavorite(targetType, targetId) {
    const id = userDataRepository.ids.createFavoriteId(targetType, targetId);
    const current = userDataRepository.getFavorites();
    const next = current.map(item => item.favoriteId === id ? { ...item, lastAccessedAt: Date.now() } : item);
    if (next.some(item => item.favoriteId === id)) userDataRepository.saveFavorites(next);
    return next;
  },
  toggleLiveFavorite(channel, userOrder = null) {
    if (!channel?.channelId) return userDataRepository.getFavorites();
    const current = userDataRepository.getFavorites();
    const id = userDataRepository.ids.createFavoriteId('channel', channel.channelId);
    const exists = current.find(item => item.favoriteId === id);
    if (exists) {
      const next = current.filter(item => item.favoriteId !== id);
      userDataRepository.saveFavorites(next);
      return next;
    }
    const nextOrder = Number.isFinite(userOrder) ? userOrder : current.filter(item => item.targetType === 'channel').length;
    const item = {
      favoriteId: id,
      targetType: 'channel',
      targetId: channel.channelId,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      userOrder: nextOrder,
      sourceRefs: (channel.sourceRefs ?? []).map(ref => ({ ...ref })),
    };
    const next = [...current, item];
    userDataRepository.saveFavorites(next);
    return next;
  },
  toggleFavorite(targetType, targetId) {
    if (!targetType || targetId == null) return userDataRepository.getFavorites();
    const current = userDataRepository.getFavorites();
    const id = userDataRepository.ids.createFavoriteId(targetType, targetId);
    const exists = current.some(item => item.favoriteId === id);
    const next = exists ? current.filter(item => item.favoriteId !== id) : [...current, { favoriteId: id, targetType, targetId, createdAt: Date.now(), lastAccessedAt: Date.now() }];
    userDataRepository.saveFavorites(next);
    return next;
  },
  recordMoviePlay(content, episodeIndex = 0, sourceId = null) {
    const episode = content?.episodes?.[episodeIndex] ?? null;
    if (!content?.contentId) return userDataRepository.getHistory();
    const episodeId = episode?.episodeId ?? '';
    const sourceRef = (episode?.sourceRefs ?? []).find(ref => ref.sourceId === sourceId) ?? (content.sourceRefs ?? []).find(ref => ref.sourceId === sourceId) ?? episode?.sourceRefs?.[0] ?? content.sourceRefs?.[0] ?? {};
    const progress = userDataRepository.getProgress().find(item => item.contentId === content.contentId && item.episodeId === episodeId);
    const historyItem = {
      historyId: userDataRepository.ids.createHistoryId('content', content.contentId, episodeId),
      targetType: 'content',
      targetId: content.contentId,
      episodeId,
      sourceId: sourceRef.sourceId ?? null,
      sourceItemId: sourceRef.sourceItemId ?? null,
      lastPlayedAt: Date.now(),
      completed: Boolean(progress?.completed),
      positionSeconds: progress?.positionSeconds ?? 0,
      durationSeconds: progress?.durationSeconds ?? null,
    };
    const history = [historyItem, ...userDataRepository.getHistory().filter(item => item.historyId !== historyItem.historyId)].slice(0, 50);
    userDataRepository.saveHistory(history);
    return history;
  },
  recordLivePlay(channel, streamId = null) {
    if (!channel?.channelId) return userDataRepository.getHistory();
    const selectedStream = channel.streams?.find(stream => stream.streamId === streamId) ?? channel.streams?.[0] ?? null;
    const sourceId = selectedStream?.sourceId ?? channel.sourceRefs?.[0]?.sourceId ?? null;
    const sourceChannelId = selectedStream?.sourceChannelId ?? channel.sourceRefs?.[0]?.sourceChannelId ?? null;
    const historyItem = {
      historyId: userDataRepository.ids.createHistoryId('channel', channel.channelId),
      targetType: 'channel',
      targetId: channel.channelId,
      streamId: selectedStream?.streamId ?? null,
      sourceId,
      sourceChannelId,
      lastPlayedAt: Date.now(),
      completed: false,
    };
    const history = [historyItem, ...userDataRepository.getHistory().filter(item => item.historyId !== historyItem.historyId)].slice(0, 50);
    userDataRepository.saveHistory(history);
    return history;
  },
  recordProgress(contentId, episodeId, positionSeconds, durationSeconds = null, completed = false) {
    if (!contentId) return userDataRepository.getProgress();
    const current = userDataRepository.getProgress();
    const progressId = userDataRepository.ids.createProgressId(contentId, episodeId);
    const previous = current.find(item => item.progressId === progressId) ?? null;
    const position = Math.max(0, Number(positionSeconds) || 0);
    const duration = durationSeconds == null ? null : Math.max(0, Number(durationSeconds) || 0);
    const progressItem = { progressId, contentId, episodeId: episodeId ?? '', positionSeconds: position, durationSeconds: duration, updatedAt: Date.now(), completed: Boolean(completed) };
    if (!shouldWriteProgress(previous, progressItem)) return current;
    const progress = [progressItem, ...current.filter(item => item.progressId !== progressId)].slice(0, 100);
    userDataRepository.saveProgress(progress);
    const history = userDataRepository.getHistory().map(item =>
      item.targetType === 'content' && item.targetId === contentId && item.episodeId === (episodeId ?? '')
        ? { ...item, positionSeconds: position, durationSeconds: duration, completed: Boolean(completed), lastPlayedAt: Date.now() }
        : item
    );
    userDataRepository.saveHistory(history);
    return progress;
  },
  clearHistory() { userDataRepository.clearHistory(); return userDataRepository.getHistory(); },
  removeSearch(searchId) { const next = userDataRepository.getSearches().filter(item => item.searchId !== searchId); userDataRepository.saveSearches(next); return next; },
  clearSearches() { userDataRepository.saveSearches([]); return []; },
  recordSearch(keyword) {
    const clean = String(keyword ?? '').trim();
    if (!clean) return userDataRepository.getSearches();
    const existing = userDataRepository.getSearches().find(item => item.keyword.toLowerCase() === clean.toLowerCase());
    const nextItem = { searchId: userDataRepository.ids.createSearchId(clean), keyword: clean, searchedAt: Date.now(), count: (existing?.count ?? 0) + 1 };
    const searches = [nextItem, ...userDataRepository.getSearches().filter(item => item.searchId !== nextItem.searchId)].slice(0, 20);
    userDataRepository.saveSearches(searches);
    return searches;
  },
  clearUserData() { userDataRepository.clearUserData(); return this.getSnapshot(); },
};
