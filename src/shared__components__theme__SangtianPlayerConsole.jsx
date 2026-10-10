import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Copy, Maximize2, Minimize2, RotateCw, Sparkles, Terminal, Paperclip,
  Play, Pause, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Rewind, FastForward,
  FileText, LayoutGrid, SlidersHorizontal, Check, RefreshCw, Ratio,
  Lock, Unlock, ListVideo, Square, Heart, Search, Radio,
  Home, Film, User, Settings, GitBranch, Tv, Clock3, Wifi, CalendarDays,
  ChevronUp, Eye, EyeOff, X, Star
} from 'lucide-react';
import {
  getPlaybackRouteConfig,
  detectRuntimeEnv,
  RUNTIME_ENV,
  MEDIA_KIND,
  VIEW_TIER
} from './core__playback__playbackStrategyDispatcher.js';

const NUMERIC_ASPECT_PRESETS = [
  { id: '16:9', label: '16:9', title: '16:9 宽屏比例' },
  { id: '16:10', label: '16:10', title: '16:10 宽屏比例' },
  { id: '21:9', label: '21:9', title: '21:9 超宽屏比例' },
  { id: '4:3', label: '4:3', title: '4:3 传统电视比例' },
  { id: '3:2', label: '3:2', title: '3:2 横向比例' },
  { id: '1:1', label: '1:1', title: '1:1 正方形比例' },
  { id: '3:4', label: '3:4', title: '3:4 竖向比例' },
  { id: '9:16', label: '9:16', title: '9:16 竖屏比例' },
];

const OTHER_ASPECT_PRESETS = [
  { id: 'original', label: '原始比例', title: '按照视频源的实际宽高比显示' },
  { id: 'custom', label: '自定义比例', title: '输入自定义宽高比' },
];

const FIT_MODE_OPTIONS = [
  { id: 'contain', label: '完整显示', description: '保留全部画面，必要时出现黑边' },
  { id: 'crop', label: '裁剪', description: '手动放大并移动，调整保留区域' },
  { id: 'fill', label: '充满', description: '保持比例并自动铺满目标区域' },
  { id: 'stretch', label: '拉伸', description: '强制填满目标区域，画面可能变形' },
];

function readStoredValue(key, fallback) {
  try {
    if (typeof window === 'undefined') return fallback;
    const value = window.localStorage.getItem(key);
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeStoredValue(key, value) {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function ratioFromPreset(id, customWidth, customHeight, sourceRatio) {
  if (id === 'original') return sourceRatio || 16 / 9;
  if (id === 'custom') {
    const width = Number(customWidth);
    const height = Number(customHeight);
    return width > 0 && height > 0 ? width / height : 16 / 9;
  }
  const [width, height] = String(id).split(':').map(Number);
  return width > 0 && height > 0 ? width / height : 16 / 9;
}

function normalizedRatioLabel(widthValue, heightValue) {
  const width = Math.round(Number(widthValue));
  const height = Math.round(Number(heightValue));
  if (!(width > 0 && height > 0)) return '自定义';
  let a = width;
  let b = height;
  while (b) [a, b] = [b, a % b];
  return `${width / Math.max(1, a)}:${height / Math.max(1, a)}`;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function SangtianPlayerWindow({
  videoRef, controller, status, error, resolvedInput, candidate, request, onRetry, onSwitchCandidate, onStop,
  onFullscreen, terminalTag = 'BASH', children, videoContainerRef, isLive = false,
  playbackRate = 1.0, onChangePlaybackRate,
  channels = [], activeChannel = null, activeStreamIndex = 0, onSelectChannel, onSwitchStreamIndex,
  decoderEngine = 'ijk_hardware', onChangeDecoderEngine,
  isImmersive = false, onToggleImmersive, onActualFullscreenChange, onRegisterImmersiveBackHandler, onTab,
  title = '', episodeLabel = '', sourceLabel = '',
  episodes = [], currentEpisodeIndex = 0, onSelectEpisode,
  onPreviousEpisode, onNextEpisode,
  candidates = [], onSelectCandidate, onOpenSourceModal,
  onTimeMetricsChange,
  idleText = '',
}) {
  const aspectStoragePrefix = isLive ? 'mybox.live.aspect' : 'mybox.vod.aspect';
  const [showTerminal, setShowTerminal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [isSystemFullscreen, setIsSystemFullscreen] = useState(false);
  const [isWebFullscreen, setIsWebFullscreen] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [showUnlockHint, setShowUnlockHint] = useState(false);
  const [lockHintKey, setLockHintKey] = useState(0);
  const lockHintTimeoutRef = useRef(null);
  // 比例预设负责目标显示区域；适配模式负责视频如何填入该区域，两者独立保存。
  const [aspectMode, setAspectMode] = useState(() => {
    const saved = readStoredValue(`${aspectStoragePrefix}.preset`, null);
    const valid = ['original', 'custom', ...NUMERIC_ASPECT_PRESETS.map(item => item.id)];
    return valid.includes(saved) ? saved : (isLive ? 'original' : '16:9');
  });
  const [fitMode, setFitMode] = useState(() => {
    const saved = readStoredValue(`${aspectStoragePrefix}.fit`, null);
    return FIT_MODE_OPTIONS.some(item => item.id === saved) ? saved : (isLive ? 'contain' : 'fill');
  });
  const [showAspectPanel, setShowAspectPanel] = useState(false);
  const [aspectNotice, setAspectNotice] = useState('');
  const [customWidth, setCustomWidth] = useState(() => String(readStoredValue(`${aspectStoragePrefix}.customWidth`, 5)));
  const [customHeight, setCustomHeight] = useState(() => String(readStoredValue(`${aspectStoragePrefix}.customHeight`, 4)));
  const [aspectFavorites, setAspectFavorites] = useState(() => {
    const saved = readStoredValue(`${aspectStoragePrefix}.favorites`, null);
    return Array.isArray(saved) ? [...new Set(saved.filter(value => value === 'original' || value === 'custom' || NUMERIC_ASPECT_PRESETS.some(item => item.id === value)))].slice(0, 6) : ['16:9', '4:3', '9:16'];
  });
  const [lockZoomEnabled, setLockZoomEnabled] = useState(() => Boolean(readStoredValue(`${aspectStoragePrefix}.zoomEnabled`, false)));
  const [lockZoomScale, setLockZoomScale] = useState(() => clampNumber(readStoredValue(`${aspectStoragePrefix}.zoomScale`, 1), 1, 3));
  const [cropScale, setCropScale] = useState(() => clampNumber(readStoredValue(`${aspectStoragePrefix}.cropScale`, 1.15), 1, 2.5));
  const [videoPan, setVideoPan] = useState(() => {
    const saved = readStoredValue(`${aspectStoragePrefix}.pan`, null);
    return saved && Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))
      ? { x: clampNumber(saved.x, -45, 45), y: clampNumber(saved.y, -45, 45) }
      : { x: 0, y: 0 };
  });
  const aspectTransformRef = useRef({});
  const gestureRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedSeconds, setBufferedSeconds] = useState(0);
  const [bufferRate, setBufferRate] = useState(0);
  const [networkDownlink, setNetworkDownlink] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showFullscreenBar, setShowFullscreenBar] = useState(true);
  const [controlHideProgressKey, setControlHideProgressKey] = useState(0);
  const [showEmbeddedNav, setShowEmbeddedNav] = useState(true);
  const [showLeftSidebar, setShowLeftSidebar] = useState(false);
  const [showRightSidebar, setShowRightSidebar] = useState(false);
  const [showEpisodeSidebar, setShowEpisodeSidebar] = useState(false);
  const [episodePage, setEpisodePage] = useState(0);
  const [immersiveMenu, setImmersiveMenu] = useState(null);
  const [showImmersiveInfo, setShowImmersiveInfo] = useState(() => {
    try { return window.localStorage.getItem('mybox.live.immersiveInfoVisible') !== 'false'; } catch { return true; }
  });
  const [showImmersiveActions, setShowImmersiveActions] = useState(() => {
    try { return window.localStorage.getItem('mybox.live.immersiveActionsVisible') !== 'false'; } catch { return true; }
  });
  const [liveNow, setLiveNow] = useState(() => new Date());
  const [liveWatchSeconds, setLiveWatchSeconds] = useState(0);
  const liveWatchSecondsRef = useRef(0);
  const [videoAspectRatio, setVideoAspectRatio] = useState(16 / 9);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  const lastWatchChannelKeyRef = useRef('');
  const [isStoppedManually, setIsStoppedManually] = useState(false);

  useEffect(() => {
    setIsStoppedManually(false);
  }, [candidate?.candidateId, candidate?.url, resolvedInput?.url]);

  const lastBufferRef = useRef({ time: 0, buffered: 0 });
  const wasSystemFullscreenRef = useRef(false);
  const controlsTimeoutRef = useRef(null);
  const immersiveRef = useRef(isImmersive);
  const fullscreenRef = useRef(false);

  useEffect(() => { immersiveRef.current = isImmersive; }, [isImmersive]);
  const embeddedTimeoutRef = useRef(null);

  useEffect(() => () => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (embeddedTimeoutRef.current) clearTimeout(embeddedTimeoutRef.current);
    if (lockHintTimeoutRef.current) clearTimeout(lockHintTimeoutRef.current);
  }, []);

  const streamUrl = resolvedInput?.url || candidate?.mediaUrl || candidate?.url || candidate?.metadata?.url || '';
  const customRatioLabel = normalizedRatioLabel(customWidth, customHeight);
  const aspectOptions = [
    ...OTHER_ASPECT_PRESETS.filter(item => item.id === 'original'),
    ...NUMERIC_ASPECT_PRESETS,
    { id: 'custom', label: customRatioLabel, title: `自定义比例 ${customRatioLabel}` },
  ];
  const currentAspect = aspectOptions.find(item => item.id === aspectMode) || aspectOptions[0];
  const currentAspectRatio = clampNumber(ratioFromPreset(aspectMode, customWidth, customHeight, videoAspectRatio), 0.2, 5);
  const mediaScale = (fitMode === 'crop' ? cropScale : 1) * (lockZoomEnabled ? lockZoomScale : 1);

  useEffect(() => {
    writeStoredValue(`${aspectStoragePrefix}.preset`, aspectMode);
  }, [aspectStoragePrefix, aspectMode]);
  useEffect(() => {
    writeStoredValue(`${aspectStoragePrefix}.fit`, fitMode);
  }, [aspectStoragePrefix, fitMode]);
  useEffect(() => {
    writeStoredValue(`${aspectStoragePrefix}.customWidth`, Number(customWidth) > 0 ? Number(customWidth) : 5);
    writeStoredValue(`${aspectStoragePrefix}.customHeight`, Number(customHeight) > 0 ? Number(customHeight) : 4);
  }, [aspectStoragePrefix, customWidth, customHeight]);
  useEffect(() => {
    writeStoredValue(`${aspectStoragePrefix}.favorites`, aspectFavorites);
  }, [aspectStoragePrefix, aspectFavorites]);
  useEffect(() => {
    writeStoredValue(`${aspectStoragePrefix}.zoomEnabled`, lockZoomEnabled);
    writeStoredValue(`${aspectStoragePrefix}.zoomScale`, lockZoomScale);
    writeStoredValue(`${aspectStoragePrefix}.cropScale`, cropScale);
    writeStoredValue(`${aspectStoragePrefix}.pan`, videoPan);
  }, [aspectStoragePrefix, lockZoomEnabled, lockZoomScale, cropScale, videoPan]);

  aspectTransformRef.current = { fitMode, lockZoomEnabled, lockZoomScale, cropScale, videoPan };

  useEffect(() => {
    const video = videoRef?.current;
    if (!video) return undefined;

    const touchDistance = touches => {
      if (!touches || touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const handleTouchStart = event => {
      const state = aspectTransformRef.current;
      if (event.touches.length >= 2) {
        const activeZoom = state.lockZoomEnabled ? state.lockZoomScale : 1;
        gestureRef.current = {
          type: 'pinch',
          startDistance: Math.max(1, touchDistance(event.touches)),
          startZoom: activeZoom,
        };
        event.preventDefault();
      } else if (event.touches.length === 1 && (state.fitMode === 'crop' || (state.lockZoomEnabled && state.lockZoomScale > 1))) {
        const touch = event.touches[0];
        gestureRef.current = {
          type: 'pan',
          startX: touch.clientX,
          startY: touch.clientY,
          startPan: { ...(state.videoPan || { x: 0, y: 0 }) },
        };
      }
    };

    const handleTouchMove = event => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const state = aspectTransformRef.current;
      if (gesture.type === 'pinch' && event.touches.length >= 2) {
        event.preventDefault();
        const distance = touchDistance(event.touches);
        setLockZoomEnabled(true);
        setLockZoomScale(clampNumber(gesture.startZoom * distance / gesture.startDistance, 1, 3));
      } else if (gesture.type === 'pan' && event.touches.length === 1 && (state.fitMode === 'crop' || state.lockZoomEnabled)) {
        event.preventDefault();
        const touch = event.touches[0];
        const rect = video.parentElement?.getBoundingClientRect?.() || video.getBoundingClientRect();
        const dx = rect.width > 0 ? (touch.clientX - gesture.startX) / rect.width * 100 : 0;
        const dy = rect.height > 0 ? (touch.clientY - gesture.startY) / rect.height * 100 : 0;
        setVideoPan({
          x: clampNumber(gesture.startPan.x + dx, -45, 45),
          y: clampNumber(gesture.startPan.y + dy, -45, 45),
        });
      }
    };

    const handleTouchEnd = event => {
      if (!event.touches.length) {
        gestureRef.current = null;
        return;
      }
      const state = aspectTransformRef.current;
      if (event.touches.length === 1 && (state.fitMode === 'crop' || state.lockZoomEnabled)) {
        const touch = event.touches[0];
        gestureRef.current = {
          type: 'pan',
          startX: touch.clientX,
          startY: touch.clientY,
          startPan: { ...(state.videoPan || { x: 0, y: 0 }) },
        };
      }
    };

    video.addEventListener('touchstart', handleTouchStart, { passive: false });
    video.addEventListener('touchmove', handleTouchMove, { passive: false });
    video.addEventListener('touchend', handleTouchEnd, { passive: false });
    video.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    return () => {
      video.removeEventListener('touchstart', handleTouchStart);
      video.removeEventListener('touchmove', handleTouchMove);
      video.removeEventListener('touchend', handleTouchEnd);
      video.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [videoRef]);

  const openAspectPanel = () => {
    setAspectNotice('');
    setShowAspectPanel(true);
    setShowRightSidebar(false);
    setShowLeftSidebar(false);
    setShowEpisodeSidebar(false);
    setImmersiveMenu(null);
    clearControlsTimeout();
    setShowFullscreenBar(true);
  };

  const closeAspectPanel = () => {
    setShowAspectPanel(false);
    if (fullscreen && isPlaying && !isLocked) resetControlsTimeout();
  };

  const toggleAspectFavorite = (id) => {
    if (aspectFavorites.includes(id)) {
      setAspectFavorites(current => current.filter(value => value !== id));
      setAspectNotice('已从常用比例移除。');
      return;
    }
    if (aspectFavorites.length >= 6) {
      setAspectNotice('常用比例最多保存 6 项，请先移除一项。');
      return;
    }
    setAspectFavorites(current => [...current, id]);
    setAspectNotice('已添加到常用比例。');
  };

  const selectAspectPreset = (id) => {
    setAspectMode(id);
    setAspectNotice('');
    if (id === 'custom') {
      const width = Number(customWidth);
      const height = Number(customHeight);
      if (!(width > 0 && height > 0 && width <= 10000 && height <= 10000)) {
        setAspectNotice('请先输入有效的自定义宽度和高度。');
      }
    }
  };

  const applyCustomAspect = () => {
    const width = Number(customWidth);
    const height = Number(customHeight);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 10000 || height > 10000) {
      setAspectNotice('宽度和高度必须是 1–10000 之间的整数。');
      return;
    }
    setAspectMode('custom');
    setAspectNotice(`已应用自定义比例 ${normalizedRatioLabel(width, height)}。`);
  };

  const resetAspectTransform = () => {
    setLockZoomEnabled(false);
    setLockZoomScale(1);
    setCropScale(1.15);
    setVideoPan({ x: 0, y: 0 });
    setAspectNotice('已恢复默认缩放与画面位置。');
  };

  const renderAspectCard = (option, compact = false) => {
    const ratio = clampNumber(ratioFromPreset(option.id, customWidth, customHeight, videoAspectRatio), 0.2, 5);
    const previewWidth = ratio >= 1 ? Math.min(40, 40 * ratio / Math.max(1, ratio)) : Math.max(8, 40 * ratio);
    const previewHeight = ratio >= 1 ? Math.max(8, 40 / ratio) : 40;
    const selected = aspectMode === option.id;
    const favorite = aspectFavorites.includes(option.id);
    return (
      <div key={option.id} className={`aspect-ratio-card ${selected ? 'selected' : ''} ${compact ? 'compact' : ''}`}>
        <button type="button" className="aspect-ratio-select" onClick={() => selectAspectPreset(option.id)} aria-pressed={selected} title={option.title}>
          <span className="aspect-ratio-shape-wrap"><span className="aspect-ratio-shape" style={{ width: `${previewWidth}px`, height: `${previewHeight}px` }} /></span>
          <strong>{option.label}</strong>
          {selected && <Check className="aspect-ratio-selected-check" size={14} aria-hidden="true" />}
        </button>
        <button type="button" className={`aspect-favorite-toggle ${favorite ? 'is-favorite' : ''}`} onClick={() => toggleAspectFavorite(option.id)} aria-label={favorite ? `从常用比例移除 ${option.label}` : `将 ${option.label} 添加到常用比例`} title={favorite ? '取消常用' : '添加到常用'}>
          <Star size={13} fill={favorite ? 'currentColor' : 'none'} />
        </button>
      </div>
    );
  };

  const setAspectPanAxis = (axis, value) => {
    setVideoPan(current => ({ ...current, [axis]: clampNumber(value, -45, 45) }));
  };

  const formatTime = value => {
    if (!Number.isFinite(value)) return '00:00';
    const total = Math.max(0, Math.floor(value));
    return `${Math.floor(total / 3600) ? String(Math.floor(total / 3600)).padStart(2,'0') + ':' : ''}${String(Math.floor((total % 3600) / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
  };
  const formatWatchDuration = value => {
    const total = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const syncMediaMetrics = () => {
    const video = videoRef?.current;
    if (!video) return;
    const cur = Number(video.currentTime) || 0;
    const dur = Number(video.duration) || 0;
    setCurrentTime(cur);
    setDuration(dur);
    onTimeMetricsChange?.(cur, dur);
    let forwardBuffer = 0;
    try {
      if (video.buffered?.length) {
        const end = video.buffered.end(video.buffered.length - 1);
        forwardBuffer = Math.max(0, end - cur);
      }
    } catch {}
    setBufferedSeconds(forwardBuffer);
    const now = performance.now();
    const previous = lastBufferRef.current;
    if (previous.time > 0 && now > previous.time && forwardBuffer >= previous.buffered) {
      setBufferRate((forwardBuffer - previous.buffered) / ((now - previous.time) / 1000));
    }
    lastBufferRef.current = { time: now, buffered: forwardBuffer };
  };

  useEffect(() => {
    let boundVideo = null;
    const events = ['timeupdate', 'progress', 'loadedmetadata', 'durationchange', 'playing', 'pause', 'waiting', 'stalled', 'canplay', 'seeking', 'seeked', 'ended'];
    const update = (event) => {
      if (event?.type === 'waiting' || event?.type === 'stalled' || event?.type === 'seeking') setIsBuffering(true);
      if (event?.type === 'playing' || event?.type === 'canplay' || event?.type === 'timeupdate' || event?.type === 'seeked' || event?.type === 'pause' || event?.type === 'ended') setIsBuffering(false);
      const video = videoRef?.current;
      if (video) {
        syncMediaMetrics();
        if (Number(video.videoWidth) > 0 && Number(video.videoHeight) > 0) {
          setVideoAspectRatio(Number(video.videoWidth) / Number(video.videoHeight));
        }
        const activePlaying = !video.paused && !video.ended && (video.currentTime > 0 || video.readyState >= 2);
        setIsPlaying(activePlaying);
        if (video !== boundVideo) {
          if (boundVideo) {
            events.forEach(event => boundVideo.removeEventListener(event, update));
          }
          boundVideo = video;
          events.forEach(event => video.addEventListener(event, update));
        }
      }
    };

    const timer = window.setInterval(update, 250);
    update();

    return () => {
      window.clearInterval(timer);
      if (boundVideo) {
        events.forEach(event => boundVideo.removeEventListener(event, update));
      }
    };
  }, [videoRef, candidate, resolvedInput, status]);

  useEffect(() => {
    const connection = typeof navigator !== 'undefined'
      ? (navigator.connection || navigator.mozConnection || navigator.webkitConnection)
      : null;
    const update = () => setNetworkDownlink(connection?.downlink != null && Number.isFinite(Number(connection.downlink)) ? Number(connection.downlink) : null);
    update();
    connection?.addEventListener?.('change', update);
    return () => connection?.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isSystem = Boolean(document.fullscreenElement);
      setIsSystemFullscreen(isSystem);
      if (!isSystem) {
        setShowLeftSidebar(false);
        setShowRightSidebar(false);
        setShowEpisodeSidebar(false);
        // Esc/系统手势只退出浏览器系统全屏，不结束 Live 的页面内沉浸模式。
        if (wasSystemFullscreenRef.current) setIsWebFullscreen(false);
        try { screen.orientation?.unlock?.(); } catch {}
      }
      wasSystemFullscreenRef.current = isSystem;
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange();
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // 以实际视口方向为准，避免旋转按钮状态与设备方向脱节。
  useEffect(() => {
    onActualFullscreenChange?.(Boolean(isSystemFullscreen || isWebFullscreen));
  }, [isSystemFullscreen, isWebFullscreen, onActualFullscreenChange]);

  useEffect(() => {
    if (!isLive) return undefined;
    onRegisterImmersiveBackHandler?.(() => {
      if (showAspectPanel) {
        setShowAspectPanel(false);
        return true;
      }
      if (immersiveMenu) {
        setImmersiveMenu(null);
        return true;
      }
      if (showLeftSidebar || showRightSidebar || showEpisodeSidebar) {
        setShowLeftSidebar(false);
        setShowRightSidebar(false);
        setShowEpisodeSidebar(false);
        setShowFullscreenBar(true);
        return true;
      }
      if (isSystemFullscreen || isWebFullscreen) {
        void handleToggleFullscreen();
        return true;
      }
      return false;
    });
    return () => onRegisterImmersiveBackHandler?.(null);
  }, [isLive, showAspectPanel, immersiveMenu, showLeftSidebar, showRightSidebar, showEpisodeSidebar, isSystemFullscreen, isWebFullscreen, onRegisterImmersiveBackHandler]);

  useEffect(() => {
    const syncOrientation = () => {
      const orientationType = typeof screen !== 'undefined' ? screen.orientation?.type : '';
      const landscapeByApi = typeof orientationType === 'string' && orientationType.length > 0
        ? orientationType.startsWith('landscape')
        : null;
      const landscapeByViewport = typeof window !== 'undefined'
        ? window.innerWidth > window.innerHeight
        : false;
      // Live 的主界面和沉浸界面始终按竖屏布局；只有实际进入全屏后才跟踪设备方向。
      // 影视播放器继续沿用原有方向行为。
      const shouldTrackOrientation = isLive
        ? (isSystemFullscreen || isWebFullscreen)
        : (isImmersive || isSystemFullscreen || isWebFullscreen);
      setIsLandscape(shouldTrackOrientation ? (landscapeByApi ?? landscapeByViewport) : false);
    };
    syncOrientation();
    window.addEventListener('resize', syncOrientation, { passive: true });
    window.addEventListener('orientationchange', syncOrientation, { passive: true });
    screen.orientation?.addEventListener?.('change', syncOrientation);
    return () => {
      window.removeEventListener('resize', syncOrientation);
      window.removeEventListener('orientationchange', syncOrientation);
      screen.orientation?.removeEventListener?.('change', syncOrientation);
    };
  }, [isLive, isImmersive, isSystemFullscreen, isWebFullscreen]);

  // 键盘 Esc：优先关闭弹层，其次退出页面内沉浸；原生全屏由浏览器自身 fullscreenchange 处理。
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== 'Escape' && event.key !== 'Esc') return;
      if (showAspectPanel) {
        event.preventDefault();
        setShowAspectPanel(false);
        setShowFullscreenBar(true);
        return;
      }
      if (document.fullscreenElement) return;
      if (isLive && immersiveRef.current && immersiveMenu) {
        event.preventDefault();
        setImmersiveMenu(null);
        setShowFullscreenBar(true);
        return;
      }
      if (showLeftSidebar || showRightSidebar || showEpisodeSidebar) {
        event.preventDefault();
        setShowLeftSidebar(false);
        setShowRightSidebar(false);
        setShowEpisodeSidebar(false);
        setShowFullscreenBar(true);
        return;
      }
      if (isLive && immersiveRef.current) {
        event.preventDefault();
        closeImmersiveUi();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isLive, showAspectPanel, immersiveMenu, showLeftSidebar, showRightSidebar, showEpisodeSidebar]);

  // 直播：沉浸状态由父级 isImmersive 统一驱动，关闭沉浸时同步收起 web 全屏
  useEffect(() => {
    if (isLive && !isImmersive) setIsWebFullscreen(false);
  }, [isLive, isImmersive]);

  // Auto-hide fullscreen controls after 3 seconds of inactivity.
  // Live 的竖屏沉浸是完整页面；只有真正的系统/网页全屏才使用全屏覆盖控制。
  const immersiveLivePage = Boolean(isLive && isImmersive && !isSystemFullscreen && !isWebFullscreen);
  const fullscreen = isSystemFullscreen || isWebFullscreen || (isImmersive && !isLive);
  fullscreenRef.current = fullscreen;

  const clearControlsTimeout = () => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }
  };

  const resetControlsTimeout = () => {
    clearControlsTimeout();
    setControlHideProgressKey(value => value + 1);
    setShowFullscreenBar(true);
    // 打开侧栏/设置面板或锁屏时不自动隐藏，避免操作过程中面板突然消失。
    if (fullscreen && isPlaying && !isLocked && !showAspectPanel && !showLeftSidebar && !showRightSidebar && !showEpisodeSidebar) {
      controlsTimeoutRef.current = window.setTimeout(() => {
        if (fullscreenRef.current) setShowFullscreenBar(false);
        controlsTimeoutRef.current = null;
      }, 3000);
    }
  };

  const handleFullscreenBlankClick = (e) => {
    if (!fullscreen || isLocked) return;
    if (showLeftSidebar || showRightSidebar || showEpisodeSidebar) {
      setShowLeftSidebar(false);
      setShowRightSidebar(false);
      setShowEpisodeSidebar(false);
      setShowFullscreenBar(true);
      resetControlsTimeout();
      return;
    }
    const isInteractive = Boolean(
      e.target.closest('button, input, select, textarea, a, .setting-btn, .sidebar-channel-item, .sidebar-chip, .close-sidebar-btn, .sangtian-ep-btn, .quick-line-pill')
    );
    if (!isInteractive) {
      e.stopPropagation();
      setShowFullscreenBar(prev => {
        const nextState = !prev;
        if (!nextState) {
          setShowLeftSidebar(false);
          setShowRightSidebar(false);
          setShowEpisodeSidebar(false);
        } else if (isPlaying && !isLocked && !showLeftSidebar && !showRightSidebar && !showEpisodeSidebar) {
          resetControlsTimeout();
        }
        return nextState;
      });
    }
  };

  const resetEmbeddedControlsTimeout = () => {
    if (embeddedTimeoutRef.current) clearTimeout(embeddedTimeoutRef.current);
    setControlHideProgressKey(value => value + 1);
    setShowEmbeddedNav(true);
    if (!fullscreen && isPlaying) {
      embeddedTimeoutRef.current = setTimeout(() => {
        setShowEmbeddedNav(false);
      }, 3000);
    }
  };

  const handleEmbeddedBlankClick = (e) => {
    if (fullscreen) return;
    const isInteractive = Boolean(
      e.target.closest('button, input, select, textarea, a, .setting-btn, .sidebar-channel-item, .sidebar-chip, .close-sidebar-btn, .sangtian-ep-btn')
    );
    if (!isInteractive) {
      e.stopPropagation();
      setShowEmbeddedNav(prev => {
        const nextState = !prev;
        if (nextState && isPlaying) {
          if (embeddedTimeoutRef.current) clearTimeout(embeddedTimeoutRef.current);
          embeddedTimeoutRef.current = setTimeout(() => {
            setShowEmbeddedNav(false);
          }, 3000);
        }
        return nextState;
      });
    }
  };

  useEffect(() => {
    if (fullscreen && isPlaying && !isLocked) {
      resetControlsTimeout();
    } else if (fullscreen) {
      setShowFullscreenBar(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    }
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [fullscreen, isPlaying, isLocked, showAspectPanel, showLeftSidebar, showRightSidebar, showEpisodeSidebar]);

  useEffect(() => {
    if (!fullscreen && isPlaying) {
      resetEmbeddedControlsTimeout();
    } else if (!fullscreen) {
      setShowEmbeddedNav(true);
      if (embeddedTimeoutRef.current) clearTimeout(embeddedTimeoutRef.current);
    }
    return () => {
      if (embeddedTimeoutRef.current) clearTimeout(embeddedTimeoutRef.current);
    };
  }, [fullscreen, isPlaying]);

  const [selectedSidebarCat, setSelectedSidebarCat] = useState('全部');
  const [sidebarSearch, setSidebarSearch] = useState('');

  const sidebarCategories = React.useMemo(() => {
    const cats = new Set();
    channels.forEach(c => { if (c.category) cats.add(c.category); });
    return ['全部', ...Array.from(cats)];
  }, [channels]);

  const filteredSidebarChannels = React.useMemo(() => {
    const query = sidebarSearch.trim().toLocaleLowerCase();
    return channels.filter((channel) => {
      const categoryMatches = selectedSidebarCat === '全部' || (channel.category || '未分类') === selectedSidebarCat;
      const nameMatches = !query || String(channel.name || '').toLocaleLowerCase().includes(query);
      return categoryMatches && nameMatches;
    });
  }, [channels, selectedSidebarCat, sidebarSearch]);

  const [clockTime, setClockTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      const d = new Date();
      setClockTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    }, 10000);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isLive || !isImmersive) return;
    const update = () => setLiveNow(new Date());
    update();
    const timer = window.setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [isLive, isImmersive]);

  const watchChannelKey = isLive
    ? String(activeChannel?.channelId || (candidate?.sourceId === 'custom' ? candidate?.candidateId : '') || candidate?.candidateId || candidate?.url || '')
    : '';

  useEffect(() => {
    if (!isLive || !watchChannelKey) return;
    if (lastWatchChannelKeyRef.current !== watchChannelKey) {
      lastWatchChannelKeyRef.current = watchChannelKey;
      liveWatchSecondsRef.current = 0;
      setLiveWatchSeconds(0);
    }
  }, [isLive, watchChannelKey]);

  useEffect(() => {
    if (isLive && isImmersive) setLiveWatchSeconds(liveWatchSecondsRef.current);
  }, [isLive, isImmersive]);

  useEffect(() => {
    if (!isLive) return;
    const timer = window.setInterval(() => {
      const video = videoRef?.current;
      const canCount = Boolean(
        video && isPlaying && !video.paused && !video.ended && !isBuffering
        && status !== 'error' && status !== 'stopped' && status !== 'loading' && status !== 'preparing'
      );
      if (canCount) {
        liveWatchSecondsRef.current += 1;
        if (isImmersive) setLiveWatchSeconds(liveWatchSecondsRef.current);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isLive, isImmersive, isPlaying, isBuffering, status, videoRef]);

  useEffect(() => {
    try { window.localStorage.setItem('mybox.live.immersiveInfoVisible', String(showImmersiveInfo)); } catch {}
  }, [showImmersiveInfo]);
  useEffect(() => {
    try { window.localStorage.setItem('mybox.live.immersiveActionsVisible', String(showImmersiveActions)); } catch {}
  }, [showImmersiveActions]);

  const availableStreams = (activeChannel?.streams && activeChannel.streams.length > 0)
    ? activeChannel.streams
    : (candidates && candidates.length > 0)
    ? candidates
    : [];
  const totalStreams = availableStreams.length > 0 ? availableStreams.length : 1;
  const currentStreamNum = Math.min(totalStreams, Math.max(1, (activeStreamIndex ?? 0) + 1));

  const handlePrevStream = (e) => {
    e?.stopPropagation?.();
    if (!totalStreams || totalStreams <= 1) return;
    const prev = (activeStreamIndex != null && activeStreamIndex > 0) ? activeStreamIndex - 1 : totalStreams - 1;
    const cand = candidates?.[prev];
    // Use exactly one callback per user action: the Live feature owns the actual
    // stream switch, and invoking multiple callbacks here could load the same
    // source two or three times.
    if (onSwitchStreamIndex) onSwitchStreamIndex(prev);
    else if (cand?.candidateId && onSelectCandidate) onSelectCandidate(cand.candidateId);
    else if (onSwitchCandidate) onSwitchCandidate(cand?.candidateId || prev);
  };

  const handleNextStream = (e) => {
    e?.stopPropagation?.();
    if (!totalStreams || totalStreams <= 1) return;
    const next = (activeStreamIndex != null && activeStreamIndex + 1 < totalStreams) ? activeStreamIndex + 1 : 0;
    const cand = candidates?.[next];
    // Keep stream switching single-dispatch to avoid duplicate player reloads.
    if (onSwitchStreamIndex) onSwitchStreamIndex(next);
    else if (cand?.candidateId && onSelectCandidate) onSelectCandidate(cand.candidateId);
    else if (onSwitchCandidate) onSwitchCandidate(cand?.candidateId || next);
  };

  const handleCopyLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && streamUrl) {
      navigator.clipboard.writeText(streamUrl).catch(() => {});
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleLockedScreenTap = () => {
    if (!isLocked) return;
    setShowUnlockHint(true);
    setLockHintKey(value => value + 1);
    if (lockHintTimeoutRef.current) clearTimeout(lockHintTimeoutRef.current);
    lockHintTimeoutRef.current = window.setTimeout(() => {
      setShowUnlockHint(false);
      lockHintTimeoutRef.current = null;
    }, 1800);
  };

  const unlockScreen = (event) => {
    event?.stopPropagation?.();
    if (lockHintTimeoutRef.current) clearTimeout(lockHintTimeoutRef.current);
    lockHintTimeoutRef.current = null;
    setShowUnlockHint(false);
    setIsLocked(false);
    setShowFullscreenBar(true);
    resetControlsTimeout();
  };

  const closeImmersiveUi = () => {
    setShowLeftSidebar(false);
    setShowRightSidebar(false);
    setShowEpisodeSidebar(false);
    setImmersiveMenu(null);
    setIsLocked(false);
    setShowUnlockHint(false);
    if (lockHintTimeoutRef.current) clearTimeout(lockHintTimeoutRef.current);
    setShowFullscreenBar(true);
    clearControlsTimeout();
    try { screen.orientation?.unlock?.(); } catch {}
    if (isLive && onToggleImmersive) onToggleImmersive(false);
    setIsWebFullscreen(false);
  };

  const handleBackFromPlayer = () => {
    // Live 沉浸但未处于真正全屏时，返回键应退出沉浸回到频道主界面。
    if (isLive && isImmersive && !isSystemFullscreen && !isWebFullscreen) {
      closeImmersiveUi();
      return;
    }
    handleToggleFullscreen();
  };

  const handleToggleFullscreen = async () => {
    if (onFullscreen) {
      onFullscreen();
      return;
    }

    // 分层退出：先退出浏览器系统全屏，但保留 Live 页面内沉浸播放；再次操作才退出沉浸界面。
    if (document.fullscreenElement) {
      try { await document.exitFullscreen?.(); } catch {}
      try { screen.orientation?.unlock?.(); } catch {}
      setShowFullscreenBar(true);
      return;
    }

    // Live 的 CSS 备用全屏退出时，只退出全屏层，保留竖屏沉浸状态。
    if (isLive && isWebFullscreen) {
      setIsWebFullscreen(false);
      setIsLandscape(false);
      setShowFullscreenBar(true);
      try { screen.orientation?.unlock?.(); } catch {}
      return;
    }

    // 沉浸播放和全屏是两个独立状态：第一次操作进入全屏，退出时保留沉浸界面。
    if (!isWebFullscreen) {
      if (isLive && onToggleImmersive) onToggleImmersive(true);
      setIsWebFullscreen(true);
      setShowFullscreenBar(true);
      const elem = videoContainerRef?.current?.parentElement || videoRef?.current?.parentElement || videoRef?.current;
      if (elem?.requestFullscreen) {
        try { await elem.requestFullscreen(); } catch {
          // 浏览器拒绝系统全屏时，继续使用 CSS 页面内全屏模式。
        }
      }
      try { await screen.orientation?.lock?.('landscape'); } catch {}
      return;
    }

    closeImmersiveUi();
  };

  const handleToggleLandscape = async () => {
    // Live 的横屏仅由用户进入全屏时触发，不提供主界面/沉浸界面的方向切换。
    if (isLive) {
      if (isSystemFullscreen || isWebFullscreen) {
        try { await screen.orientation?.lock?.('landscape'); } catch {}
      }
      return;
    }
    const next = !isLandscape;
    try {
      await screen.orientation?.lock?.(next ? 'landscape' : 'portrait');
      // 不直接设置状态；由 orientationchange/resize 反映实际设备方向。
    } catch {
      // 不支持方向锁定时，提示按钮状态仍跟随真实视口方向。
    }
  };

  const handleSeek = value => {
    const val = Number(value);
    if (!Number.isFinite(val)) return;
    if (controller?.seek) {
      controller.seek(val);
    } else {
      const video = videoRef?.current;
      if (video && Number.isFinite(video.duration)) {
        video.currentTime = val;
      }
    }
    setCurrentTime(val);
    resetControlsTimeout();
  };

  const handlePlayPause = () => {
    if (controller) {
      if (isPlaying) {
        controller.pause();
      } else {
        controller.play().catch(() => {});
      }
    } else {
      const video = videoRef?.current;
      if (!video) return;
      if (video.paused) video.play().catch(() => {}); else video.pause();
    }
    resetControlsTimeout();
  };

  const handleSkip = seconds => {
    if (isLive) return;
    const dur = duration || (videoRef?.current?.duration ?? 0);
    const cur = currentTime || (videoRef?.current?.currentTime ?? 0);
    if (dur <= 0) return;
    const nextTime = Math.max(0, Math.min(dur, cur + seconds));
    if (controller?.seek) {
      controller.seek(nextTime);
    } else if (videoRef?.current) {
      videoRef.current.currentTime = nextTime;
    }
    setCurrentTime(nextTime);
    resetControlsTimeout();
  };

  const handleCycleRate = () => {
    const rates = [0.75, 1.0, 1.25, 1.5, 2.0];
    const currentIndex = rates.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % rates.length;
    const nextRate = rates[nextIndex];
    onChangePlaybackRate?.(nextRate);
    if (controller?.setPlaybackRate) {
      controller.setPlaybackRate(nextRate);
    } else if (videoRef?.current) {
      videoRef.current.playbackRate = nextRate;
    }
    resetControlsTimeout();
  };

  const episodeGroups = [];
  for (let i = 0; i < episodes.length; i += 50) {
    episodeGroups.push(episodes.slice(i, i + 50));
  }
  const currentGroupEpisodes = episodeGroups[episodePage] ?? episodes;

  const renderedChildren = children;
  const bufferPct = duration > 0 ? Math.min(100, (bufferedSeconds / duration) * 100) : 0;
  const loadSpeed = bufferRate > 0 ? `${bufferRate.toFixed(1)} 秒/秒` : '—';
  const displayTitle = title || request?.metadata?.title || (isLive ? activeChannel?.name : '正在播放');
  const displayEpisode = episodeLabel || (episodes.length > 0 ? `第 ${currentEpisodeIndex + 1} 集` : '');

  // 8 路线统一调度中心：实时根据 [当前平台环境] x [影视/直播] x [主界面/沉浸全屏] 解析出对应路线
  const runtimeEnv = detectRuntimeEnv();
  const currentTier = (isSystemFullscreen || isWebFullscreen || (isImmersive && !isLive)) ? VIEW_TIER.IMMERSIVE : VIEW_TIER.MAIN;
  const currentRouteConfig = getPlaybackRouteConfig({
    runtime: runtimeEnv,
    kind: isLive ? MEDIA_KIND.LIVE : MEDIA_KIND.VOD,
    viewTier: currentTier,
  });

  return (
    <div
      className={`sangtian-window ${isLive ? 'is-live-direct' : ''} ${isImmersive ? 'is-immersive' : ''} ${isLandscape ? 'is-landscape' : ''} ${isSystemFullscreen ? 'is-system-fullscreen' : ''} ${isWebFullscreen ? 'is-web-fullscreen' : ''} aspect-${aspectMode.replace(':','-')}`}
      data-fit-mode={fitMode}
      data-zoom-enabled={lockZoomEnabled ? 'true' : 'false'}
      style={{
        '--aspect-ratio-value': currentAspectRatio,
        '--video-zoom': mediaScale,
        '--video-pan-x': `${videoPan.x}%`,
        '--video-pan-y': `${videoPan.y}%`,
      }}
      onMouseMove={fullscreen ? resetControlsTimeout : resetEmbeddedControlsTimeout}
      onTouchStart={fullscreen ? resetControlsTimeout : resetEmbeddedControlsTimeout}
    >
      {!fullscreen && !immersiveLivePage && (
        <div className="sangtian-window-bar">
          <div className="sangtian-window-tag">
            <span>{terminalTag}</span>
            <span style={{ marginLeft: '6px', fontSize: '10px', opacity: 0.85, padding: '1px 5px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)' }}>
              {currentRouteConfig.label}
            </span>
          </div>
          <div className="sangtian-window-actions">
            <button
              className="sangtian-window-btn"
              onClick={() => {
                setIsStoppedManually(true);
                onStop?.();
              }}
              title="停止播放"
            >
              <Square size={13}/>
              <span>停止</span>
            </button>
            <button className="sangtian-window-btn" onClick={handleCopyLink} title="复制播放链接">
              {copied ? <Check size={13}/> : <Copy size={13}/>}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>
            {!isLive && (
              <button className={`sangtian-window-btn ${isLandscape ? 'active' : ''}`} onClick={handleToggleLandscape} title="方向">
                <RotateCw size={13}/>
                <span>{isLandscape ? '竖屏' : '横屏'}</span>
              </button>
            )}
            <button className={`sangtian-window-btn ${showAspectPanel ? 'active' : ''}`} onClick={openAspectPanel} title="画面比例与缩放">
              <Ratio size={13}/>
              <span>比例</span>
            </button>
            <button className="sangtian-window-btn icon-only" onClick={handleToggleFullscreen} title="全屏播放">
              <Maximize2 size={13}/>
            </button>
          </div>
        </div>
      )}

      {immersiveLivePage && (
        <header className="live-immersive-header">
          <div className="live-immersive-header-main">
            <button type="button" className="live-immersive-back" onClick={closeImmersiveUi} aria-label="返回直播频道页" title="返回">
              <ChevronLeft size={23} />
            </button>
            <div className="live-immersive-channel-logo" aria-hidden="true">
              {activeChannel?.logo && <img src={activeChannel.logo} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />}
              <Radio size={19} />
            </div>
            <div className="live-immersive-channel-copy">
              <div className="live-immersive-channel-title">{activeChannel?.name || displayTitle || '直播频道'}</div>
              <div className="live-immersive-channel-subtitle">{activeChannel?.category || (candidate?.sourceId === 'custom' ? '自定义直播' : '电视直播')}</div>
            </div>
            <span className="live-immersive-live-badge"><i />直播中</span>
          </div>
        </header>
      )}

      <div
        ref={videoContainerRef}
        className={`sangtian-window-body ${immersiveLivePage ? 'live-immersive-video' : ''}`}
        style={{
          aspectRatio: fullscreen ? undefined : `${currentAspectRatio}`,
          '--live-video-ratio': currentAspectRatio,
        }}
      >
        {showTerminal ? (
          <div className="sangtian-terminal-panel">
            <pre className="terminal-code">{`播放信息

模式：${isLive ? 'Live 直连' : '影视解析'}
协议：${resolvedInput?.protocol || candidate?.protocol || '未知'}
源：${candidate?.sourceId || '—'}
状态：${status || 'idle'}
播放进度：${formatTime(currentTime)} / ${formatTime(duration)}
已缓冲：${formatTime(bufferedSeconds)}
加载速率：${loadSpeed}
网络估速：${networkDownlink != null ? networkDownlink + ' Mbps' : '不可用'}
播放地址：${streamUrl || '等待地址…'}`}</pre>
            <div className="terminal-footer">
              <button className="terminal-back-btn" onClick={()=>setShowTerminal(false)}>
                <Play size={13}/>
                <span>返回视频播放</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {renderedChildren}
            {(() => {
              const isStopped = isStoppedManually || status === 'stopped';
              if (isStopped) {
                return (
                  <div className="sangtian-video-overlay stopped">
                    <div
                      className="sangtian-stopped-play-btn"
                      onClick={() => {
                        setIsStoppedManually(false);
                        if (onRetry) onRetry();
                        else if (videoRef?.current) videoRef.current.play?.();
                      }}
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: '50%',
                        background: 'rgba(213, 165, 90, 0.95)',
                        display: 'grid',
                        placeItems: 'center',
                        color: '#1a1816',
                        cursor: 'pointer',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                        marginBottom: 8,
                      }}
                    >
                      <Play size={24} style={{ marginLeft: 3 }} />
                    </div>
                    <span style={{ fontSize: 13, color: '#ecd9ba', fontWeight: 500 }}>已停止播放</span>
                    {onRetry && (
                      <button
                        type="button"
                        className="sangtian-btn-sand"
                        onClick={() => {
                          setIsStoppedManually(false);
                          onRetry();
                        }}
                        style={{ marginTop: 10, padding: '4px 12px', fontSize: 12, borderRadius: 6 }}
                      >
                        重新连接播放
                      </button>
                    )}
                  </div>
                );
              }
              if (isLive && !candidate && status !== 'error') {
                return (
                  <div className="sangtian-video-overlay compact" style={{ pointerEvents: 'none' }}>
                    <span>{idleText || '请从下方选择频道开始观看'}</span>
                  </div>
                );
              }
              if (!resolvedInput && candidate && status !== 'error') {
                return (
                  <div className="sangtian-video-overlay">
                    <div className="sangtian-loading-spinner"/>
                    <span>{isLive ? '正在连接直播直链…' : '正在解析视频播放地址…'}</span>
                  </div>
                );
              }
              if (resolvedInput && status !== 'error' && (status === 'loading' || status === 'preparing') && !isPlaying && currentTime === 0) {
                return (
                  <div className="sangtian-video-overlay compact" style={{ pointerEvents: 'none' }}>
                    <div className="sangtian-loading-spinner"/>
                    <span>正在缓冲…</span>
                  </div>
                );
              }
              return null;
            })()}
            {status === 'error' && (
              <div className="sangtian-video-error">
                <b>{isLive ? '直播直连失败' : '播放解析失败'}</b>
                <span>{error || '当前播放链路没有可用候选。'}</span>
                <div className="sangtian-error-btns">
                  <button className="sangtian-btn-red" onClick={onRetry}>重新播放</button>
                  {onSwitchCandidate && (
                    <button
                      className="sangtian-btn-sand"
                      onClick={() => onSwitchCandidate()}
                    >
                      切换备用线路
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Embedded Navigation Bar inside Video Window (Non-fullscreen) */}
            {!fullscreen && !immersiveLivePage && !showTerminal && status !== 'error' && (
              <div
                className={`sangtian-embedded-player-nav ${isLandscape ? 'mode-landscape' : 'mode-portrait'} ${showEmbeddedNav ? 'visible' : ''}`}
                onClick={handleEmbeddedBlankClick}
              >
                {showEmbeddedNav && isPlaying && (
                  <div key={controlHideProgressKey} className="sangtian-control-hide-countdown embedded" aria-label="无操作 3 秒后自动隐藏控制栏" />
                )}
                {/* Embedded Top Control Bar */}
                <div className="embedded-nav-top">
                  <div className="embedded-nav-title-group">
                    <span className="embedded-nav-title">{displayTitle}</span>
                    {displayEpisode && <span className="embedded-nav-badge">{displayEpisode}</span>}
                    {sourceLabel && <span className="embedded-nav-source">{sourceLabel}</span>}
                  </div>
                  <div className="embedded-nav-top-actions">
                    {!isLive && episodes.length > 1 && (
                      <button
                        type="button"
                        className="embedded-nav-btn"
                        onClick={() => setShowEpisodeSidebar(!showEpisodeSidebar)}
                        title="选集"
                      >
                        <ListVideo size={13} />
                        <span>选集</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className={`embedded-nav-btn ${showAspectPanel ? 'active' : ''}`}
                      onClick={openAspectPanel}
                      title="画面比例与缩放"
                    >
                      <Ratio size={13} />
                      <span>比例</span>
                    </button>
                    {!isLive && (
                      <button
                        type="button"
                        className={`embedded-nav-btn ${isLandscape ? 'active' : ''}`}
                        onClick={handleToggleLandscape}
                        title="切换横竖屏"
                      >
                        <RotateCw size={13} />
                        <span>{isLandscape ? '竖屏' : '横屏'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="embedded-nav-btn icon-only"
                      onClick={handleToggleFullscreen}
                      title="全屏"
                    >
                      <Maximize2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Embedded Bottom Control Bar */}
                <div className="embedded-nav-bottom">
                  {!isLive && (
                    <div className="embedded-progress-row">
                      <span className="time-text">{formatTime(currentTime)}</span>
                      <input
                        type="range"
                        className="embedded-progress-slider"
                        min="0"
                        max={duration || 0}
                        step="0.1"
                        value={Math.min(currentTime, duration || 0)}
                        onChange={e => handleSeek(e.target.value)}
                        aria-label="播放进度"
                      />
                      <span className="time-text">{formatTime(duration)}</span>
                    </div>
                  )}

                  <div className="embedded-controls-row">
                    <div className="embedded-controls-left">
                      <button
                        type="button"
                        className="embedded-play-btn"
                        onClick={handlePlayPause}
                        title={isPlaying ? '暂停' : '播放'}
                      >
                        {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                      </button>

                      {!isLive && onPreviousEpisode && (
                        <button type="button" className="embedded-icon-btn" onClick={onPreviousEpisode} title="上一集">
                          <ChevronLeft size={16} />
                          <span className="btn-text">上一集</span>
                        </button>
                      )}

                      {!isLive && onNextEpisode && (
                        <button type="button" className="embedded-icon-btn" onClick={onNextEpisode} title="下一集">
                          <span className="btn-text">下一集</span>
                          <ChevronRight size={16} />
                        </button>
                      )}
                    </div>

                    <div className="embedded-controls-right">
                      {!isLive && (
                        <button type="button" className="embedded-nav-btn speed-btn" onClick={handleCycleRate} title="切换倍速">
                          <span>{playbackRate}x</span>
                        </button>
                      )}
                      {!isLive && (
                        <button type="button" className="embedded-nav-btn icon-only" onClick={handleToggleFullscreen} title="全屏">
                          <Maximize2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Locked Screen Overlay */}
            {fullscreen && isLocked && (
              <div className="sangtian-fullscreen-locked-surface" onClick={handleLockedScreenTap} aria-label="屏幕已锁定，点击显示解锁按钮">
                {showUnlockHint && (
                  <button key={lockHintKey} type="button" className="sangtian-fullscreen-lock-pill" onClick={unlockScreen} aria-label="解锁播放器控制">
                    <Unlock size={17} />
                    <span>解锁</span>
                  </button>
                )}
              </div>
            )}

            {/* Fullscreen Overlay Controls */}
            {fullscreen && !isLocked && (
              <div
                className={`sangtian-fullscreen-controls ${isLandscape ? 'landscape' : 'portrait'} ${showFullscreenBar ? 'visible' : ''}`}
                onClick={handleFullscreenBlankClick}
              >
                {showFullscreenBar && isPlaying && !showLeftSidebar && !showRightSidebar && !showEpisodeSidebar && (
                  <div key={controlHideProgressKey} className="sangtian-control-hide-countdown" aria-label="无操作 3 秒后自动隐藏控制栏" />
                )}
                {/* Fullscreen Top Bar */}
                <div className="sangtian-fullscreen-topbar">
                  <div className="sangtian-topbar-left-triggers">
                    <button
                      type="button"
                      className="sangtian-trigger-btn"
                      onClick={(e) => { e.stopPropagation(); handleBackFromPlayer(); }}
                      title={isLive && isImmersive && !isSystemFullscreen && !isWebFullscreen ? '退出沉浸播放' : '退出全屏'}
                    >
                      <ChevronLeft size={18} />
                      <span>返回</span>
                    </button>
                    {isLive ? (
                      <>
                        <button
                          type="button"
                          className="sangtian-trigger-btn"
                          onClick={(e) => { e.stopPropagation(); setShowLeftSidebar(!showLeftSidebar); setShowRightSidebar(false); setShowEpisodeSidebar(false); }}
                        >
                          <LayoutGrid size={15} />
                          <span>选台</span>
                        </button>
                        <span className="channel-title-badge">{activeChannel?.name || '直播频道'}</span>
                      </>
                    ) : (
                      <div className="movie-fullscreen-title-box">
                        <span className="movie-fullscreen-title">{displayTitle}</span>
                        {displayEpisode && <span className="movie-fullscreen-episode">{displayEpisode}</span>}
                        {sourceLabel && <span className="movie-fullscreen-source">{sourceLabel}</span>}
                      </div>
                    )}
                  </div>

                  <div className="sangtian-topbar-right-actions">
                    <button
                      type="button"
                      className={`sangtian-trigger-btn ${showAspectPanel ? 'active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); openAspectPanel(); }}
                      title="画面比例与缩放"
                    >
                      <Ratio size={15} />
                      <span>比例</span>
                    </button>
                    {/* VOD Episode Selector Trigger */}
                    {!isLive && episodes.length > 1 && (
                      <button
                        type="button"
                        className="sangtian-trigger-btn"
                        onClick={(e) => { e.stopPropagation(); setShowEpisodeSidebar(!showEpisodeSidebar); setShowRightSidebar(false); }}
                      >
                        <ListVideo size={15} />
                        <span>选集 ({episodes.length})</span>
                      </button>
                    )}

                    {/* Settings / Lines Trigger */}
                    <button
                      type="button"
                      className="sangtian-trigger-btn"
                      onClick={(e) => { e.stopPropagation(); setShowRightSidebar(!showRightSidebar); setShowLeftSidebar(false); setShowEpisodeSidebar(false); }}
                    >
                      <SlidersHorizontal size={15} />
                      <span>{isLive ? '线路与解码' : '线路设置'}</span>
                    </button>

                    {/* Lock Screen Button */}
                    <button
                      type="button"
                      className="sangtian-trigger-btn"
                      onClick={(e) => { e.stopPropagation(); setShowLeftSidebar(false); setShowRightSidebar(false); setShowEpisodeSidebar(false); setShowFullscreenBar(false); setShowUnlockHint(false); setIsLocked(true); }}
                      title="锁定屏幕控制"
                    >
                      <Lock size={15} />
                    </button>

                    {/* Clock & Exit Button */}
                    {!isLive && <span className="fullscreen-clock-badge">{clockTime}</span>}
                    <button
                      type="button"
                      className="sangtian-exit-btn-top"
                      onClick={(e) => { e.stopPropagation(); handleToggleFullscreen(); }}
                      title={isLive && !isSystemFullscreen && !isWebFullscreen ? '进入横屏全屏' : '退出全屏'}
                    >
                      {isLive && !isSystemFullscreen && !isWebFullscreen ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                    </button>
                  </div>
                </div>

                {/* 顶部栏下面一行：横屏、铺满、退出 */}
                {!isLive && (
                <div className="sangtian-fullscreen-subbar-actions" onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 16px', background: 'rgba(15,23,42,0.85)', backdropFilter: 'blur(8px)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {!isLive && (
                    <button type="button" className="setting-btn" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={handleToggleLandscape}>
                      <RotateCw size={13}/><span>{isLandscape ? '竖屏' : '横屏'}</span>
                    </button>
                  )}
                  <button type="button" className="setting-btn" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={openAspectPanel}>
                    <Ratio size={13}/><span>画面比例</span>
                  </button>
                  <button type="button" className="setting-btn" style={{ padding: '4px 10px', fontSize: '12px', background: isLive && !isSystemFullscreen && !isWebFullscreen ? 'rgba(124,131,255,0.2)' : 'rgba(225,29,72,0.2)', color: isLive && !isSystemFullscreen && !isWebFullscreen ? '#c7c9ff' : '#f43f5e' }} onClick={handleToggleFullscreen}>
                    {isLive && !isSystemFullscreen && !isWebFullscreen ? <Maximize2 size={13}/> : <Minimize2 size={13}/>}<span>{isLive && !isSystemFullscreen && !isWebFullscreen ? '全屏' : '退出'}</span>
                  </button>
                </div>
                )}

                {/* Left Channel Sidebar for Live */}
                {isLive && showLeftSidebar && (
                  <div className="sangtian-fullscreen-left-sidebar is-live-channel-drawer" onClick={(e) => e.stopPropagation()}>
                    <div className="sidebar-header">
                      <b>频道选择 ({filteredSidebarChannels.length})</b>
                      <button className="close-sidebar-btn" onClick={() => setShowLeftSidebar(false)}>✕</button>
                    </div>
                    <label className="fullscreen-channel-search">
                      <Search size={16} aria-hidden="true" />
                      <input
                        type="search"
                        value={sidebarSearch}
                        onChange={(event) => setSidebarSearch(event.target.value)}
                        placeholder="搜索频道名称"
                        aria-label="搜索频道名称"
                      />
                      {sidebarSearch && <button type="button" onClick={() => setSidebarSearch('')} aria-label="清除搜索">清除</button>}
                    </label>
                    <div className="sidebar-category-chips">
                      {sidebarCategories.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          className={`sidebar-chip ${selectedSidebarCat === cat ? 'active' : ''}`}
                          onClick={() => setSelectedSidebarCat(cat)}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                    <div className="sidebar-channel-list">
                      {filteredSidebarChannels.map((chan) => {
                        const isCurrent = chan.channelId === activeChannel?.channelId;
                        return (
                          <div
                            key={chan.channelId}
                            className={`sidebar-channel-item ${isCurrent ? 'active' : ''}`}
                            role="button"
                            tabIndex={0}
                            aria-current={isCurrent ? 'true' : undefined}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                onSelectChannel?.(chan);
                                setShowLeftSidebar(false);
                              }
                            }}
                            onClick={() => { onSelectChannel?.(chan); setShowLeftSidebar(false); }}
                          >
                            <span className="chan-name">{chan.name}</span>
                            {isCurrent && <span className="chan-active-tag">● 播放中</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Right Episode Sidebar for VOD / Movies in Fullscreen */}
                {!isLive && showEpisodeSidebar && (
                  <div className="sangtian-fullscreen-right-sidebar" onClick={(e) => e.stopPropagation()}>
                    <div className="sidebar-header">
                      <b>剧集选集 ({episodes.length} 集)</b>
                      <button className="close-sidebar-btn" onClick={() => setShowEpisodeSidebar(false)}>✕</button>
                    </div>
                    {episodeGroups.length > 1 && (
                      <div className="sidebar-category-chips" style={{ marginTop: 6 }}>
                        {episodeGroups.map((_, i) => (
                          <button
                            key={i}
                            className={`sidebar-chip ${episodePage === i ? 'active' : ''}`}
                            onClick={() => setEpisodePage(i)}
                          >
                            {i * 50 + 1}–{Math.min((i + 1) * 50, episodes.length)}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="sidebar-settings-content" style={{ marginTop: 6 }}>
                      <div className="settings-btn-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))' }}>
                        {currentGroupEpisodes.map((ep, idx) => {
                          const realIdx = episodePage * 50 + idx;
                          const isCurrent = realIdx === currentEpisodeIndex;
                          return (
                            <button
                              key={ep.episodeId || realIdx}
                              className={`setting-btn ${isCurrent ? 'active' : ''}`}
                              onClick={() => {
                                onSelectEpisode?.(realIdx);
                                setShowEpisodeSidebar(false);
                              }}
                              title={ep.title}
                            >
                              {ep.title || `${realIdx + 1}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Right Settings Sidebar */}
                {showRightSidebar && (
                  <div className="sangtian-fullscreen-right-sidebar" onClick={(e) => e.stopPropagation()}>
                    <div className="sidebar-header">
                      <b>{isLive ? '播放与解码设置' : '线路与播放设置'}</b>
                      <button className="close-sidebar-btn" onClick={() => setShowRightSidebar(false)}>✕</button>
                    </div>
                    <div className="sidebar-settings-content">
                      <div className="settings-group">
                        <label>画面比例与缩放</label>
                        <div className="aspect-sidebar-current">
                          <span><Ratio size={16} />当前：{currentAspect.label} · {FIT_MODE_OPTIONS.find(item => item.id === fitMode)?.label}</span>
                          <button type="button" className="setting-btn active" onClick={openAspectPanel}>完整设置</button>
                        </div>
                      </div>

                      {/* VOD Candidate Lines */}
                      {!isLive && candidates?.length > 0 && (
                        <div className="settings-group">
                          <label>备用播放线路 ({candidates.length})</label>
                          <div className="settings-btn-grid vertical">
                            {candidates.map((c, idx) => (
                              <button
                                key={c.candidateId}
                                className={`setting-btn ${candidate?.candidateId === c.candidateId ? 'active' : ''}`}
                                onClick={() => {
                                  onSelectCandidate?.(c.candidateId);
                                  setShowRightSidebar(false);
                                }}
                              >
                                {c.metadata?.label || c.label || (c.index != null ? `线路 ${c.index + 1}` : `线路 ${idx + 1}`)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Live Stream Switcher */}
                      {isLive && (() => {
                        const liveStreams = (activeChannel?.streams && activeChannel.streams.length > 0)
                          ? activeChannel.streams
                          : (candidates && candidates.length > 0)
                          ? candidates.map((c, i) => ({
                              streamId: c.candidateId || `stream-${i}`,
                              label: c.metadata?.label || c.label || (c.index != null ? `线路 ${c.index + 1}` : `线路 ${i + 1}`),
                              protocol: c.protocol || '',
                              candidateId: c.candidateId,
                            }))
                          : [];
                        if (!liveStreams.length) return null;
                        return (
                          <div className="settings-group">
                            <label>直播换线 ({liveStreams.length})</label>
                            <div className="settings-btn-grid vertical">
                              {liveStreams.map((stream, idx) => {
                                const isCurrent = activeStreamIndex === idx || (stream.candidateId && candidate?.candidateId === stream.candidateId);
                                return (
                                  <button
                                    key={stream.streamId || stream.candidateId || idx}
                                    className={`setting-btn ${isCurrent ? 'active' : ''}`}
                                    onClick={() => {
                                      if (onSwitchStreamIndex) {
                                        onSwitchStreamIndex(idx);
                                      } else if (stream.candidateId && onSelectCandidate) {
                                        onSelectCandidate(stream.candidateId);
                                      } else if (candidates?.[idx]?.candidateId && onSelectCandidate) {
                                        onSelectCandidate(candidates[idx].candidateId);
                                      }
                                      setShowRightSidebar(false);
                                    }}
                                  >
                                    {stream.label || `线路 ${idx + 1}`} {stream.protocol ? `· ${stream.protocol}` : ''}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {(!isLive || runtimeEnv !== RUNTIME_ENV.WEB) && <div className="settings-group">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <label style={{ margin: 0 }}>解码内核与硬软解 (Decoder Engine & Mode)</label>
                          <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: runtimeEnv === RUNTIME_ENV.WEB ? 'rgba(59, 130, 246, 0.2)' : 'rgba(217, 119, 6, 0.2)', color: runtimeEnv === RUNTIME_ENV.WEB ? '#60a5fa' : '#fbbf24', border: `1px solid ${runtimeEnv === RUNTIME_ENV.WEB ? 'rgba(59, 130, 246, 0.4)' : 'rgba(217, 119, 6, 0.4)'}`, fontWeight: 600 }}>
                            {currentRouteConfig.label}
                          </span>
                        </div>
                        
                        {/* 明确展示 Web 与 Android 分工与职责 */}
                        <div style={{ padding: '8px 10px', borderRadius: '6px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', marginBottom: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: runtimeEnv === RUNTIME_ENV.WEB ? '#93c5fd' : '#fcd34d', marginBottom: '3px' }}>
                            <span>{runtimeEnv === RUNTIME_ENV.WEB ? '🌐 Web 浏览器端分工' : '📱 Android 原生容器分工'}</span>
                          </div>
                          <p style={{ fontSize: '11px', color: '#94a3b8', margin: 0, lineHeight: 1.4 }}>
                            {runtimeEnv === RUNTIME_ENV.WEB
                              ? '普通手机浏览器使用 HLS.js 与 HTML5 原生媒体路径；播放画面由当前页面的视频元素承载，具体能力受浏览器与源站跨域策略限制。'
                              : 'Android 端由当前页面内的 HTML 视频元素承载实际画面。选项只调整 HTML5 自动适配、HLS.js/MSE 与原生媒体的尝试顺序，不再启用独立 TextureView、ExoPlayer 或 IJKPlayer 视频表面。'}
                          </p>
                        </div>

                        <div className="settings-btn-grid vertical">
                          {(() => {
                            const enginesList = currentRouteConfig?.engines || (runtimeEnv === RUNTIME_ENV.ANDROID
                              ? [
                                  { id: 'html5_auto', name: 'HTML5 自动适配（内嵌播放器）' },
                                  ...(isLive ? [{ id: 'hls_lowlatency', name: 'HLS.js 低延迟直播' }] : [{ id: 'hls_worker', name: 'HLS.js / MSE 播放' }]),
                                  { id: 'html5_hardware', name: 'HTML5 原生媒体优先' },
                                ]
                              : [
                                  { id: 'hls_lowlatency', name: 'HLS.js 低延迟直播' },
                                  { id: 'html5_hardware', name: 'HTML5 原生媒体优先' },
                                  { id: 'hls_worker', name: 'HLS.js / MSE 播放' },
                                ]);
                            
                            // 严格互斥计算唯一选中的激活引擎 ID，杜绝“硬解”与“软解”同时选中的异常
                            const rawEngine = String(decoderEngine || '').toLowerCase();
                            let exactActiveId = '';
                            if (enginesList.some(e => e.id === rawEngine)) {
                              exactActiveId = rawEngine;
                            } else if (rawEngine.includes('exo')) {
                              exactActiveId = rawEngine.includes('soft') ? 'exo_software' : 'exo_hardware';
                            } else if (rawEngine.includes('ijk')) {
                              exactActiveId = rawEngine.includes('soft') ? 'ijk_software' : 'ijk_hardware';
                            } else if (rawEngine === 'html5_auto') {
                              exactActiveId = 'html5_auto';
                            } else if (rawEngine.includes('html5') || rawEngine.includes('hls')) {
                              exactActiveId = rawEngine.includes('hard') ? 'html5_hardware' : (isLive ? 'hls_lowlatency' : 'hls_worker');
                            }
                            if (!exactActiveId || !enginesList.some(e => e.id === exactActiveId)) {
                              exactActiveId = enginesList[0]?.id || 'html5_auto';
                            }

                            return enginesList.map((engine) => {
                              const isActive = engine.id === exactActiveId;
                              return (
                                <button
                                  key={engine.id}
                                  className={`setting-btn ${isActive ? 'active' : ''}`}
                                  onClick={() => onChangeDecoderEngine?.(engine.id)}
                                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    {isActive && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', display: 'inline-block' }} />}
                                    <span>{engine.name}</span>
                                  </div>
                                  {engine.badge && (
                                    <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: isActive ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.12)', color: isActive ? '#7dd3fc' : '#cbd5e1' }}>
                                      {engine.badge}
                                    </span>
                                  )}
                                </button>
                              );
                            });
                          })()}
                        </div>
                      </div>}

                      <div className="settings-group exit-section">
                        <button
                          type="button"
                          className="sangtian-big-exit-btn"
                          onClick={() => {
                            setShowRightSidebar(false);
                            handleToggleFullscreen();
                          }}
                        >
                          <Minimize2 size={18} />
                          <span>退出全屏模式</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Center Control (Play/Pause & Rewind/FastForward) */}
                <div className="sangtian-fullscreen-center" onDoubleClick={handlePlayPause}>
                  {!isLive ? (
                    <div className="fullscreen-skip-row">
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleSkip(-10); }} aria-label="后退10秒">
                        <Rewind size={20}/>
                        <span>-10s</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handlePlayPause(); }}
                        className="fullscreen-play-btn"
                        aria-label={isPlaying ? '暂停' : '播放'}
                      >
                        {isPlaying ? <Pause size={28} fill="currentColor"/> : <Play size={28} fill="currentColor"/>}
                      </button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleSkip(10); }} aria-label="前进10秒">
                        <FastForward size={20}/>
                        <span>+10s</span>
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={(e) => { e.stopPropagation(); handlePlayPause(); }} className="fullscreen-play-btn">
                      {isPlaying ? <Pause size={26}/> : <Play size={26}/>}
                    </button>
                  )}
                </div>

                {/* Middle Bottom Translucent Bar for Live (Moved up one row) */}
                {isLive && (
                  <div className="sangtian-fullscreen-live-centerbar" onClick={e => e.stopPropagation()} style={{ marginBottom: '12px', zIndex: 10 }}>
                    <div className="stream-switcher-badge">
                      <button
                        type="button"
                        className="stream-nav-btn"
                        onClick={handlePrevStream}
                        title="切换到上一条线路"
                        disabled={totalStreams <= 1}
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <button
                        type="button"
                        className="stream-counter-text-btn"
                        onClick={handleNextStream}
                        title="点击切换到下一条线路"
                      >
                        <span>线路 {currentStreamNum} / {totalStreams}</span>
                      </button>
                      <button
                        type="button"
                        className="stream-nav-btn"
                        onClick={handleNextStream}
                        title="切换到下一条线路"
                        disabled={totalStreams <= 1}
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                    <span className="live-channel-title-center">
                      {activeChannel?.name || '直播频道'}
                    </span>
                    <div className="live-realtime-clock">
                      <span className="live-pill">● 直播</span>
                      <span className="clock-digits">{clockTime}</span>
                    </div>
                  </div>
                )}

                {/* Fullscreen Bottom Bar */}
                <div className="sangtian-fullscreen-bottombar">
                  {!isLive && (
                    <>
                      <div className="sangtian-fullscreen-progress">
                        <span>{formatTime(currentTime)}</span>
                        <input
                          type="range"
                          min="0"
                          max={duration || 0}
                          step="0.1"
                          value={Math.min(currentTime, duration || 0)}
                          onChange={e => handleSeek(e.target.value)}
                          aria-label="播放进度"
                        />
                        <span>{formatTime(duration)}</span>
                      </div>
                      <div className="sangtian-fullscreen-metrics">
                        <span>缓冲 {bufferPct.toFixed(0)}%</span>
                        <span>加载 {loadSpeed}</span>
                        <span>网络 {networkDownlink != null ? networkDownlink + ' Mbps' : '—'}</span>
                      </div>
                    </>
                  )}

                  <div className="sangtian-fullscreen-actions">
                    {!isLive && onPreviousEpisode && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); onPreviousEpisode(); }} title="上一集">
                        <ChevronLeft size={15}/>上一集
                      </button>
                    )}
                    {!isLive && onNextEpisode && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); onNextEpisode(); }} title="下一集">
                        下一集<ChevronRight size={15}/>
                      </button>
                    )}
                    {!isLive && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleCycleRate(); }} title="切换倍速">
                        <Play size={14}/>{playbackRate}x
                      </button>
                    )}
                    {!isLive && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleToggleLandscape(); }}>
                        <RotateCw size={15}/>{isLandscape ? '竖屏' : '横屏'}
                      </button>
                    )}
                    {!isLive && (
                      <>
                        <button type="button" onClick={(e) => { e.stopPropagation(); openAspectPanel(); }}>
                          <Ratio size={15}/>画面比例
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleToggleFullscreen(); }}>
                          <Minimize2 size={15}/>退出全屏
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {immersiveLivePage && (
        <section className="live-immersive-lower" aria-label="直播信息与操作">
          <div className="live-immersive-info-wrap">
            {showImmersiveInfo ? (
              <div className="live-immersive-info-card">
                <div className="live-immersive-info-heading">
                  <span>观看信息</span>
                  <button type="button" onClick={() => setShowImmersiveInfo(false)} aria-label="隐藏观看信息" title="隐藏观看信息"><EyeOff size={16} />隐藏</button>
                </div>
                <div className="live-immersive-info-grid">
                  <div className="live-immersive-metric">
                    <span className="live-immersive-metric-icon"><Clock3 size={19} /></span>
                    <span className="live-immersive-metric-copy"><small>本次观看</small><strong>{formatWatchDuration(liveWatchSeconds)}</strong></span>
                  </div>
                  <div className="live-immersive-metric">
                    <span className="live-immersive-metric-icon"><Wifi size={19} /></span>
                    <span className="live-immersive-metric-copy"><small>网络速度（估算）</small><strong>{isOnline ? (networkDownlink != null ? `${networkDownlink.toFixed(networkDownlink >= 10 ? 0 : 1)} Mbps` : '暂不可用') : '网络已断开'}</strong></span>
                  </div>
                </div>
                <div className="live-immersive-date-row">
                  <span><CalendarDays size={16} />{liveNow.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</span>
                  <strong>{liveNow.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
                </div>
              </div>
            ) : (
              <button type="button" className="live-immersive-reveal-pill" onClick={() => setShowImmersiveInfo(true)}><Eye size={15} />显示观看信息</button>
            )}
          </div>

          <div className="live-immersive-controls">
            <button type="button" className="live-immersive-play-button" onClick={handlePlayPause} aria-label={isPlaying ? '暂停直播' : '继续播放'} title={isPlaying ? '暂停' : '播放'}>
              {isPlaying ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
            </button>
            <div className="live-immersive-play-state">
              <span className={`live-immersive-state-dot ${isBuffering ? 'is-buffering' : isPlaying ? 'is-playing' : ''}`} />
              <span>{isBuffering ? '正在缓冲' : isPlaying ? '正在播放' : status === 'error' ? '播放异常' : '已暂停'}</span>
            </div>
            <div className="live-immersive-controls-spacer" />
            <button type="button" className="live-immersive-ratio-button" onClick={openAspectPanel} title="调整画面比例与缩放"><Ratio size={17} /><span>比例</span></button>
            <button type="button" className="live-immersive-fullscreen-button" onClick={handleToggleFullscreen} title="进入全屏播放"><Maximize2 size={18} /><span>全屏</span></button>
          </div>

          <div className="live-immersive-actions-area">
            <div className="live-immersive-actions-heading">
              <span>快捷操作</span>
              <button type="button" onClick={() => setShowImmersiveActions(value => !value)} aria-expanded={showImmersiveActions}>
                {showImmersiveActions ? <><ChevronUp size={15} />收起</> : <><ChevronDown size={15} />展开操作</>}
              </button>
            </div>
            {showImmersiveActions && (
              <div className={`live-immersive-actions-grid ${runtimeEnv === RUNTIME_ENV.WEB ? 'is-web' : 'is-android'}`}>
                <button type="button" className="live-immersive-action-card" onClick={openAspectPanel}>
                  <span className="live-immersive-action-icon"><Ratio size={20} /></span>
                  <span><strong>画面比例</strong><small>{currentAspect.label} · {FIT_MODE_OPTIONS.find(item => item.id === fitMode)?.label}</small></span>
                  <ChevronRight size={17} />
                </button>
                {runtimeEnv !== RUNTIME_ENV.WEB && (
                  <button type="button" className="live-immersive-action-card" onClick={() => setImmersiveMenu('config')}>
                    <span className="live-immersive-action-icon"><Settings size={20} /></span>
                    <span><strong>直播配置</strong><small>{String(decoderEngine || '').toLowerCase().includes('exo') ? 'ExoPlayer' : String(decoderEngine || '').toLowerCase().includes('ijk') ? 'IJKPlayer' : '当前播放内核'}</small></span>
                    <ChevronRight size={17} />
                  </button>
                )}
                <button type="button" className="live-immersive-action-card" onClick={() => setImmersiveMenu('lines')}>
                  <span className="live-immersive-action-icon"><GitBranch size={20} /></span>
                  <span><strong>线路选择</strong><small>{availableStreams.length ? `${currentStreamNum} / ${availableStreams.length} 条线路` : '暂无可选线路'}</small></span>
                  <ChevronRight size={17} />
                </button>
                <button type="button" className="live-immersive-action-card" onClick={() => setImmersiveMenu('channels')}>
                  <span className="live-immersive-action-icon"><Tv size={20} /></span>
                  <span><strong>选台</strong><small>搜索并切换频道</small></span>
                  <ChevronRight size={17} />
                </button>
              </div>
            )}
          </div>

          <nav className="live-immersive-bottom-nav" aria-label="主导航">
            {[['home', Home, '首页'], ['movies', Film, '影视'], ['live', Radio, '直播'], ['favorites', Heart, '收藏'], ['me', User, '我的']].map(([key, Icon, label]) => (
              <button type="button" key={key} className={key === 'live' ? 'active' : ''} onClick={() => { setImmersiveMenu(null); onTab?.(key); }}>
                <Icon size={20} fill={key === 'live' ? 'currentColor' : 'none'} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </section>
      )}

      {immersiveLivePage && immersiveMenu && (
        <div className="live-immersive-menu-backdrop" onClick={() => setImmersiveMenu(null)}>
          <section className="live-immersive-menu-sheet" role="dialog" aria-modal="true" aria-label={immersiveMenu === 'config' ? '直播配置' : immersiveMenu === 'lines' ? '线路选择' : '选台'} onClick={event => event.stopPropagation()}>
            <div className="live-immersive-sheet-grabber" />
            <div className="live-immersive-sheet-heading">
              <div><strong>{immersiveMenu === 'config' ? '直播配置' : immersiveMenu === 'lines' ? '线路选择' : '选择频道'}</strong><small>{immersiveMenu === 'config' ? '调整当前直播的播放器与解码模式' : immersiveMenu === 'lines' ? '只切换当前频道的播放线路' : '切换频道不会影响频道列表来源'}</small></div>
              <button type="button" onClick={() => setImmersiveMenu(null)} aria-label="关闭菜单"><X size={20} /></button>
            </div>

            {immersiveMenu === 'config' && runtimeEnv !== RUNTIME_ENV.WEB && (
              <div className="live-immersive-menu-list">
                {(currentRouteConfig?.engines?.length ? currentRouteConfig.engines : [
                  { id: 'ijk_hardware', name: 'IJKPlayer 硬解' },
                  { id: 'ijk_software', name: 'IJKPlayer 软解' },
                  { id: 'exo_hardware', name: 'ExoPlayer 硬解' },
                  { id: 'exo_software', name: 'ExoPlayer 软解' },
                ]).map(engine => {
                  const selected = String(decoderEngine || '').toLowerCase() === String(engine.id).toLowerCase();
                  return <button type="button" key={engine.id} className={`live-immersive-option-row ${selected ? 'active' : ''}`} onClick={async () => { try { await onChangeDecoderEngine?.(engine.id); setImmersiveMenu(null); } catch {} }}>
                    <span className="live-immersive-option-icon"><Settings size={17} /></span><span className="live-immersive-option-copy"><strong>{engine.name}</strong><small>{engine.decoder === 'software' || String(engine.id).includes('software') ? '软件解码' : '硬件解码'}</small></span>{selected && <Check size={19} />}
                  </button>;
                })}
                <p className="live-immersive-sheet-note">切换播放器可能会重新连接当前直播；失败时会保留原有错误提示与线路恢复机制。</p>
              </div>
            )}

            {immersiveMenu === 'lines' && (
              <div className="live-immersive-menu-list">
                {availableStreams.length ? availableStreams.map((stream, index) => {
                  const streamId = stream.streamId || stream.candidateId || `stream-${index}`;
                  const selected = index === activeStreamIndex;
                  const label = stream.label || stream.metadata?.label || `线路 ${index + 1}`;
                  return <button type="button" key={streamId} className={`live-immersive-option-row ${selected ? 'active' : ''}`} onClick={() => { onSwitchStreamIndex?.(index); setImmersiveMenu(null); }}>
                    <span className="live-immersive-option-icon"><GitBranch size={17} /></span><span className="live-immersive-option-copy"><strong>{label}</strong><small>{stream.protocol || stream.type || '直播线路'}{selected ? ' · 当前使用' : ''}</small></span>{selected && <Check size={19} />}
                  </button>;
                }) : <div className="live-immersive-empty">当前频道暂时没有可选择的备用线路。</div>}
              </div>
            )}

            {immersiveMenu === 'channels' && (
              <div className="live-immersive-channel-picker">
                <label className="live-immersive-channel-search"><Search size={17} /><input type="search" value={sidebarSearch} onChange={event => setSidebarSearch(event.target.value)} placeholder="搜索频道名称" aria-label="搜索频道名称" />{sidebarSearch && <button type="button" onClick={() => setSidebarSearch('')} aria-label="清除搜索">清除</button>}</label>
                <div className="live-immersive-categories">{sidebarCategories.map(category => <button type="button" key={category} className={selectedSidebarCat === category ? 'active' : ''} onClick={() => setSelectedSidebarCat(category)}>{category}</button>)}</div>
                <div className="live-immersive-menu-list channel-list">
                  {filteredSidebarChannels.map(channel => {
                    const selected = channel.channelId === activeChannel?.channelId;
                    return <button type="button" key={channel.channelId} className={`live-immersive-option-row ${selected ? 'active' : ''}`} onClick={() => { onSelectChannel?.(channel); setImmersiveMenu(null); }}>
                      <span className="live-immersive-option-icon">{channel.logo ? <img src={channel.logo} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} /> : <Radio size={17} />}</span><span className="live-immersive-option-copy"><strong>{channel.name}</strong><small>{channel.category || '未分类'}</small></span>{selected && <Check size={19} />}
                    </button>;
                  })}
                  {!filteredSidebarChannels.length && <div className="live-immersive-empty">没有找到匹配的频道。</div>}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {showAspectPanel && createPortal((
        <div
          className="aspect-settings-backdrop"
          onClick={event => {
            event.stopPropagation();
            if (event.target === event.currentTarget) closeAspectPanel();
          }}
        >
          <section className="aspect-settings-sheet" role="dialog" aria-modal="true" aria-label="画面比例与缩放设置" onClick={event => event.stopPropagation()}>
            <div className="aspect-settings-grabber" />
            <header className="aspect-settings-header">
              <div>
                <strong>画面比例</strong>
                <small>调整目标区域、适配方式和缩放位置</small>
              </div>
              <button type="button" onClick={closeAspectPanel} aria-label="关闭画面比例设置"><X size={20} /></button>
            </header>

            <div className="aspect-settings-scroll">
              <section className="aspect-settings-section">
                <div className="aspect-settings-section-title"><strong>★ 我的常用比例</strong><small>最多固定 6 项，点星标可添加或移除</small></div>
                {aspectFavorites.length ? (
                  <div className="aspect-ratio-grid aspect-ratio-grid-favorites">
                    {aspectFavorites.map(id => aspectOptions.find(item => item.id === id)).filter(Boolean).map(option => renderAspectCard(option, true))}
                  </div>
                ) : (
                  <div className="aspect-settings-empty">还没有常用比例。可在下方数字比例卡片右上角点星标添加。</div>
                )}
              </section>

              <section className="aspect-settings-section">
                <div className="aspect-settings-section-title"><strong>数字比例</strong><small>选择目标视频区域的宽高比</small></div>
                <div className="aspect-ratio-grid">
                  {NUMERIC_ASPECT_PRESETS.map(option => renderAspectCard(option))}
                </div>
              </section>

              <section className="aspect-settings-section">
                <div className="aspect-settings-section-title"><strong>其他比例</strong><small>自动匹配视频源，或输入自定义宽高比</small></div>
                <div className="aspect-ratio-grid aspect-ratio-grid-other">
                  {OTHER_ASPECT_PRESETS.filter(option => option.id === 'original').map(option => renderAspectCard(option))}
                  {renderAspectCard({ id: 'custom', label: customRatioLabel, title: `自定义比例 ${customRatioLabel}` })}
                </div>
                <div className="aspect-custom-editor">
                  <div className="aspect-custom-editor-title"><strong>自定义比例</strong><small>输入两个整数，例如 5 : 4 或 2 : 1</small></div>
                  <div className="aspect-custom-fields">
                    <label><span>宽度</span><input type="number" min="1" max="10000" step="1" inputMode="numeric" value={customWidth} onChange={event => setCustomWidth(event.target.value)} aria-label="自定义比例宽度" /></label>
                    <span className="aspect-custom-colon">:</span>
                    <label><span>高度</span><input type="number" min="1" max="10000" step="1" inputMode="numeric" value={customHeight} onChange={event => setCustomHeight(event.target.value)} aria-label="自定义比例高度" /></label>
                    <button type="button" onClick={applyCustomAspect}>应用</button>
                  </div>
                </div>
              </section>

              <section className="aspect-settings-section">
                <div className="aspect-settings-section-title"><strong>画面适配方式</strong><small>决定视频如何填入上方的目标区域</small></div>
                <div className="aspect-fit-grid">
                  {FIT_MODE_OPTIONS.map(option => (
                    <button type="button" key={option.id} className={`aspect-fit-card ${fitMode === option.id ? 'selected' : ''}`} onClick={() => {
                      setFitMode(option.id);
                      if (option.id === 'crop' && cropScale === 1) setCropScale(1.15);
                      setAspectNotice('');
                    }} aria-pressed={fitMode === option.id}>
                      <span className={`aspect-fit-preview mode-${option.id}`}><i /><b /><em /></span>
                      <span className="aspect-fit-copy"><strong>{option.label}</strong><small>{option.description}</small></span>
                      {fitMode === option.id && <Check size={16} className="aspect-fit-check" />}
                    </button>
                  ))}
                </div>
              </section>

              {fitMode === 'crop' && (
                <section className="aspect-settings-section aspect-adjust-section">
                  <div className="aspect-settings-section-title"><strong>裁剪范围与位置</strong><small>放大画面并拖动预览位置，保留想看的区域</small></div>
                  <label className="aspect-range-row"><span>裁剪放大</span><input type="range" min="1" max="2.5" step="0.05" value={cropScale} onChange={event => setCropScale(Number(event.target.value))} /><output>{cropScale.toFixed(2)}×</output></label>
                  <label className="aspect-range-row"><span>水平位置</span><input type="range" min="-45" max="45" step="1" value={videoPan.x} onChange={event => setAspectPanAxis('x', event.target.value)} /><output>{videoPan.x}%</output></label>
                  <label className="aspect-range-row"><span>垂直位置</span><input type="range" min="-45" max="45" step="1" value={videoPan.y} onChange={event => setAspectPanAxis('y', event.target.value)} /><output>{videoPan.y}%</output></label>
                  <p className="aspect-settings-hint">也可以在视频上双指缩放、单指拖动调整裁剪区域。</p>
                </section>
              )}

              <section className="aspect-settings-section aspect-zoom-section">
                <div className="aspect-settings-section-title"><strong>锁定比例放大</strong><small>横向和纵向等比例缩放，不会把人物拉宽或压扁</small></div>
                <button type="button" className={`aspect-zoom-toggle ${lockZoomEnabled ? 'enabled' : ''}`} onClick={() => {
                  setLockZoomEnabled(value => !value);
                  setAspectNotice('');
                }} aria-pressed={lockZoomEnabled}>
                  <span className="aspect-zoom-toggle-copy"><strong>{lockZoomEnabled ? '已开启锁比例放大' : '关闭锁比例放大'}</strong><small>{lockZoomEnabled ? '当前缩放会应用于三个播放界面' : '开启后可使用滑块或双指手势放大'}</small></span>
                  <span className="aspect-zoom-switch" aria-hidden="true"><i /></span>
                </button>
                <label className={`aspect-range-row ${!lockZoomEnabled ? 'is-disabled' : ''}`}><span>放大倍数</span><input type="range" min="1" max="3" step="0.05" value={lockZoomScale} disabled={!lockZoomEnabled} onChange={event => setLockZoomScale(Number(event.target.value))} /><output>{lockZoomScale.toFixed(2)}×</output></label>
                {lockZoomEnabled && <>
                  <label className="aspect-range-row"><span>水平位置</span><input type="range" min="-45" max="45" step="1" value={videoPan.x} onChange={event => setAspectPanAxis('x', event.target.value)} /><output>{videoPan.x}%</output></label>
                  <label className="aspect-range-row"><span>垂直位置</span><input type="range" min="-45" max="45" step="1" value={videoPan.y} onChange={event => setAspectPanAxis('y', event.target.value)} /><output>{videoPan.y}%</output></label>
                  <p className="aspect-settings-hint">播放画面支持双指捏合缩放和单指拖动；相同缩放比例会跨主界面、沉浸界面与全屏保留。</p>
                </>}
              </section>

              <div className="aspect-settings-footer">
                {aspectNotice && <p role="status" className="aspect-settings-notice">{aspectNotice}</p>}
                <button type="button" className="aspect-reset-button" onClick={resetAspectTransform}><RefreshCw size={15} />恢复默认缩放与位置</button>
                <button type="button" className="aspect-done-button" onClick={closeAspectPanel}>完成</button>
              </div>
            </div>
          </section>
        </div>
      ), (typeof document !== 'undefined' && document.fullscreenElement) ? document.fullscreenElement : document.body)}
    </div>
  );
}

export const SangtianPlayerWindowCore = SangtianPlayerWindow;

export function SangtianFloatingBar({
  playbackRate = 1.0,
  onChangeRate,
  currentTime = 0,
  duration = 0,
  isLive = false,
}) {
  const rates = [0.75, 1.0, 1.25, 1.5, 2.0];

  const handleCycleSpeed = (dir) => {
    const idx = rates.indexOf(playbackRate);
    if (dir === 'up') {
      const nextIdx = Math.min(rates.length - 1, (idx === -1 ? 1 : idx) + 1);
      onChangeRate?.(rates[nextIdx]);
    } else {
      const nextIdx = Math.max(0, (idx === -1 ? 1 : idx) - 1);
      onChangeRate?.(rates[nextIdx]);
    }
  };

  const formatTime = value => {
    if (!Number.isFinite(value)) return '00:00';
    const total = Math.max(0, Math.floor(value));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const timeString = `${formatTime(currentTime)} / ${formatTime(duration)}`;

  return (
    <div className="sangtian-floating-bar">
      {!isLive && (
        <div className="sangtian-zoom-controls">
          <button
            className="sangtian-zoom-btn"
            onClick={() => handleCycleSpeed('down')}
            title="减速播放"
          >
            -
          </button>
          <span className="sangtian-speed-label">{playbackRate}x</span>
          <button
            className="sangtian-zoom-btn"
            onClick={() => handleCycleSpeed('up')}
            title="加速播放"
          >
            +
          </button>
        </div>
      )}

      <div
        className="sangtian-model-pill"
        style={{ cursor: 'default', userSelect: 'none' }}
      >
        <Sparkles size={14} className="sparkle-gold" />
        <span className="model-pill-text">{timeString}</span>
      </div>
    </div>
  );
}

export function SangtianConsoleCard({
  title,
  subtitle,
  description,
  episodes = [],
  currentEpisodeId,
  onSelectEpisode,
  sources = [],
  currentSource,
  onSelectSource,
  candidates = [],
  currentCandidateId,
  onSelectCandidate,
  streamUrl,
  relatedItems = [],
  onSelectRelated,
  onReplay,
  onTogglePip,
  playerStatus = 'idle',
  isLive = false,
  activeItemId,
  onBack,
  onFav,
  isFav = false,
  onSearchSameName,
  sourceName = '',
  actors = [],
  director = '',
  writer = '',
}) {
  const [activeTab, setActiveTab] = useState('info'); // Default to 'info' (简介)
  const [copiedLink, setCopiedLink] = useState(false);
  const [selectedLiveCat, setSelectedLiveCat] = useState('全部');

  const actorsArr = React.useMemo(() => {
    return Array.isArray(actors) ? actors : (typeof actors === 'string' ? actors.split(/[\/,，\s]+/).map(a => a.trim()).filter(Boolean) : []);
  }, [actors]);

  const mainActors = React.useMemo(() => actorsArr.slice(0, 3), [actorsArr]);
  const otherActors = React.useMemo(() => actorsArr.slice(3), [actorsArr]);

  const handleCopyStream = () => {
    if (navigator?.clipboard?.writeText && streamUrl) {
      navigator.clipboard.writeText(streamUrl).catch(() => {});
    }
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2200);
  };

  const liveCategories = React.useMemo(() => {
    if (!isLive || !relatedItems.length) return ['全部'];
    const cats = new Set();
    relatedItems.forEach(item => {
      if (item.category) cats.add(item.category);
    });
    return ['全部', ...Array.from(cats)];
  }, [isLive, relatedItems]);

  const filteredLiveChannels = React.useMemo(() => {
    if (!isLive) return [];
    if (selectedLiveCat === '全部') return relatedItems;
    return relatedItems.filter(item => (item.category || '未分类') === selectedLiveCat);
  }, [isLive, selectedLiveCat, relatedItems]);

  return (
    <div className="sangtian-console-card">
      {/* Sub-header Bar: Toggles & View Switches */}
      <div className="sangtian-console-subbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        {onBack ? (
          <button
            className="console-tab-btn back-button"
            onClick={onBack}
            title="返回上一页"
            style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', background: 'rgba(255,255,255,0.08)', borderRadius: '8px', fontSize: '13px', color: '#aeb5c3' }}
          >
            <ChevronLeft size={16} />
            <span>返回</span>
          </button>
        ) : <div style={{ marginRight: 'auto' }} />}

        {isLive && (
          <div className="console-toggles" style={{ marginLeft: '12px', marginRight: '12px' }}>
            <div className="console-live-status">
              <span className="live-pill">LIVE 直连</span>
              <span>{playerStatus === 'playing' ? '播放中' : playerStatus === 'buffering' ? '缓冲中' : playerStatus === 'reconnecting' ? '自动重连中' : playerStatus === 'error' ? '播放失败' : '连接中'}</span>
            </div>
          </div>
        )}

        <div className="console-tab-switches" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onFav && (
            <button
              className={`console-tab-btn fav-button ${isFav ? 'active-fav' : ''}`}
              onClick={onFav}
              title={isFav ? "取消收藏" : "加入收藏"}
              style={{ color: isFav ? '#e11d48' : 'inherit' }}
            >
              <Heart size={14} fill={isFav ? '#e11d48' : 'none'} />
              <span>{isFav ? '已收藏' : '收藏'}</span>
            </button>
          )}
          {onSearchSameName && (
            <button
              className="console-tab-btn same-name-button"
              onClick={onSearchSameName}
              title="全网跨源搜同名影视"
            >
              <Search size={14} />
              <span>搜同名</span>
            </button>
          )}
          <button
            className={`console-tab-btn ${activeTab === 'episodes' ? 'active' : ''}`}
            onClick={() => setActiveTab('episodes')}
            title={isLive ? "频道选择" : "选集播放"}
          >
            <LayoutGrid size={14} />
            <span>{isLive ? '频道' : '选集'}</span>
          </button>
          <button
            className={`console-tab-btn ${activeTab === 'info' ? 'active' : ''}`}
            onClick={() => setActiveTab('info')}
            title={isLive ? "直播信息" : "剧集信息与简介"}
          >
            <FileText size={14} />
            <span>{isLive ? '信息' : '简介'}</span>
          </button>
        </div>
      </div>

      {/* Main Interactive Content */}
      <div className="sangtian-console-body">
        {/* Tab 1: Episodes (选集) OR Channels Grid for Live */}
        {activeTab === 'episodes' && (
          <div className="console-episodes-section">
            <div className="console-section-header">
              <span className="section-eyebrow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span>
                  {isLive ? (filteredLiveChannels.length > 0 ? "LIVE CHANNELS · 频道切换" : "LIVE DIRECT · 当前直播") : `EPISODES · 选集列表 (当前片源：${sourceName || '未知源'})`}
                </span>
              </span>
              <h4>{title}</h4>
            </div>

            {/* 选集里面只要出现主演（去除阴影，加上1px的黑色描边），不要其他出演人员名字，居中，无“主演：”前缀 */}
            {!isLive && mainActors.length > 0 && (
              <div className="console-cast-section-episodes" style={{ marginBottom: '14px', padding: '12px 16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '10px' }}>
                {mainActors.map(actor => (
                  <span
                    key={actor}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '6px 14px',
                      borderRadius: '8px',
                      background: 'rgba(217, 119, 6, 0.15)',
                      color: '#f59e0b',
                      fontWeight: '800',
                      fontSize: '15px',
                      letterSpacing: '0.12em',
                      textShadow: 'none',
                    }}
                  >
                    {actor}
                  </span>
                ))}
              </div>
            )}

            {/* 当前流直链剪贴板区域 (移至选集前面) */}
            {!isLive && (
              <div className="console-url-snippet" style={{ marginBottom: '14px', marginTop: '6px' }}>
                <span className="snippet-label">当前流直链：</span>
                <code className="snippet-code">{streamUrl || '加载中…'}</code>
                <button className="snippet-copy-btn" onClick={handleCopyStream}>
                  {copiedLink ? <Check size={14} color="#54c46f" /> : <Copy size={14} />}
                  <span>{copiedLink ? '已复制' : '复制直链'}</span>
                </button>
              </div>
            )}

            {isLive ? (
              <div className="sangtian-channel-selector-wrapper">
                {/* Category Filter Pills */}
                {liveCategories.length > 1 && (
                  <div className="sangtian-console-category-scroll">
                    {liveCategories.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        className={`console-category-pill ${selectedLiveCat === cat ? 'active' : ''}`}
                        onClick={() => setSelectedLiveCat(cat)}
                      >
                        <span>{cat}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Quick Line Candidates Bar if lines exist */}
                {candidates.length > 0 && (
                  <div className="console-quick-lines-bar">
                    <span className="quick-lines-label">当前线路:</span>
                    <div className="quick-lines-chips">
                      {candidates.map((c, index) => {
                        const isCurrentLine = c.candidateId === currentCandidateId;
                        const lineName = c.metadata?.label || c.label || (c.index != null ? `线路 ${c.index + 1}` : `线路 ${index + 1}`);
                        return (
                          <button
                            key={c.candidateId}
                            type="button"
                            className={`quick-line-pill ${isCurrentLine ? 'active' : ''}`}
                            aria-pressed={isCurrentLine}
                            onClick={() => {
                              // A live line selection is one atomic action. Do not
                              // call candidate and index callbacks together.
                              if (isLive && onSwitchStreamIndex) {
                                onSwitchStreamIndex(index);
                              } else if (onSelectCandidate) {
                                onSelectCandidate(c.candidateId);
                              } else {
                                onSwitchCandidate?.(c.candidateId);
                              }
                            }}
                          >
                            {lineName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Channels Grid */}
                <div className="sangtian-channel-selection-grid">
                  {filteredLiveChannels.map((item) => {
                    const isCurrent = item.channelId === activeItemId;
                    return (
                      <button
                        key={item.channelId}
                        type="button"
                        className={`sangtian-channel-btn ${isCurrent ? 'active' : ''}`}
                        onClick={() => onSelectRelated?.(item)}
                      >
                        <div className="channel-logo-mini">
                          {item.logo ? <img src={item.logo} alt="" /> : <Radio size={14} />}
                        </div>
                        <div className="channel-info-mini">
                          <span className="channel-name-mini">{item.name}</span>
                          <span className="channel-sub-mini">
                            {isCurrent ? '● 正在播放' : (item.category || '直播频道')}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : episodes.length > 0 ? (
              <div className="sangtian-episode-grid">
                {episodes.map((ep, idx) => {
                  const isCurrent = ep.episodeId === currentEpisodeId || idx === 0 && !currentEpisodeId;
                  return (
                    <button
                      key={ep.episodeId || idx}
                      className={`sangtian-ep-btn ${isCurrent ? 'active' : ''}`}
                      onClick={() => onSelectEpisode?.(idx)}
                    >
                      <span>{ep.title || `${idx + 1}`}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="sangtian-empty-text">当前内容暂无更多选集可供切换</div>
            )}
          </div>
        )}

        {/* Tab 2: Information & Synopsis (视频信息与简介) */}
        {activeTab === 'info' && (
          <div className="console-info-section">
            <div className="console-section-header">
              <span className="section-eyebrow">{isLive ? "LIVE · 当前直播" : "OVERVIEW · 详细资料"}</span>
              <h4>{title}</h4>
            </div>
            {subtitle && <p className="console-subtitle">{subtitle}</p>}
            <p className="console-description">{description || '暂无剧情简介。'}</p>

            {!isLive && (actorsArr.length > 0 || director || writer) && (
              <div className="console-cast-section" style={{ marginTop: '12px', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '12px', color: '#8f98aa', textTransform: 'uppercase', letterSpacing: '0.15em', display: 'block', marginBottom: '12px', fontWeight: 'bold', textAlign: 'center' }}>
                  CAST & CREW
                </span>
                {(director || writer) && (
                  <div style={{ fontSize: '13px', color: '#cbd5e1', marginBottom: '14px', textAlign: 'center', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '16px' }}>
                    {director && <span><span style={{ color: '#8f98aa' }}>导演：</span>{director}</span>}
                    {writer && <span><span style={{ color: '#8f98aa' }}>编剧：</span>{writer}</span>}
                  </div>
                )}
                {mainActors.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '14px', justifyContent: 'center' }}>
                    {mainActors.map(actor => (
                      <span
                        key={actor}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '6px 14px',
                          borderRadius: '8px',
                          background: 'rgba(217, 119, 6, 0.15)',
                          border: '1px solid rgba(217, 119, 6, 0.35)',
                          color: '#f59e0b',
                          fontWeight: '800',
                          fontSize: '15px',
                          letterSpacing: '0.12em',
                          boxShadow: '0 2px 5px rgba(0,0,0,0.25)',
                        }}
                      >
                        {actor}
                      </span>
                    ))}
                  </div>
                )}
                {otherActors.length > 0 && (
                  <div style={{ fontSize: '12px', color: '#aeb5c3', lineHeight: '1.5', paddingTop: '8px', borderTop: '1px dashed rgba(255,255,255,0.08)', textAlign: 'center' }}>
                    <span style={{ color: '#8f98aa' }}>参演人员：</span>
                    {otherActors.join('  ·  ')}
                  </div>
                )}
              </div>
            )}

            <div className="console-info-actions" style={{ display: 'flex', gap: '8px', margin: '12px 0', flexWrap: 'wrap' }}>
              {onSearchSameName && (
                <button
                  type="button"
                  className="secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
                  onClick={onSearchSameName}
                  title="全网跨源搜索同名影视"
                >
                  <Search size={15} />
                  <span>全网搜同名</span>
                </button>
              )}
              {onFav && (
                <button
                  type="button"
                  className={`secondary ${isFav ? 'active-fav' : ''}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', background: isFav ? 'rgba(225,29,72,0.15)' : 'rgba(255,255,255,0.08)', color: isFav ? '#f43f5e' : '#fff', border: isFav ? '1px solid #f43f5e' : '1px solid rgba(255,255,255,0.15)' }}
                  onClick={onFav}
                >
                  <Heart size={15} fill={isFav ? '#f43f5e' : 'none'} />
                  <span>{isFav ? '已收藏' : '收藏'}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Related Recommendations (相关推荐) - Hidden for live because channels are in the main tab */}
        {!isLive && relatedItems.length > 0 && (
          <div className="console-related-section">
            <div className="console-section-header">
              <span className="section-eyebrow">RECOMMENDED · 相关推荐</span>
            </div>
            <div className="sangtian-related-row">
              {relatedItems.slice(0, 6).map(item => (
                <div
                  key={item.contentId || item.channelId}
                  className="sangtian-related-card"
                  onClick={() => onSelectRelated?.(item)}
                >
                  <img src={item.poster || item.logo} alt={item.title || item.name} />
                  <b>{item.title || item.name}</b>
                  <small>{item.category || item.year || '精彩视听'}</small>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
