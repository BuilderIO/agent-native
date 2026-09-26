import { isToolVisibilityModelOnly } from "@modelcontextprotocol/ext-apps/app-bridge";

import { waitForGlobalMcpManager } from "../server/agent-chat/mcp-glue.js";
import { getRequestContext } from "../server/request-context.js";
import {
  buildMcpToolName,
  type McpClientManager,
  type McpTool,
} from "./manager.js";
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
  const manager = await requireMcpManager();
  const tools = options.serverId
    ? manager.getToolsForServer(options.serverId)
    : manager.getTools();

  return tools
    .filter((tool) => isToolVisibleToApp(tool, context))
    .map(toAppMcpTool);
}

export async function callMcpTool(
  serverId: string,
  originalToolName: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const context = requireAuthenticatedRequest();
  const manager = await requireMcpManager();
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

async function requireMcpManager(): Promise<McpClientManager> {
  const manager = await waitForGlobalMcpManager();
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
