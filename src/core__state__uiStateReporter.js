import { sessionStateStore } from './core__state__sessionStateStore.js';

const STORAGE_KEY = 'mybox.ui-state.v1';
const CHANGE_EVENT = 'mybox:ui-state-change';
const PAGE_LABELS = Object.freeze({
  home: '首页',
  movies: '影视',
  'movie-detail': '影视详情',
  'movie-search': '影视搜索',
  'movie-playback': '影视播放',
  live: 'Live 直播主界面',
  'live-channel': '直播选台详情',
  'live-playback': '直播播放页',
  favorites: '收藏',
  me: '我的',
  settings: '设置与管理',
});
const ROUTE_PAGES = Object.freeze({
  detail: 'movie-detail',
  search: 'movie-search',
  'movie-play': 'movie-playback',
  'live-channel': 'live-channel',
  'live-play': 'live-playback',
  sources: 'settings',
  settings: 'settings',
  appearance: 'settings',
  'data-management': 'settings',
  history: 'settings',
  'search-history': 'settings',
});
const VIDEO_EVENTS = ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'pause', 'waiting', 'stalled', 'seeking', 'seeked', 'ended', 'error'];
const listeners = new Set();
let started = false;
let snapshot = null;
let observer = null;
let scheduledTimer = null;
const boundVideos = new Map();

function cleanLabel(value, limit = 120) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || /^https?:\/\//i.test(text)) return '';
  return text.slice(0, limit);
}

function isVisible(element) {
  if (!element || element.hidden || element.closest?.('[hidden]')) return false;
  if (typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}

function firstVisibleText(selectors) {
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (!isVisible(element)) continue;
      const label = cleanLabel(element.innerText || element.textContent);
      if (label) return label;
    }
  }
  return '';
}

function currentPlayerWindow() {
  const windows = [...document.querySelectorAll('.sangtian-window')];
  return windows.find(isVisible) || windows[0] || null;
}

function findCurrentVideo(playerWindow) {
  const videos = [...(playerWindow || document).querySelectorAll('video')];
  return videos.find(video => isVisible(video) && (video.currentSrc || video.src || video.readyState > 0))
    || videos.find(isVisible)
    || videos[0]
    || null;
}

function readPlayerState(video) {
  if (!video) return 'idle';
  if (video.error) return 'error';
  if (video.ended) return 'ended';
  if (video.seeking) return 'seeking';
  if (video.paused) return (video.currentSrc || video.src || video.readyState > 0) ? 'paused' : 'idle';
  if (video.readyState < 3) return 'buffering';
  return 'playing';
}

function detectActivePanel(playerWindow) {
  const candidates = [
    ['channel-picker', '.live-immersive-menu-sheet.is-channel-picker'],
    ['playback-menu', '.live-immersive-menu-sheet'],
    ['aspect-settings', '.aspect-settings-sheet'],
    ['quick-aspect', '.live-mini-aspect-picker'],
    ['channel-drawer', '.sangtian-fullscreen-left-sidebar'],
    ['playback-sidebar', '.sangtian-fullscreen-right-sidebar'],
    ['source-picker', '.source-selector-popover'],
    ['dialog', '[role="dialog"]'],
  ];
  for (const [name, selector] of candidates) {
    const nodes = [...(playerWindow || document).querySelectorAll(selector)];
    if (nodes.some(isVisible)) return name;
  }
  const dialogs = [...document.querySelectorAll('[role="dialog"]')];
  if (dialogs.some(isVisible)) return 'dialog';
  return '';
}

function makeSnapshot() {
  const session = sessionStateStore.getSnapshot() || {};
  const tab = cleanLabel(session.tab || 'home', 32) || 'home';
  const route = cleanLabel(session.route || '', 48);
  const currentPage = ROUTE_PAGES[route] || (PAGE_LABELS[tab] ? tab : 'home');
  const playerWindow = currentPlayerWindow();
  const immersive = Boolean(playerWindow?.classList.contains('is-immersive'));
  const fullscreen = Boolean(
    document.fullscreenElement
    || playerWindow?.classList.contains('is-system-fullscreen')
    || playerWindow?.classList.contains('is-web-fullscreen')
  );
  const displayMode = fullscreen ? 'fullscreen' : immersive ? 'immersive' : 'embedded';
  const video = findCurrentVideo(playerWindow);
  const isLive = Boolean(playerWindow?.classList.contains('is-live-direct')) || tab === 'live';
  const currentChannel = isLive ? firstVisibleText([
    '.live-fullscreen-channel-name',
    '.live-channel-title-center',
    '.live-channel-name',
  ]) : '';
  const selected = session.selected;
  const selectedTitle = currentChannel || cleanLabel(
    selected?.metadata?.title
      || selected?.metadata?.episodeTitle
      || selected?.title
      || selected?.name
      || selected?.metadata?.movie?.title
      || '',
  );
  const activePanel = detectActivePanel(playerWindow);
  const menuOpen = Boolean(
    playerWindow?.classList.contains('is-menu-open')
    || (playerWindow && [...playerWindow.querySelectorAll('.live-immersive-menu-sheet')].some(isVisible)),
  );
  const overlayOpen = Boolean(activePanel || (playerWindow && [
    '.live-immersive-menu-sheet', '.aspect-settings-sheet', '.live-mini-aspect-picker',
    '.sangtian-fullscreen-left-sidebar', '.sangtian-fullscreen-right-sidebar',
  ].some(selector => [...playerWindow.querySelectorAll(selector)].some(isVisible))));
  const controls = playerWindow?.querySelector('.live-playback-nav, .sangtian-player-controls, .sangtian-window-bar');
  let controlsVisible = false;
  if (controls && isVisible(controls)) {
    const style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(controls) : null;
    controlsVisible = !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0');
  }
  const isAndroidWebView = Boolean(window.MyBoxUiStateBridge || window.Capacitor?.isNativePlatform?.());

  return {
    schemaVersion: 1,
    appId: 'com.yuivo9999.mybox123',
    runtime: isAndroidWebView ? 'android-webview' : 'web',
    currentPage,
    pageName: PAGE_LABELS[currentPage] || '未知页面',
    tab,
    route,
    displayMode,
    fullscreen,
    immersive,
    playerKind: video ? 'html5' : 'none',
    playerState: readPlayerState(video),
    selectedTitle,
    currentChannel,
    menuOpen,
    overlayOpen,
    activePanel,
    controlsVisible,
    documentVisibility: document.visibilityState || 'unknown',
    appLifecycle: document.visibilityState === 'hidden' ? 'background' : 'foreground',
    viewportWidth: Math.max(0, Math.round(window.innerWidth || document.documentElement?.clientWidth || 0)),
    viewportHeight: Math.max(0, Math.round(window.innerHeight || document.documentElement?.clientHeight || 0)),
    updatedAt: new Date().toISOString(),
  };
}

function emit() {
  const value = getSnapshot();
  listeners.forEach(listener => {
    try { listener(value); } catch { /* External observers must not interrupt state reporting. */ }
  });
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: value }));
  } catch { /* CustomEvent may be unavailable in restricted test runtimes. */ }
}

function persist(snapshotValue) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotValue)); } catch { /* Storage is optional. */ }
  try {
    if (typeof window.MyBoxUiStateBridge?.update === 'function') {
      window.MyBoxUiStateBridge.update(JSON.stringify(snapshotValue));
    }
  } catch { /* The Web-only runtime has no native bridge. */ }
}

function updateSnapshot(force = false) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const next = makeSnapshot();
  if (!force && snapshot) {
    const previousCore = { ...snapshot };
    const nextCore = { ...next };
    delete previousCore.updatedAt;
    delete nextCore.updatedAt;
    if (JSON.stringify(previousCore) === JSON.stringify(nextCore)) return;
  }
  snapshot = Object.freeze(next);
  persist(snapshot);
  emit();
}

function scheduleUpdate() {
  if (scheduledTimer !== null) window.clearTimeout(scheduledTimer);
  scheduledTimer = window.setTimeout(() => {
    scheduledTimer = null;
    updateSnapshot();
  }, 45);
}

function syncVideoListeners() {
  const currentVideos = new Set(document.querySelectorAll('video'));
  for (const [video, handler] of boundVideos) {
    if (currentVideos.has(video)) continue;
    VIDEO_EVENTS.forEach(eventName => video.removeEventListener(eventName, handler));
    boundVideos.delete(video);
  }
  for (const video of currentVideos) {
    if (boundVideos.has(video)) continue;
    const handler = scheduleUpdate;
    VIDEO_EVENTS.forEach(eventName => video.addEventListener(eventName, handler));
    boundVideos.set(video, handler);
  }
}

export function getMyBoxUIState() {
  return snapshot ? { ...snapshot } : null;
}

export function startUiStateReporter() {
  if (started || typeof window === 'undefined' || typeof document === 'undefined') return;
  started = true;
  window.MyBoxUIState = Object.freeze({
    version: 1,
    getSnapshot: getMyBoxUIState,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh: scheduleUpdate,
  });

  sessionStateStore.subscribe(scheduleUpdate);
  document.addEventListener('fullscreenchange', scheduleUpdate);
  document.addEventListener('visibilitychange', scheduleUpdate);
  window.addEventListener('resize', scheduleUpdate);
  window.addEventListener('pageshow', scheduleUpdate);
  window.addEventListener('pagehide', scheduleUpdate);
  window.addEventListener('online', scheduleUpdate);
  window.addEventListener('offline', scheduleUpdate);

  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    observer = new MutationObserver(() => {
      syncVideoListeners();
      scheduleUpdate();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-expanded', 'aria-hidden', 'role'],
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
  syncVideoListeners();
  updateSnapshot(true);
}
