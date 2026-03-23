export {
  createServer,
  type CreateServerOptions,
  type EnvKeyConfig,
} from "./create-server.js";
export {
  createFileWatcher,
  createSSEHandler,
  type FileWatcherOptions,
  type SSEHandlerOptions,
} from "./sse.js";
export {
  mountAuthMiddleware,
  autoMountAuth,
  getSession,
  type AuthSession,
  type AuthOptions,
} from "./auth.js";
export { requireEnvKey, type MissingKeyResponse } from "./missing-key.js";
export { verifyCaptcha, type CaptchaVerifyResult } from "./captcha.js";
export {
  createProductionAgentHandler,
  type ScriptEntry,
  type ProductionAgentOptions,
  type ScriptTool,
  type AgentMessage,
  type AgentChatRequest,
  type AgentChatEvent,
} from "../agent/index.js";

export {
  getDefaultWatcher,
  getDefaultSSEEmitters,
  getDefaultSyncResult,
  setDefaultSyncResult,
  createDefaultSSEHandler,
  defaultSyncStatusHandler,
} from "./default-watcher.js";
export { createAuthPlugin, defaultAuthPlugin } from "./auth-plugin.js";
export {
  createFileSyncPlugin,
  defaultFileSyncPlugin,
} from "./file-sync-plugin.js";

// Nitro plugin helper — re-exported so templates don't need nitro as a direct dependency.
// defineNitroPlugin is an identity function; this typed wrapper lets templates use it
// without resolving `nitro/runtime` (which requires Nitro's virtual modules at runtime).
type NitroPluginDef = (nitroApp: any) => void | Promise<void>;
export function defineNitroPlugin(def: NitroPluginDef): NitroPluginDef {
  return def;
}
