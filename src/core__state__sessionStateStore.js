const listeners = new Set();
let snapshot = Object.freeze({
  tab: 'home',
  route: null,
  selected: null,
});

function emit() {
  listeners.forEach((listener) => listener());
}

export const sessionStateStore = {
  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot() {
    return snapshot;
  },
  patch(patch) {
    snapshot = Object.freeze({ ...snapshot, ...patch });
    emit();
    return snapshot;
  },
  reset() {
    snapshot = Object.freeze({ tab: 'home', route: null, selected: null });
    emit();
    return snapshot;
  },
};
