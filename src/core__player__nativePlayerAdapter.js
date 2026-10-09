import { PlayerState, PlayerCapability, createPlayerAdapterContract } from './core__player__playerInterface.js';

function getBridge() {
 if(typeof window==='undefined') return null;
 return [window.TVBoxAndroidBridge,window.Android,window.tvboxBridge].find(x=>x&&typeof x==='object')??null;
}
function call(method,payload={}) {
 const bridge=getBridge();
 if(!bridge||typeof bridge[method]!=='function') throw new Error('NATIVE_PLAYER_BRIDGE_UNAVAILABLE');
 const value=bridge[method](JSON.stringify(payload));
 return value&&typeof value.then==='function'?value:Promise.resolve(value);
}
function unwrapNativeResult(value){
 if(typeof value!=='string')return value;
 const text=value.trim();
 if(!text.startsWith('{'))return value;
 let parsed=null;
 try{parsed=JSON.parse(text);}catch{return value;}
 if(parsed&&parsed.ok===false)throw new Error(String(parsed.code||parsed.error||'NATIVE_PLAYER_ERROR'));
 return value;
}
function callChecked(method,payload={}) {
 return Promise.resolve(call(method,payload)).then(unwrapNativeResult);
}
export function createNativePlayerAdapter(hooks={}) {
 let state=PlayerState.IDLE,input=null,released=false,capabilities=Object.freeze({
  [PlayerCapability.SEEK]:true,[PlayerCapability.VOLUME]:true,[PlayerCapability.PAUSE]:true,
  [PlayerCapability.AUTOPLAY]:true,[PlayerCapability.CUSTOM_HEADERS]:true,[PlayerCapability.COOKIES]:true,
  [PlayerCapability.RTMP]:true,[PlayerCapability.RTSP]:true,[PlayerCapability.HLS]:true,
  [PlayerCapability.DASH]:true,[PlayerCapability.MP4]:true,[PlayerCapability.TS]:true,[PlayerCapability.FLV]:true,
  [PlayerCapability.AUDIO_TRACKS]:false,[PlayerCapability.SUBTITLE_TRACKS]:false,
  [PlayerCapability.TRACK_SELECTION]:false,[PlayerCapability.QUALITY_SELECTION]:false,
  [PlayerCapability.LIVE_RECONNECT]:true,
 });
 const emit=(event,data={})=>{if(event==='playing')state=PlayerState.PLAYING;if(event==='paused')state=PlayerState.PAUSED;if(event==='bufferingStart')state=PlayerState.BUFFERING;if(event==='reconnecting')state=PlayerState.RECONNECTING;if(event==='stopped')state=PlayerState.STOPPED;if(event==='released')state=PlayerState.RELEASED;hooks.onEvent?.({event,...data});if(event==='decoderChanged')hooks.onDecoderChange?.(data);};
 const eventHandler=(payload)=>{try{const value=typeof payload==='string'?JSON.parse(payload):payload;if(value?.event)emit(value.event,value.data??value);}catch{}};
 const previousEventHandler=typeof window!=='undefined'?window.TVBoxWebView?.onPlayerEvent:null;
 if(typeof window!=='undefined'){window.TVBoxWebView=window.TVBoxWebView||{};window.TVBoxWebView.onPlayerEvent=eventHandler;}
 const adapter={
  get capabilities(){return capabilities;},
  load(next){if(released)throw new Error('PLAYER_ADAPTER_RELEASED');input=next;state=PlayerState.LOADING;emit('loading');const headers={...(next.headers??{})};if(next.referer&&!headers.Referer&&!headers.referer)headers.Referer=next.referer;if(next.userAgent&&!headers['User-Agent']&&!headers['user-agent'])headers['User-Agent']=next.userAgent;return callChecked('loadMedia',{url:next.url,headers,cookies:next.cookies??'',referer:next.referer??'',userAgent:next.userAgent??'',token:next.token,protocol:next.protocol,playerHint:next.playerHint}).then(()=>input);},
  prepare(){if(!input)throw new Error('PLAYER_INPUT_REQUIRED');state=PlayerState.PREPARING;return callChecked('prepareMedia',{});},
  play(){if(!input)throw new Error('PLAYER_INPUT_REQUIRED');return callChecked('playMedia',{});},
  pause(){return call('pauseMedia',{});},
  seek(seconds){return call('seekMedia',{seconds});},
  stop(){state=PlayerState.STOPPED;emit('stopped');return call('stopMedia',{});},
  setVolume(value){return call('setVolume',{value});},
  getState(){return {state,input};},
  getAudioTracks(){return call('getAudioTracks',{});},
  getSubtitleTracks(){return call('getSubtitleTracks',{});},
  selectAudioTrack(trackId){return call('selectAudioTrack',{trackId});},
  selectSubtitleTrack(trackId){return call('selectSubtitleTrack',{trackId});},
  getQualities(){return call('getQualities',{});},
  selectQuality(qualityId){return call('selectQuality',{qualityId});},
  setVideoViewBounds(bounds){
   if(!bounds || typeof bounds !== 'object') return false;
   return call('setPlayerViewBounds',{
    left:Number(bounds.left)||0,
    top:Number(bounds.top)||0,
    width:Math.max(0,Number(bounds.width)||0),
    height:Math.max(0,Number(bounds.height)||0),
    viewportWidth:Math.max(0,Number(bounds.viewportWidth)||0),
    viewportHeight:Math.max(0,Number(bounds.viewportHeight)||0),
   });
  },
  release(){if(released)return;released=true;state=PlayerState.RELEASED;emit('released');if(typeof window!=='undefined'&&window.TVBoxWebView?.onPlayerEvent===eventHandler)delete window.TVBoxWebView.onPlayerEvent;return call('releaseMedia',{}).catch(()=>undefined);},
 };
 return createPlayerAdapterContract(adapter);
}
