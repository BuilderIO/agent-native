import { parseEdits } from "../../app/lib/timestamp-mapping.js";
import { parseRedactions } from "../../app/lib/video-redactions.js";

const EDITOR_ROLES = new Set(["owner", "admin", "editor"]);

export function countPendingRedactions(
  editsJson: string | null | undefined,
): number {
  return parseRedactions(parseEdits(editsJson).overlays).length;
}

export function canViewWhileRedacting(
  role: string | null | undefined,
): boolean {
  return typeof role === "string" && EDITOR_ROLES.has(role);
}

/**
 * Files a screenshot burn replaced but has not yet deleted. The burn writes
 * this before it deletes anything and clears it after, so the hold covers the
 * window in which the unredacted original is still in storage — including
 * when the redactions were never saved as pending boxes first.
 */
export const BURN_IN_PROGRESS_KEY = "burnInProgress";

/**
 * The raw edits as an object. `null` means unreadable, which no caller may
 * treat as "no edits": the hold would lift, a save would wipe what is stored,
 * and a delete would miss files the edits list.
 */
export function readEditsRecord(
  editsJson: string | null | undefined,
): Record<string, unknown> | null {
  if (!editsJson) return {};
  try {
    const parsed = JSON.parse(editsJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
    // coercion-ok: null is the typed "unreadable" value, distinct from {}
  } catch {
    return null;
  }
}

/** The marker's files, or null when there is no burn in progress. */
export function markerUrls(edits: Record<string, unknown>): string[] | null {
  const marker = edits[BURN_IN_PROGRESS_KEY];
  if (!marker || typeof marker !== "object") return null;
  const urls = (marker as { staleUrls?: unknown }).staleUrls;
  return Array.isArray(urls)
    ? urls.filter((url): url is string => typeof url === "string" && !!url)
    : [];
}

export function burnInProgressUrls(
  editsJson: string | null | undefined,
): string[] | null {
  const edits = readEditsRecord(editsJson);
  return edits ? markerUrls(edits) : null;
}

/** True when this viewer must be held back from this recording's media. */
export function isHeldForRedaction(
  editsJson: string | null | undefined,
  role: string | null | undefined,
): boolean {
  if (canViewWhileRedacting(role)) return false;
  const edits = readEditsRecord(editsJson);
  // Unreadable edits could have boxes or a burn waiting.
  if (!edits) return true;
  return (
    parseRedactions(edits.overlays).length > 0 || markerUrls(edits) !== null
  );
}

export const REDACTION_HOLD_MESSAGE =
  "This is being edited by its owner and is unavailable for now.";
