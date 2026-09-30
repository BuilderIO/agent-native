import type { AppMcpTool } from "@agent-native/core/mcp-client";

export const GONG_NATIVE_OPERATIONS = [
  "ask_account",
  "ask_deal",
  "generate_brief",
] as const;

export type GongNativeOperation = (typeof GONG_NATIVE_OPERATIONS)[number];

export function gongNativeOperationName(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, "_");
}

export function gongNativeTools(tools: AppMcpTool[]): AppMcpTool[] {
  const names = new Set<string>(GONG_NATIVE_OPERATIONS);
  return tools.filter((tool) => names.has(gongNativeOperationName(tool.name)));
}

export function selectGongNativeTool(
  tools: AppMcpTool[],
  operation: GongNativeOperation,
): AppMcpTool | null {
  const matches = tools.filter(
    (tool) => gongNativeOperationName(tool.name) === operation,
  );
  if (matches.length === 1) return matches[0];
  const gongNamed = matches.filter((tool) => /gong/i.test(tool.serverId));
  return gongNamed.length === 1 ? gongNamed[0] : null;
}
