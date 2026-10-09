import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Heart, Play, Radio, RefreshCw } from 'lucide-react';
import { tv1LiveService } from './liveServices.js';
import { playbackService } from '../core__services__playbackService.js';
import { usePersistentState } from '../core__state__usePersistentState.js';
import { requestManager } from '../core__services__network__requestManager.js';
import { SmartImage, EmptyState, LoadingState, ErrorState } from '../shared__components__StateViews.jsx';
import { Tv1LivePlayerBlock } from './PlayerBlocks.jsx';
import { getPlaybackScheme } from '../core__models__userData.js';
import { detectRuntimeEnv, RUNTIME_ENV } from '../core__playback__playbackStrategyDispatcher.js';

function normalizeDecoderSelection(player = 'ijk', mode = 'hardware') {
  return getPlaybackScheme(String(player || 'ijk') + '_' + (String(mode).toLowerCase() === 'software' ? 'software' : 'hardware')).id;
}

export function Tv1LiveFeature({ sources = [], favorites = [], onPlay, toggleFavorite, onBack }) {
  const { saveSettings, settings } = usePersistentState();
  const tv1Sources = useMemo(() => sources.filter(tv1LiveService.isSupportedSource), [sources]);
  const [sourceId, setSourceId] = useState(tv1Sources[0]?.sourceId || '');
  const [channels, setChannels] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [category, setCategory] = useState('全部');
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [streamIndex, setStreamIndex] = useState(0);
  const [decoderEngine, setDecoderEngine] = useState(() => {
    const isWeb = detectRuntimeEnv() === RUNTIME_ENV.WEB;
    const playback = settings?.playback || {};
    if (playback.livePlaybackScheme) return getPlaybackScheme(playback.livePlaybackScheme).id;
    if (isWeb) return 'hls_lowlatency';
    const engine = playback.livePlayer || 'ijk';
    return normalizeDecoderSelection(engine, playback.decoder?.[engine] || 'hardware');
  });
  const [isImmersive, setIsImmersive] = useState(false);
  const [resolvedInput, setResolvedInput] = useState(null);
  const [playbackError, setPlaybackError] = useState('');
  const videoRef = useRef(null);
  const controllerRef = useRef(null);
  const loadedControllerRef = useRef(null);
  const loadedCandidateIdRef = useRef('');

  useEffect(() => {
    if (!sourceId && tv1Sources.length) setSourceId(tv1Sources[0].sourceId);
    if (sourceId && !tv1Sources.some(source => source.sourceId === sourceId)) setSourceId(tv1Sources[0]?.sourceId || '');
  }, [tv1Sources, sourceId]);

  const activeSource = useMemo(() => tv1Sources.find(source => source.sourceId === sourceId) || tv1Sources[0] || null, [tv1Sources, sourceId]);

  const load = async (isCurrent = () => true) => {
    if (!activeSource) return;
    setStatus('loading');
    setError(null);
    try {
      const next = await requestManager.run(`tv1-live:${activeSource.sourceId}`, signal => tv1LiveService.load(activeSource, { signal }));
      if (!isCurrent()) return;
      setChannels(next);
      setSelectedChannelId(current => next.some(item => item.channelId === current) ? current : '');
      setStreamIndex(0);
      setStatus('success');
    } catch (reason) {
      if (!isCurrent() || reason?.name === 'AbortError' || reason?.message === 'REQUEST_ABORTED') return;
      setChannels([]);
      setStatus('error');
      setError(reason);
    }
  };

  useEffect(() => {
    let current = true;
    const sourceKey = activeSource?.sourceId ? `tv1-live:${activeSource.sourceId}` : null;
    if (sourceKey) void load(() => current);
    return () => {
      current = false;
      if (sourceKey) requestManager.cancel(sourceKey);
    };
  }, [activeSource?.sourceId]);

  const activeChannel = useMemo(() => selectedChannelId ? channels.find(channel => channel.channelId === selectedChannelId) || null : null, [channels, selectedChannelId]);
  const playbackRequest = useMemo(
    () => activeChannel ? playbackService.createLiveRequest({ channel: activeChannel, preferredSource: activeSource?.sourceId }) : null,
    [activeChannel, activeSource?.sourceId],
  );
  const activeStream = activeChannel?.streams?.[streamIndex] || activeChannel?.streams?.[0] || null;
  const categories = useMemo(() => ['全部', ...new Set(channels.map(channel => channel.category).filter(Boolean))], [channels]);
  const visible = useMemo(() => category === '全部' ? channels : channels.filter(channel => channel.category === category), [channels, category]);

  const handleSwitchDecoderEngine = async (engineInput) => {
    const scheme = getPlaybackScheme(engineInput);
    const engine = scheme.engine;
    const decoderMode = scheme.decoder;
    const normalizedSelection = scheme.id;
    setDecoderEngine(normalizedSelection);

    const currentPlayback = settings?.playback || {};
    saveSettings({
      ...settings,
      playback: {
        ...currentPlayback,
        livePlayer: engine,
        livePlaybackScheme: scheme.id,
        decoder: {
          ...(currentPlayback.decoder || {}),
          [engine]: decoderMode,
        },
      },
    });

    const target = playbackRequest?.candidates?.[streamIndex] || playbackRequest?.candidates?.[0];
    if (target && controllerRef.current) {
      setStatus('loading');
      setPlaybackError('');
      const hinted = {
        ...target,
        playerHint: {
          ...(target.playerHint || {}),
          engine,
          decoder: decoderMode,
        },
      };
      controllerRef.current.resolveAndLoad(hinted).catch(reason => {
        setPlaybackError(reason?.message || '切换解码内核失败');
      });
    }
  };

  const playbackController = useMemo(() => {
    if (!playbackRequest) return null;
    return playbackService.createController(playbackRequest, {
      onStateChange: nextState => setStatus(nextState),
      onEvent: event => {
        if (event?.event !== 'decoderChanged') return;
        const payload = event?.data ?? event?.decoder ?? {};
        const engine = String(payload?.engine ?? '').toLowerCase();
        const mode = String(payload?.mode ?? '').toLowerCase();
        if (engine === 'exo' || engine === 'ijk') {
          setDecoderEngine(engine + '_' + (mode === 'software' ? 'software' : 'hardware'));
        } else if (engine === 'html5') {
          setDecoderEngine(mode.includes('hard') ? 'html5_hardware' : 'hls_lowlatency');
        }
      },
      onResolvedInput: setResolvedInput,
      onPlayerError: ({ error: reason }) => setPlaybackError(reason?.message || '播放器加载失败'),
      onExhausted: () => setStatus('error'),
    });
  }, [playbackRequest]);

  controllerRef.current = playbackController;

  useEffect(() => {
    if (!playbackController || !playbackRequest) return undefined;
    let active = true;
    const player = playbackController.attachPlayer(videoRef.current);
    if (!player) {
      setStatus('error');
      setPlaybackError('Native 播放器不可用');
      return undefined;
    }

    const target = playbackRequest.candidates?.[streamIndex] || playbackRequest.candidates?.[0];
    loadedControllerRef.current = playbackController;
    loadedCandidateIdRef.current = target?.candidateId || '';
    const initial = playbackController.start();

    if (!initial) {
      setStatus('error');
      setPlaybackError('没有可用的 TV1 播放线路');
    } else if (target && target.candidateId !== initial.candidateId) {
      setStatus('loading');
      setPlaybackError('');
      // switchCandidate already performs the controller-side load; do not call
      // resolveAndLoad a second time or the same TV1 stream would connect twice.
      playbackController.switchCandidate(target.candidateId);
    } else {
      setStatus('loading');
      setPlaybackError('');
      playbackController.resolveAndLoad(initial).catch(reason => {
        if (active) setPlaybackError(reason?.message || 'TV1 播放初始化失败');
      });
    }

    return () => {
      active = false;
      try { playbackController.leave(); } catch {}
      setResolvedInput(null);
    };
  }, [playbackController]);

  useEffect(() => {
    if (!playbackController || !playbackRequest) return undefined;
    if (loadedControllerRef.current !== playbackController) {
      loadedControllerRef.current = playbackController;
      loadedCandidateIdRef.current = '';
      return undefined;
    }

    const target = playbackRequest.candidates?.[streamIndex] || playbackRequest.candidates?.[0];
    if (!target || target.candidateId === loadedCandidateIdRef.current) return undefined;

    loadedCandidateIdRef.current = target.candidateId;
    setPlaybackError('');
    playbackController.switchCandidate(target.candidateId);
    return undefined;
  }, [streamIndex, playbackController, playbackRequest]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') playbackController?.handleAppState('background');
      else playbackController?.handleAppState('foreground');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [playbackController]);

  if (!tv1Sources.length) return <Page><Header title="TV1 直播"/><EmptyState text="暂无 TV1 专用直播源。请在源管理中添加 #genre# TXT，并选择 TV1 专用模式。"/><BackButton onBack={onBack}/></Page>;
  if (status === 'loading') return <Page><Header title="TV1 直播"/><LoadingState text="正在加载 TV1 直播源…"/></Page>;
  if (status === 'error') return <Page><Header title="TV1 直播"/><ErrorState text={`TV1 直播源加载失败：${error?.message || '未知错误'}`} retry={load}/><BackButton onBack={onBack}/></Page>;
  if (!channels.length) return <Page><Header title="TV1 直播"/><EmptyState text="TV1 直播源没有可播放频道"/><BackButton onBack={onBack}/></Page>;

  return (
    <Page>
      <Header title="TV1 直播"/>
      <div className="actions">
        <button className="secondary" onClick={onBack}>返回通用直播</button>
        {tv1Sources.length > 1 && <select value={activeSource?.sourceId || ''} onChange={event => setSourceId(event.target.value)}>{tv1Sources.map(source => <option key={source.sourceId} value={source.sourceId}>{source.name}</option>)}</select>}
        <button className="secondary" onClick={load}><RefreshCw size={15}/>刷新</button>
      </div>
      {activeChannel && <>
        <Tv1LivePlayerBlock 
          videoRef={videoRef} 
          status={status} 
          isLive 
          candidate={{ label: activeStream?.label || '默认线路', url: activeStream?.url, mediaUrl: activeStream?.url, protocol: activeStream?.protocol || 'HLS/M3U8', sourceId: activeSource?.sourceId, candidateId: activeStream?.streamId }} 
          candidates={activeChannel.streams.map((stream, idx) => ({
            candidateId: stream.streamId || `stream-${idx}`,
            label: stream.label || `线路 ${idx + 1}`,
            mediaUrl: stream.url,
            protocol: stream.protocol || 'HLS/M3U8',
            index: idx,
          }))}
          channels={visible}
          activeChannel={activeChannel}
          activeStreamIndex={streamIndex}
          onSelectChannel={chan => { setSelectedChannelId(chan.channelId); setStreamIndex(0); }}
          onSwitchStreamIndex={index => {
            const nextIndex = Math.max(0, Number(index) || 0);
            setStreamIndex(nextIndex);
          }}
          onSelectCandidate={id => {
            const idx = activeChannel.streams.findIndex((s, i) => s.streamId === id || `stream-${i}` === id || s.url === id);
            if (idx >= 0) setStreamIndex(idx);
          }}
          onSwitchCandidate={id => {
            if (typeof id === 'string') {
              const idx = activeChannel.streams.findIndex((s, i) => s.streamId === id || `stream-${i}` === id || s.url === id);
              if (idx >= 0) { setStreamIndex(idx); return; }
            }
            if (activeChannel.streams.length > 1) {
              setStreamIndex(prev => (prev + 1) % activeChannel.streams.length);
            }
          }}
          terminalTag={`TV1 · ${activeChannel.name}`}
          resolvedInput={resolvedInput}
          error={playbackError}
          controller={playbackController}
          decoderEngine={decoderEngine}
          onChangeDecoderEngine={handleSwitchDecoderEngine}
          isImmersive={isImmersive}
          onToggleImmersive={() => setIsImmersive(value => !value)}
          onStop={() => {
            try { playbackController?.stop(); } catch {}
            setResolvedInput(null);
          }}
        >
          <video ref={videoRef} controls playsInline className="sangtian-video-element"/>
        </Tv1LivePlayerBlock>
        <div className="live-current-bar">
          <div className="live-current-info"><span className="live-pill">● TV1 专用</span><b>{activeChannel.name}</b><small>{activeChannel.category} · {activeStream?.label || '线路 1'}</small></div>
          <div className="live-current-actions">
            {activeChannel.streams.length > 1 && activeChannel.streams.map((stream, index) => <button key={stream.streamId} className={streamIndex === index ? 'active' : ''} onClick={() => setStreamIndex(index)}>{stream.label || `线路 ${index + 1}`}</button>)}
            <button className="secondary icon-button" onClick={() => toggleFavorite('channel', activeChannel.channelId)}><Heart size={16} fill={favorites.some(item => item.targetType === 'channel' && item.targetId === activeChannel.channelId) ? 'currentColor' : 'none'}/></button>
            <button className="primary" onClick={() => setIsImmersive(true)}><Play size={13}/>沉浸播放</button>
          </div>
        </div>
      </>}
      <div className="chips">{categories.map(item => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
      <div className="channel-list">
        {visible.map(channel => {
          const favorite = favorites.some(item => item.targetType === 'channel' && item.targetId === channel.channelId);
          const current = channel.channelId === activeChannel?.channelId;
          return <div className={`channel ${current ? 'active-playing' : ''}`} key={channel.channelId} onClick={() => { setSelectedChannelId(channel.channelId); setStreamIndex(0); }}>
            <div className="channel-logo"><SmartImage src={channel.logo} alt={channel.name} fallback={<Radio/>}/></div>
            <div className="channel-main"><b>{channel.name}</b><small>{channel.category} · {channel.streams.length} 条线路</small></div>
            <button className={favorite ? 'channel-favorite active-fav' : 'channel-favorite'} onClick={event => { event.stopPropagation(); toggleFavorite('channel', channel.channelId); }}><Heart size={17} fill={favorite ? 'currentColor' : 'none'}/></button>
            <button className="secondary" onClick={event => { event.stopPropagation(); setSelectedChannelId(channel.channelId); setStreamIndex(0); onPlay(channel); }}><Play size={17}/></button>
          </div>;
        })}
      </div>
    </Page>
  );
}

const Page = ({children}) => <main className="page">{children}</main>;
const Header = ({title}) => <header><div><span className="eyebrow">TVBOX REACT · TV1</span><h2>{title}</h2></div></header>;
const BackButton = ({onBack}) => <button className="secondary" style={{marginTop:12}} onClick={onBack}>返回</button>;
