import { PlaybackKind } from './core__models__playback.js';

export function createPlaybackLifecyclePolicy({ kind } = {}) {
  const playbackKind = kind ?? PlaybackKind.VOD;

  return Object.freeze({
    onPageLeave: playbackKind === PlaybackKind.LIVE ? 'release' : 'release',
    onBackground: playbackKind === PlaybackKind.LIVE ? 'pause' : 'pause',
    shouldReleaseOnLeave: true,
  });
}
