// Android-style horizontal navigation contract shared by the whole React shell.
// Top-level tabs behave like an Android pager: left -> next tab, right -> previous tab.
// Child routes behave like a native back stack: right -> parent. Vertical gestures are ignored.
export const TOP_LEVEL_TABS = Object.freeze(['home', 'movies', 'live', 'favorites', 'me']);

export const TAB_PARENT = Object.freeze({
  sources: 'me',
  settings: 'me',
  appearance: 'settings',
  'data-management': 'me',
  history: 'me',
  'search-history': 'me',
  about: 'me',
});

export function getTopLevelSwipeTarget(tab, direction) {
  const index = TOP_LEVEL_TABS.indexOf(tab);
  if (index < 0) return null;
  const nextIndex = direction === 'left' ? index + 1 : index - 1;
  return TOP_LEVEL_TABS[nextIndex] ?? null;
}

export function getGestureDirection(dx, dy, { threshold = 72, ratio = 1.25 } = {}) {
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * ratio) return null;
  return dx < 0 ? 'left' : 'right';
}

export function isSwipeExcludedTarget(target) {
  return target instanceof Element && Boolean(target.closest(
    'input,textarea,select,button,[contenteditable="true"],[data-swipe-ignore="true"],[data-horizontal-scroll="true"],.movie-carousel,.movie-carousel-card'
  ));
}

export function getParentForRoute({ tab, route, selected }) {
  if (route === 'movie-play') return selected?.metadata?.returnRoute || 'detail';
  if (route === 'detail') return null;
  if (route === 'search') return null;
  if (route === 'live-play') return 'live-channel';
  if (route === 'live-channel') return null;
  return TAB_PARENT[tab] ?? null;
}
