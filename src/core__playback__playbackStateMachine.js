import { PlaybackKind } from './core__models__playback.js';
import { PlayerState } from './core__player__playerInterface.js';

const common = new Set(Object.values(PlayerState));
const vodTransitions = new Map([
 [PlayerState.IDLE,new Set([PlayerState.LOADING,PlayerState.RELEASED])],
 [PlayerState.LOADING,new Set([PlayerState.PREPARING,PlayerState.BUFFERING,PlayerState.ERROR,PlayerState.RELEASED])],
 [PlayerState.PREPARING,new Set([PlayerState.PLAYING,PlayerState.BUFFERING,PlayerState.ERROR,PlayerState.RELEASED])],
 [PlayerState.PLAYING,new Set([PlayerState.PAUSED,PlayerState.BUFFERING,PlayerState.COMPLETED,PlayerState.ERROR,PlayerState.RELEASED])],
 [PlayerState.PAUSED,new Set([PlayerState.PLAYING,PlayerState.BUFFERING,PlayerState.LOADING,PlayerState.RELEASED])],
 [PlayerState.BUFFERING,new Set([PlayerState.PLAYING,PlayerState.ERROR,PlayerState.RELEASED])],
 [PlayerState.COMPLETED,new Set([PlayerState.LOADING,PlayerState.RELEASED])],
 [PlayerState.ERROR,new Set([PlayerState.LOADING,PlayerState.RELEASED])],
 [PlayerState.STOPPED,new Set([PlayerState.LOADING,PlayerState.RELEASED])],
 [PlayerState.RELEASED,new Set()],
]);
const liveTransitions = new Map([
 [PlayerState.IDLE,new Set([PlayerState.LOADING,PlayerState.RELEASED])],
 [PlayerState.LOADING,new Set([PlayerState.PREPARING,PlayerState.BUFFERING,PlayerState.ERROR,PlayerState.RELEASED])],
 [PlayerState.PREPARING,new Set([PlayerState.PLAYING,PlayerState.BUFFERING,PlayerState.ERROR,PlayerState.RELEASED])],
 [PlayerState.PLAYING,new Set([PlayerState.BUFFERING,PlayerState.RECONNECTING,PlayerState.ERROR,PlayerState.STOPPED,PlayerState.RELEASED])],
 [PlayerState.BUFFERING,new Set([PlayerState.PLAYING,PlayerState.RECONNECTING,PlayerState.ERROR,PlayerState.STOPPED,PlayerState.RELEASED])],
 [PlayerState.RECONNECTING,new Set([PlayerState.LOADING,PlayerState.PREPARING,PlayerState.PLAYING,PlayerState.ERROR,PlayerState.STOPPED,PlayerState.RELEASED])],
 [PlayerState.ERROR,new Set([PlayerState.LOADING,PlayerState.RECONNECTING,PlayerState.STOPPED,PlayerState.RELEASED])],
 [PlayerState.STOPPED,new Set([PlayerState.LOADING,PlayerState.RELEASED])],
 [PlayerState.RELEASED,new Set()],
]);
export function createPlaybackStateMachine(kind=PlaybackKind.VOD,initial=PlayerState.IDLE){
 const transitions=kind===PlaybackKind.LIVE?liveTransitions:vodTransitions; let state=initial;
 return {get state(){return state;},canTransition(next){return common.has(next)&&transitions.get(state)?.has(next);},transition(next){if(next===state)return state;if(!this.canTransition(next))throw new Error(`INVALID_PLAYBACK_TRANSITION:${state}->${next}`);state=next;return state;},reset(){state=PlayerState.IDLE;return state;}};
}
