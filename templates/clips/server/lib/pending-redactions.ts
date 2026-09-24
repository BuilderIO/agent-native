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

/** True when this viewer must be held back from this recording's media. */
export function isHeldForRedaction(
  editsJson: string | null | undefined,
  role: string | null | undefined,
): boolean {
  return countPendingRedactions(editsJson) > 0 && !canViewWhileRedacting(role);
}

/** What the viewer is told. Deliberately says nothing about what is covered. */
export const REDACTION_HOLD_MESSAGE =
  "This is being edited by its owner and is unavailable for now.";
