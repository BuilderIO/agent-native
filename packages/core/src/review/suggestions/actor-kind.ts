// Connected external agents arrive as mcp/webmcp/a2a callers; classifying
// them as human would lose agent provenance on persisted suggestions.
export function suggestionActorKind(
  ctx: unknown,
): "agent" | "human" | "system" {
  const agentCallers = new Set(["agent", "tool", "mcp", "webmcp", "a2a"]);
  const caller = (ctx as { caller?: unknown })?.caller;
  if (agentCallers.has(caller as string)) return "agent";
  return (ctx as { userEmail?: unknown })?.userEmail ? "human" : "system";
}

// Receipts created before the classifier rollout persisted external calls as
// "human"; their same-author retries must stay replayable until they age out.
// Receipts created after this cutoff with actorKind "human" are current
// human/CLI creations and stay strict.
export const SUGGESTION_ACTOR_KIND_LEGACY_CUTOFF = "2026-09-12T12:00:00.000Z";

export function suggestionActorKindMatchesReceipt(
  receiptActorKind: string | null | undefined,
  actorKind: string,
  suggestionCreatedAt: string | null | undefined,
): boolean {
  if (receiptActorKind === actorKind) return true;
  if (receiptActorKind !== "human" || actorKind !== "agent") return false;
  const created = suggestionCreatedAt
    ? Date.parse(suggestionCreatedAt)
    : Number.NaN;
  return (
    Number.isFinite(created) &&
    created < Date.parse(SUGGESTION_ACTOR_KIND_LEGACY_CUTOFF)
  );
}