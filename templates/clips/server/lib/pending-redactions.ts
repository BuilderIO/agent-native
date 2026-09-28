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

export function isHeldForRedaction(
  editsJson: string | null | undefined,
  role: string | null | undefined,
): boolean {
  return countPendingRedactions(editsJson) > 0 && !canViewWhileRedacting(role);
}

export const REDACTION_HOLD_MESSAGE =
  "This clip is being edited by its owner and is unavailable for now.";
