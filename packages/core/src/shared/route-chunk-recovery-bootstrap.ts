export const STALE_CHUNK_RELOAD_AT_KEY = "__agentNativeStaleChunkReloadAt";
export const STALE_CHUNK_RELOAD_COOLDOWN_MS = 10_000;
export const CHUNK_RECOVERY_QUERY_PARAM = "__agentNativeChunkRecovery";
export const CHUNK_RECOVERY_QUERY_VALUE = "1";
export const CHUNK_RECOVERY_CACHE_BUSTER_PARAM =
  "__agentNativeChunkRecoveryRequest";
export const CHUNK_RECOVERY_PATH_SUFFIX = "/__agent-native-chunk-recovery";
export const CHUNK_RECOVERY_ORIGINAL_HASH_PARAM =
  "__agentNativeRecoveryOriginalHash";
export const ROUTE_WARMUP_PRELOAD_ATTRIBUTE = "data-agent-native-route-warmup";

export const ROUTE_CHUNK_RECOVERY_BOOTSTRAP_SCRIPT = `(()=>{
const queryParam=${JSON.stringify(CHUNK_RECOVERY_QUERY_PARAM)};
const queryValue=${JSON.stringify(CHUNK_RECOVERY_QUERY_VALUE)};
const cacheBusterParam=${JSON.stringify(CHUNK_RECOVERY_CACHE_BUSTER_PARAM)};
const pathSuffix=${JSON.stringify(CHUNK_RECOVERY_PATH_SUFFIX)};
const originalHashParam=${JSON.stringify(CHUNK_RECOVERY_ORIGINAL_HASH_PARAM)};
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
if(url.pathname.endsWith(pathSuffix)||url.pathname.endsWith(pathSuffix+"/")||url.searchParams.get(queryParam)===queryValue)return;
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
const originalHash=url.hash;
const trailingSlash=url.pathname.endsWith("/")?"/":"";
const routePath=trailingSlash?url.pathname.slice(0,-1):url.pathname;
url.pathname=(routePath==="/"?"":routePath)+pathSuffix+trailingSlash;
url.searchParams.delete(queryParam);
url.searchParams.delete(cacheBusterParam);
const recoveryHash=new URLSearchParams();
recoveryHash.set(cacheBusterParam,now.toString(36));
recoveryHash.set(originalHashParam,originalHash);
url.hash=recoveryHash.toString();
location.assign(url.href);
event.stopImmediatePropagation();
},true);
})();`;
