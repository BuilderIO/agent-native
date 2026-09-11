import type { McpTool } from "./manager.js";

export const MCP_ACTION_RESULT_MARKER = "__agentNativeMcpToolResult" as const;

export interface AgentMcpAppResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  _meta?: Record<string, unknown>;
}

export interface AgentMcpAppPayload {
  serverId: string;
  toolName: string;
  originalToolName: string;
  resourceUri: string;
  toolInput: Record<string, unknown>;
  toolResult: Record<string, unknown>;
  tool?: {
    name: string;
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  };
  resource?: AgentMcpAppResourceContent;
}

export interface McpActionResult {
  [MCP_ACTION_RESULT_MARKER]: true;
  text: string;
  raw: unknown;
  serverId: string;
  toolName: string;
  originalToolName: string;
  input: Record<string, unknown>;
  mcpApp?: AgentMcpAppPayload;
}

export function isMcpActionResult(value: unknown): value is McpActionResult {
  return (
    !!value &&
    typeof value === "object" &&
    (value as Record<string, unknown>)[MCP_ACTION_RESULT_MARKER] === true &&
    typeof (value as Record<string, unknown>).text === "string"
  );
}

export function toolForMcpAppPayload(
  tool: McpTool,
): AgentMcpAppPayload["tool"] {
  return {
    name: tool.originalName,
    ...(tool.title ? { title: tool.title } : {}),
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    ...(tool._meta ? { _meta: tool._meta } : {}),
  };
}
