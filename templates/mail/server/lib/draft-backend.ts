export type SavedDraftBackend = "gmail" | "local";

export function parseSavedDraftBackend(
  value: unknown,
): SavedDraftBackend | undefined {
  if (value === undefined) return undefined;
  if (value === "gmail" || value === "local") return value;
  throw new Error("Invalid saved draft backend");
}

export function resolveSavedDraftBackend(
  requested: SavedDraftBackend | undefined,
  gmailConnected: boolean,
): SavedDraftBackend {
  return requested ?? (gmailConnected ? "gmail" : "local");
}
