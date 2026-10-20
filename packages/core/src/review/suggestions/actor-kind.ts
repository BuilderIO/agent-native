export function suggestionActorKind(
  ctx: unknown,
): "agent" | "human" | "system" {
  const agentCallers = new Set(["agent", "tool", "mcp", "webmcp", "a2a"]);
  const caller = (ctx as { caller?: unknown })?.caller;
  if (agentCallers.has(caller as string)) return "agent";
  return (ctx as { userEmail?: unknown })?.userEmail ? "human" : "system";
}

export const LEGACY_SUGGESTION_RECEIPT_VERSION = 1;

export function suggestionActorKindMatchesReceipt(
  receiptActorKind: string | null | undefined,
  actorKind: string,
  receiptVersion: number | null | undefined,
): boolean {
  if (receiptActorKind === actorKind) return true;
  const legacy = (receiptVersion ?? 1) < 2;
  return legacy && receiptActorKind === "human" && actorKind === "agent";
}
