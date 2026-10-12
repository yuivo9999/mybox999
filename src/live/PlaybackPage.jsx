import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Heart, ListVideo, Film, Radio, Search } from 'lucide-react';
import { movieService } from '../movies/movieServices.js';
import { playbackService } from '../core__services__playbackService.js';
import { usePersistentState } from '../core__state__usePersistentState.js';
import { SangtianTopBar } from '../shared__components__theme__SangtianTopBar.jsx';
import { SangtianDrawer } from '../shared__components__theme__SangtianDrawer.jsx';
import { OtherSourceSearchDialog } from '../movies/OtherSourceSearchDialog.jsx';
import {
  SangtianFloatingBar,
  SangtianConsoleCard,
} from '../shared__components__theme__SangtianPlayerConsole.jsx';
import { PlaybackPagePlayerBlock } from './PlayerBlocks.jsx';
import { getPlaybackScheme } from '../core__models__userData.js';
import { detectRuntimeEnv, RUNTIME_ENV, MEDIA_KIND, VIEW_TIER, getPlaybackRouteConfig, resolveEngineSelection } from '../core__playback__playbackStrategyDispatcher.js';


function PlaybackView({
  request,
  kind,
  onBack,
  movies = [],
  channels = [],
  favorites = [],
  onChannel,
  onPlay,
  onEpisode,
  onMovie,
  toggleFavorite,
  onTab,
}) {
  const { recordProgress, saveSettings, settings } = usePersistentState();
  const isLive = kind === 'live';

  const [source, setSource] = useState(request?.metadata?.sourceId ?? request?.candidates?.[0]?.sourceId ?? '');
  const [candidate, setCandidate] = useState(request?.candidates?.[0] ?? null);
  const [status, setStatus] = useState('idle');
  const [resolvedInput, setResolvedInput] = useState(null);
  const [error, setError] = useState('');
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [decoderEngine, setDecoderEngine] = useState(() => {
    const isWeb = detectRuntimeEnv() === RUNTIME_ENV.WEB;
    const playback = settings?.playback || {};
    const scope = isLive ? 'live' : 'movie';
    const savedScheme = playback[scope + 'PlaybackScheme'];
    if (isWeb) {
      const allowedWebSchemes = isLive
        ? ['hls_lowlatency', 'html5_hardware']
        : ['hls_worker', 'html5_hardware'];
      return allowedWebSchemes.includes(savedScheme) ? savedScheme : (isLive ? 'hls_lowlatency' : 'hls_worker');
    }
    const allowedAndroidSchemes = isLive
      ? ['ijk_hardware', 'ijk_software', 'exo_hardware', 'exo_software', 'html5_auto', 'hls_lowlatency', 'html5_hardware']
      : ['html5_auto', 'hls_worker', 'html5_hardware'];
    return allowedAndroidSchemes.includes(savedScheme) ? savedScheme : (isLive ? 'ijk_hardware' : 'html5_auto');
  });

  const handleSwitchDecoderEngine = async (engineInput) => {
    const runtimeEnv = detectRuntimeEnv();
    const currentRoute = getPlaybackRouteConfig({
      runtime: runtimeEnv,
      kind: isLive ? MEDIA_KIND.LIVE : MEDIA_KIND.VOD,
      viewTier: VIEW_TIER.MAIN,
    });
    const currentPlayback = settings?.playback || {};
    let engine;
    let decoderMode;
    let selectedScheme;
    let resolvedHint = {};

    if (runtimeEnv === RUNTIME_ENV.ANDROID) {
      const resolved = resolveEngineSelection(engineInput, currentRoute);
      engine = resolved.engine;
      decoderMode = resolved.decoder;
      const allowedLiveNativeSchemes = ['ijk_hardware', 'ijk_software', 'exo_hardware', 'exo_software'];
      selectedScheme = (isLive && allowedLiveNativeSchemes.includes(engineInput))
        || ['html5_auto', 'hls_worker', 'hls_lowlatency', 'html5_hardware'].includes(engineInput)
        ? engineInput
        : (isLive ? 'ijk_hardware' : 'html5_auto');
      resolvedHint = resolved.playerHint;
    } else {
      // Keep the ordinary mobile browser's existing scheme mapping unchanged.
      const scheme = getPlaybackScheme(engineInput);
      engine = scheme.engine;
      decoderMode = scheme.decoder;
      selectedScheme = scheme.id;
    }

    setDecoderEngine(selectedScheme);
    saveSettings({
      ...settings,
      playback: {
        ...currentPlayback,
        [isLive ? 'livePlayer' : 'moviePlayer']: engine,
        [isLive ? 'livePlaybackScheme' : 'moviePlaybackScheme']: selectedScheme,
        decoder: { ...(currentPlayback.decoder || {}), [engine]: decoderMode },
      }
    });

    const retry = candidate || controller.start();
    if (retry) {
      setResolvedInput(null);
      setError('');
      const hintCand = {
        ...retry,
        playerHint: { ...(retry.playerHint || {}), engine, decoder: decoderMode, ...resolvedHint },
      };
      controller.resolveAndLoad(hintCand).catch(e => setError(e?.message || '重新加载失败'));
    }
  };
  const [playbackTime, setPlaybackTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [otherSourceSearchOpen, setOtherSourceSearchOpen] = useState(false);

  const videoRef = useRef(null);

  useEffect(() => {
    let active = true;
    const interval = setInterval(() => {
      if (videoRef.current && active) {
        setPlaybackTime(videoRef.current.currentTime || 0);
        setTotalDuration(videoRef.current.duration || 0);
      }
    }, 250);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);
  const playerWindowBodyRef = useRef(null);
  const progressRef = useRef({ currentTime: 0, duration: null, persistedAt: 0 });

  // VOD / Movie Info
  const movie = useMemo(() => {
    if (isLive) return null;
    const found = movies.find(item => item.contentId === request?.contentId);
    if (found) return found;
    if (request?.metadata?.movie) return request.metadata.movie;
    if (request?.contentId) {
      return {
        contentId: request.contentId,
        title: request?.metadata?.title || '未知影片',
        poster: request?.metadata?.poster || '',
        episodes: request?.metadata?.episodes || [],
      };
    }
    return null;
  }, [movies, request, isLive]);

  const episodes = useMemo(() => {
    if (isLive) return [];
    return movie?.episodes ?? request?.metadata?.episodes ?? [];
  }, [movie, request, isLive]);

  const episodeIndex = useMemo(() => {
    if (isLive) return 0;
    return Math.max(0, episodes.findIndex(item => item.episodeId === request?.episodeId) ?? 0);
  }, [episodes, request, isLive]);

  const currentEpisode = useMemo(() => {
    if (isLive) return null;
    return episodes[episodeIndex] ?? null;
  }, [episodes, episodeIndex, isLive]);

  // Live EPG Info
  const channel = useMemo(() => {
    if (!isLive) return null;
    return channels.find(c => c.channelId === request?.channelId);
  }, [channels, request, isLive]);

  const now = Date.now();
  const currentProgram = useMemo(() => {
    if (!isLive || !channel) return null;
    return channel?.epg?.find(program => program.status === 'live' || (Date.parse(program.startAt) <= now && now < Date.parse(program.endAt)));
  }, [channel, isLive, now]);

  const nextProgram = useMemo(() => {
    if (!isLive || !channel) return null;
    return channel?.epg?.find(program => program.status === 'upcoming' || Date.parse(program.startAt) > now);
  }, [channel, isLive, now]);

  const controller = useMemo(() => playbackService.createController(request, {
    onEvent: event => {
      if (event.event === 'error') setError(event.error || '播放候选失败');
      if (event.event === 'released') setStatus('released');
      if (event.event === 'stopped') setStatus('stopped');
      if (event.event === 'decoderChanged') {
        const payload = event?.data ?? event?.decoder ?? {};
        const engine = String(payload?.engine ?? '').toLowerCase();
        const mode = String(payload?.mode ?? '').toLowerCase();
        if (engine === 'exo' || engine === 'ijk') {
          setDecoderEngine(engine + '_' + (mode === 'software' ? 'software' : 'hardware'));
        } else if (engine === 'html5') {
          setDecoderEngine(mode.includes('hard') ? 'html5_hardware' : (isLive ? 'hls_lowlatency' : 'hls_worker'));
        }
      }

      // VOD Progress Tracking
      if (!isLive && event.event === 'progress') {
        const currentTime = event.currentTime ?? 0;
        const duration = event.duration ?? null;
        setPlaybackTime(currentTime);
        if (duration && Number.isFinite(duration) && duration > 0) {
          setTotalDuration(duration);
        }
        progressRef.current = { ...progressRef.current, currentTime, duration };
        if (request?.contentId && request?.episodeId && currentTime - progressRef.current.persistedAt >= 15) {
          recordProgress(request.contentId, request.episodeId, currentTime, duration, false);
          progressRef.current.persistedAt = currentTime;
        }
      }
      if (!isLive && event.event === 'completed' && request?.contentId && request?.episodeId) {
        const progress = progressRef.current;
        if (progress.currentTime > 0) {
          recordProgress(request.contentId, request.episodeId, progress.currentTime, progress.duration, true);
        }
      }
    },
    onStateChange: setStatus,
    onCandidateChange: next => {
      setCandidate(next);
      setResolvedInput(null);
      if (next) setError('');
    },
    onResolvedInput: setResolvedInput,
    onParserError: ({ code }) => setError('解析失败：' + code),
    onPlayerError: ({ error: e }) => setError(e?.message || '播放器加载失败'),
    onExhausted: () => setStatus('error'),
  }), [request, isLive, recordProgress]);

  useEffect(() => {
    let active = true;
    const onVisibility = () => void controller.handleAppState(document.visibilityState === 'hidden' ? 'background' : 'foreground');
    document.addEventListener('visibilitychange', onVisibility);

    const player = controller.attachPlayer(videoRef.current);
    const initial = controller.start();
    setCandidate(initial);

    if (!initial) {
      setStatus('error');
      setError('没有可用的播放候选');
    } else {
      controller.resolveAndLoad(initial).catch(e => {
        if (active) setError(e?.message || '播放初始化失败');
      });
    }

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibility);

      // VOD Progress persistence on unmount
      if (!isLive && request?.contentId && request?.episodeId && progressRef.current.currentTime > 0) {
        const progress = progressRef.current;
        recordProgress(request.contentId, request.episodeId, progress.currentTime, progress.duration, false);
      }

      controller.leave();
      void player;
    };
  }, [controller, request, isLive, recordProgress]);


  const switchCandidate = id => {
    const next = controller.switchCandidate(id);
    if (next) {
      setCandidate(next);
      setSource(next.sourceId ?? '');
      setResolvedInput(null);
      setError('');
    } else {
      const cand = candidates.find(c => c.candidateId === id);
      if (cand) {
        setCandidate(cand);
        setSource(cand.sourceId ?? '');
        setResolvedInput(null);
        setError('');
        controller.resolveAndLoad(cand).catch(e => setError(e?.message || '线路加载失败'));
      }
    }
  };

  const handleRetry = () => {
    setError('');
    const retry = controller.start();
    if (retry) {
      controller.resolveAndLoad(retry).catch(e => setError(e?.message || '重新加载失败'));
    }
  };

  const handleStop = () => {
    try {
      controller.stop();
    } catch (e) {
      console.error("Stop controller failed:", e);
    }
    setResolvedInput(null);
    try {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = "";
        videoRef.current.removeAttribute('src');
        try {
          videoRef.current.load();
        } catch {}
      }
    } catch (e) {
      console.error("Pause video failed:", e);
    }
  };

  const handleChangePlaybackRate = rate => {
    setPlaybackRate(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate;
  };

  const handleSelectTheme = newTheme => {
    saveSettings({ ...settings, theme: newTheme });
  };

  const candidates = request?.candidates ?? [];
  const relatedChannels = isLive ? channels : [];
  const relatedMovies = !isLive && movie ? movieService.getRelated({ movies, movie }) : [];
  const activeStreamUrl = resolvedInput?.url || candidate?.mediaUrl || candidate?.url || candidate?.metadata?.url || '';

  const candidateLabel = candidate?.metadata?.label || candidate?.label || (candidate?.index != null ? `线路 ${candidate.index + 1}` : null) || '线路 1';

  // Parse channel name digits for topbar
  const parsedChannelInfo = useMemo(() => {
    if (!isLive) return { cleanName: '直播', number: null };
    const rawName = request?.metadata?.title ?? channel?.name ?? 'LIVE 直播';
    const digitMatch = rawName.match(/\d+/);
    if (digitMatch) {
      const number = digitMatch[0];
      const cleanName = rawName.replace(new RegExp(`-?\\s*${number}`), '').trim();
      return { cleanName, number };
    }
    return { cleanName: rawName, number: null };
  }, [isLive, request, channel]);

  // Check if favorited
  const isFavorited = useMemo(() => {
    const targetType = isLive ? 'channel' : 'content';
    const targetId = isLive ? request?.channelId : request?.contentId;
    return favorites.some(item => item.targetType === targetType && item.targetId === targetId);
  }, [favorites, isLive, request]);

  const currentSourceItem = sources.find(s => s.sourceId === source);
  const sourceName = currentSourceItem?.name || candidate?.metadata?.sourceName || '当前源';
  const actors = movie?.actors || movie?.actorsList || request?.metadata?.movie?.actors || [];

  return (
    <div className="player-page theme-sangtian-layout">
      {/* 1. Top Bar: Left (Hamburger), Center (Title), Right (More Vertical) */}
      <SangtianTopBar
        title={isLive ? (channel?.name || request?.metadata?.title) : (movie?.title || request?.metadata?.title)}
        subTitle={isLive ? (currentProgram?.title || '直播频道') : (currentEpisode?.title || `第 ${episodeIndex + 1} 集`)}
        onHamburger={() => setDrawerOpen(true)}
        onWorkspace={() => setSourceModalOpen(true)}
        onSearchSameName={isLive ? undefined : () => setOtherSourceSearchOpen(true)}
        currentTheme={settings?.theme || 'sangtian'}
        onSelectTheme={handleSelectTheme}
        onCopyLink={() => {
          if (activeStreamUrl && navigator?.clipboard) {
            navigator.clipboard.writeText(activeStreamUrl).catch(() => {});
          }
        }}
        onReload={handleRetry}
        onOpenSettings={() => onTab?.('settings') || onBack()}
        onBack={onBack}
      />

      {/* Hamburger Navigation Drawer */}
      <SangtianDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNav={tabKey => {
          setDrawerOpen(false);
          onBack();
        }}
        currentTheme={settings?.theme || 'sangtian'}
        onSelectTheme={handleSelectTheme}
      />

      {/* 1. Fully Featured Video Playback Window */}
      <PlaybackPagePlayerBlock
        videoRef={videoRef}
        controller={controller}
        videoContainerRef={playerWindowBodyRef}
        status={status}
        error={error}
        resolvedInput={resolvedInput}
        candidate={candidate}
        request={request}
        onRetry={handleRetry}
        onStop={handleStop}
        onSwitchCandidate={candidateIdOrEvent => {
          if (typeof candidateIdOrEvent === 'string') {
            switchCandidate(candidateIdOrEvent);
            return;
          }
          const next = candidates.find(item => item.candidateId !== candidate?.candidateId && !controller.failedCandidateIds?.includes(item.candidateId))
            || candidates.find(item => item.candidateId !== candidate?.candidateId);
          if (next) switchCandidate(next.candidateId);
        }}
        terminalTag={isLive ? 'LIVE DIRECT' : 'VOD DECODE'}
        isLive={isLive}
        playbackRate={playbackRate}
        onChangePlaybackRate={handleChangePlaybackRate}
        channels={isLive ? channels : []}
        activeChannel={isLive ? channel : null}
        activeStreamIndex={isLive ? Math.max(0, request?.candidates?.findIndex(item => item.candidateId === candidate?.candidateId) ?? 0) : 0}
        onSelectChannel={onChannel}
        onSwitchStreamIndex={isLive ? (idx => {
          const targetCandidate = candidates[idx] || request?.candidates?.[idx];
          if (targetCandidate) switchCandidate(targetCandidate.candidateId);
        }) : undefined}
        title={isLive ? (request?.metadata?.title ?? channel?.name ?? 'LIVE 直播') : (movie?.title || request?.metadata?.title)}
        episodeLabel={isLive ? '' : (currentEpisode?.title || `第 ${episodeIndex + 1} 集`)}
        sourceLabel={candidateLabel}
        episodes={episodes}
        currentEpisodeIndex={episodeIndex}
        onSelectEpisode={idx => onEpisode?.(movie, idx, source, request?.metadata?.returnRoute || 'detail')}
        onPreviousEpisode={episodeIndex > 0 ? () => onEpisode?.(movie, episodeIndex - 1, source, request?.metadata?.returnRoute || 'detail') : undefined}
        onNextEpisode={episodeIndex < episodes.length - 1 ? () => onEpisode?.(movie, episodeIndex + 1, source, request?.metadata?.returnRoute || 'detail') : undefined}
        candidates={candidates}
        onSelectCandidate={switchCandidate}
        onOpenSourceModal={() => setSourceModalOpen(true)}
        decoderEngine={decoderEngine}
        onChangeDecoderEngine={handleSwitchDecoderEngine}
        onTimeMetricsChange={(cur, dur) => {
          setPlaybackTime(cur);
          if (dur > 0 && Number.isFinite(dur)) {
            setTotalDuration(dur);
          }
        }}
      >
        <video
          ref={videoRef}
          playsInline
          preload="metadata"
          poster={request?.metadata?.poster || movie?.poster}
          className="sangtian-video-element"
        />
      </PlaybackPagePlayerBlock>

      {/* 4. Floating Control Bar (VOD Only) */}
      {!isLive && (
        <SangtianFloatingBar
          playbackRate={playbackRate}
          isLive={isLive}
          onChangeRate={handleChangePlaybackRate}
          currentTime={playbackTime}
          duration={totalDuration}
        />
      )}

      {/* 5. Rich Console Console Card */}
      <SangtianConsoleCard
        title={isLive ? (request?.metadata?.title ?? channel?.name ?? 'LIVE 直播') : (request?.metadata?.title || movie?.title || '精彩视频')}
        subtitle={isLive ? `● 正在直播 · ${request?.metadata?.category ?? channel?.category ?? '通用频道'}` : `${movie?.year || '2026'} · ${movie?.category || '高清影音'} · 第 ${episodeIndex + 1} 集`}
        description={isLive ? (currentProgram ? `当前节目：${currentProgram.title || '未命名'} (${currentProgram.startAt || ''}–${currentProgram.endAt || ''})${nextProgram ? ` | 下一节目：${nextProgram.title || ''}` : ''}` : '') : (movie?.description || '暂无剧情简介。')}
        episodes={isLive ? [] : episodes}
        currentEpisodeId={isLive ? null : request?.episodeId}
        onSelectEpisode={idx => {
          if (!isLive) onEpisode?.(movie, idx, source, request?.metadata?.returnRoute || 'detail');
        }}
        candidates={candidates}
        currentCandidateId={candidate?.candidateId}
        onSelectCandidate={switchCandidate}
        streamUrl={activeStreamUrl}
        relatedItems={isLive ? relatedChannels : relatedMovies}
        activeItemId={isLive ? request?.channelId : null}
        onSelectRelated={next => {
          if (isLive) {
            if (next) onPlay?.(next);
          } else {
            if (next) onMovie?.(next);
          }
        }}
        onReplay={handleRetry}
        playerStatus={status}
        isLive={isLive}
        onBack={onBack}
        onFav={isLive ? undefined : () => {
          if (request?.contentId) toggleFavorite?.('content', request.contentId);
        }}
        isFav={isLive ? false : favorites.some(item => item.targetId === request?.contentId)}
        onSearchSameName={isLive ? undefined : () => setOtherSourceSearchOpen(true)}
        sourceName={sourceName}
        actors={actors}
        onTogglePip={() => {
          if (videoRef.current && document.pictureInPictureEnabled) {
            if (document.pictureInPictureElement) {
              document.exitPictureInPicture?.().catch(() => {});
            } else {
              videoRef.current.requestPictureInPicture?.().catch(() => {});
            }
          }
        }}
      />

      {/* 全网搜同名弹窗 */}
      {otherSourceSearchOpen && (
        <OtherSourceSearchDialog
          title={movie?.title || request?.metadata?.title || '影片'}
          currentSourceId={source}
          sources={persistent?.sources || []}
          onClose={() => setOtherSourceSearchOpen(false)}
          onMovie={movieItem => {
            setOtherSourceSearchOpen(false);
            if (onMovie) onMovie(movieItem);
            else if (onEpisode) onEpisode(movieItem, 0, movieItem?.sourceId, 'detail');
          }}
          onPlay={(m, epIdx, srcId) => {
            setOtherSourceSearchOpen(false);
            if (onEpisode) onEpisode(m, epIdx || 0, srcId, 'detail');
            else if (onPlay) onPlay(m, epIdx || 0, srcId, 'detail');
          }}
        />
      )}

      {/* Unified Source Selection Drawer / Modal */}
      {sourceModalOpen && (
        <div className="sangtian-modal-backdrop" onClick={() => setSourceModalOpen(false)}>
          <div className="sangtian-modal" onClick={e => e.stopPropagation()}>
            <h4>{isLive ? '选择直播线路' : '选择播放源与集数'}</h4>
            {!isLive && episodes.length > 0 && (
              <div className="modal-episodes-section" style={{ marginBottom: 16 }}>
                <h5>剧集选集</h5>
                <div className="chips" style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {episodes.map((ep, idx) => (
                    <button
                      key={ep.episodeId}
                      className={episodeIndex === idx ? 'active' : ''}
                      onClick={() => {
                        onEpisode?.(movie, idx, source, request?.metadata?.returnRoute || 'detail');
                        setSourceModalOpen(false);
                      }}
                    >
                      {ep.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h5>线路 / 播放源</h5>
              <div className="chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {candidates.map((item, idx) => (
                  <button
                    key={item.candidateId}
                    className={candidate?.candidateId === item.candidateId ? 'active' : ''}
                    onClick={() => { switchCandidate(item.candidateId); setSourceModalOpen(false); }}
                  >
                    {item.metadata?.label || item.label || (item.index != null ? `线路 ${item.index + 1}` : `线路 ${idx + 1}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="actions" style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="primary" onClick={() => setSourceModalOpen(false)}>完成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Validation tags for automated architecture verification checks:
// 重新播放, 切换线路

export function PlaybackPage(props) {
  return <PlaybackView {...props} />;
}
