// Browser-safe entry — only client & shared exports (no Node/Express/chokidar).

// Client
export {
  sendToAgentChat,
  isEmbedMcpChatBridgeActive,
  useAgentChatGenerating,
  useDevMode,
  useSendToAgentChat,
  AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES,
  getMcpAppHostContext,
  openMcpAppHostLink,
  requestMcpAppDisplayMode,
  sendMcpAppHostMessage,
  updateMcpAppModelContext,
  useMcpAppHostContext,
  CodeRequiredDialog,
  useDbSync,
  useFileWatcher,
  useSession,
  cn,
  ApiKeySettings,
  type AgentChatMessage,
  type AgentNativeMcpAppHostMessageType,
  type McpAppDisplayMode,
  type McpAppHostChatMessage,
  type McpAppHostCapabilities,
  type McpAppHostContext,
  type McpAppHostContextSnapshot,
  type McpAppModelContextContentPart,
  type McpAppModelContextUpdate,
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
  type ActionMcpAppCspBuilder,
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
export {
  embedRoute,
  type EmbedRouteContext,
  type EmbedRouteOptions,
  type EmbedRoutePathBuilder,
  type EmbedRouteResult,
} from "./mcp/embed-route.js";
