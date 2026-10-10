import { PlaybackFailureCode, PlaybackKind } from './core__models__playback.js';
import { parserService } from './core__parsers__parserService.js';
import { createHtml5PlayerAdapter } from './core__player__html5PlayerAdapter.js';
import { PlayerState } from './core__player__playerInterface.js';
import { createPlaybackEventBus } from './core__playback__playbackEventBus.js';
import { createPlaybackStateMachine } from './core__playback__playbackStateMachine.js';
import { createPlaybackNetworkPolicy } from './core__playback__playbackNetworkPolicy.js';
import { classifyPlaybackError } from './core__playback__playbackErrorPolicy.js';
import { playbackResourceManager } from './core__playback__playbackResourceManager.js';
import { playbackTaskRegistry } from './core__playback__playbackTaskRegistry.js';
import { playbackSessionManager } from './core__playback__playbackSessionManager.js';
import { ErrorCode } from './core__models__errors.js';
import { errorService } from './core__services__errorService.js';
import { normalizePlaybackEvent } from './core__playback__playbackEventProtocol.js';
import { userDataService } from './me/userDataService.js';

const LIVE_BUFFER_MAX_SECONDS = 60;
const VOD_BUFFER_MAX_SECONDS = 200;

export function createPlaybackCore(task,hooks={}) {
 let player=null,playerElement=null,resourceRelease=null,sessionId=null,released=false;
 let operationEpoch=0, recoveryInFlight=false, recoveryOperationEpoch=0, recoverySequence=0;
 const isOperationCurrent=(epoch)=>!released&&epoch===operationEpoch;
 const eventBus=createPlaybackEventBus();
 const stateMachine=createPlaybackStateMachine(task.request.kind??PlaybackKind.VOD);
 const networkPolicy=createPlaybackNetworkPolicy(hooks.networkPolicy);
 const unsubscribe=task.subscribe(e=>{const normalized=normalizePlaybackEvent(e);eventBus.emit(normalized);hooks.onEvent?.(normalized);});

 const transition=(next)=>{try{stateMachine.transition(next);}catch{stateMachine.reset();if(next!==PlayerState.IDLE)try{stateMachine.transition(next);}catch{}}hooks.onStateChange?.(stateMachine.state);return stateMachine.state;};
 const emit=(event,data={})=>{const normalized=normalizePlaybackEvent({event,requestId:task.request.requestId,taskId:task.request.taskId,...data});return eventBus.emit(normalized);};

 const handlePlayerEvent=(event)=>{
  if(event.event==='loading')transition(PlayerState.LOADING);
  if(event.event==='prepared')transition(PlayerState.PREPARING);
  if(event.event==='playing'){transition(PlayerState.PLAYING);networkPolicy.resetRetry();}
  if(event.event==='paused')transition(PlayerState.PAUSED);
  if(event.event==='bufferingStart'){transition(PlayerState.BUFFERING);emit('bufferingStart');}
  if(event.event==='bufferingEnd'){if(task.request.kind===PlaybackKind.LIVE)transition(PlayerState.PLAYING);else if(stateMachine.state===PlayerState.BUFFERING)transition(PlayerState.PLAYING);emit('bufferingEnd');}
  if(event.event==='buffering')transition(PlayerState.BUFFERING);
  if(event.event==='qualityChanged')emit('qualityChanged',event);
  if(event.event==='decoderChanged'){
   const decoderEvent={event:'decoderChanged',requestId:task.request.requestId,taskId:task.request.taskId,data:event.data??event};
   emit('decoderChanged',{decoder:event.data??event});
   hooks.onEvent?.(normalizePlaybackEvent(decoderEvent));
  }
  if(event.event==='episodeChanged')emit('episodeChanged',event);
  if(event.event==='reconnecting')transition(PlayerState.RECONNECTING);
  if(event.event==='completed'&&task.request.kind===PlaybackKind.VOD)transition(PlayerState.COMPLETED);
  if(event.event==='stopped')transition(PlayerState.STOPPED);
  if(event.event==='released')transition(PlayerState.RELEASED);
  if(event.event==='progress'&&task.request.kind===PlaybackKind.VOD)emit('progress',{currentTime:event.currentTime,duration:event.duration});
  if(event.event==='sourceChanged')emit('sourceChanged',{candidate:event.candidate});
  if(event.event==='error'){
   const code=classifyPlaybackError(event.nativeError,{code:event.nativeError?.message});
   const normalized=errorService.normalize(event.nativeError??new Error('MEDIA_LOAD_ERROR'),{code:code===PlaybackFailureCode.NETWORK?ErrorCode.NETWORK:ErrorCode.PLAYBACK,context:{scope:'playback',taskId:task.request.taskId,requestId:task.request.requestId,candidateId:task.currentCandidateId},retryable:code===PlaybackFailureCode.NETWORK});
   hooks.onPlayerError?.({error:normalized,candidate:task.currentCandidate});
   void recover(normalized,code);
  }
  if(event.event==='requestContextIgnored')hooks.onPlayerWarning?.(event);
 };

 const attachPlayer=(element)=>{
  operationEpoch+=1;
  player?.release?.(); playerElement=element;
  // All platforms use the page-owned HTMLMediaElement as the actual video surface.
  // Android native playback engines are intentionally not attached: their Activity-level
  // TextureView cannot inherit DOM scroll, clipping, or layout.
  if(element) {
   const isAndroidWebView = typeof window !== 'undefined' && Boolean(window.TVBoxAndroidBridge);
   player=createHtml5PlayerAdapter(element,{
    onEvent:handlePlayerEvent,
    requireVideoFrame:isAndroidWebView,
    allowMixedContent:isAndroidWebView,
   });
  } else return null;
  return player;
 };

 const resolve=async(candidate=task.currentCandidate,options={})=>{
  if(!candidate)return null;
  // Live 使用源提供的原始 mediaUrl，完全跳过影视解析器链。
  if(task.request.kind===PlaybackKind.LIVE){
   const directInput={
    ...candidate,
    url:candidate.mediaUrl,
    mediaUrl:candidate.mediaUrl,
    session:null,
    parserSkipped:true,
    playerHint:{autoplay:true,...(candidate.playerHint??{})},
   };
   hooks.onResolvedInput?.(directInput);
   return directInput;
  }
  if(sessionId)playbackSessionManager.clear(sessionId);
  sessionId=playbackSessionManager.create(candidate);
  try{
   const resolved=await parserService.resolve({...candidate,session:{sessionId}}, {...options,sessionManager:playbackSessionManager});
   hooks.onResolvedInput?.(resolved);
   return resolved;
  }catch(error){
   const code=classifyPlaybackError(error,{code:error?.message,fromParser:true});
   const normalized=errorService.normalize(error,{code:error?.message?.includes('SessionExpired')?ErrorCode.PLAYBACK:ErrorCode.PARSE,context:{scope:'parser',taskId:task.request.taskId,requestId:task.request.requestId,candidateId:candidate.candidateId}});
   hooks.onParserError?.({candidate,error:normalized,code});
   emit('error',{candidateId:candidate.candidateId,code,error:normalized.message});
   const failureCode=code===PlaybackFailureCode.NETWORK?PlaybackFailureCode.NETWORK:code===PlaybackFailureCode.EXPIRED?PlaybackFailureCode.EXPIRED:PlaybackFailureCode.PARSER;
   failAndResolve(normalized,failureCode);
   return null;
  }
 }

 const playResolved=async(input,epoch)=>{
  if(!player)throw new Error('PLAYER_ADAPTER_NOT_ATTACHED');
  if(!isOperationCurrent(epoch))return null;
  const playbackSettings = userDataService.getSettings().playback;
  const isAndroidDomPlayer = typeof window !== 'undefined' && Boolean(window.TVBoxAndroidBridge);
  const defaultEngine = isAndroidDomPlayer
   ? 'html5'
   : (task.request.kind === PlaybackKind.LIVE ? (playbackSettings.livePlayer || 'ijk') : (playbackSettings.moviePlayer || 'ijk'));
  const playerHint = {
   ...(input.playerHint ?? {}),
   engine: isAndroidDomPlayer ? 'html5' : (input.playerHint?.engine ?? defaultEngine),
   decoder: isAndroidDomPlayer ? 'browser_auto' : (input.playerHint?.decoder ?? playbackSettings.decoder?.[defaultEngine] ?? 'hardware'),
   decoderModes: input.playerHint?.decoderModes ?? playbackSettings.decoder ?? {},
   fallbackEnabled: input.playerHint?.fallbackEnabled ?? playbackSettings.fallbackEnabled,
   fallbackOrder: input.playerHint?.fallbackOrder ?? playbackSettings.fallbackOrder,
   live: task.request.kind === PlaybackKind.LIVE,
   liveBufferMaxSeconds: task.request.kind === PlaybackKind.LIVE
    ? Number(input.playerHint?.liveBufferMaxSeconds ?? LIVE_BUFFER_MAX_SECONDS)
    : undefined,
   vodBufferMaxSeconds: task.request.kind === PlaybackKind.VOD
    ? Number(input.playerHint?.vodBufferMaxSeconds ?? VOD_BUFFER_MAX_SECONDS)
    : undefined,
   ijkProfiles: input.playerHint?.ijkProfiles ?? input.metadata?.tvboxIJKProfiles ?? {},
   ijkProfile: input.playerHint?.ijkProfile ?? (
    (input.playerHint?.decoder ?? playbackSettings.decoder?.ijk ?? 'auto') === 'software' ? '软解码' :
    (input.playerHint?.decoder ?? playbackSettings.decoder?.ijk ?? 'auto') === 'hardware' ? '硬解码' :
    undefined
   ),
  };
  await Promise.resolve(player.load({ ...input, playerHint }));
  if(!isOperationCurrent(epoch))return null;
  await Promise.resolve(player.prepare());
  if(!isOperationCurrent(epoch))return null;
  const startPosition=Number(task.request.metadata?.startPositionSeconds??0);
  if(task.request.kind===PlaybackKind.VOD&&startPosition>0)player.seek(startPosition);
  if(!isOperationCurrent(epoch))return null;
  if(input.playerHint?.autoplay!==false)await player.play();
  if(!isOperationCurrent(epoch))return null;
  return input;
 };

 const resolveAndLoad=async(candidate=task.currentCandidate,options={})=>{
  const epoch=++operationEpoch;
  const input=await resolve(candidate,options);
  if(!input||!isOperationCurrent(epoch))return null;
  let loaded=null;
  try{
   loaded=await playResolved(input,epoch);
  }catch(error){
   if(!isOperationCurrent(epoch))return null;
   const code=classifyPlaybackError(error,{code:error?.message});
   const normalized=errorService.normalize(error,{code:code===PlaybackFailureCode.NETWORK?ErrorCode.NETWORK:ErrorCode.PLAYBACK,context:{scope:'playback',taskId:task.request.taskId,requestId:task.request.requestId,candidateId:candidate?.candidateId},retryable:code===PlaybackFailureCode.NETWORK});
   hooks.onPlayerError?.({error:normalized,candidate});
   void recover(normalized,code);
   return null;
  }
  if(!loaded||!isOperationCurrent(epoch))return null;
  networkPolicy.resetRetry();
  return loaded;
 };

 const failAndResolve=(error,code=PlaybackFailureCode.UNKNOWN)=>{
  const failedCandidate=task.currentCandidate;
  const classified=classifyPlaybackError(error,{code});
  const next=task.fail(error,classified);
  networkPolicy.resetRetry();
  if(!next){hooks.onExhausted?.(task);return null;}
  hooks.onAutoFallback?.({previousCandidate:failedCandidate,candidate:next,error,code:classified,task});
  hooks.onCandidateChange?.(next);
  transition(PlayerState.LOADING);void resolveAndLoad(next).catch(e=>hooks.onPlayerError?.({error:e,candidate:next}));return next;
 };

 async function recover(error,code){
  // 同一操作代次的重复错误只恢复一次；新频道/新线路的错误不能被旧恢复任务吞掉。
  if(released)return false;
  const recoverEpoch=operationEpoch;
  if(recoveryInFlight&&recoveryOperationEpoch===recoverEpoch)return false;
  const recoveryId=++recoverySequence;
  recoveryInFlight=true;
  recoveryOperationEpoch=recoverEpoch;
  const recoverCandidateId=task.currentCandidateId;
  try {
   if(task.request.kind===PlaybackKind.LIVE && networkPolicy.shouldReconnect({code})){
    transition(PlayerState.RECONNECTING);emit('reconnecting',{candidate:task.currentCandidate,reconnectCount:networkPolicy.reconnectCount});
    await new Promise(r=>setTimeout(r,networkPolicy.getReconnectDelay()));
    if(!isOperationCurrent(recoverEpoch)||task.currentCandidateId!==recoverCandidateId)return false;
    try {
     const reloaded=await resolveAndLoad(task.currentCandidate);
     if(reloaded)return true;
    } catch {}
    // 如果重载期间已经触发了新一轮恢复/用户操作，旧任务必须立即退出。
    if(recoverySequence!==recoveryId||task.currentCandidateId!==recoverCandidateId)return false;
   }
   if(task.currentCandidateId!==recoverCandidateId)return false;
   if(networkPolicy.shouldRetry({code})){
    const candidate=task.retry({maxRetries:networkPolicy.retryCount+1});
    if(candidate){emit('retry',{candidate,retryCount:networkPolicy.retryCount});try{const retried=await resolveAndLoad(candidate);if(retried)return true;}catch{}}
   }
   if(task.currentCandidateId!==recoverCandidateId)return false;
   failAndResolve(error,code);return false;
  } finally {
   if(recoverySequence===recoveryId) recoveryInFlight=false;
  }
 }

 const cancelRecovery=()=>{recoverySequence+=1;recoveryInFlight=false;};

 return {
  get request(){return task.request;},get task(){return task;},get state(){return stateMachine.state;},get capabilities(){return player?.capabilities??{};},get currentPlayer(){return player;},
  subscribe(listener){return eventBus.subscribe(listener);},attachPlayer,
  start(){
   if(released)throw new Error('PLAYBACK_CORE_RELEASED');
   playbackTaskRegistry.register({request:task.request,stop:()=>{try{player?.stop?.();}finally{task.stop?.();}},release:()=>{try{player?.release?.();}finally{task.release?.();}}});
   resourceRelease?.();
   resourceRelease=playbackResourceManager.acquire(task.request.taskId,(previous)=>hooks.onResourceReplaced?.(previous));
   const initial=task.start();if(initial)transition(PlayerState.LOADING);return initial;
  },
  async resolveAndLoad(candidate=task.currentCandidate,options={}){cancelRecovery();return resolveAndLoad(candidate,options);},
  resolve,
  async play(){if(!player)throw new Error('PLAYER_ADAPTER_NOT_ATTACHED');return player.play();},
  pause(){return player?.pause();},seek(s){return player?.seek(s);},setPlaybackRate(r){return player?.setPlaybackRate?.(r);},setVolume(v){return player?.setVolume(v);},
  getAudioTracks(){return player?.getAudioTracks?.()??[];},getSubtitleTracks(){return player?.getSubtitleTracks?.()??[];},selectAudioTrack(id){return player?.selectAudioTrack?.(id)??false;},selectSubtitleTrack(id){return player?.selectSubtitleTrack?.(id)??false;},getQualities(){return player?.getQualities?.()??[];},selectQuality(id){return player?.selectQuality?.(id)??false;},
  markPlaying(){return task.markPlaying();},
  retry(options={}){if(!networkPolicy.shouldRetry({code:options.code??'network'}))return null;cancelRecovery();operationEpoch+=1;const candidate=task.retry(options);if(candidate)void resolveAndLoad(candidate);return candidate;},
  fail(error,code=PlaybackFailureCode.UNKNOWN){return failAndResolve(error,code);},
  switchCandidate(candidateId){cancelRecovery();operationEpoch+=1;const next=task.switchCandidate(candidateId);hooks.onCandidateChange?.(next);if(next){networkPolicy.reset();transition(PlayerState.LOADING);void resolveAndLoad(next).catch(e=>hooks.onPlayerError?.({error:e,candidate:next}));}return next;},
  switchEpisode(episodeId,candidate=null,startPositionSeconds=0){emit('episodeChanged',{episodeId,startPositionSeconds});if(candidate)return this.switchCandidate(candidate.candidateId);return episodeId;},
  async handleAppState(state){
   if(state==='background'){if(task.request.kind===PlaybackKind.VOD){await player?.pause?.();}else{player?.pause?.();}}
   if(state==='foreground'&&task.request.kind===PlaybackKind.LIVE&&task.currentCandidate){cancelRecovery();try{await resolveAndLoad(task.currentCandidate);}catch(e){void recover(e,PlaybackFailureCode.NETWORK);}}
  },
  stop(){cancelRecovery();operationEpoch+=1;player?.stop?.();task.stop();resourceRelease?.();resourceRelease=null;playbackTaskRegistry.unregister(task.request.taskId);},
  release(){if(released)return;cancelRecovery();operationEpoch+=1;released=true;try{player?.release?.();}finally{player=null;resourceRelease?.();resourceRelease=null;playbackSessionManager.clear(sessionId);sessionId=null;unsubscribe();eventBus.clear();task.release();playbackTaskRegistry.unregister(task.request.taskId);}}
 };
}
