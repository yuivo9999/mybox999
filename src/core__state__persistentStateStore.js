import { userDataService } from './me/userDataService.js';
import { cacheService } from './core__services__cacheService.js';
import { sourceConfigService } from './me/sourceManagement.js';

const listeners = new Set();
let snapshot = null;

function buildSnapshot() {
  const user = userDataService.getSnapshot();
  return Object.freeze({
    favorites: user.favorites,
    history: user.history,
    progress: user.progress,
    searches: user.searches,
    settings: user.settings,
    selectedSources: user.selectedSources,
    migration: user.migration,
    sources: sourceConfigService.read(),
  });
}

function refresh() {
  snapshot = buildSnapshot();
  listeners.forEach((listener) => listener());
  return snapshot;
}

function getSnapshot() {
  if (!snapshot) snapshot = buildSnapshot();
  return snapshot;
}

export const persistentStateStore = {
  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot,
  reload: refresh,
  toggleFavorite(targetType, targetId) { userDataService.toggleFavorite(targetType, targetId); return refresh(); },
  touchFavorite(targetType, targetId) { userDataService.touchFavorite(targetType, targetId); return refresh(); },
  recordMoviePlay(movie, episodeIndex = 0, sourceId = null) { userDataService.recordMoviePlay(movie, episodeIndex, sourceId); return refresh(); },
  recordLivePlay(channel, streamId = null) { userDataService.recordLivePlay(channel, streamId); return refresh(); },
  recordProgress(contentId, episodeId, positionSeconds, durationSeconds = null, completed = false) {
    userDataService.recordProgress(contentId, episodeId, positionSeconds, durationSeconds, completed);
    return refresh();
  },
  recordSearch(keyword) { userDataService.recordSearch(keyword); return refresh(); },
  clearHistory() { userDataService.clearHistory(); return refresh(); },
  removeSearch(searchId) { userDataService.removeSearch(searchId); return refresh(); },
  clearSearches() { userDataService.clearSearches(); return refresh(); },
  clearUserData() { userDataService.clearUserData(); return refresh(); },
  clearCache() { return cacheService.clearAll(); },
  saveSettings(settings) { userDataService.saveSettings(settings); return refresh(); },
  updateSettings(patch) { userDataService.updateSettings(patch); return refresh(); },
};
