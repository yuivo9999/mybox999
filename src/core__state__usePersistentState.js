import { useSyncExternalStore } from 'react';
import { persistentStateStore } from './core__state__persistentStateStore.js';

export function usePersistentState() {
  const snapshot = useSyncExternalStore(
    persistentStateStore.subscribe,
    persistentStateStore.getSnapshot,
    persistentStateStore.getSnapshot,
  );
  return {
    ...snapshot,
    reload: persistentStateStore.reload,
    toggleFavorite: persistentStateStore.toggleFavorite,
    touchFavorite: persistentStateStore.touchFavorite,
    recordMoviePlay: persistentStateStore.recordMoviePlay,
    recordLivePlay: persistentStateStore.recordLivePlay,
    recordProgress: persistentStateStore.recordProgress,
    recordSearch: persistentStateStore.recordSearch,
    clearHistory: persistentStateStore.clearHistory,
    removeSearch: persistentStateStore.removeSearch,
    clearSearches: persistentStateStore.clearSearches,
    clearUserData: persistentStateStore.clearUserData,
    clearCache: persistentStateStore.clearCache,
    saveSettings: persistentStateStore.saveSettings,
    updateSettings: persistentStateStore.updateSettings,
  };
}
