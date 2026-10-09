const STANDARD_EVENTS = Object.freeze({
  loading: 'PLAYBACK_LOADING',
  parsing: 'PLAYBACK_PARSING',
  prepared: 'PLAYBACK_READY',
  playing: 'PLAYBACK_PLAYING',
  paused: 'PLAYBACK_PAUSED',
  buffering: 'PLAYBACK_BUFFERING',
  bufferingStart: 'PLAYBACK_BUFFERING',
  bufferingEnd: 'PLAYBACK_BUFFERING',
  reconnecting: 'PLAYBACK_RETRYING',
  retry: 'PLAYBACK_RETRYING',
  sourceChanged: 'PLAYBACK_SWITCHING_SOURCE',
  error: 'PLAYBACK_ERROR',
  completed: 'PLAYBACK_COMPLETED',
  released: 'PLAYBACK_RELEASED',
  stopped: 'PLAYBACK_STOPPED',
  created: 'PLAYBACK_CREATED',
});

export function toStandardPlaybackEvent(event) {
  if (!event) return null;
  return STANDARD_EVENTS[event.event] ?? null;
}

export function normalizePlaybackEvent(event) {
  const standardEvent = toStandardPlaybackEvent(event);
  return standardEvent ? Object.freeze({ ...event, standardEvent }) : event;
}

export { STANDARD_EVENTS };
