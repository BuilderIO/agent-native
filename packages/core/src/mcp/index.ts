export { mountMCP } from "./server.js";
export type { MCPConfig } from "./server.js";

// Shared MCP server builder (also re-exported from ./server.js for back-compat).
export {
  createMCPServerForRequest,
  verifyAuth,
  getAccessTokens,
  resolveOrgIdFromDomain,
  buildLinkArtifacts,
} from "./build-server.js";
export type { MCPCallerIdentity, MCPRequestMeta } from "./build-server.js";
export type { ExternalAgentPolicy } from "./external-agent-policy.js";

// stdio transport for `agent-native mcp serve` (Node-only).
export { runMCPStdio } from "./stdio.js";
export type { RunMCPStdioOptions } from "./stdio.js";
export { runScreenMemoryMCPStdio } from "./screen-memory-stdio.js";
export type { RunScreenMemoryMCPStdioOptions } from "./screen-memory-stdio.js";

// Generic cross-app builtin tools (merged into the registry, template wins).
export { getBuiltinCrossAppTools } from "./builtin-tools.js";
export {
  embedApp,
  MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
  type EmbedAppOptions,
} from "./embed-app.js";
export {
  embedRoute,
  type EmbedRouteContext,
  type EmbedRouteOptions,
  type EmbedRoutePathBuilder,
  type EmbedRouteResult,
} from "./embed-route.js";

// Workspace / app resolution helpers (Node-only).
export {
  resolveWorkspace,
  resolveLocalAppOrigin,
  findWorkspaceRoot,
} from "./workspace-resolve.js";
export type { ResolvedApp, ResolvedWorkspace } from "./workspace-resolve.js";
export {
  fetchOrgApps,
  resolveOrgDirectoryOrigin,
  type OrgApp,
} from "./org-directory.js";
