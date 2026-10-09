import { playbackTaskRegistry } from './core__playback__playbackTaskRegistry.js';
export function createPlaybackResourceManager(registry=playbackTaskRegistry){
 let ownerTaskId=null,ownerRelease=null;
 return {
  acquire(taskId,onReplaced=()=>{}){
   if(ownerTaskId&&ownerTaskId!==taskId){const previous=ownerTaskId;ownerRelease?.();onReplaced(previous);registry.stopAndRelease(previous);}
   ownerTaskId=taskId;
   ownerRelease=()=>{if(ownerTaskId===taskId){ownerTaskId=null;ownerRelease=null;}};
   return ownerRelease;
  },
  get ownerTaskId(){return ownerTaskId;},
 };
}
export const playbackResourceManager=createPlaybackResourceManager();
