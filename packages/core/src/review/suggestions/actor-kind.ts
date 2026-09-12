export function suggestionActorKind(
  ctx: unknown,
): "agent" | "human" | "system" {
  // Connected external agents arrive as mcp/webmcp/a2a callers; classifying
  // them as human would lose agent provenance on persisted suggestions.
  const agentCallers = new Set(["agent", "tool", "mcp", "webmcp", "a2a"]);
  const caller = (ctx as { caller?: unknown })?.caller;
  if (agentCallers.has(caller as string)) return "agent";
  return (ctx as { userEmail?: unknown })?.userEmail ? "human" : "system";
}
