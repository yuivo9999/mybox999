// Live data-source contract

export function createLiveDataSource({ fetchChannels }) {
  if (typeof fetchChannels !== 'function') throw new TypeError('fetchChannels must be a function');
  return Object.freeze({ fetchChannels });
}


// Same-channel next-line fallback policy

/**
 * Find the next unattempted line in the same channel.
 * Deliberately does not wrap to index 0: automatic fallback must not create a retry loop.
 */
export function findNextLiveStreamIndex(currentIndex, streamCount, attemptedIndices = new Set()) {
  const count = Number.isFinite(Number(streamCount)) ? Math.max(0, Math.floor(Number(streamCount))) : 0;
  const current = Number.isFinite(Number(currentIndex)) ? Math.floor(Number(currentIndex)) : -1;
  for (let index = Math.max(0, current + 1); index < count; index += 1) {
    if (!attemptedIndices.has(index)) return index;
  }
  return -1;
}
