// Browser-safe entry — only client & shared exports (no Node/Express/chokidar).

// Client
export {
  sendToAgentChat,
  useAgentChatGenerating,
  useDevMode,
  useSendToAgentChat,
  CodeRequiredDialog,
  useDbSync,
  useFileWatcher,
  useSession,
  cn,
  ApiKeySettings,
  type AgentChatMessage,
  type CodeRequiredDialogProps,
  type AuthSession,
} from "./client/index.js";

// Shared (isomorphic)
export { agentChat } from "./shared/index.js";

// Pure utilities (no Node.js deps — safe for browser and SSR)
export { parseArgs, camelCaseArgs } from "./scripts/parse-args.js";
