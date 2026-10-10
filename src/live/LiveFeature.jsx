import React, { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { ChevronLeft, Heart, Play, Radio } from 'lucide-react';
import { liveService } from './liveServices.js';
import { playbackService } from '../core__services__playbackService.js';
import { observeNativeVideoBounds } from '../core__player__nativeVideoBoundsSync.js';
import { requestManager } from '../core__services__network__requestManager.js';
import { tv1LiveService } from './liveServices.js';
import { findNextLiveStreamIndex } from './liveRuntime.js';
import { canUseHlsProxy } from '../core__playback__hlsWebProxy.js';
import { usePageState, pageStateStore } from '../core__state__pageStateStore.js';
import { persistentStateStore } from '../core__state__persistentStateStore.js';
import { SmartImage, EmptyState, LoadingState } from '../shared__components__StateViews.jsx';
import { SangtianPlayerWindow } from '../shared__components__theme__SangtianPlayerConsole.jsx';
import {
  getPlaybackRouteConfig,
  resolveEngineSelection,
  detectRuntimeEnv,
  RUNTIME_ENV,
  MEDIA_KIND,
  VIEW_TIER
} from '../core__playback__playbackStrategyDispatcher.js';

function describePlaybackError(message) {
  const text = String(message || '');
  if (!text) return '';
  if (text.includes('MIXED_CONTENT')) {
    return canUseHlsProxy()
      ? '当前直播源使用 HTTP，浏览器可能阻止网页直连；系统已尝试配置的 HTTPS 中转。请检查中转服务和上游线路是否可用，或切换同频道其他线路。'
      : '当前直播源使用 HTTP，而网页使用 HTTPS，浏览器可能阻止播放。系统会继续尝试当前浏览器允许的播放方式，并自动切换同一频道的下一条线路；不会自动把直播地址发送给第三方中转服务。';
  }
  if (/rtmp_NOT_PLAYABLE|rtsp_NOT_PLAYABLE/i.test(text)) {
    return '网页浏览器无法播放 RTMP/RTSP 源，请换用安卓 APK，或切换其他线路。';
  }
  if (text.includes('mpegts_js_missing')) {
    return '缺少 FLV/TS 播放组件 mpegts.js，请先执行 npm install 再构建。';
  }
  if (text.includes('MSE_NOT_AVAILABLE')) {
    return '当前浏览器不支持 FLV/TS 直播所需的 MediaSource（如 iPhone Safari），请换用安卓 APK 或其他浏览器。';
  }
  if (/HLS_NETWORK_ERROR|manifestLoad|fragLoad|levelLoad|Failed to fetch|CORS/i.test(text)) {
    return canUseHlsProxy()
      ? '浏览器仍无法读取该直播流。系统已尝试配置的网页端中转；可能是中转服务、源站跨域策略、网络连接或直播清单异常，请尝试同频道其他线路。'
      : '浏览器无法读取该直播流，可能是源站跨域限制、网络不可达或直播清单失效。系统会自动尝试同一频道的下一条线路；不会自动启用或请求第三方中转服务。';
  }
  return text;
}

export function createLiveFeature({ channels = [] } = {}) {
  return {
    getCategories() { return liveService.getCategories(channels); },
    list(options = {}) { return liveService.listChannels(channels, options); },
    getChannel(id) { return liveService.getById(channels, id); },
    async getEPG(channel, range) { return liveService.getEPG(channel, range); },
  };
}


export async function resolveLiveChannelStreams(channel, { sources = [], signal, forceRefresh = false } = {}) {
  if (!channel) return [];
  if (Array.isArray(channel.streams) && channel.streams.length && !channel.deferredRef && !forceRefresh) return channel.streams;

  const tv1Source = channel.sourceRefs?.find(ref =>
    sources.some(source =>
      source.sourceId === ref.sourceId
      && source.sourceType === 'live'
      && source.liveMode === 'tv1'
      && source.enabled !== false
    )
  );
  const source = tv1Source
    ? sources.find(item => item.sourceId === tv1Source.sourceId)
    : null;

  const reqTag = forceRefresh ? `refresh_${Date.now()}_` : '';

  if (source) {
    return requestManager.run(
      'tv1-streams:' + reqTag + source.sourceId + ':' + channel.channelId,
      requestSignal => tv1LiveService.getStreams(source, channel, {
        signal: signal || requestSignal,
        forceRefresh,
      }),
    );
  }

  return requestManager.run(
    'live-deferred-streams:' + reqTag + channel.channelId,
    requestSignal => liveService.getStreams(channel, {
      signal: signal || requestSignal,
      forceRefresh,
    }),
  );
}

// Global Live State Cache across Tab Navigations
export const globalLiveCache = {
  tv1Channels: [],
  selectedChannelId: '',
  selectedCategory: '全部',
  resolvedStreams: {},
  activeStreamIndex: 0,
  decoderEngine: null,
  isImmersive: false,
  exitImmersive: null,
};

export function LiveFeature({ channels = [], sources = [], favorites = [], onChannel, onPlay, onTab, toggleFavorite }) {
  const page = usePageState();
  const immersiveBackHandlerRef = useRef(null);
  const registerImmersiveBackHandler = useCallback(handler => { immersiveBackHandlerRef.current = typeof handler === 'function' ? handler : null; }, []);
  const videoRef = useRef(null);
  const playerWindowBodyRef = useRef(null);
  const [selectedChannelId, setSelectedChannelId] = useState(globalLiveCache.selectedChannelId);
  const [selectedCategory, setSelectedCategory] = useState(globalLiveCache.selectedCategory || '全部');
  const [activeStreamIndex, setActiveStreamIndex] = useState(globalLiveCache.activeStreamIndex || 0);
  const [tv1Channels, setTv1Channels] = useState(globalLiveCache.tv1Channels || []);
  const [tv1Loading, setTv1Loading] = useState(false);
  const [tv1LoadedCount, setTv1LoadedCount] = useState(globalLiveCache.tv1Channels?.length || 0);
  const [tv1Error, setTv1Error] = useState(null);
  const [resolvedStreams, setResolvedStreams] = useState(globalLiveCache.resolvedStreams || {});
  const [streamLoading, setStreamLoading] = useState(false);
  const [decoderEngine, setDecoderEngine] = useState(() => {
    if (globalLiveCache.decoderEngine) return globalLiveCache.decoderEngine;
    const isWeb = detectRuntimeEnv() === RUNTIME_ENV.WEB;
    if (isWeb) return 'hls_lowlatency';
    const settings = persistentStateStore.getSnapshot()?.settings;
    const currentPlayback = settings?.playback || {};
    if (currentPlayback.livePlaybackScheme) return currentPlayback.livePlaybackScheme;
    const player = currentPlayback.livePlayer || 'ijk';
    const mode = currentPlayback.decoder?.[player] || 'hardware';
    return `${player}_${mode}`;
  });

  const handleSwitchDecoderEngine = async (engineInput) => {
    const runtimeEnv = detectRuntimeEnv();
    const currentRoute = getPlaybackRouteConfig({
      runtime: runtimeEnv,
      kind: MEDIA_KIND.LIVE,
      // 竖屏沉浸页面不等于真正全屏；仅用户主动全屏后才使用沉浸播放路由。
      viewTier: isActualFullscreen ? VIEW_TIER.IMMERSIVE : VIEW_TIER.MAIN,
    });
    const resolved = resolveEngineSelection(engineInput, currentRoute);
    setDecoderEngine(engineInput);
    globalLiveCache.decoderEngine = engineInput;

    // 1. 保存设置到持久化 settings 中
    const settings = persistentStateStore.getSnapshot()?.settings;
    const currentPlayback = settings?.playback || {};
    persistentStateStore.updateSettings({
      playback: {
        ...currentPlayback,
        livePlayer: resolved.engine,
        livePlaybackScheme: engineInput,
        decoder: {
          ...(currentPlayback.decoder || {}),
          [resolved.engine]: resolved.decoder,
        }
      }
    });

    // 2. 马上以新解码内核与硬/软解模式重新载入并播放当前流
    const activeReq = livePlaybackRequestRef.current;
    const currentStreamIdx = activeStreamIndexRef.current || 0;
    const cand = playbackCandidate || (activeReq?.candidates?.[currentStreamIdx]);
    if (cand && playbackControllerRef.current) {
      setPlaybackStatus('loading');
      setPlaybackError('');
      const hintCand = {
        ...cand,
        playerHint: {
          ...(cand.playerHint || {}),
          ...resolved.playerHint,
        }
      };
      playbackControllerRef.current.resolveAndLoad(hintCand, { forceRefresh: true }).catch(err => {
        setPlaybackError(err?.message || '切换解码内核失败');
      });
    }
  };
  const [isImmersive, setIsImmersive] = useState(globalLiveCache.isImmersive || false);
  const [isActualFullscreen, setIsActualFullscreen] = useState(false);

  // 向 App 层暴露“退出沉浸”能力，供安卓返回键优先收起沉浸界面
  useEffect(() => {
    globalLiveCache.exitImmersive = () => {
      if (immersiveBackHandlerRef.current?.()) return;
      setIsImmersive(false);
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
    return () => { globalLiveCache.exitImmersive = null; };
  }, []);

  const [customUrl, setCustomUrl] = useState('');
  const customUrlInputRef = useRef(null);
  const [customCandidate, setCustomCandidate] = useState(null);

  const handleLoadCustomUrl = () => {
    let raw = String(customUrl || '').trim();
    if (!raw) return;

    // 采用高度健壮的 URL 扫描器正则：识别并提取符合 tv1.txt 或其他常用网络直播流（http/https/rtmp/rtsp）的播放地址
    const urlMatch = raw.match(/(https?|rtmp|rtsp):\/\/[^\s"'，,]+/i);
    let trimmed = raw;
    if (urlMatch) {
      let extracted = urlMatch[0];
      // 如果包含多个备用地址（以 # 分离，如 "http://url1#http://url2"），提取第一个有效的播放地址
      if (extracted.includes('#')) {
        const parts = extracted.split('#');
        const firstValid = parts.find(p => /^https?:\/\//i.test(p.trim()) || /^rtmp:\/\//i.test(p.trim()) || /^rtsp:\/\//i.test(p.trim()));
        if (firstValid) {
          extracted = firstValid.trim();
        }
      }
      trimmed = extracted;
    }

    trimmed = trimmed.trim();
    if (!trimmed) return;

    setSelectedChannelId('');
    setActiveStreamIndex(0);

    const cand = {
      candidateId: 'custom-live-stream-' + Date.now(),
      mediaUrl: trimmed,
      url: trimmed,
      label: '自定义直播',
      protocol: 'auto',
      sourceId: 'custom',
      kind: 'live',
    };

    setCustomCandidate(cand);
    setPlaybackCandidate(cand);
    setResolvedPlaybackInput(null);
    setPlaybackError('');
    setPlaybackStatus('loading');
    setIsImmersive(true); // 激活沉浸播放卡片
    // 不在此处直接调用旧控制器加载：customCandidate 变化会生成新的播放请求与控制器，由 effect 统一起播
  };

  const enabledTv1Sources = useMemo(
    () => sources.filter(source => source.sourceType === 'live' && source.liveMode === 'tv1' && source.enabled !== false),
    [sources],
  );

  // Sync state changes to global Live Cache
  useEffect(() => { globalLiveCache.selectedChannelId = selectedChannelId; }, [selectedChannelId]);
  useEffect(() => { globalLiveCache.selectedCategory = selectedCategory; }, [selectedCategory]);
  useEffect(() => { globalLiveCache.activeStreamIndex = activeStreamIndex; }, [activeStreamIndex]);
  useEffect(() => { globalLiveCache.tv1Channels = tv1Channels; }, [tv1Channels]);
  useEffect(() => { globalLiveCache.resolvedStreams = resolvedStreams; }, [resolvedStreams]);
  useEffect(() => { globalLiveCache.decoderEngine = decoderEngine; }, [decoderEngine]);
  useEffect(() => { globalLiveCache.isImmersive = isImmersive; }, [isImmersive]);

  // 退出live直播界面，就不算了。释放最高播放权，暂停播放，清理全部运行时缓存，并重置全局 Live Cache
  useEffect(() => {
    return () => {
      if (videoRef.current) {
        try {
          videoRef.current.pause();
          videoRef.current.src = "";
          videoRef.current.removeAttribute('src');
          videoRef.current.load();
        } catch (e) {}
      }
      if (playbackControllerRef.current) {
        try {
          playbackControllerRef.current.stop?.();
          playbackControllerRef.current.leave?.();
        } catch (e) {}
      }
      globalLiveCache.selectedChannelId = '';
      globalLiveCache.activeStreamIndex = 0;
      globalLiveCache.resolvedStreams = {};
      globalLiveCache.isImmersive = false;
      liveService.clearRuntimeCache();
    };
  }, []);

  useEffect(() => {
    const requestedId = page?.live?.channelId;
    if (!requestedId) return;
    setCustomCandidate(null);
    setSelectedChannelId(requestedId);
    if (page.live.category) setSelectedCategory(page.live.category);
    if (typeof page?.live?.streamIndex === 'number' && page.live.streamIndex >= 0) {
      setActiveStreamIndex(page.live.streamIndex);
    }
    // 一次性请求：消费后清空，之后用户在直播页自行选台不会被改回
    pageStateStore.patch('live', { channelId: '', streamIndex: 0 });
  }, [page?.live?.channelId]);

  useEffect(() => {
    let active = true;
    setTv1Error(null);
    if (!enabledTv1Sources.length) {
      setTv1Loading(false);
      return () => { active = false; };
    }

    // Skip network re-fetch if channels are already loaded in global cache
    if (globalLiveCache.tv1Channels && globalLiveCache.tv1Channels.length > 0) {
      setTv1Loading(false);
      return () => { active = false; };
    }

    setTv1Loading(true);
    const loadSource = async source => {
      try {
        await tv1LiveService.loadMetadata(source, {
          onChannel: channel => {
            if (!active) return;
            startTransition(() => {
              setTv1Channels(prev => {
                const next = [...prev, channel];
                globalLiveCache.tv1Channels = next;
                return next;
              });
              setTv1LoadedCount(count => count + 1);
            });
          },
        });
      } catch (error) {
        if (active && error?.name !== 'AbortError') setTv1Error(error);
      }
    };

    void Promise.all(enabledTv1Sources.map(loadSource)).finally(() => {
      if (active) setTv1Loading(false);
    });

    return () => {
      active = false;
    };
  }, [enabledTv1Sources]);

  const allChannels = useMemo(() => [...channels, ...tv1Channels], [channels, tv1Channels]);

  // 源启停/删除后，立即丢弃已经失效的频道选择与延迟流缓存。
  // 不能只依赖页面卸载：Live 页面可能一直挂载，而 sources 会原地变化。
  useEffect(() => {
    const availableIds = new Set(allChannels.map(channel => channel.channelId));
    setResolvedStreams(prev => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([channelId]) => availableIds.has(channelId)),
      );
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
    if (selectedChannelId && !availableIds.has(selectedChannelId)) {
      setSelectedChannelId('');
      setActiveStreamIndex(0);
    }
  }, [allChannels, selectedChannelId]);
  const activeChannelBase = useMemo(
    () => allChannels.find(channel => channel.channelId === selectedChannelId) || null,
    [allChannels, selectedChannelId],
  );
  const activeChannel = useMemo(() => {
    if (customCandidate) {
      return {
        channelId: customCandidate.candidateId,
        name: customCandidate.label || '自定义直播',
        streams: [customCandidate],
        category: '自定义',
      };
    }
    if (!activeChannelBase) return null;
    const lazy = resolvedStreams[activeChannelBase.channelId];
    const lazyStreams = Array.isArray(lazy) ? lazy : lazy?.streams;
    return lazyStreams ? { ...activeChannelBase, streams: lazyStreams } : activeChannelBase;
  }, [activeChannelBase, resolvedStreams, customCandidate]);

  const activeStream = activeChannel?.streams?.[activeStreamIndex] || activeChannel?.streams?.[0] || null;
  const [currentEPG, setCurrentEPG] = useState(null);
  const streamAbortRef = useRef(null);

  const livePlaybackRequest = useMemo(() => {
    if (!activeChannel?.streams?.length) return null;
    return playbackService.createLiveRequest({ channel: activeChannel });
  }, [activeChannel?.channelId, activeChannel?.streams]);

  const [playbackCandidate, setPlaybackCandidate] = useState(null);
  const [playbackStatus, setPlaybackStatus] = useState('idle');
  const [playbackError, setPlaybackError] = useState('');
  const [webAutoSwitchNotice, setWebAutoSwitchNotice] = useState('');
  const [resolvedPlaybackInput, setResolvedPlaybackInput] = useState(null);
  const playbackStatusRef = useRef(playbackStatus);
  playbackStatusRef.current = playbackStatus;
  const autoSkippedIndicesRef = useRef(new Set());
  const autoSkipChannelRef = useRef('');
  const playbackStartedCandidateRef = useRef(null);

  const activeStreamIndexRef = useRef(activeStreamIndex);
  activeStreamIndexRef.current = activeStreamIndex;
  const livePlaybackRequestRef = useRef(livePlaybackRequest);
  livePlaybackRequestRef.current = livePlaybackRequest;
  const playbackControllerRef = useRef(null);

  const playbackController = useMemo(() => {
    if (!livePlaybackRequest) return null;
    let ctrl = null;
    const isCurrentCtrl = () => playbackControllerRef.current === ctrl;
    ctrl = playbackService.createController(livePlaybackRequest, {
      onStateChange: state => { if (isCurrentCtrl()) setPlaybackStatus(state); },
      onCandidateChange: next => {
        if (!isCurrentCtrl()) return;
        playbackStartedCandidateRef.current = null;
        setPlaybackCandidate(next);
        if (next) {
          setPlaybackError('');
          const req = livePlaybackRequestRef.current;
          const index = req?.candidates?.findIndex(item => item.candidateId === next.candidateId);
          if (index != null && index >= 0) setActiveStreamIndex(index);
        }
      },
      onAutoFallback: ({ candidate }) => {
        if (!isCurrentCtrl()) return;
        if (detectRuntimeEnv() === RUNTIME_ENV.WEB) {
          setWebAutoSwitchNotice(`当前线路无法正常播放，正在尝试同一频道的备用线路：${candidate?.label || '下一条线路'}…`);
        }
      },
      onResolvedInput: input => { if (isCurrentCtrl()) setResolvedPlaybackInput(input); },
      onPlayerError: ({ error }) => {
        if (!isCurrentCtrl()) return;
        const errMsg = error?.message || '播放器加载失败';
        setPlaybackError(errMsg);
      },
      onParserError: ({ code }) => { if (isCurrentCtrl()) setPlaybackError('解析失败：' + code); },
      onExhausted: () => {
        if (!isCurrentCtrl()) return;
        setPlaybackStatus('error');
        if (detectRuntimeEnv() === RUNTIME_ENV.WEB) {
          setWebAutoSwitchNotice('当前频道的线路均无法播放，请稍后重试或选择其他频道。');
        }
      },
    });
    playbackControllerRef.current = ctrl;
    return ctrl;
  }, [livePlaybackRequest]);
  playbackControllerRef.current = playbackController;

  // 每次换频道后重置启动超时记录。播放错误的常规恢复由 playbackCore 统一负责；
  // 这里仅兜底处理“播放器没有报错、但一直未开始播放”的挂起场景，避免两套机制重复切线。
  useEffect(() => {
    if (autoSkipChannelRef.current !== (activeChannel?.channelId || '')) {
      autoSkipChannelRef.current = activeChannel?.channelId || '';
      autoSkippedIndicesRef.current = new Set();
      playbackStartedCandidateRef.current = null;
      setWebAutoSwitchNotice('');
    }
  }, [activeChannel?.channelId]);

  useEffect(() => {
    if (!activeChannel || !playbackCandidate) return undefined;
    if (!['loading', 'preparing', 'buffering'].includes(playbackStatus)) return undefined;

    const channelId = activeChannel.channelId;
    const candidateId = playbackCandidate.candidateId;
    const timeoutMs = detectRuntimeEnv() === RUNTIME_ENV.ANDROID ? 45000 : 35000;
    const timer = window.setTimeout(() => {
      if (activeChannel?.channelId !== channelId) return;
      if (playbackCandidate?.candidateId !== candidateId) return;
      if (playbackStartedCandidateRef.current === candidateId || playbackStatusRef.current === 'playing') return;
      if (playbackStatusRef.current === 'error' || playbackStatusRef.current === 'paused') return;

      const streams = activeChannel.streams || [];
      const currentIndex = activeStreamIndexRef.current;
      autoSkippedIndicesRef.current.add(currentIndex);
      // 只向同频道的后续线路前进，不回绕到已经失败的线路，避免自动切换死循环。
      const nextIndex = findNextLiveStreamIndex(currentIndex, streams.length, autoSkippedIndicesRef.current);

      if (nextIndex >= 0) {
        if (detectRuntimeEnv() === RUNTIME_ENV.WEB) {
          setWebAutoSwitchNotice('当前线路长时间未开始播放，正在自动切换到同一频道的下一条线路…');
        }
        handleSwitchStream(nextIndex, { preserveNotice: true });
      } else {
        setPlaybackStatus('error');
        setPlaybackError('当前频道的线路均未能在规定时间内开始播放。');
        if (detectRuntimeEnv() === RUNTIME_ENV.WEB) {
          setWebAutoSwitchNotice('当前频道的线路均无法播放，请稍后重试或选择其他频道。');
        }
      }
    }, timeoutMs);

    return () => window.clearTimeout(timer);
  }, [activeChannel?.channelId, playbackCandidate?.candidateId, activeStreamIndex, playbackStatus]);

  useEffect(() => {
    if (playbackStatus === 'playing' && playbackCandidate?.candidateId) {
      playbackStartedCandidateRef.current = playbackCandidate.candidateId;
      setPlaybackError('');
      setWebAutoSwitchNotice('');
      autoSkippedIndicesRef.current = new Set();
    }
  }, [playbackStatus, playbackCandidate?.candidateId]);

  // Load current EPG program details when active channel changes
  useEffect(() => {
    let active = true;
    setCurrentEPG(null);
    if (!activeChannel) return undefined;

    liveService.getEPG(activeChannel).then(programs => {
      if (!active || !programs?.length) return;
      const now = Date.now();
      const current = programs.find(p => p.startAt <= now && p.endAt >= now) || programs[0];
      if (current) setCurrentEPG(current);
    }).catch(() => {});

    return () => { active = false; };
  }, [activeChannel]);

  const loadChannelStreams = async (channel, forceRefresh = true, targetIndex = 0) => {
    if (!channel?.deferredRef) return;
    const existing = resolvedStreams[channel.channelId];
    const resolvedAt = existing?.resolvedAt || 0;
    const isStale = Date.now() - resolvedAt > 60000;
    if (existing && !isStale && !forceRefresh) return;

    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }
    const controller = new AbortController();
    streamAbortRef.current = controller;

    setStreamLoading(true);
    setSelectedChannelId(channel.channelId);
    setActiveStreamIndex(targetIndex);
    try {
      const streams = await resolveLiveChannelStreams(channel, {
        sources: enabledTv1Sources,
        signal: controller.signal,
        forceRefresh,
      });
      if (!controller.signal.aborted && Array.isArray(streams) && streams.length > 0) {
        setResolvedStreams(prev => ({
          ...prev,
          [channel.channelId]: { streams, resolvedAt: Date.now() },
        }));
      }
    } catch (error) {
      if (error?.name !== 'AbortError') setTv1Error(error);
    } finally {
      if (!controller.signal.aborted) {
        setStreamLoading(false);
      }
    }
  };

  const selectChannel = (channel, targetStreamIndex = 0) => {
    playbackStartedCandidateRef.current = null;
    autoSkippedIndicesRef.current = new Set();
    setWebAutoSwitchNotice('');
    setCustomCandidate(null);
    setSelectedChannelId(channel.channelId);
    setActiveStreamIndex(targetStreamIndex);
    globalLiveCache.activeStreamIndex = targetStreamIndex;
    setPlaybackCandidate(null);
    setResolvedPlaybackInput(null);
    setPlaybackError('');
    if (channel.deferredRef) {
      const existing = resolvedStreams[channel.channelId];
      const fresh = existing && Date.now() - (existing.resolvedAt || 0) < 60000;
      if (!fresh) void loadChannelStreams(channel, true, targetStreamIndex);
    }
  };

  // Keyboard & TV Box Remote D-Pad Navigation (Up/Down Arrow Keys)
  useEffect(() => {
    const handleKeyDown = event => {
      if (!allChannels.length) return;
      const tag = String(event.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable) return;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const currentIndex = allChannels.findIndex(c => c.channelId === selectedChannelId);
        let nextIndex = 0;
        if (event.key === 'ArrowUp') {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : allChannels.length - 1;
        } else {
          nextIndex = currentIndex < allChannels.length - 1 ? currentIndex + 1 : 0;
        }
        const nextChannel = allChannels[nextIndex];
        if (nextChannel) selectChannel(nextChannel);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [allChannels, selectedChannelId]);

  useEffect(() => observeNativeVideoBounds(playerWindowBodyRef.current, playbackController), [playbackController]);

  useEffect(() => {
    if (!playbackController) {
      setPlaybackCandidate(null);
      setResolvedPlaybackInput(null);
      setPlaybackStatus('idle');
      setPlaybackError('');
      return undefined;
    }
    const player = playbackController.attachPlayer(videoRef.current);
    const initial = playbackController.start();
    const currentStreamIdx = activeStreamIndexRef.current || 0;
    const req = livePlaybackRequestRef.current;
    let chosenCandidate = initial;
    let candidateAlreadyLoading = false;
    if (currentStreamIdx > 0 && req?.candidates?.[currentStreamIdx]) {
      const targetCandidate = req.candidates[currentStreamIdx];
      const switched = playbackController.switchCandidate(targetCandidate.candidateId);
      if (switched) {
        chosenCandidate = switched;
        // switchCandidate 自身已经启动 resolveAndLoad，不能再重复加载同一线路。
        candidateAlreadyLoading = true;
      }
    }
    setPlaybackCandidate(chosenCandidate);
    setResolvedPlaybackInput(null);
    if (chosenCandidate && !candidateAlreadyLoading) {
      playbackController.resolveAndLoad(chosenCandidate).catch(error => setPlaybackError(error?.message || '播放初始化失败'));
    } else if (!chosenCandidate) {
      setPlaybackStatus('error');
      setPlaybackError('没有可用的播放候选');
    }
    return () => {
      void player;
      try {
        playbackController?.stop?.();
        playbackController?.leave?.();
      } catch (e) {}
      if (videoRef?.current) {
        try {
          videoRef.current.pause();
          videoRef.current.src = "";
          videoRef.current.removeAttribute('src');
          try { videoRef.current.load(); } catch {}
        } catch (e) {}
      }
    };
  }, [playbackController]);

  useEffect(() => {
    const top = Number(page.live.scrollTop) || 0;
    requestAnimationFrame(() => window.scrollTo(0, top));
    const save = () => pageStateStore.patch('live', { scrollTop: window.scrollY });
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, []);

  const hasEnabledLiveSource = sources.some(source => source.sourceType === 'live' && source.enabled !== false);

  const categoriesList = useMemo(() => {
    const cats = new Set();
    allChannels.forEach(c => { if (c.category) cats.add(c.category); });
    return ['全部', ...Array.from(cats)];
  }, [allChannels]);

  const filteredChannels = useMemo(() => {
    if (selectedCategory === '全部') return allChannels;
    return allChannels.filter(c => (c.category || '未分类') === selectedCategory);
  }, [allChannels, selectedCategory]);

  const handleSwitchStream = (index, { preserveNotice = false } = {}) => {
    if (index < 0 || !activeChannel?.streams?.length) return;
    playbackStartedCandidateRef.current = null;
    if (!preserveNotice) setWebAutoSwitchNotice('');
    const boundedIndex = Math.max(0, Math.min(index, activeChannel.streams.length - 1));

    setActiveStreamIndex(boundedIndex);
    globalLiveCache.activeStreamIndex = boundedIndex;
    const req = livePlaybackRequestRef.current;
    const candidate = req?.candidates?.[boundedIndex];
    setPlaybackError('');
    setPlaybackStatus('loading');
    setResolvedPlaybackInput(null);
    if (candidate && playbackControllerRef.current) {
      const switched = playbackControllerRef.current.switchCandidate(candidate.candidateId);
      setPlaybackCandidate(candidate);
      if (!switched) {
        playbackControllerRef.current.resolveAndLoad(candidate, { forceRefresh: true }).catch(e => setPlaybackError(e?.message || '线路加载失败'));
      }
    } else if (activeChannel.streams[boundedIndex]) {
      const stream = activeChannel.streams[boundedIndex];
      const customCandidate = {
        candidateId: stream.streamId || `stream-${activeChannel.channelId}-${boundedIndex + 1}`,
        mediaUrl: stream.mediaUrl || stream.url,
        url: stream.mediaUrl || stream.url,
        label: stream.label || `线路 ${boundedIndex + 1}`,
        protocol: stream.protocol || 'auto',
        sourceId: stream.sourceId,
        channelId: activeChannel.channelId,
        kind: 'live',
      };
      setPlaybackCandidate(customCandidate);
      if (playbackControllerRef.current) {
        playbackControllerRef.current.resolveAndLoad(customCandidate, { forceRefresh: true }).catch(e => setPlaybackError(e?.message || '线路加载失败'));
      }
    }
  };

  const retryCurrentPlayback = () => {
    playbackStartedCandidateRef.current = null;
    autoSkippedIndicesRef.current = new Set();
    setWebAutoSwitchNotice('');
    setPlaybackError('');
    if (playbackController) {
      const initial = playbackController.start();
      if (initial) {
        setPlaybackCandidate(initial);
        playbackController.resolveAndLoad(initial).catch(err => setPlaybackError(err?.message || '播放重试失败'));
      }
    }
  };


  const handleStartImmersivePlay = async (channelToPlay = activeChannel, streamId = activeStream?.streamId) => {
    if (!channelToPlay) return;
    let targetIdx = 0;
    if (streamId && Array.isArray(channelToPlay.streams)) {
      const idx = channelToPlay.streams.findIndex(s => s.streamId === streamId || s.url === streamId);
      if (idx >= 0) targetIdx = idx;
    }
    selectChannel(channelToPlay, targetIdx);
    setIsImmersive(true);
  };

  return (
    <Page>
      <Header title="直播">
        <div className="live-custom-source-tools" style={{ display: 'flex', flex: 1, alignItems: 'center', gap: '6px', height: '32px', maxWidth: '300px' }}>
          <input
            type="text"
            placeholder="输入自定义直播地址 (http/rtmp/m3u8)..."
            ref={customUrlInputRef}
            value={customUrl}
            onChange={e => setCustomUrl(e.target.value)}
            style={{
              flex: 1,
              height: '100%',
              border: '1px solid #303643',
              background: '#11141b',
              borderRadius: '8px',
              padding: '0 10px',
              color: '#fff',
              fontSize: '12px',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={handleLoadCustomUrl}
            style={{
              height: '100%',
              padding: '0 12px',
              borderRadius: '8px',
              background: '#f2f4f8',
              color: '#101217',
              fontSize: '12px',
              fontWeight: 'bold',
              display: 'grid',
              placeItems: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            加载
          </button>
        </div>
      </Header>



      <SangtianPlayerWindow
        videoRef={videoRef}
        controller={playbackController}
        videoContainerRef={playerWindowBodyRef}
        status={playbackStatus}
        candidate={activeStream ? {
          label: playbackCandidate?.label || activeStream.label || '默认线路',
          url: playbackCandidate?.mediaUrl || activeStream.url,
          protocol: playbackCandidate?.protocol || activeStream.protocol || 'HLS/M3U8',
          sourceId: playbackCandidate?.sourceId || activeStream.sourceId,
          candidateId: playbackCandidate?.candidateId,
        } : (customCandidate ? {
          label: customCandidate.label,
          url: customCandidate.url,
          protocol: customCandidate.protocol,
          sourceId: customCandidate.sourceId,
          candidateId: customCandidate.candidateId,
        } : null)}
        idleText={streamLoading ? '正在读取频道线路…' : '请从下方选择频道开始观看'}
        candidates={livePlaybackRequest?.candidates ?? (customCandidate ? [customCandidate] : [])}
        error={describePlaybackError(playbackError)}
        resolvedInput={resolvedPlaybackInput}
        isLive
        terminalTag={activeChannel ? 'LIVE · ' + activeChannel.name : (customCandidate ? 'LIVE · 自定义地址' : 'LIVE · 等待频道')}
        channels={allChannels}
        activeChannel={activeChannel}
        activeStreamIndex={activeStreamIndex}
        onSelectChannel={selectChannel}
        onSwitchStreamIndex={handleSwitchStream}
        onSelectCandidate={id => {
          const req = livePlaybackRequestRef.current;
          const idx = req?.candidates?.findIndex(c => c.candidateId === id);
          if (idx != null && idx >= 0) {
            handleSwitchStream(idx);
          }
        }}
        onSwitchCandidate={candidateOrEvent => {
          const req = livePlaybackRequestRef.current;
          const streamsCount = activeChannel?.streams?.length || req?.candidates?.length || 0;
          if (typeof candidateOrEvent === 'string') {
            const idx = req?.candidates?.findIndex(c => c.candidateId === candidateOrEvent);
            if (idx != null && idx >= 0) {
              handleSwitchStream(idx);
              return;
            }
          }
          if (streamsCount > 1) {
            const nextIdx = (activeStreamIndexRef.current + 1) % streamsCount;
            handleSwitchStream(nextIdx);
          }
        }}
        onRetry={retryCurrentPlayback}
        onStop={() => {
          try {
            playbackController?.stop();
          } catch (e) {
            console.error("Stop live controller failed:", e);
          }
          setResolvedPlaybackInput(null);
          try {
            if (videoRef.current) {
              videoRef.current.pause();
              videoRef.current.src = "";
              videoRef.current.removeAttribute('src');
              try { videoRef.current.load(); } catch {}
            }
          } catch (e) {
            console.error("Pause live video failed:", e);
          }
        }}
        decoderEngine={decoderEngine}
        onChangeDecoderEngine={handleSwitchDecoderEngine}
        isImmersive={isImmersive}
        onToggleImmersive={next => setIsImmersive(typeof next === 'boolean' ? next : v => !v)}
        onActualFullscreenChange={setIsActualFullscreen}
        onRegisterImmersiveBackHandler={registerImmersiveBackHandler}
        onTab={onTab}
      >
        <video
          ref={videoRef}
          playsInline
          preload="metadata"
          className="sangtian-video-element"
        />
      </SangtianPlayerWindow>

      {detectRuntimeEnv() === RUNTIME_ENV.WEB && (webAutoSwitchNotice || playbackStatus === 'error' || playbackError) && (
        <div role="status" aria-live="polite" style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          margin: '10px 0', padding: '12px 14px', borderRadius: '10px',
          border: '1px solid rgba(245, 158, 11, .35)', background: 'rgba(245, 158, 11, .10)',
          color: 'var(--text-primary, #f3f4f6)', fontSize: '13px', lineHeight: 1.5,
        }}>
          <span>{webAutoSwitchNotice || '暂时无法播放这个直播地址，正在检查是否有其他可用线路…'}</span>
        </div>
      )}

      {activeChannel && (
        <div className="live-current-bar">
          <div className="live-current-header">
            <div className="live-current-info">
              <span className="live-pill">● 正在直播</span>
              <span className="live-channel-name">{activeChannel.name}</span>
              <span className="live-channel-meta">
                {activeChannel.category} · {activeStream?.label || (streamLoading ? '正在读取地址…' : '等待播放')}
                {currentEPG ? ` · 节目：${currentEPG.title || currentEPG.name}` : ''}
              </span>
            </div>

            <div className="live-current-actions">
              <button
                type="button"
                className="secondary icon-button live-fav-btn"
                onClick={() => toggleFavorite('channel', activeChannel.channelId)}
                title="收藏频道"
              >
                <Heart size={16} fill={favorites.some(i => i.targetType === 'channel' && i.targetId === activeChannel.channelId) ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                className="primary live-play-btn"
                onClick={() => handleStartImmersivePlay(activeChannel, activeStream?.streamId)}
                disabled={!activeChannel}
              >
                <Play size={14} />
                <span>沉浸播放</span>
              </button>
            </div>
          </div>

          {activeChannel.streams?.length > 1 && (
            <div className="live-stream-switcher">
              <span className="switcher-label">线路 ({activeChannel.streams.length}):</span>
              <div className="switcher-pills">
                {activeChannel.streams.map((stream, index) => (
                  <button
                    key={stream.streamId || index}
                    type="button"
                    className={`switcher-pill ${activeStreamIndex === index ? 'active' : ''}`}
                    onClick={() => handleSwitchStream(index)}
                  >
                    {stream.label || '线路 ' + (index + 1)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {hasEnabledLiveSource && (
        <>
          <div className="section-title">
            <h3>频道分组选台</h3>
            {tv1Loading && <small>正在读取：{tv1LoadedCount}</small>}
          </div>

          {tv1Error && <div className="info-card"><Radio size={18}/><div><b>部分 TV1 源读取异常</b><span>{tv1Error.message || '未知错误'}；已保留已读取的频道。</span></div></div>}

          {!allChannels.length && tv1Loading && (
            <LoadingState compact text="正在建立频道列表，暂不读取播放地址…" />
          )}

          {/* Category Tabs: Clicking tab changes channel filter below WITHOUT stopping video playback */}
          {!!allChannels.length && (
            <div className="live-category-tabs-container">
              <div className="live-category-tabs-scroll">
                {categoriesList.map(cat => {
                  const count = cat === '全部' ? allChannels.length : allChannels.filter(c => (c.category || '未分类') === cat).length;
                  const isActive = selectedCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      className={`live-category-tab ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedCategory(cat);
                        pageStateStore.patch('live', { category: cat });
                      }}
                    >
                      <span>{cat}</span>
                      <span className="count-badge">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Channel Cards Grid for Selected Category */}
          {!!filteredChannels.length && (
            <div className="live-channel-grid" aria-label="直播频道列表">
              {filteredChannels.map(channel => {
                const isCurrent = channel.channelId === activeChannel?.channelId;
                const favorite = favorites.some(i => i.targetType === 'channel' && i.targetId === channel.channelId);
                const isLazy = Boolean(channel.deferredRef);
                const isResolving = streamLoading && selectedChannelId === channel.channelId && isLazy;
                const streamCount = resolvedStreams[channel.channelId]?.streams?.length ?? channel.streams?.length ?? channel.estimatedStreamCount ?? channel.deferredRef?.lineIndices?.length ?? 0;

                return (
                  <div
                    key={channel.channelId}
                    className={`live-channel-card ${isCurrent ? 'is-playing' : ''}`}
                    onClick={() => selectChannel(channel)}
                  >
                    <div className="card-logo">
                      <SmartImage src={channel.logo} alt={channel.name} fallback={<Radio size={20} />} />
                    </div>
                    <div className="card-main">
                      <div className="card-title">
                        <b>{channel.name}</b>
                        {isCurrent && <span className="live-pill">● 播放中</span>}
                      </div>
                      <div className="card-sub">
                        {isResolving ? '正在读取地址…' : isLazy ? 'TV1 按需读取' : channel.category} · {streamCount ? `${streamCount} 条线路` : '点击播放'}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`收藏 ${channel.name}`}
                      className={`card-fav-btn ${favorite ? 'active' : ''}`}
                      onClick={e => { e.stopPropagation(); toggleFavorite('channel', channel.channelId); }}
                    >
                      <Heart size={16} fill={favorite ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      type="button"
                      aria-label={`沉浸播放 ${channel.name}`}
                      className="card-play-btn secondary icon-button"
                      onClick={async e => {
                        e.stopPropagation();
                        await handleStartImmersivePlay(channel);
                      }}
                    >
                      <Play size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {!tv1Loading && !allChannels.length && <EmptyState text="暂无可用 Live 频道" />}
        </>
      )}
    </Page>
  );
}

export function LiveChannelPanel({
  channel,
  channels = [],
  sources = [],
  favorites = [],
  onBack,
  onPlay,
  onChannel,
  toggleFavorite,
}) {
  const feature = useMemo(() => createLiveFeature({ channels }), [channels]);
  const [epg, setEpg] = useState(channel?.epg ?? []);
  const [epgLoading, setEpgLoading] = useState(false);
  const [resolvedChannel, setResolvedChannel] = useState(channel);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState('');

  useEffect(() => {
    let active = true;
    setResolvedChannel(channel);
    setStreamError('');
    if (!channel?.deferredRef || channel?.streams?.length) {
      setStreamLoading(false);
      return () => { active = false; };
    }

    setStreamLoading(true);
    void resolveLiveChannelStreams(channel, { sources })
      .then(streams => {
        if (!active) return;
        setResolvedChannel(prev => prev?.channelId === channel.channelId
          ? { ...prev, streams }
          : prev);
      })
      .catch(error => {
        if (active && error?.name !== 'AbortError') {
          setStreamError(error?.message || '播放地址读取失败');
        }
      })
      .finally(() => {
        if (active) setStreamLoading(false);
      });

    return () => { active = false; };
  }, [channel, sources]);

  useEffect(() => {
    let active = true;
    if (channel?.capabilities?.epg === false) {
      setEpg(channel?.epg ?? []);
      setEpgLoading(false);
      return () => { active = false; };
    }
    setEpg(channel?.epg ?? []);
    setEpgLoading(true);
    const now = Date.now();
    const range = {
      startAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      endAt: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
    };
    feature.getEPG(channel, range).then(items => {
      if (active && items.length) setEpg(items);
    }).catch(() => {}).finally(() => {
      if (active) setEpgLoading(false);
    });
    return () => { active = false; };
  }, [channel, feature]);

  if (!channel) {
    return (
      <Page>
        <button className="back" onClick={onBack}><ChevronLeft />返回直播列表</button>
        <EmptyState text="频道不存在或已被移除" />
      </Page>
    );
  }
  const displayChannel = resolvedChannel?.channelId === channel.channelId ? resolvedChannel : channel;
  const streams = Array.isArray(displayChannel.streams) ? displayChannel.streams : [];
  const favorite = favorites.some(i => i.targetType === 'channel' && i.targetId === channel.channelId);
  const related = channels.filter(i => i.channelId !== channel.channelId && i.category === channel.category);
  const canPlay = streams.length > 0 && !streamLoading;

  const playResolved = (streamId = null) => {
    if (!canPlay) return;
    onPlay(displayChannel, streamId);
  };

  return (
    <Page>
      <button className="back" onClick={onBack}><ChevronLeft />返回直播列表</button>
      <div className="detail-hero live-detail">
        <div className="channel-logo large">
          <SmartImage src={channel.logo} alt={channel.name} fallback={<Radio size={34} />} />
        </div>
        <div>
          <span className="eyebrow">{channel.category} · {channel.sourceRefs?.length ?? 0} 个来源</span>
          <h1>{channel.name}</h1>
          <p>
            ● 正在直播 · {streamLoading ? '正在读取播放地址…' : streams.length + ' 条线路可用'}，频道身份与线路身份保持独立。
          </p>
          {streamError && <div className="info-card"><Radio size={18} /><div><b>线路读取失败</b><span>{streamError}</span></div></div>}
          <div className="actions">
            <button className="primary" disabled={!canPlay} onClick={() => playResolved()}>
              <Play size={16} />{streamLoading ? '读取线路…' : '播放'}
            </button>
            <button className={favorite ? 'secondary active-fav' : 'secondary'} onClick={() => toggleFavorite('channel', channel.channelId)}>
              <Heart size={16} fill={favorite ? 'currentColor' : 'none'} />
              {favorite ? '已收藏' : '收藏'}
            </button>
          </div>
        </div>
      </div>
      <SectionTitle title="播放线路" />
      {streamLoading && <LoadingState compact text="正在按需读取频道播放地址…" />}
      {!streamLoading && !streams.length && <div className="empty compact"><span>{streamError || '暂无可用播放线路'}</span></div>}
      {!!streams.length && (
        <div className="channel-list">
          {streams.map(stream => (
            <button className="menu live-stream" key={stream.streamId} onClick={() => playResolved(stream.streamId)}>
              <Radio size={18} />
              <span>{stream.label || '默认线路'}<small>{stream.protocol || 'LIVE'} · {stream.sourceId || '—'}</small></span>
              <ChevronLeft className="flip" size={17} />
            </button>
          ))}
        </div>
      )}
      {channel.capabilities?.epg !== false && (
        <>
          <SectionTitle title="节目单" />
          {epgLoading && !epg.length && <LoadingState compact text="正在加载节目单…" />}
          {!epgLoading && !epg.length && <div className="empty compact"><span>暂无节目单</span></div>}
          {!!epg.length && (
            <div className="epg-list">
              {epg.map(program => (
                <div className="menu epg-item" key={program.programId}>
                  <span><b>{program.title || '未命名节目'}</b><small>{program.startAt || '—'} - {program.endAt || '—'}</small></span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {!!related.length && (
        <>
          <SectionTitle title="频道列表" />
          <div className="channel-list">
            {channels.map(item => (
              <button className="menu" key={item.channelId} onClick={() => onChannel(item)}>
                <Radio size={18} />
                <span>{item.name}<small>{item.category}</small></span>
                <ChevronLeft className="flip" size={17} />
              </button>
            ))}
          </div>
          <SectionTitle title="同分类频道" />
          <div className="channel-list">
            {related.map(item => (
              <button className="menu" key={item.channelId} onClick={() => onChannel(item)}>
                <Radio size={18} />
                <span>{item.name}<small>{Array.isArray(item.streams) && item.streams.length ? item.streams.length + ' 条线路' : item.deferredRef ? '地址按需读取' : '暂无线路'}</small></span>
                <ChevronLeft className="flip" size={17} />
              </button>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
const Page = ({ children }) => <main className="page">{children}</main>;
const Header = ({ title, children }) => (
  <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '22px', gap: '12px' }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <span className="eyebrow" style={{ display: 'block' }}>TVBOX REACT · LIVE</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '3px' }}>
        <h2 style={{ margin: 0, fontSize: '28px', whiteSpace: 'nowrap' }}>{title}</h2>
        {children}
      </div>
    </div>
  </header>
);
const SectionTitle = ({ title }) => <div className="section-title"><h3>{title}</h3></div>;
const InfoCard = ({ title, text }) => <div className="info-card"><Radio size={18} /><div><b>{title}</b><span>{text}</span></div></div>;
export const Empty = ({ text }) => <div className="empty"><Radio size={22} /><span>{text}</span></div>;
