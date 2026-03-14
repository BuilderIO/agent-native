// Browser-safe entry — only client & shared exports (no Node/Express/chokidar).

// Client
export {
  sendToAgentChat,
  useAgentChatGenerating,
  useFileWatcher,
  cn,
  ApiKeySettings,
  type AgentChatMessage,
} from "./client/index.js";

// Shared (isomorphic)
export { agentChat } from "./shared/index.js";
