export const PlayerCapability = Object.freeze({
  SEEK:'seek', VOLUME:'volume', PAUSE:'pause', AUTOPLAY:'autoplay',
  HLS:'hls', DASH:'dash', MP4:'mp4', TS:'ts', FLV:'flv', RTMP:'rtmp', RTSP:'rtsp',
  AUDIO_TRACKS:'audioTracks', SUBTITLE_TRACKS:'subtitleTracks',
  TRACK_SELECTION:'trackSelection', QUALITY_SELECTION:'qualitySelection',
  CUSTOM_HEADERS:'customHeaders', COOKIES:'cookies', LIVE_RECONNECT:'liveReconnect',
});

export const PlayerState = Object.freeze({
  IDLE:'idle', LOADING:'loading', PREPARING:'preparing', PLAYING:'playing',
  PAUSED:'paused', BUFFERING:'buffering', RECONNECTING:'reconnecting',
  COMPLETED:'completed', ERROR:'error', STOPPED:'stopped', RELEASED:'released',
});

export function createPlayerCapabilities(video) {
  const canPlay = (type) => { try { return Boolean(video?.canPlayType?.(type)); } catch { return false; } };
  return Object.freeze({
    [PlayerCapability.SEEK]: true, [PlayerCapability.VOLUME]: true, [PlayerCapability.PAUSE]: true,
    [PlayerCapability.AUTOPLAY]: true,
    [PlayerCapability.HLS]: canPlay('application/vnd.apple.mpegurl') || canPlay('application/x-mpegURL'),
    [PlayerCapability.DASH]: canPlay('application/dash+xml'),
    [PlayerCapability.MP4]: canPlay('video/mp4'), [PlayerCapability.TS]: canPlay('video/mp2t'),
    [PlayerCapability.FLV]: canPlay('video/x-flv'),
    [PlayerCapability.RTMP]: false, [PlayerCapability.RTSP]: false,
    [PlayerCapability.AUDIO_TRACKS]: Boolean(video?.audioTracks),
    [PlayerCapability.SUBTITLE_TRACKS]: Boolean(video?.textTracks),
    [PlayerCapability.TRACK_SELECTION]: Boolean(video?.audioTracks || video?.textTracks),
    [PlayerCapability.QUALITY_SELECTION]: false,
    [PlayerCapability.CUSTOM_HEADERS]: false,
    [PlayerCapability.COOKIES]: typeof document !== 'undefined',
    [PlayerCapability.LIVE_RECONNECT]: true,
  });
}

export function createPlayerAdapterContract(adapter) {
  const required=['load','prepare','play','pause','seek','stop','setVolume','getState','release'];
  for (const method of required) if (typeof adapter?.[method] !== 'function') throw new Error(`PLAYER_ADAPTER_METHOD_REQUIRED:${method}`);
  return adapter;
}
