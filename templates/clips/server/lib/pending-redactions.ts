/**
 * Whether a recording is mid-redaction, and who is allowed to see it anyway.
 *
 * A redaction box is metadata until it is burned in: the stored file still has
 * every pixel underneath it. A link that went out before the box was drawn
 * therefore still hands over the unredacted video, and the person who drew the
 * box has every reason to assume otherwise.
 *
 * So while there are boxes waiting, the clip is held back from everyone except
 * the people who can finish the job. It comes back on its own the moment
 * `burn-recording-redactions` runs — nothing to remember to undo.
 */

import { parseEdits } from "../../app/lib/timestamp-mapping.js";
import { parseRedactions } from "../../app/lib/video-redactions.js";

/** Roles that can edit, and so can still play the clip while it is held. */
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

/** What the viewer is told. Deliberately says nothing about what is covered. */
export const REDACTION_HOLD_MESSAGE =
  "This is being edited by its owner and is unavailable for now.";
