// Framework for agent-native apps.
// Import everything from "@agent-native/core".

// Agent (production mode)
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
} from "./agent/index.js";
export { defineAction, type ActionHttpConfig } from "./action.js";
export { createDevScriptRegistry } from "./scripts/dev/index.js";
export {
  createAgentChatPlugin,
  defaultAgentChatPlugin,
  type AgentChatPluginOptions,
} from "./server/agent-chat-plugin.js";

// Server
export {
  createServer,
  createSSEHandler,
  defineNitroPlugin,
  autoMountAuth,
  getSession,
  type CreateServerOptions,
  type SSEHandlerOptions,
  type AuthSession,
  type AuthOptions,
} from "./server/index.js";

// Client
export {
  sendToAgentChat,
  useAgentChatGenerating,
  useDevMode,
  useSendToAgentChat,
  CodeRequiredDialog,
  useDbSync,
  useFileWatcher,
  cn,
  ApiKeySettings,
  useSession,
  useProductionAgent,
  ProductionAgentPanel,
  type AgentChatMessage,
  type CodeRequiredDialogProps,
  type ProductionAgentMessage,
  type UseProductionAgentResult,
  type ProductionAgentPanelProps,
  useActionQuery,
  useActionMutation,
} from "./client/index.js";

// Shared (isomorphic)
export {
  agentChat,
  type AgentChatCallOptions,
  type AgentChatResponse,
} from "./shared/index.js";

// Token usage tracking
export {
  recordUsage,
  getUsageSummary,
  getUserUsageCents,
  checkUsageLimit,
  calculateCost,
  type UsageRecord,
  type UsageSummary,
  type UsageBucket,
  type DailyBucket,
  type UsageRecentEntry,
} from "./usage/store.js";

// Scripts
export {
  runScript,
  loadEnv,
  parseArgs,
  camelCaseArgs,
  isValidPath,
  isValidProjectPath,
  ensureDir,
  fail,
} from "./scripts/index.js";

// Secrets registry — import from "@agent-native/core/secrets" when possible
// (the subpath keeps the top-level entry point lean), but re-export the
// public API here for convenience.
export {
  registerRequiredSecret,
  listRequiredSecrets,
  getRequiredSecret,
  readAppSecret,
  writeAppSecret,
  deleteAppSecret,
  type RegisteredSecret,
  type SecretScope,
  type SecretKind,
  type SecretValidator,
  type SecretRef,
} from "./secrets/index.js";
