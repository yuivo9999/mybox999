import { createCanonicalChannelIdentity, createFallbackChannelIdentity, createSourceChannelIdentity, resolveCanonicalChannelId } from './live/liveModels.js';
function cleanIdentity(value){return String(value??'').trim().toLowerCase().replace(/\s+/g,' ');}
export function createChannelIdentity({canonicalId='',channelKey='',name='',sourceId='',sourceItemId=''}={}){const resolved=resolveCanonicalChannelId({canonicalId,channelKey,name});return resolved?createCanonicalChannelIdentity(resolved):createFallbackChannelIdentity({sourceId,sourceItemId});}
export function createChannelId(sourceId,sourceItemId,identity=''){return `channel:${createFallbackChannelIdentity({sourceId,sourceItemId})}:${identity||'channel'}`;}
export function createSourceChannelId(sourceId,sourceItemId){return createSourceChannelIdentity(sourceId,sourceItemId);}
export function createStreamId(sourceId,sourceItemId,index=0){return `stream:${cleanIdentity(sourceId)}:${cleanIdentity(sourceItemId)}:${index+1}`;}
export function createEpgProgramId(channelId,startAt,title=''){return `epg:${channelId}:${String(startAt??'')}:${cleanIdentity(title)}`;}
export function getEpgProgramStatus(program,now=Date.now()){const start=Date.parse(program?.startTime??program?.startAt??'');const end=Date.parse(program?.endTime??program?.endAt??'');if(!Number.isFinite(start)||!Number.isFinite(end))return 'unknown';if(now<start)return 'upcoming';if(now<end)return 'live';return 'ended';}
