export const DEFAULT_AGENT_NATIVE_MCP_INSTRUCTIONS =
  "This Agent-Native app exposes focused action tools. When the host supports page-local WebMCP, prefer the page's named tools over browser click/type automation for supported actions. For state-dependent work, call the app's `view-screen` tool only when the target is not already in context; if current selection or item metadata identifies the target, call the smallest matching mutation directly, then read back the changed item to verify the result. Use the exact field names from each action schema. Treat validation or contract errors as corrective feedback and retry with corrected arguments; do not turn a 500 into an unsafe full-document or UI fallback. You, the connected model, are the author: when the user asks for new content — a design, a deck, a form, a document, a plan — write it yourself and persist it with the app's create/update tools; do not delegate the authoring to the app's built-in agent or wait on an in-app question form, and use ask_app only when no named tool covers the capability.";

export function agentNativeMcpInstructions(
  custom?: string,
  keyTools?: readonly string[],
): string {
  const extra = custom?.trim();
  const key = keyTools?.length
    ? `Key tools for this app: ${keyTools.join(", ")}. Call tool-search for anything not listed.`
    : "";
  const base = key
    ? `${DEFAULT_AGENT_NATIVE_MCP_INSTRUCTIONS}\n\n${key}`
    : DEFAULT_AGENT_NATIVE_MCP_INSTRUCTIONS;
  return extra ? `${base}\n\nApp-specific guidance:\n${extra}` : base;
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
