export {
  createServer,
  upsertEnvFile,
  type CreateServerOptions,
  type EnvKeyConfig,
} from "./create-server.js";
export { createSSEHandler, type SSEHandlerOptions } from "./sse.js";
export {
  mountAuthMiddleware,
  autoMountAuth,
  getSession,
  addSession,
  removeSession,
  getSessionEmail,
  type AuthSession,
  type AuthOptions,
} from "./auth.js";
export { requireEnvKey, type MissingKeyResponse } from "./missing-key.js";
export { verifyCaptcha, type CaptchaVerifyResult } from "./captcha.js";
export {
  createProductionAgentHandler,
  type ActionEntry,
  type ScriptEntry,
  type ProductionAgentOptions,
  type ActionTool,
  type ScriptTool,
  type AgentMessage,
  type AgentChatRequest,
  type AgentChatEvent,
  type AgentChatReference,
  type MentionProvider,
  type MentionProviderItem,
} from "../agent/index.js";
export { createDevScriptRegistry } from "../scripts/dev/index.js";

export {
  createPollHandler,
  recordChange,
  getVersion,
  getChangesSince,
} from "./poll.js";
export { createAuthPlugin, defaultAuthPlugin } from "./auth-plugin.js";
export {
  createGoogleAuthPlugin,
  type GoogleAuthPluginOptions,
} from "./google-auth-plugin.js";
export {
  createAgentChatPlugin,
  defaultAgentChatPlugin,
  type AgentChatPluginOptions,
} from "./agent-chat-plugin.js";
export {
  createThread,
  getThread,
  listThreads,
  updateThreadData,
  deleteThread,
  type ChatThread,
  type ChatThreadSummary,
} from "../chat-threads/store.js";
export {
  createResourcesPlugin,
  defaultResourcesPlugin,
} from "./resources-plugin.js";
export {
  createCoreRoutesPlugin,
  defaultCoreRoutesPlugin,
  FRAMEWORK_ROUTE_PREFIX,
  type CoreRoutesPluginOptions,
} from "./core-routes-plugin.js";
export {
  createTerminalPlugin,
  defaultTerminalPlugin,
  type TerminalPluginOptions,
} from "../terminal/terminal-plugin.js";
export {
  createCollabPlugin,
  type CollabPluginOptions,
} from "./collab-plugin.js";

export {
  spawnTask,
  getTask,
  getTaskByThread,
  listTasks,
  sendToTask,
  markTaskErrored,
  type AgentTask,
  type SpawnTaskOptions,
} from "./agent-teams.js";
export { isOAuthConnected, getOAuthAccounts } from "./oauth-helpers.js";
export { wrapWithAnalytics } from "./analytics.js";
export {
  handleFrameworkRequest,
  registerFrameworkRoute,
  registerFrameworkMiddleware,
  getH3App,
} from "./framework-request-handler.js";
export {
  autoDiscoverActions,
  autoDiscoverScripts,
} from "./action-discovery.js";

export {
  createIntegrationsPlugin,
  defaultIntegrationsPlugin,
  slackAdapter,
  telegramAdapter,
  whatsappAdapter,
  type PlatformAdapter,
  type IncomingMessage,
  type OutgoingMessage,
  type IntegrationStatus,
  type IntegrationsPluginOptions,
} from "../integrations/index.js";

export {
  isElectron,
  isMobile,
  getOrigin,
  encodeOAuthState,
  decodeOAuthState,
  resolveOAuthOwner,
  createOAuthSession,
  oauthCallbackResponse,
  oauthErrorPage,
  type OAuthStatePayload,
  type OAuthOwnerResult,
  type OAuthSessionResult,
} from "./google-oauth.js";

export { ssrHandler, createSSRRequestHandler } from "./ssr-handler.js";

// Nitro plugin helper — re-exported so templates don't need nitro as a direct dependency.
// defineNitroPlugin is an identity function; this typed wrapper lets templates use it
// without resolving `nitro/runtime` (which requires Nitro's virtual modules at runtime).
type NitroPluginDef = (nitroApp: any) => void | Promise<void>;
export function defineNitroPlugin(def: NitroPluginDef): NitroPluginDef {
  return def;
}
