// Framework for agent-native apps.
// Import everything from "@agent-native/core".

// Server
export {
  createServer,
  createFileWatcher,
  createSSEHandler,
  createProductionServer,
  type CreateServerOptions,
  type FileWatcherOptions,
  type SSEHandlerOptions,
  type ProductionServerOptions,
} from "./server/index.js";

// Client
export {
  sendToAgentChat,
  useAgentChatGenerating,
  useFileWatcher,
  cn,
  type AgentChatMessage,
} from "./client/index.js";

// Shared (isomorphic)
export { agentChat } from "./shared/index.js";

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
