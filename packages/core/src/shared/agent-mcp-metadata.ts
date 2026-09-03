export const DEFAULT_AGENT_NATIVE_MCP_INSTRUCTIONS =
  "This Agent-Native app exposes focused action tools. When the host supports page-local WebMCP, prefer the page's named tools over browser click/type automation for supported actions. For state-dependent work, call the app's current-screen or context read only when the target is not already in context; if current selection or item metadata identifies the target, call the smallest matching mutation directly, then read back the changed item to verify the result.";

export function agentNativeMcpInstructions(custom?: string): string {
  const extra = custom?.trim();
  return extra
    ? `${DEFAULT_AGENT_NATIVE_MCP_INSTRUCTIONS}\n\nApp-specific guidance:\n${extra}`
    : DEFAULT_AGENT_NATIVE_MCP_INSTRUCTIONS;
}

export function agentNativeToolTitle(name: string, title?: string): string {
  const explicit = title?.trim();
  if (explicit) return explicit;
  const readable = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return readable ? readable[0]!.toUpperCase() + readable.slice(1) : name;
}
