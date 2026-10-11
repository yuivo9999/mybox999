import { useSyncExternalStore } from 'react';
import { sessionStateStore } from './core__state__sessionStateStore.js';

export function useSessionState() {
  return useSyncExternalStore(
    sessionStateStore.subscribe,
    sessionStateStore.getSnapshot,
    sessionStateStore.getSnapshot,
  );
}
