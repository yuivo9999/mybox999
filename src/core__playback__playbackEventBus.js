export function createPlaybackEventBus() {
  const listeners = new Set();

  return {
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      listeners.forEach((listener) => listener(event));
      return event;
    },
    clear() {
      listeners.clear();
    },
  };
}
