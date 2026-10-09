import Hls from 'hls.js';
import { STREAM_TYPE, detectStreamTypeFromUrl, probeStreamType } from './core__playback__streamSniffer.js';
import { PlayerState, PlayerCapability, createPlayerCapabilities, createPlayerAdapterContract } from './core__player__playerInterface.js';
import { createPlaybackAttemptGuard } from './core__player__playbackAttemptGuard.js';
import { buildHlsProxyUrl, canUseHlsProxy, isMixedContentUrl as isProxyMixedContentUrl } from './core__playback__hlsWebProxy.js';

export function createHtml5PlayerAdapter(video, hooks = {}) {
  if (!video) throw new Error('PLAYER_ELEMENT_REQUIRED');
  let state=PlayerState.IDLE,input=null,released=false,buffering=false;
  let hlsInstance=null;
  let mpegtsInstance=null;
  let hlsRecoveryCount=0;
  let hlsGeneration=0;
  let loadToken=0;
  const attemptGuard=createPlaybackAttemptGuard();
  let planning=false;
  let watchdog=null;
  let suppressVideoError=false;

  const clearWatchdog = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };
  // HLS 回调可能在切台/切线路后迟到；只有当前加载令牌和实例都匹配时才允许改动状态。
  const isCurrentAttempt = (token, attemptId) =>
    !released && token === loadToken && attemptGuard.isCurrent(attemptId);
  const isCurrentHls = (hls, token, generation, attemptId) =>
    isCurrentAttempt(token, attemptId) && generation === hlsGeneration && hlsInstance === hls;
  const isMixedContentUrl = (url) => isProxyMixedContentUrl(url);

  const cleanupHls = () => {
    clearWatchdog();
    if (hlsInstance) {
      try { hlsInstance.stopLoad(); } catch {}
      try { hlsInstance.detachMedia(); } catch {}
      try { hlsInstance.destroy(); } catch {}
      hlsInstance = null;
      hlsGeneration += 1;
    }
    if (mpegtsInstance) {
      try { mpegtsInstance.pause(); } catch {}
      try { mpegtsInstance.unload(); } catch {}
      try { mpegtsInstance.detachMediaElement(); } catch {}
      try { mpegtsInstance.destroy(); } catch {}
      mpegtsInstance = null;
    }
  };

  const emit=(event,data={})=>hooks.onEvent?.({event,...data});
  const onLoadStart=()=>{state=PlayerState.LOADING;emit('loading');};
  const onWaiting=()=>{if(!buffering){buffering=true;state=PlayerState.BUFFERING;emit('bufferingStart');emit('buffering');}};
  const endBuffering=()=>{if(buffering){buffering=false;emit('bufferingEnd');} if(state===PlayerState.BUFFERING)state=PlayerState.PLAYING;};
  const onCanPlay=()=>{endBuffering();state=PlayerState.PREPARING;emit('prepared');};
  const onPlaying=()=>{endBuffering();state=PlayerState.PLAYING;emit('playing');};
  const onPause=()=>{if(state!==PlayerState.COMPLETED&&state!==PlayerState.STOPPED&&!released){state=PlayerState.PAUSED;emit('paused');}};
  const onTimeUpdate=()=>emit('progress',{currentTime:video.currentTime,duration:video.duration});
  const onEnded=()=>{state=PlayerState.COMPLETED;emit('completed');};
  const onError=()=>{if(suppressVideoError)return;state=PlayerState.ERROR;emit('error',{nativeError:video.error});};
  const bind=()=>{for(const [e,h] of [['loadstart',onLoadStart],['waiting',onWaiting],['canplay',onCanPlay],['playing',onPlaying],['pause',onPause],['timeupdate',onTimeUpdate],['durationchange',onTimeUpdate],['loadedmetadata',onTimeUpdate],['ended',onEnded],['error',onError]])video.addEventListener(e,h);};
  const unbind=()=>{for(const [e,h] of [['loadstart',onLoadStart],['waiting',onWaiting],['canplay',onCanPlay],['playing',onPlaying],['pause',onPause],['timeupdate',onTimeUpdate],['durationchange',onTimeUpdate],['loadedmetadata',onTimeUpdate],['ended',onEnded],['error',onError]])video.removeEventListener(e,h);};
  const trackList=(list)=>Array.from(list??[]).map((t,i)=>({id:String(t.id??t.language??i),label:t.label??t.language??`Track ${i+1}`,language:t.language??'',kind:t.kind??''}));
  bind();


  const tryAutoplay = () => {
    const p = video.play();
    p?.catch?.(err => {
      if (err?.name === 'NotAllowedError' && !video.muted) {
        video.muted = true;
        video.play()?.catch?.(() => {});
      }
    });
  };

  const failPlayback = (message) => {
    clearWatchdog();
    cleanupHls();
    suppressVideoError = false;
    state = PlayerState.ERROR;
    emit('error', { nativeError: new Error(message) });
  };

  /**
   * 默认直连；只有用户配置网页端中转时，才为 HLS 增加中转备用策略。
   * 对 .ctv/.php/.xyz/短链/平台路由等动态地址，
   * 先探测真实格式；探测受 CORS 限制时依次尝试 HLS、原生媒体、FLV、MPEG-TS。
   */
  const planAttempts = async (next, token) => {
    const hint = detectStreamTypeFromUrl(next.url);
    const declared = String(next.protocol || next.format || '').toLowerCase();
    const explicitTypes = new Set(Object.values(STREAM_TYPE));
    const declaredType = explicitTypes.has(declared) && declared !== STREAM_TYPE.UNKNOWN ? declared : null;
    const type = declaredType || hint.type;

    if (type === STREAM_TYPE.RTMP || type === STREAM_TYPE.RTSP) {
      return { error: 'STREAM_UNSUPPORTED:' + type.toUpperCase() + '_NOT_PLAYABLE_IN_BROWSER' };
    }

    const mixedContent = isMixedContentUrl(next.url);
    // HTTPS 页面加载 HTTP 直播源时，HLS.js / mpegts.js 的 fetch/XHR 会受混合内容策略限制。
    // 没有用户/部署方显式配置代理时，只尝试浏览器原生媒体路径（浏览器可能自动升级媒体请求），
    // 随后由 LiveFeature 切换同频道下一条线路；不要对同一条必然受限的 URL 反复尝试多个解码器。
    if (mixedContent && !canUseHlsProxy()) {
      return { attempts: [{ type: 'native', url: next.url }] };
    }
    const addUnique = (list, candidate) => {
      const candidateUrl = candidate.url || next.url;
      if (!list.some((item) => item.type === candidate.type && (item.url || next.url) === candidateUrl)) list.push(candidate);
    };
    // 中转必须由用户显式配置；HTTPS 页面遇到 HTTP 源时优先中转，
    // 其他情况先尝试直连，再把配置的 HTTPS 中转作为 HLS 备用策略。
    const addHlsAttempts = (list) => {
      const proxyUrl = canUseHlsProxy() ? buildHlsProxyUrl(next.url) : null;
      if (mixedContent && proxyUrl) {
        // 已配置 HTTPS 中转时，不再浪费一个启动超时去请求必然可能被拦截的 HTTP 源。
        addUnique(list, { type: STREAM_TYPE.HLS, url: proxyUrl, viaProxy: true });
        return;
      }
      addUnique(list, { type: STREAM_TYPE.HLS, url: next.url });
      if (!mixedContent && proxyUrl) addUnique(list, { type: STREAM_TYPE.HLS, url: proxyUrl, viaProxy: true });
    };

    if (hint.confident || (declaredType && declaredType !== STREAM_TYPE.UNKNOWN)) {
      const attempts = [];
      // HTTPS 页面遇到 HTTP 源时，浏览器直连会被混合内容策略阻止；
      if (mixedContent && type !== STREAM_TYPE.HLS) addUnique(attempts, { type: 'native' });
      if (type === STREAM_TYPE.HLS) addHlsAttempts(attempts);
      else addUnique(attempts, { type });
      if (type === STREAM_TYPE.HLS) addUnique(attempts, { type: 'native' });
      if (type === STREAM_TYPE.FLV || type === STREAM_TYPE.TS) addHlsAttempts(attempts);
      return { attempts };
    }

    let probed = null;
    // 仅在 HTTPS 页面加载 HTTPS 源或 HTTP 页面加载任意 HTTP(S) 源时探测。
    // HTTPS 页面访问 HTTP 源可能被浏览器混合内容策略直接阻止，避免等待探测超时。
    if (!mixedContent) {
      probed = await probeStreamType(next.url, { timeoutMs: 4500 });
      if (token !== loadToken || released) return { attempts: [] };
    }

    const attempts = [];
    if (mixedContent && !canUseHlsProxy()) addUnique(attempts, { type: 'native' });
    if (probed?.type === STREAM_TYPE.HLS) addHlsAttempts(attempts);
    else if (probed?.type && probed.type !== STREAM_TYPE.UNKNOWN) addUnique(attempts, { type: probed.type });
    // 动态 URL 常见实际返回 HLS，也可能返回 FLV/裸 TS 或浏览器原生支持的 MP4。
    addHlsAttempts(attempts);
    addUnique(attempts, { type: 'native' });
    addUnique(attempts, { type: STREAM_TYPE.FLV });
    addUnique(attempts, { type: STREAM_TYPE.TS });
    return { attempts };
  };

  const startWebPlayback = async (next, token) => {
    planning = true;
    let plan;
    try { plan = await planAttempts(next, token); } catch { plan = { attempts: [{ type: STREAM_TYPE.HLS }, { type: 'native' }, { type: STREAM_TYPE.FLV }, { type: STREAM_TYPE.TS }] }; }
    planning = false;
    if (token !== loadToken || released) return;
    if (plan.error) { failPlayback(plan.error); return; }

    const attempts = plan.attempts || [];
    let index = -1;
    let lastError = 'HLS_NETWORK_ERROR:all_attempts_failed';
    let playbackStarted = false;

    const advance = (reason, expectedAttemptId = null) => {
      if (token !== loadToken || released) return;
      // A late error/watchdog from a previous strategy must not advance the current strategy.
      if (expectedAttemptId !== null && !attemptGuard.isCurrent(expectedAttemptId)) return;
      if (reason) lastError = reason;
      const attemptId = attemptGuard.begin();
      clearWatchdog();
      cleanupHls();
      index += 1;
      if (index >= attempts.length) {
        // Keep the actionable root cause: browsers commonly surface mixed-content blocks as opaque media/network errors.
        if (isMixedContentUrl(next.url)) {
          const proxyAttempted = attempts.some((item) => item.viaProxy);
          failPlayback(proxyAttempted
            ? 'MIXED_CONTENT_PROXY_FAILED:HTTPS_PAGE_HTTP_STREAM'
            : 'MIXED_CONTENT_BLOCKED:HTTPS_PAGE_HTTP_STREAM');
        } else {
          failPlayback(lastError);
        }
        return;
      }
      hlsRecoveryCount = 0;
      suppressVideoError = index < attempts.length - 1;
      const attempt = attempts[index];
      playbackStarted = false;
      if (next.playerHint?.autoplay !== false) {
        watchdog = setTimeout(() => {
          if (!isCurrentAttempt(token, attemptId) || playbackStarted) return;
          advance('HLS_NETWORK_ERROR:startup_timeout', attemptId);
        }, 25000);
        const onAttemptPlaying = () => {
          if (isCurrentAttempt(token, attemptId)) {
            playbackStarted = true;
            clearWatchdog();
          }
        };
        video.addEventListener('playing', onAttemptPlaying, { once: true });
      }
      if (attempt.type === STREAM_TYPE.HLS) startHls(attempt, attemptId);
      else if (attempt.type === STREAM_TYPE.FLV || attempt.type === STREAM_TYPE.TS) void startMpegts(attempt, attemptId);
      else startNative(attempt, attemptId);
    };

    const startNative = (attempt, attemptId) => {
      video.src = attempt.url || next.url;
      video.autoplay = next.playerHint?.autoplay !== false;
      video.load();
      // 原生元素的 error 事件由 onError 统一上报；这里只在还有后备时接管
      const onNativeError = () => {
        video.removeEventListener('error', onNativeError);
        if (!isCurrentAttempt(token, attemptId)) return;
        if (index < attempts.length - 1) advance('HLS_MEDIA_ERROR:native', attemptId);
      };
      video.addEventListener('error', onNativeError, { once: true });
    };

    const startHls = (attempt, attemptId) => {
      const isLiveStream = Boolean(next.kind === 'live' || next.protocol === 'LIVE' || next.playerHint?.isLive || next.playerHint?.live || next.metadata?.isLive);
      const isLowLatency = Boolean(next.playerHint?.webMode === 'hls_lowlatency' || isLiveStream);
      if (!Hls.isSupported()) {
        // iOS Safari：尝试浏览器原生 HLS 播放能力
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = attempt.url || next.url;
          video.autoplay = next.playerHint?.autoplay !== false;
          video.load();
          const onErr = () => { if (isCurrentAttempt(token, attemptId)) advance('HLS_MEDIA_ERROR:native_hls', attemptId); };
          video.addEventListener('error', onErr, { once: true });
        } else advance('STREAM_UNSUPPORTED:HLS', attemptId);
        return;
      }
      try {
        hlsGeneration += 1;
        const generation = hlsGeneration;
        let fragLoadedCount = 0;
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: isLowLatency,
          liveSyncMode: 'buffered',
          startOnSegmentBoundary: true,
          initialLiveManifestSize: 6,
          backBufferLength: isLiveStream ? 30 : 60,
          maxBufferLength: isLiveStream ? 12 : 30,
          maxMaxBufferLength: isLiveStream ? 35 : 120,
          maxBufferSize: 80 * 1000 * 1000,
          maxBufferHole: 0.8,
          highBufferWatchdogPeriod: 2,
          nudgeOffset: 0.2,
          nudgeMaxRetry: 5,
          liveSyncDurationCount: isLiveStream ? 3 : 6,
          liveMaxLatencyDurationCount: isLiveStream ? 15 : 40,
          fragLoadingTimeOut: 25000,
          manifestLoadingTimeOut: 25000,
        });
        hlsInstance = hls;
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => { if (isCurrentHls(hls, token, generation, attemptId)) hls.loadSource(attempt.url || next.url); });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!isCurrentHls(hls, token, generation, attemptId)) return;
          hlsRecoveryCount = 0;
          endBuffering();
          state = PlayerState.PREPARING;
          emit('prepared');
          if (next.playerHint?.autoplay !== false) tryAutoplay();
        });
        hls.on(Hls.Events.FRAG_LOADED, () => {
          if (!isCurrentHls(hls, token, generation, attemptId)) return;
          fragLoadedCount += 1;
          if (fragLoadedCount === 1) hls.config.maxBufferLength = Math.max(hls.config.maxBufferLength, 30);
          else if (fragLoadedCount === 2) hls.config.maxBufferLength = Math.max(hls.config.maxBufferLength, 45);
          else if (fragLoadedCount >= 3) hls.config.maxBufferLength = 60;
        });
        hls.on(Hls.Events.ERROR, (event, data) => {
          if (!isCurrentHls(hls, token, generation, attemptId) || !data.fatal) return;
          const details = data.details || 'fatal';
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // 清单拿不到/不是清单，直接尝试下一种本地播放策略
              if (/manifestLoad|manifestParsing/i.test(details) || hlsRecoveryCount >= 1) {
                advance('HLS_NETWORK_ERROR:' + details, attemptId);
              } else {
                hlsRecoveryCount += 1;
                hls.startLoad();
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              if (hlsRecoveryCount < 1) { hlsRecoveryCount += 1; hls.recoverMediaError(); }
              else advance('HLS_MEDIA_ERROR:' + details, attemptId);
              break;
            default:
              advance('HLS_ERROR:' + details, attemptId);
              break;
          }
        });
      } catch {
        advance('HLS_ERROR:init', attemptId);
      }
    };

    // FLV / 裸 MPEG-TS：用 mpegts.js（MSE）在网页里播放
    const startMpegts = async (attempt, attemptId) => {
      let mod;
      try { mod = await import('mpegts.js'); } catch { advance('STREAM_UNSUPPORTED:mpegts_js_missing', attemptId); return; }
      if (!isCurrentAttempt(token, attemptId)) return;
      const mpegts = mod.default || mod;
      if (!mpegts?.isSupported?.()) { advance('STREAM_UNSUPPORTED:MSE_NOT_AVAILABLE', attemptId); return; }
      try {
        const player = mpegts.createPlayer({
          type: attempt.type === STREAM_TYPE.FLV ? 'flv' : 'mpegts',
          isLive: true,
          url: attempt.url || next.url,
          cors: true,
          withCredentials: false,
        }, {
          enableWorker: true,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 15,
          liveBufferLatencyMinRemain: 1.5,
          autoCleanupSourceBuffer: true,
        });
        mpegtsInstance = player;
        player.on(mpegts.Events.ERROR, (errType, detail) => {
          if (!isCurrentAttempt(token, attemptId) || mpegtsInstance !== player) return;
          advance((errType === mpegts.ErrorTypes?.NETWORK_ERROR ? 'HLS_NETWORK_ERROR:' : 'HLS_MEDIA_ERROR:') + (detail || errType), attemptId);
        });
        player.attachMediaElement(video);
        player.load();
        if (next.playerHint?.autoplay !== false) {
          const p = player.play?.();
          p?.catch?.(() => {
            if (!isCurrentAttempt(token, attemptId)) return;
            if (!video.muted) { video.muted = true; video.play()?.catch?.(() => {}); }
          });
        }
        video.addEventListener('playing', () => {
          if (isCurrentAttempt(token, attemptId)) { playbackStarted = true; clearWatchdog(); }
        }, { once: true });
      } catch {
        advance('HLS_ERROR:mpegts_init', attemptId);
      }
    };

    advance();
  };

  const adapter={
    get capabilities(){return createPlayerCapabilities(video);},
    load(next){
      if(released)throw new Error('PLAYER_ADAPTER_RELEASED');
      input=next;
      state=PlayerState.LOADING;
      hlsRecoveryCount=0;
      loadToken+=1;
      attemptGuard.invalidate();
      planning=false;
      suppressVideoError=false;
      cleanupHls();
      video.pause();
      video.removeAttribute('src');
      try { video.load(); } catch (e) {}
      void startWebPlayback(next, loadToken);
      if(next.cookies&&typeof document!=='undefined'){try{for(const cookie of String(next.cookies).split(/;\s*/)){const i=cookie.indexOf('=');if(i>0)document.cookie=cookie;}}catch{}}
      if(next.headers&&Object.keys(next.headers).length)emit('requestContextIgnored',{reason:'HTML5_VIDEO_CANNOT_SET_CUSTOM_HEADERS'});
      return input;
    },
    prepare(){if(!input)throw new Error('PLAYER_INPUT_REQUIRED');if(state===PlayerState.ERROR)return input;if(hlsInstance)return input;if(mpegtsInstance||planning)return input;state=PlayerState.PREPARING;video.load();return input;},
    play(){
      if(!input)throw new Error('PLAYER_INPUT_REQUIRED');
      if(state===PlayerState.ERROR)return Promise.resolve();
      const attempt=()=>{
        const p=video.play();
        if(!p||typeof p.catch!=='function')return Promise.resolve();
        return p.catch(err=>{
          if(err?.name==='AbortError')return undefined;
          if(err?.name==='NotAllowedError'&&!video.muted){video.muted=true;return video.play()?.catch?.(()=>undefined);}
          throw err;
        });
      };
      // HLS 起播需等清单与首片段下载完成，这里不阻塞加载流程；真实失败由 HLS 错误事件上报
      if(hlsInstance||mpegtsInstance||planning){if(!planning)void attempt().catch(()=>{});return Promise.resolve();}
      return attempt();
    },
    pause(){video.pause();return true;},
    seek(seconds){if(!Number.isFinite(seconds))return false;if(!Number.isFinite(video.duration)&&!video.seekable?.length)return false;video.currentTime=Math.max(0,seconds);return video.currentTime;},
    setPlaybackRate(rate){const r=Number(rate);if(Number.isFinite(r)&&r>0){video.playbackRate=r;}return video.playbackRate;},
    stop(){
      loadToken+=1;attemptGuard.invalidate();planning=false;
      cleanupHls();
      try { video.pause(); } catch {}
      try { video.src = ""; } catch {}
      try { video.removeAttribute('src'); } catch {}
      try { video.load(); } catch {}
      state=PlayerState.STOPPED;
      emit('stopped');
    },
    setVolume(value){const n=Number(value);if(!Number.isFinite(n))return video.volume;video.volume=Math.min(1,Math.max(0,n));return video.volume;},
    getState(){return {state,input,currentTime:video.currentTime,duration:video.duration};},
    getAudioTracks(){return trackList(video.audioTracks);},
    getSubtitleTracks(){return trackList(video.textTracks);},
    selectAudioTrack(trackId){if(!video.audioTracks)return false;for(const t of video.audioTracks)t.enabled=String(t.id)===String(trackId);emit('audioTrackChanged',{trackId});return true;},
    selectSubtitleTrack(trackId){if(!video.textTracks)return false;for(const t of video.textTracks)t.mode=String(t.id)===String(trackId)?'showing':'disabled';emit('subtitleTrackChanged',{trackId});return true;},
    getQualities(){return input?.manifest?.variants?.map((v,i)=>({qualityId:String(v.attributes?.['VIDEO-RANGE']??v.attributes?.RESOLUTION??i),width:Number(v.attributes?.RESOLUTION?.split('x')?.[0]??0),height:Number(v.attributes?.RESOLUTION?.split('x')?.[1]??0),bitrate:Number(v.attributes?.BANDWIDTH??0),url:v.url}))??[];},
    selectQuality(qualityId){const q=this.getQualities().find(x=>x.qualityId===String(qualityId));if(!q)return false;const wasPlaying=!video.paused;const pos=video.currentTime;video.src=q.url;video.load();if(wasPlaying)void video.play();if(Number.isFinite(pos))try{video.currentTime=pos;}catch{}emit('qualityChanged',{quality:q});return q;},
    release(){if(released)return;released=true;loadToken+=1;attemptGuard.invalidate();planning=false;cleanupHls();unbind();try { video.pause(); } catch {} try { video.src = ""; } catch {} try { video.removeAttribute('src'); } catch {} try { video.load(); } catch {} state=PlayerState.RELEASED;emit('released');},
  };
  return createPlayerAdapterContract(adapter);
}
