// Framework for agent-native apps.
// Import everything from "@agent-native/core".

// Agent (production mode)
export {
  createProductionAgentHandler,
  type ScriptEntry,
  type ProductionAgentOptions,
  type ScriptTool,
  type AgentMessage,
  type AgentChatRequest,
  type AgentChatEvent,
} from "./agent/index.js";

// Server
export {
  createServer,
  createFileWatcher,
  createSSEHandler,
  type CreateServerOptions,
  type FileWatcherOptions,
  type SSEHandlerOptions,
} from "./server/index.js";

// Client
export {
  sendToAgentChat,
  useAgentChatGenerating,
  useFileWatcher,
  cn,
  ApiKeySettings,
  useProductionAgent,
  ProductionAgentPanel,
  type AgentChatMessage,
  type ProductionAgentMessage,
  type UseProductionAgentResult,
  type ProductionAgentPanelProps,
} from "./client/index.js";

// Shared (isomorphic)
export {
  agentChat,
  type AgentChatCallOptions,
  type AgentChatResponse,
} from "./shared/index.js";

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
