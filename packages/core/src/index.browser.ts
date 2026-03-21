// Browser-safe entry — only client & shared exports (no Node/Express/chokidar).

// Client
export {
  sendToAgentChat,
  useAgentChatGenerating,
  useFileWatcher,
  useSession,
  cn,
  ApiKeySettings,
  type AgentChatMessage,
  type AuthSession,
} from "./client/index.js";

// Shared (isomorphic)
export { agentChat } from "./shared/index.js";
