import { createFavoriteId, createHistoryId, createProgressId, createSearchId, emptyUserData } from './core__models__userData.js';
import { storage } from './core__storage__storage.js';
import { migrateLegacyData } from './core__storage__migration.js';
migrateLegacyData();
const loadList = (key) => storage.read(key, []);
export const userDataRepository = {
  getFavorites: () => loadList('favorites'), saveFavorites: (items) => storage.write('favorites', items),
  getHistory: () => loadList('history'), saveHistory: (items) => storage.write('history', items),
  getProgress: () => loadList('progress'), saveProgress: (items) => storage.write('progress', items),
  getSearches: () => loadList('searches'), saveSearches: (items) => storage.write('searches', items),
  getSettings: () => storage.read('settings', {}), saveSettings: (value) => storage.write('settings', value),
  getSelectedSources: () => storage.read('selectedSources', emptyUserData().selectedSources), saveSelectedSources: (value) => storage.write('selectedSources', value),
  getMigrationState: () => storage.read('migration:legacy-v2', null),
  clearHistory: () => { storage.write('history', []); storage.write('progress', []); },
  clearUserData: () => { storage.write('favorites', []); storage.write('history', []); storage.write('progress', []); storage.write('searches', []); },
  ids: { createFavoriteId, createHistoryId, createProgressId, createSearchId },
};
