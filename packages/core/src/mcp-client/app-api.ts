import { isToolVisibilityModelOnly } from "@modelcontextprotocol/ext-apps/app-bridge";

import { getGlobalMcpManager } from "../server/agent-chat/mcp-glue.js";
import { getRequestContext } from "../server/request-context.js";
import {
  buildMcpToolName,
  type McpClientManager,
  type McpTool,
} from "./manager.js";
import { parseMergedKey } from "./remote-store.js";
import { isMcpToolAllowedForRequest } from "./visibility.js";

export interface AppMcpTool {
  /** Configured MCP server id. */
  serverId: string;
  /** Original, unprefixed name reported by the MCP server. */
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface ListVisibleMcpToolsOptions {
  /** Restrict the result to one configured server. */
  serverId?: string;
}

export class McpAppApiError extends Error {
  readonly statusCode: 401 | 403 | 503;

  constructor(message: string, statusCode: 401 | 403 | 503) {
    super(message);
    this.name = "McpAppApiError";
    this.statusCode = statusCode;
  }
}

/**
 * List MCP tools that the authenticated request may expose to an app.
 *
 * The manager owns connection state and credentials; this API deliberately
 * projects only the tool contract and never returns server configuration.
 */
export async function listVisibleMcpTools(
  options: ListVisibleMcpToolsOptions = {},
): Promise<AppMcpTool[]> {
  const context = requireAuthenticatedRequest();
  const manager = requireMcpManager();
  const tools = options.serverId
    ? manager.getToolsForServer(options.serverId)
    : manager.getTools();

  return tools
    .filter((tool) => isToolVisibleToApp(tool, context))
    .map(toAppMcpTool);
}

/**
 * Call an app-visible MCP tool by server id and its original server-reported
 * name. The prefixed manager name is built only after the tool is found in
 * that server's current, request-visible tool list.
 */
export async function callMcpTool(
  serverId: string,
  originalToolName: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const context = requireAuthenticatedRequest();
  const manager = requireMcpManager();
  const tool = manager
    .getToolsForServer(serverId)
    .find((candidate) => candidate.originalName === originalToolName);

  if (!tool || !isToolVisibleToApp(tool, context)) {
    throw new McpAppApiError(
      "MCP tool is not available in this request scope.",
      403,
    );
  }

  return manager.callTool(buildMcpToolName(serverId, originalToolName), args);
}

function requireAuthenticatedRequest() {
  const context = getRequestContext();
  if (!context?.userEmail?.trim()) {
    throw new McpAppApiError("Authentication required.", 401);
  }
  return context;
}

function requireMcpManager(): McpClientManager {
  const manager = getGlobalMcpManager();
  if (!manager) {
    throw new McpAppApiError("MCP client is not configured.", 503);
  }
  return manager;
}

function isToolVisibleToApp(
  tool: McpTool,
  context: ReturnType<typeof getRequestContext>,
): boolean {
  if (!context) return false;

  // `isMcpToolAllowedForRequest` intentionally permits missing identity in
  // development for CLI/startup enumeration. App calls are stricter: an
  // active org-scoped tool requires an active org even in development.
  if (!isMcpToolAllowedForRequest(tool.name)) return false;
  const merged = parseMergedKey(tool.name);
  if (merged?.scope === "user" && !context.userEmail?.trim()) return false;
  if (merged?.scope === "org" && !context.orgId?.trim()) return false;

  try {
    // A malformed visibility declaration is not safe to expose to an app.
    return !isToolVisibilityModelOnly(tool.raw as any);
  } catch {
    return false;
  }
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
