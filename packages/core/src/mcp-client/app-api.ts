import { isToolVisibilityModelOnly } from "@modelcontextprotocol/ext-apps/app-bridge";

import { getMcpManagerForPrincipal } from "../server/agent-chat/mcp-glue.js";
import { getRequestContext } from "../server/request-context.js";
import {
  hasMcpProviderMatchRules,
  mcpServerUrlMatchesProvider,
} from "../shared/mcp-provider-hosts.js";
import {
  buildMcpToolName,
  type McpClientManager,
  type McpTool,
} from "./manager.js";
import { normalizeMcpPrincipal } from "./principal.js";
import { parseMergedKey } from "./remote-store.js";
import { isMcpToolAllowedForRequest } from "./visibility.js";

export interface AppMcpTool {
  serverId: string;
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface ListVisibleMcpToolsOptions {
  serverId?: string;
  /**
   * Keep only tools served from this provider's MCP endpoint, matched on the
   * server URL. A server id is a name the user chose, so it cannot prove which
   * provider answers the call.
   */
  providerId?: string;
}

export interface CallMcpToolOptions {
  /** Refuse the call unless the server's URL belongs to this provider. */
  providerId?: string;
}

export class McpAppApiError extends Error {
  readonly statusCode: 401 | 403 | 503;

  constructor(message: string, statusCode: 401 | 403 | 503) {
    super(message);
    this.name = "McpAppApiError";
    this.statusCode = statusCode;
  }
}

export async function listVisibleMcpTools(
  options: ListVisibleMcpToolsOptions = {},
): Promise<AppMcpTool[]> {
  const context = requireAuthenticatedRequest();
  const manager = await requireMcpManager(context);
  const tools = options.serverId
    ? manager.getToolsForServer(options.serverId)
    : manager.getTools();

  return tools
    .filter(
      (tool) =>
        isToolVisibleToApp(tool, context) &&
        isServerForProvider(manager, tool.source, options.providerId),
    )
    .map(toAppMcpTool);
}

export async function callMcpTool(
  serverId: string,
  originalToolName: string,
  args: Record<string, unknown> = {},
  options: CallMcpToolOptions = {},
): Promise<unknown> {
  const context = requireAuthenticatedRequest();
  const manager = await requireMcpManager(context);
  const tool = manager
    .getToolsForServer(serverId)
    .find((candidate) => candidate.originalName === originalToolName);

  if (
    !tool ||
    !isToolVisibleToApp(tool, context) ||
    !isServerForProvider(manager, serverId, options.providerId)
  ) {
    throw new McpAppApiError(
      "MCP tool is not available in this request scope.",
      403,
    );
  }

  return manager.callTool(buildMcpToolName(serverId, originalToolName), args);
}

function requireAuthenticatedRequest() {
  const context = getRequestContext();
  const principal = normalizeMcpPrincipal({
    userEmail: context?.userEmail,
    orgId: context?.orgId,
  });
  if (!principal) {
    throw new McpAppApiError("Authentication required.", 401);
  }
  return {
    ...(context ?? {}),
    userEmail: principal.userEmail,
    orgId: principal.orgId ?? undefined,
  };
}

async function requireMcpManager(
  context: ReturnType<typeof requireAuthenticatedRequest>,
): Promise<McpClientManager> {
  try {
    return await getMcpManagerForPrincipal({
      userEmail: context.userEmail,
      orgId: context.orgId ?? null,
    });
  } catch (error) {
    throw new McpAppApiError(
      error instanceof Error && error.message.includes("Authenticated MCP")
        ? "Authentication required."
        : "MCP client is not configured.",
      error instanceof Error && error.message.includes("Authenticated MCP")
        ? 401
        : 503,
    );
  }
}

function isToolVisibleToApp(
  tool: McpTool,
  context: ReturnType<typeof getRequestContext>,
): boolean {
  if (!context) return false;

  if (!isMcpToolAllowedForRequest(tool.name)) return false;
  const merged = parseMergedKey(tool.name);
  if (merged?.scope === "user" && !context.userEmail?.trim()) return false;
  if (merged?.scope === "org" && !context.orgId?.trim()) return false;

  try {
    return !isToolVisibilityModelOnly(tool.raw as any);
  } catch {
    return false;
  }
}

function isServerForProvider(
  manager: McpClientManager,
  serverId: string,
  providerId: string | undefined,
): boolean {
  if (providerId === undefined) return true;
  if (!hasMcpProviderMatchRules(providerId)) {
    throw new Error(
      `No MCP provider match rules for "${providerId}". Add it to MCP_PROVIDER_ENDPOINTS or MCP_LINK_HOSTS before filtering by it.`,
    );
  }
  const config = manager.getServerConfig(serverId);
  return (
    config?.type === "http" &&
    mcpServerUrlMatchesProvider(providerId, config.url) === true
  );
}

function toAppMcpTool(tool: McpTool): AppMcpTool {
  return {
    serverId: tool.source,
    name: tool.originalName,
    ...(tool.title ? { title: tool.title } : {}),
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    ...(tool._meta ? { _meta: tool._meta } : {}),
  };
}
