export { mountMCP } from "./server.js";
export type { MCPConfig } from "./server.js";

export {
  createMCPServerForRequest,
  verifyAuth,
  getAccessTokens,
  resolveOrgIdFromDomain,
  buildLinkArtifacts,
} from "./build-server.js";
export type { MCPCallerIdentity, MCPRequestMeta } from "./build-server.js";
export type { ExternalAgentPolicy } from "./external-agent-policy.js";

export { runMCPStdio } from "./stdio.js";
export type { RunMCPStdioOptions } from "./stdio.js";
export { runScreenMemoryMCPStdio } from "./screen-memory-stdio.js";
export type { RunScreenMemoryMCPStdioOptions } from "./screen-memory-stdio.js";

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

export {
  resolveWorkspace,
  resolveLocalAppOrigin,
  findWorkspaceRoot,
} from "./workspace-resolve.js";
export type { ResolvedApp, ResolvedWorkspace } from "./workspace-resolve.js";
export {
  fetchOrgApps,
  fetchOrgAppsResult,
  resolveOrgDirectoryOrigin,
  type FetchOrgAppsOptions,
  type OrgApp,
  type OrgDirectoryFetchResult,
  type OrgDirectoryUnavailableReason,
} from "./org-directory.js";
