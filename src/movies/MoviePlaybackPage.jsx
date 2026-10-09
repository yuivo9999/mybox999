import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ListVideo, Search } from 'lucide-react';
import { movieService } from './movieServices.js';
import { playbackService } from '../core__services__playbackService.js';
import { searchMovieSources } from './movieServices.js';
import { usePersistentState } from '../core__state__usePersistentState.js';
import { SangtianTopBar } from '../shared__components__theme__SangtianTopBar.jsx';
import { SangtianDrawer } from '../shared__components__theme__SangtianDrawer.jsx';
import {
  SangtianPlayerWindow,
  SangtianFloatingBar,
  SangtianConsoleCard,
} from '../shared__components__theme__SangtianPlayerConsole.jsx';
import { OtherSourceSearchDialog } from './OtherSourceSearchDialog.jsx';
import {
  getPlaybackRouteConfig,
  resolveEngineSelection,
  detectRuntimeEnv,
  RUNTIME_ENV,
  MEDIA_KIND,
  VIEW_TIER
} from '../core__playback__playbackStrategyDispatcher.js';

export function MoviePlaybackPage({
  request,
  movies = [],
  sources = [],
  favorites = [],
  toggleFavorite,
  onBack,
  onEpisode,
  onMovie,
  onTab,
}) {
  const { recordProgress, saveSettings, settings } = usePersistentState();

  const [source, setSource] = useState(request?.metadata?.sourceId ?? request?.candidates?.[0]?.sourceId ?? '');
  const [candidate, setCandidate] = useState(request?.candidates?.[0] ?? null);
  const [onlineCandidates, setOnlineCandidates] = useState([]);
  const [matchingOnline, setMatchingOnline] = useState(false);
  const [otherSourceSearchOpen, setOtherSourceSearchOpen] = useState(false);
  const [status, setStatus] = useState('idle');
  const [resolvedInput, setResolvedInput] = useState(null);
  const [error, setError] = useState('');
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [decoderEngine, setDecoderEngine] = useState(() => {
    const isWeb = detectRuntimeEnv() === RUNTIME_ENV.WEB;
    const playback = settings?.playback || {};
    if (playback.moviePlaybackScheme) return playback.moviePlaybackScheme;
    if (isWeb) return 'hls_worker';
    const player = playback.moviePlayer || 'ijk';
    const mode = playback.decoder?.[player] || 'hardware';
    return `${player}_${mode}`;
  });

  const handleSwitchDecoderEngine = async (engineInput) => {
    const runtimeEnv = detectRuntimeEnv();
    const currentRoute = getPlaybackRouteConfig({
      runtime: runtimeEnv,
      kind: MEDIA_KIND.VOD,
      viewTier: VIEW_TIER.MAIN,
    });
    const resolved = resolveEngineSelection(engineInput, currentRoute);
    setDecoderEngine(engineInput);

    // 1. 保存设置到持久化 settings 中
    const currentPlayback = settings?.playback || {};
    saveSettings({
      ...settings,
      playback: {
        ...currentPlayback,
        moviePlayer: resolved.engine,
        moviePlaybackScheme: engineInput,
        decoder: {
          ...(currentPlayback.decoder || {}),
          [resolved.engine]: resolved.decoder,
        }
      }
    });

    // 2. 立即重新以新的解码内核与硬/软解模式载入并播放
    const retry = candidate || controller.start();
    if (retry) {
      setResolvedInput(null);
      setError('');
      const hintCand = {
        ...retry,
        playerHint: {
          ...(retry.playerHint || {}),
          ...resolved.playerHint,
        }
      };
      controller.resolveAndLoad(hintCand).catch(e => setError(e?.message || '重新加载失败'));
    }
  };
  const [playbackTime, setPlaybackTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);

  const videoRef = useRef(null);
  const playerWindowBodyRef = useRef(null);
  const progressRef = useRef({ currentTime: 0, duration: null, persistedAt: 0 });
  const recordProgressRef = useRef(recordProgress);
  recordProgressRef.current = recordProgress;

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

  // VOD / Movie Info
  const movie = useMemo(() => {
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
  }, [movies, request]);

  const episodes = useMemo(() => {
    return movie?.episodes ?? request?.metadata?.episodes ?? [];
  }, [movie, request]);

  const episodeIndex = useMemo(() => {
    return Math.max(0, episodes.findIndex(item => item.episodeId === request?.episodeId) ?? 0);
  }, [episodes, request?.episodeId]);

  const currentEpisode = useMemo(() => {
    return episodes[episodeIndex] ?? null;
  }, [episodes, episodeIndex]);

  const controller = useMemo(() => playbackService.createController(request, {
    onEvent: event => {
      if (event.event === 'error') setError(event.error || '播放候选失败');
      if (event.event === 'released') setStatus('released');
      if (event.event === 'stopped') setStatus('stopped');

      // VOD Progress Tracking
      if (event.event === 'progress') {
        const currentTime = event.currentTime ?? 0;
        const duration = event.duration ?? null;
        setPlaybackTime(currentTime);
        if (duration && Number.isFinite(duration) && duration > 0) {
          setTotalDuration(duration);
        }
        progressRef.current = { ...progressRef.current, currentTime, duration };
        if (request?.contentId && request?.episodeId && currentTime - progressRef.current.persistedAt >= 15) {
          recordProgressRef.current?.(request.contentId, request.episodeId, currentTime, duration, false);
          progressRef.current.persistedAt = currentTime;
        }
      }
      if (event.event === 'completed' && request?.contentId && request?.episodeId) {
        const progress = progressRef.current;
        if (progress.currentTime > 0) {
          recordProgressRef.current?.(request.contentId, request.episodeId, progress.currentTime, progress.duration, true);
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
  }), [request?.requestId || request?.contentId, request?.episodeId]);

  const controllerRef = useRef(controller);
  controllerRef.current = controller;

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

      if (request?.contentId && request?.episodeId && progressRef.current.currentTime > 0) {
        const progress = progressRef.current;
        recordProgressRef.current?.(request.contentId, request.episodeId, progress.currentTime, progress.duration, false);
      }

      controller.leave();
      void player;
    };
  }, [controller]);

  useEffect(() => {
    const body = playerWindowBodyRef.current;
    if (!body || !controller?.setVideoViewBounds) return undefined;

    const syncNativeVideoSurface = () => {
      if (typeof window === 'undefined' || typeof body.getBoundingClientRect !== 'function') return;
      const rect = body.getBoundingClientRect();
      controller.setVideoViewBounds({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
    };

    syncNativeVideoSurface();
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(syncNativeVideoSurface)
      : null;
    observer?.observe(body);
    window.addEventListener('resize', syncNativeVideoSurface);
    window.addEventListener('orientationchange', syncNativeVideoSurface);
    const timer = window.setTimeout(syncNativeVideoSurface, 150);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', syncNativeVideoSurface);
      window.removeEventListener('orientationchange', syncNativeVideoSurface);
      window.clearTimeout(timer);
    };
  }, [controller]);

  // 动态在线匹配真实片源：若当前是静态/测试流，或者配置了真实影视源，自动跨源搜索匹配该片名的真实 m3u8 播放线路
  const sourcesKey = useMemo(() => (sources || []).map(s => s.sourceId).join(','), [sources]);
  const matchedRef = useRef('');

  useEffect(() => {
    let active = true;
    const title = String(movie?.title || request?.metadata?.title || '').trim();
    if (!title || !Array.isArray(sources) || sources.length === 0) return undefined;
    const cacheKey = `${title}_${episodeIndex}_${sourcesKey}`;
    if (matchedRef.current === cacheKey) return undefined;
    matchedRef.current = cacheKey;

    searchMovieSources(sources, title, { timeoutMs: 5000, pageSize: 6 })
      .then(res => {
        if (!active || !res?.results?.length) return;
        // 找到与当前片名最匹配的源条目
        const matched = res.results.find(r => r.title === title || r.title?.includes(title) || title?.includes(r.title)) || res.results[0];
        if (matched && Array.isArray(matched.episodes) && matched.episodes.length > 0) {
          const epIdx = episodeIndex >= 0 ? episodeIndex : 0;
          const targetEp = matched.episodes[epIdx] || matched.episodes[0];
          const dynamicCandidates = (targetEp?.playbackCandidates || []).map((cand, idx) => ({
            ...cand,
            candidateId: `online_${matched.sourceId || 'src'}_${idx}_${Date.now()}`,
            label: cand.label || `[${matched.sourceName || '真实片源'}] 线路${idx + 1}`,
            sourceId: matched.sourceId || 'online_matched',
            mediaUrl: cand.mediaUrl || cand.url,
            metadata: {
              ...(cand.metadata || {}),
              onlineMatched: true,
              sourceName: matched.sourceName || '在线源',
            },
          })).filter(c => Boolean(c.mediaUrl));

          if (dynamicCandidates.length > 0 && active) {
            setOnlineCandidates(dynamicCandidates);
            // 若当前播放的是测试流或为空，自动无缝升级至真实片源
            const curUrl = candidate?.mediaUrl || candidate?.url || '';
            const isTestStream = !curUrl || curUrl.includes('test-streams.mux.dev');
            if (isTestStream && dynamicCandidates[0]) {
              const bestReal = dynamicCandidates[0];
              controllerRef.current?.resolveAndLoad(bestReal)
                .then(() => {
                  if (active) {
                    setCandidate(bestReal);
                    setSource(bestReal.sourceId ?? '');
                    setError('');
                  }
                })
                .catch(() => {});
            }
          }
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [movie?.title, request?.metadata?.title, sourcesKey, episodeIndex]);

  const allCandidates = useMemo(() => {
    const raw = [...(request?.candidates ?? []), ...onlineCandidates];
    const seen = new Set();
    return raw.filter(cand => {
      const url = cand.mediaUrl || cand.url || cand.candidateId;
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
  }, [request?.candidates, onlineCandidates]);

  const switchCandidate = id => {
    const foundOnline = onlineCandidates.find(c => c.candidateId === id);
    if (foundOnline) {
      setCandidate(foundOnline);
      setSource(foundOnline.sourceId ?? '');
      setResolvedInput(null);
      setError('');
      controller.resolveAndLoad(foundOnline).catch(e => setError(e?.message || '线路加载失败'));
      return;
    }
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
    const retry = candidate || controller.start();
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
    if (controller?.setPlaybackRate) {
      controller.setPlaybackRate(rate);
    } else if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const handleSelectTheme = newTheme => {
    saveSettings({ ...settings, theme: newTheme });
  };

  const candidates = allCandidates;
  const relatedMovies = movie ? movieService.getRelated({ movies, movie }) : [];
  const activeStreamUrl = resolvedInput?.url || candidate?.mediaUrl || candidate?.url || candidate?.metadata?.url || '';

  const candidateLabel = candidate?.metadata?.label || candidate?.label || (candidate?.index != null ? `线路 ${candidate.index + 1}` : null) || '线路 1';

  const currentSourceItem = sources.find(s => s.sourceId === source);
  const sourceName = currentSourceItem?.name || candidate?.metadata?.sourceName || '当前源';
  const actors = movie?.actors || movie?.actorsList || request?.metadata?.movie?.actors || [];
  const director = movie?.director || request?.metadata?.director || movie?.directorName || '';
  const writer = movie?.writer || request?.metadata?.writer || movie?.writerName || '';

  return (
    <div className="player-page theme-sangtian-layout">
      {/* 1. Top Bar: Left (Hamburger), Center (Title), Right (More Vertical) */}
      <SangtianTopBar
        title={movie?.title || request?.metadata?.title}
        subTitle={currentEpisode?.title || `第 ${episodeIndex + 1} 集`}
        onHamburger={() => setDrawerOpen(true)}
        onWorkspace={() => setSourceModalOpen(true)}
        onSearchSameName={() => setOtherSourceSearchOpen(true)}
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

      {/* Drawer */}
      <SangtianDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNav={tabKey => {
          setDrawerOpen(false);
          if (tabKey === 'movies' || tabKey === 'home') onBack();
          else onTab?.(tabKey) || onBack();
        }}
        currentTheme={settings?.theme || 'sangtian'}
        onSelectTheme={handleSelectTheme}
      />

      {/* 2. Fully Featured Video Playback Window with unified Controller */}
      <SangtianPlayerWindow
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
        onSwitchCandidate={() => {
          const next = candidates.find(item => item.candidateId !== candidate?.candidateId && !controller.failedCandidateIds?.includes(item.candidateId));
          if (next) switchCandidate(next.candidateId);
        }}
        terminalTag="VOD DECODE"
        isLive={false}
        playbackRate={playbackRate}
        onChangePlaybackRate={handleChangePlaybackRate}
        title={movie?.title || request?.metadata?.title}
        episodeLabel={currentEpisode?.title || `第 ${episodeIndex + 1} 集`}
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
      </SangtianPlayerWindow>

      {/* 3. Floating Control Bar (VOD Only) */}
      <SangtianFloatingBar
        playbackRate={playbackRate}
        isLive={false}
        onChangeRate={handleChangePlaybackRate}
        currentTime={playbackTime}
        duration={totalDuration}
      />

      {/* 4. Rich Console Console Card with unified Back/Fav buttons */}
      <SangtianConsoleCard
        title={request?.metadata?.title || movie?.title || '精彩视频'}
        subtitle={`${movie?.year || '2026'} · ${movie?.category || '高清影音'} · 第 ${episodeIndex + 1} 集`}
        description={movie?.description || '暂无剧情简介。'}
        episodes={episodes}
        currentEpisodeId={request?.episodeId}
        onSelectEpisode={idx => {
          onEpisode?.(movie, idx, source, request?.metadata?.returnRoute || 'detail');
        }}
        candidates={candidates}
        currentCandidateId={candidate?.candidateId}
        onSelectCandidate={switchCandidate}
        streamUrl={activeStreamUrl}
        relatedItems={relatedMovies}
        activeItemId={null}
        onSelectRelated={next => {
          if (next) onMovie?.(next);
        }}
        onReplay={handleRetry}
        playerStatus={status}
        isLive={false}
        onBack={onBack}
        onFav={() => {
          if (request?.contentId) toggleFavorite?.('content', request.contentId);
        }}
        isFav={favorites.some(item => item.targetId === request?.contentId)}
        onSearchSameName={() => setOtherSourceSearchOpen(true)}
        sourceName={sourceName}
        actors={actors}
        director={director}
        writer={writer}
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

      {/* Source Selection Modal */}
      {sourceModalOpen && (
        <div className="sangtian-modal-backdrop" onClick={() => setSourceModalOpen(false)}>
          <div className="sangtian-modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <h3>播放线路与解析切换</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="secondary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 12, borderRadius: 6 }}
                    onClick={() => {
                      setSourceModalOpen(false);
                      setOtherSourceSearchOpen(true);
                    }}
                  >
                    <Search size={13} />
                    <span>搜同名</span>
                  </button>
                  <button className="close-btn" onClick={() => setSourceModalOpen(false)}>✕</button>
                </div>
              </div>
            </div>

            <div className="modal-body">
              <div className="modal-section-title">可用线路 ({candidates.length})</div>
              <div className="source-cards-grid">
                {candidates.map((c, i) => {
                  const isCurrent = c.candidateId === candidate?.candidateId;
                  return (
                    <div
                      key={c.candidateId}
                      className={`source-card ${isCurrent ? 'active' : ''}`}
                      onClick={() => {
                        switchCandidate(c.candidateId);
                        setSourceModalOpen(false);
                      }}
                    >
                      <div className="card-top">
                        <span className="source-name">{c.metadata?.label || c.label || `线路 ${i + 1}`}</span>
                        {isCurrent && <span className="current-badge">正在使用</span>}
                      </div>
                      <div className="card-tags">
                        <span className="tech-tag">{c.protocol || 'HTTP'}</span>
                        <span className="tech-tag">{decoderEngine.toUpperCase()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="modal-section-title" style={{ marginTop: 20 }}>剧集选择 ({episodes.length} 集)</div>
              <div className="episodes-grid-modal">
                {episodes.map((ep, idx) => (
                  <button
                    key={ep.episodeId || idx}
                    type="button"
                    className={`modal-ep-btn ${idx === episodeIndex ? 'active' : ''}`}
                    onClick={() => {
                      onEpisode?.(movie, idx, source, request?.metadata?.returnRoute || 'detail');
                      setSourceModalOpen(false);
                    }}
                  >
                    {ep.title || `${idx + 1}`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 全网搜同名弹窗 */}
      {otherSourceSearchOpen && (
        <OtherSourceSearchDialog
          title={movie?.title || request?.metadata?.title || '影片'}
          currentSourceId={source}
          sources={sources}
          onClose={() => setOtherSourceSearchOpen(false)}
          onMovie={movieItem => {
            setOtherSourceSearchOpen(false);
            if (onMovie) onMovie(movieItem);
            else if (onEpisode) onEpisode(movieItem, 0, movieItem?.sourceId, 'detail');
          }}
          onPlay={(item, epIdx, srcId) => {
            setOtherSourceSearchOpen(false);
            onEpisode?.(item, epIdx || 0, srcId, 'detail');
          }}
        />
      )}
    </div>
  );
}
