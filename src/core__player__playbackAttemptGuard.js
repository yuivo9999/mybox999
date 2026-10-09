/**
 * Guards asynchronous callbacks belonging to a specific playback strategy.
 * Starting a new strategy or invalidating the current load makes old callbacks stale.
 */
export function createPlaybackAttemptGuard() {
  let sequence = 0;
  let activeAttemptId = null;

  return {
    begin() {
      activeAttemptId = ++sequence;
      return activeAttemptId;
    },
    invalidate() {
      sequence += 1;
      activeAttemptId = null;
      return null;
    },
    isCurrent(attemptId) {
      return attemptId !== null && attemptId !== undefined && attemptId === activeAttemptId;
    },
    get currentAttemptId() {
      return activeAttemptId;
    },
  };
}
