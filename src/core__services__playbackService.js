import {
  PlaybackFailureCode,
  PlaybackKind,
  PlaybackRequestStatus,
  createPlaybackRequest,
  normalizePlaybackCandidate,
  isPlaybackCandidateExpired,
} from './core__models__playback.js';
import { createPlaybackCore } from './core__playback__playbackCore.js';
import { createPlaybackLifecyclePolicy } from './core__playback__playbackLifecyclePolicy.js';

function sortCandidates(candidates) {
  return [...candidates].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

function normalizeCandidatePlayerHint(playerHint) {
  if (!playerHint || typeof playerHint !== 'object') return undefined;
  const next = { ...playerHint };
  // Decoder engine/mode is an application-level preference, not a source-level
  // property. Explicit player UI selections are re-injected after this step.
  delete next.engine;
  delete next.decoder;
  return next;
}

function isSupportedVODCandidate(candidate) {
  const capability = String(candidate?.metadata?.sourceCapability || '').trim();
  const adapterType = String(candidate?.metadata?.adapterType || '').trim();
  if (!capability && !adapterType) return true;
  return (capability === 'direct-http-vod' && adapterType === 'http-vod')
    || capability === 'tvbox-jar'
    || capability === 'tvbox-http-vod-with-jar';
}

export const playbackService = {
  getVODCandidates({ content, episode, episodeIndex = 0, preferredSource = null } = {}) {
    if (!content || !episode) return [];
    let rawCandidates = Array.isArray(episode.playbackCandidates) && episode.playbackCandidates.length > 0
      ? episode.playbackCandidates
      : [];

    if (!rawCandidates.length) {
      const url = episode.playUrl || episode.url || episode.mediaUrl;
      if (url) {
        rawCandidates = [{
          mediaUrl: url,
          label: episode.label || '默认线路',
          sourceId: episode.sourceId || content.sourceId || content.sourceRefs?.[0]?.sourceId || '',
        }];
      } else if (Array.isArray(content.playbackCandidates) && content.playbackCandidates.length > 0) {
        rawCandidates = content.playbackCandidates;
      }
    }

    return sortCandidates(rawCandidates.filter(isSupportedVODCandidate).map((candidate, index) => normalizePlaybackCandidate({
      ...candidate,
      kind: PlaybackKind.VOD,
      contentId: candidate.contentId ?? content.contentId,
      episodeId: candidate.episodeId ?? episode.episodeId,
      sourceId: candidate.sourceId ?? episode.sourceRefs?.[0]?.sourceId ?? content.sourceRefs?.[0]?.sourceId,
      priority: (candidate.priority ?? -index) + (preferredSource && candidate.sourceId === preferredSource ? 100000 : 0),
      playerHint: normalizeCandidatePlayerHint(candidate.playerHint),
    })));
  },

  getLiveCandidates(channel) {
    if (!channel) return [];
    return (channel.streams ?? []).map((stream, index) => normalizePlaybackCandidate({
      ...stream,
      mediaUrl: stream.mediaUrl ?? stream.url,
      kind: PlaybackKind.LIVE,
      channelId: channel.channelId,
      sourceId: stream.sourceId ?? channel.sourceRefs?.[0]?.sourceId,
      streamId: stream.streamId || `stream-${channel.channelId}-${index + 1}`,
      priority: Number.isFinite(stream.priority) ? stream.priority : -index,
      metadata: { channelName: channel.name, streamIndex: index, label: stream.label || `线路 ${index + 1}`, ...(stream.metadata ?? {}) },
      playerHint: { ...normalizeCandidatePlayerHint(stream.playerHint), autoplay: true },
    }));
  },

  createVODRequest({ content, episode, episodeIndex = 0, preferredSource = null, metadata } = {}) {
    return createPlaybackRequest({
      kind: PlaybackKind.VOD,
      contentId: content?.contentId,
      episodeId: episode?.episodeId,
      candidates: this.getVODCandidates({ content, episode, episodeIndex, preferredSource }),
      metadata: { episodeIndex, episodes: content?.episodes?.map((item) => ({ episodeId: item.episodeId, title: item.title })) ?? [], ...(metadata ?? {}) },
    });
  },

  createLiveRequest({ channel, preferredSource = null, metadata } = {}) {
    const rawCandidates = this.getLiveCandidates(channel);
    const candidates = preferredSource
      ? [...rawCandidates].sort((a, b) => (a.sourceId === preferredSource ? -1 : 0) - (b.sourceId === preferredSource ? -1 : 0))
      : rawCandidates;
    return createPlaybackRequest({
      kind: PlaybackKind.LIVE,
      channelId: channel?.channelId,
      candidates,
      metadata,
    });
  },

  createTask(request) {
    return createPlaybackTask(request);
  },

  createController(request, hooks = {}) {
    const task = createPlaybackTask(request);
    const core = createPlaybackCore(task, hooks);
    const policy = createPlaybackLifecyclePolicy({ kind: request?.kind });
    return Object.freeze({
      policy,
      attachPlayer: element => core.attachPlayer(element),
      start: () => core.start(),
      resolveAndLoad: (candidate, options) => core.resolveAndLoad(candidate, options),
      subscribe: listener => core.subscribe(listener),
      switchCandidate: id => core.switchCandidate(id),
      switchEpisode: (...args) => core.switchEpisode(...args),
      pause: () => core.pause(),
      play: () => core.play(),
      seek: seconds => core.seek(seconds),
      setPlaybackRate: rate => core.setPlaybackRate?.(rate),
      setVolume: volume => core.setVolume(volume),
      getAudioTracks: () => core.getAudioTracks(),
      getSubtitleTracks: () => core.getSubtitleTracks(),
      selectAudioTrack: id => core.selectAudioTrack(id),
      selectSubtitleTrack: id => core.selectSubtitleTrack(id),
      getQualities: () => core.getQualities(),
      selectQuality: id => core.selectQuality(id),
      stop: () => core.stop(),
      handleAppState: state => core.handleAppState(state),
      leave: () => {
        if (policy.onPageLeave === 'release') core.release();
        else core.stop();
      },
    });
  },
};

export function createPlaybackTask(request = {}) {
  const candidates = Array.isArray(request?.candidates) ? request.candidates : [];
  const snapshot = Object.freeze({
    ...request,
    candidates: candidates.map((candidate) => Object.freeze({
      ...candidate,
      headers: Object.freeze({ ...candidate?.headers }),
      metadata: Object.freeze({ ...candidate?.metadata }),
    })),
  });
  let status = PlaybackRequestStatus.CREATED;
  let currentIndex = 0;
  let retryCount = 0;
  let failureCount = 0;
  let currentCandidateId = snapshot.candidates[0]?.candidateId ?? null;
  const failedCandidates = new Set();
  const listeners = new Set();

  const emit = (event, data = {}) => {
    const payload = { event, requestId: snapshot.requestId, taskId: snapshot.taskId, ...data };
    listeners.forEach((listener) => listener(payload));
    return payload;
  };

  const current = () => snapshot.candidates[currentIndex] ?? null;
  const markFailed = (candidateId, error, code = PlaybackFailureCode.UNKNOWN) => {
    if (candidateId) failedCandidates.add(candidateId);
    failureCount += 1;
    status = PlaybackRequestStatus.FAILED;
    retryCount = 0;
    emit('error', {
      candidateId,
      code,
      error: error instanceof Error ? error.message : String(error ?? ''),
      failureCount,
    });
  };

  const next = () => {
    for (let index = currentIndex + 1; index < snapshot.candidates.length; index += 1) {
      if (!failedCandidates.has(snapshot.candidates[index].candidateId) && !isPlaybackCandidateExpired(snapshot.candidates[index])) {
        currentIndex = index;
        currentCandidateId = snapshot.candidates[index].candidateId;
        status = PlaybackRequestStatus.LOADING;
        retryCount = 0;
        emit('sourceChanged', { candidate: current() });
        return current();
      }
    }
    return null;
  };

  return {
    request: snapshot,
    get status() { return status; },
    get currentCandidate() { return current(); },
    get currentCandidateId() { return currentCandidateId; },
    get retryCount() { return retryCount; },
    get failureCount() { return failureCount; },
    get failedCandidateIds() { return [...failedCandidates]; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start() {
      if (status === PlaybackRequestStatus.RELEASED) throw new Error('PLAYBACK_TASK_RELEASED');
      if (current() && isPlaybackCandidateExpired(current())) {
        markFailed(currentCandidateId, 'PLAYBACK_CANDIDATE_EXPIRED', PlaybackFailureCode.EXPIRED);
        const nextCandidate = next();
        if (nextCandidate) return nextCandidate;
      }
      status = PlaybackRequestStatus.LOADING;
      emit('loading', { candidate: current() });
      return current();
    },
    markPlaying() {
      if (!current()) return null;
      status = PlaybackRequestStatus.PLAYING;
      emit('playing', { candidate: current() });
      return current();
    },
    retry({ maxRetries = 2 } = {}) {
      if (!current() || retryCount >= maxRetries || isPlaybackCandidateExpired(current())) return null;
      retryCount += 1;
      status = PlaybackRequestStatus.LOADING;
      emit('retry', { candidate: current(), retryCount, maxRetries });
      return current();
    },
    fail(error, code = PlaybackFailureCode.UNKNOWN) {
      markFailed(currentCandidateId, error, code);
      return next();
    },
    switchCandidate(candidateId) {
      const index = snapshot.candidates.findIndex((candidate) => candidate.candidateId === candidateId);
      if (index < 0) return null;
      failedCandidates.delete(candidateId);
      currentIndex = index;
      currentCandidateId = candidateId;
      retryCount = 0;
      status = PlaybackRequestStatus.LOADING;
      emit('sourceChanged', { candidate: current() });
      return current();
    },
    stop() {
      if (status === PlaybackRequestStatus.RELEASED) return;
      status = PlaybackRequestStatus.STOPPED;
      emit('stopped', { candidate: current() });
    },
    release() {
      if (status === PlaybackRequestStatus.RELEASED) return;
      status = PlaybackRequestStatus.RELEASED;
      emit('released', { candidateId: currentCandidateId });
      listeners.clear();
    },
  };
}
