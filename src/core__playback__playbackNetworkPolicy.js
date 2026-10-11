const DEFAULTS={maxRetries:2,retryWindowMs:10000,reconnectMaxRetries:2,reconnectWindowMs:30000,reconnectDelayMs:1000};
export function createPlaybackNetworkPolicy(options={}) {
 const cfg={...DEFAULTS,...options}; let retryCount=0,retryWindow=0,reconnectCount=0,reconnectWindow=0;
 const inWindow=(started,windowMs)=>started&&Date.now()-started<=windowMs;
 return {
  shouldRetry({code}={}){if(!['network','player','NetworkError'].includes(code))return false;const now=Date.now();if(!inWindow(retryWindow,cfg.retryWindowMs)){retryWindow=now;retryCount=0;}if(retryCount>=cfg.maxRetries)return false;retryCount+=1;return true;},
  shouldReconnect({code}={}){if(!['network','player','NetworkError'].includes(code))return false;const now=Date.now();if(!inWindow(reconnectWindow,cfg.reconnectWindowMs)){reconnectWindow=now;reconnectCount=0;}if(reconnectCount>=cfg.reconnectMaxRetries)return false;reconnectCount+=1;return true;},
  getReconnectDelay(){return cfg.reconnectDelayMs*Math.max(1,reconnectCount);},
  reset(){retryCount=0;retryWindow=0;reconnectCount=0;reconnectWindow=0;},
  resetRetry(){retryCount=0;retryWindow=0;},
  get retryCount(){return retryCount;},get reconnectCount(){return reconnectCount;},
 };
}
