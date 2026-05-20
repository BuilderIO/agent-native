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

// defineAction — used by template actions, no Node.js deps
export {
  defineAction,
  AgentActionStopError,
  isAgentActionStopError,
  type ActionHttpConfig,
  type AgentActionStopOptions,
  MCP_APP_EXTENSION_ID,
  MCP_APP_MIME_TYPE,
  MCP_APP_RESOURCE_URI_META_KEY,
  type ActionMcpAppConfig,
  type ActionMcpAppCsp,
  type ActionMcpAppHtmlBuilder,
  type ActionMcpAppPermissions,
  type ActionMcpAppResourceConfig,
  type ActionMcpAppResourceMeta,
} from "./action.js";
export {
  embedApp,
  MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
  type EmbedAppOptions,
} from "./mcp/embed-app.js";
