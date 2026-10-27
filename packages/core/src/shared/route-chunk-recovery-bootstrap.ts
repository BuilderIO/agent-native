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
// Set by embedApp's transplant path, which runs the app document inside the MCP
// host's sandbox frame. There, every recovery URL is on the host's origin, so
// recovery can only navigate the frame to a page the host blocks.
export const EXTERNAL_EMBED_WINDOW_KEY = "__AGENT_NATIVE_EXTERNAL_EMBED";
// Where recovery records that it gave up. The inline bootstrap writes it too, so
// a failure before the client bundle loads is still reported once it does.
export const STALE_CHUNK_EXHAUSTED_KEY =
  "__agentNativeStaleChunkRecoveryExhausted";
/**
 * Fired on `window` the first time a stale chunk could not be recovered by a
 * reload. The shared noise rules drop the raw dynamic-import failure because
 * recovery handles it; this is the one signal that it did not, so a deploy whose
 * chunks are gone for everyone stays visible.
 */
export const STALE_CHUNK_RECOVERY_EXHAUSTED_EVENT =
  "agent-native:stale-chunk-recovery-exhausted";

export function isLegacyChunkRecoveryRequest(url: URL): boolean {
  const values = url.searchParams.getAll(CHUNK_RECOVERY_QUERY_PARAM);
  return values.length === 1 && values[0] === CHUNK_RECOVERY_QUERY_VALUE;
}

// Only the app's own module files count as stale chunks. A content blocker
// stopping a cross-origin module script, such as an analytics beacon a CDN
// injects, would otherwise send every page load through recovery, or report a
// false exhaustion inside an MCP App embed. The app's files are on the page's
// origin, or in an embed on the app origin embedApp records, because the embed
// document runs on the host's. Inline module scripts have no src and are the
// app's own.
export const ROUTE_CHUNK_RECOVERY_BOOTSTRAP_SCRIPT = `(()=>{
const queryParam=${JSON.stringify(CHUNK_RECOVERY_QUERY_PARAM)};
const queryValue=${JSON.stringify(CHUNK_RECOVERY_QUERY_VALUE)};
const cacheBusterParam=${JSON.stringify(CHUNK_RECOVERY_CACHE_BUSTER_PARAM)};
const pathSuffix=${JSON.stringify(CHUNK_RECOVERY_PATH_SUFFIX)};
const originalHashParam=${JSON.stringify(CHUNK_RECOVERY_ORIGINAL_HASH_PARAM)};
const reloadKey=${JSON.stringify(STALE_CHUNK_RELOAD_AT_KEY)};
const warmupAttr=${JSON.stringify(ROUTE_WARMUP_PRELOAD_ATTRIBUTE)};
const externalEmbedKey=${JSON.stringify(EXTERNAL_EMBED_WINDOW_KEY)};
const exhaustedKey=${JSON.stringify(STALE_CHUNK_EXHAUSTED_KEY)};
const exhaustedEvent=${JSON.stringify(STALE_CHUNK_RECOVERY_EXHAUSTED_EVENT)};
document.addEventListener("error",event=>{
const target=event.target;
const tag=target?.tagName?.toUpperCase();
const failedModuleScript=tag==="SCRIPT"&&target.type?.toLowerCase()==="module";
const failedModulePreload=tag==="LINK"&&/(?:^|\\s)modulepreload(?:\\s|$)/i.test(target.getAttribute?.("rel")||target.rel||"")&&!target.hasAttribute?.(warmupAttr);
if(!failedModuleScript&&!failedModulePreload||/AgentNativeDesktop/i.test(navigator.userAgent))return;
const url=new URL(location.href);
const embed=window[externalEmbedKey];
const failedUrl=String((failedModuleScript?target.src:target.href)||"");
const isOwn=origin=>typeof origin==="string"&&origin!==""&&failedUrl.startsWith(origin+"/");
if(failedUrl&&!isOwn(url.origin)&&!isOwn(embed&&embed.origin))return;
if(embed){
if(!window[exhaustedKey]){
const detail={reason:"external-embed"};
window[exhaustedKey]=detail;
if(typeof window.dispatchEvent==="function"&&typeof CustomEvent==="function")window.dispatchEvent(new CustomEvent(exhaustedEvent,{detail}));
}
return;
}
if(/^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname))return;
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
