export function editedTimelineState(
  raw: string | null | undefined,
): "none" | "edited" | "invalid" {
  if (!raw) return "none";
  try {
    const edits = JSON.parse(raw);
    if (!edits || typeof edits !== "object" || Array.isArray(edits))
      return "invalid";
    if (edits.trims === undefined) return "none";
    if (!Array.isArray(edits.trims)) return "invalid";
    let edited = false;
    for (const trim of edits.trims) {
      if (!trim || typeof trim !== "object") return "invalid";
      const value = trim as Record<string, unknown>;
      if (
        typeof value.excluded !== "boolean" ||
        typeof value.startMs !== "number" ||
        !Number.isFinite(value.startMs) ||
        typeof value.endMs !== "number" ||
        !Number.isFinite(value.endMs) ||
        value.startMs < 0 ||
        value.endMs < value.startMs
      )
        return "invalid";
      if (value.excluded && value.endMs > value.startMs) edited = true;
    }
    return edited ? "edited" : "none";
  } catch {
    return "invalid";
  }
}

export function hasUnavailableEditedTimeline(
  raw: string | null | undefined,
): boolean {
  return editedTimelineState(raw) !== "none";
}

export const EDITED_TIMELINE_UNAVAILABLE: Record<string, unknown> = {
  failureKind: "unavailable",
  error:
    "This clip exists, but its edited timeline context is not available yet.",
  nextStep: "Use the clip player to view the edited recording.",
};
