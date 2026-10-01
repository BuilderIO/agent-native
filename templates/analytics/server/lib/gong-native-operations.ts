import {
  listVisibleMcpTools,
  type AppMcpTool,
} from "@agent-native/core/mcp-client";

export const GONG_NATIVE_OPERATIONS = [
  "ask_account",
  "ask_deal",
  "generate_brief",
] as const;

export type GongNativeOperation = (typeof GONG_NATIVE_OPERATIONS)[number];

/** Matches servers by URL, so another server reusing Gong's tool names is never a candidate. */
export const GONG_MCP_PROVIDER_ID = "gong";

export function gongNativeOperationName(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, "_");
}

export async function listGongNativeTools(): Promise<AppMcpTool[]> {
  const names = new Set<string>(GONG_NATIVE_OPERATIONS);
  const tools = await listVisibleMcpTools({ providerId: GONG_MCP_PROVIDER_ID });
  return tools.filter((tool) => names.has(gongNativeOperationName(tool.name)));
}

export function selectGongNativeTool(
  tools: AppMcpTool[],
  operation: GongNativeOperation,
): AppMcpTool | null {
  const matches = tools.filter(
    (tool) => gongNativeOperationName(tool.name) === operation,
  );
  return matches.length === 1 ? matches[0] : null;
}
