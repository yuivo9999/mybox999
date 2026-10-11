import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'tvbox-react.page-state.v1';
const DEFAULTS = Object.freeze({
  home: { scrollTop: 0 },
  movies: { category: '全部', page: 1, pageSize: 50, filters: {}, sort: 'default', query: '', scrollTop: 0 },
  search: { query: '', scrollTop: 0 },
  live: { category: '全部', scrollTop: 0 },
});
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function load() {
  if (typeof localStorage === 'undefined') return clone(DEFAULTS);
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? { ...clone(DEFAULTS), ...JSON.parse(raw) } : clone(DEFAULTS); }
  catch { return clone(DEFAULTS); }
}
let snapshot = Object.freeze(load());
const listeners = new Set();
function persist() { try { localStorage?.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch {} }
function emit() { listeners.forEach((listener) => listener()); }
export const pageStateStore = {
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  getSnapshot() { return snapshot; },
  patch(page, patch) {
    if (!DEFAULTS[page]) return snapshot;
    snapshot = Object.freeze({ ...snapshot, [page]: Object.freeze({ ...snapshot[page], ...(patch ?? {}) }) });
    persist(); emit(); return snapshot;
  },
  reset(page) {
    snapshot = Object.freeze(page && DEFAULTS[page] ? { ...snapshot, [page]: Object.freeze(clone(DEFAULTS[page])) } : clone(DEFAULTS));
    persist(); emit(); return snapshot;
  },
};
export function usePageState() {
  return useSyncExternalStore(pageStateStore.subscribe, pageStateStore.getSnapshot, pageStateStore.getSnapshot);
}
