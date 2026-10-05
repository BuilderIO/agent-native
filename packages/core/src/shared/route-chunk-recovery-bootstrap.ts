export const STALE_CHUNK_RELOAD_AT_KEY = "__agentNativeStaleChunkReloadAt";
export const STALE_CHUNK_RELOAD_COOLDOWN_MS = 10_000;
export const CHUNK_RECOVERY_QUERY_PARAM = "__agentNativeChunkRecovery";
export const CHUNK_RECOVERY_QUERY_VALUE = "1";
export const CHUNK_RECOVERY_CACHE_BUSTER_PARAM =
  "__agentNativeChunkRecoveryRequest";
export const ROUTE_WARMUP_PRELOAD_ATTRIBUTE = "data-agent-native-route-warmup";

export const ROUTE_CHUNK_RECOVERY_BOOTSTRAP_SCRIPT = `(()=>{
const queryParam=${JSON.stringify(CHUNK_RECOVERY_QUERY_PARAM)};
const queryValue=${JSON.stringify(CHUNK_RECOVERY_QUERY_VALUE)};
const cacheBusterParam=${JSON.stringify(CHUNK_RECOVERY_CACHE_BUSTER_PARAM)};
const reloadKey=${JSON.stringify(STALE_CHUNK_RELOAD_AT_KEY)};
const warmupAttr=${JSON.stringify(ROUTE_WARMUP_PRELOAD_ATTRIBUTE)};
document.addEventListener("error",event=>{
const target=event.target;
const tag=target?.tagName?.toUpperCase();
const failedModuleScript=tag==="SCRIPT"&&target.type?.toLowerCase()==="module";
const failedModulePreload=tag==="LINK"&&/(?:^|\\s)modulepreload(?:\\s|$)/i.test(target.getAttribute?.("rel")||target.rel||"")&&!target.hasAttribute?.(warmupAttr);
if(!failedModuleScript&&!failedModulePreload||/AgentNativeDesktop/i.test(navigator.userAgent))return;
if(/^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname))return;
const url=new URL(location.href);
if(url.searchParams.get(queryParam)===queryValue)return;
const now=Date.now();
let last=Number(window[reloadKey])||0;
try{
last=Math.max(last,Number(sessionStorage.getItem(reloadKey))||0);
if(last>0&&now-last<=${STALE_CHUNK_RELOAD_COOLDOWN_MS})return;
sessionStorage.setItem(reloadKey,String(now));
}catch{
last=Number(window[reloadKey])||0;
if(last>0&&now-last<=${STALE_CHUNK_RELOAD_COOLDOWN_MS})return;
}
window[reloadKey]=now;
url.searchParams.set(queryParam,queryValue);
url.searchParams.set(cacheBusterParam,Date.now().toString(36)+"-"+Math.random().toString(36).slice(2));
location.assign(url.href);
event.stopImmediatePropagation();
},true);
})();`;
