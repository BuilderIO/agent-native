/**
 * The server-only parts of a screenshot's `editsJson`, and what each audience
 * is shown of the rest.
 *
 * Two keys list stored files that still hold pixels the owner has since
 * replaced: the burn-in-progress marker (see `pending-redactions.ts`) and
 * `unreclaimedUrls`, earlier copies an ordinary save could not delete. Neither
 * may leave the server — each names a file a viewer is not meant to reach —
 * and every path that deletes a screenshot's media has to delete them too.
 */

import { parseEdits } from "../../app/lib/timestamp-mapping.js";
import {
  BURN_IN_PROGRESS_KEY,
  markerUrls,
  readEditsRecord,
} from "./pending-redactions.js";

export const UNRECLAIMED_URLS_KEY = "unreclaimedUrls";

/**
 * Set by permanent delete before it removes any file, so no save can land in
 * between and leave the row pointing at a file that is gone, or list a new
 * leftover the delete will never see.
 */
export const DELETE_CLAIM_KEY = "permanentDeleteClaim";

export function isClaimedForDelete(editsJson: string | null | undefined) {
  return Boolean(readEditsRecord(editsJson)?.[DELETE_CLAIM_KEY]);
}

/** The edits with the delete claim on; `null` when they cannot be read. */
export function withDeleteClaim(
  editsJson: string | null | undefined,
  at: string,
): string | null {
  const edits = readEditsRecord(editsJson);
  if (!edits) return null;
  return JSON.stringify({ ...edits, [DELETE_CLAIM_KEY]: { at } });
}

export function isReadableEditsJson(
  editsJson: string | null | undefined,
): boolean {
  return readEditsRecord(editsJson) !== null;
}

function urlList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((url): url is string => typeof url === "string" && !!url)
    : [];
}

export function unreclaimedUrls(editsJson: string | null | undefined) {
  return urlList(readEditsRecord(editsJson)?.[UNRECLAIMED_URLS_KEY]);
}

/**
 * Every stored file the edits say is left over and still to be deleted, or
 * `null` when the edits cannot be read — then the list is unknown, not empty.
 */
export function screenshotLeftoverUrls(
  editsJson: string | null | undefined,
): string[] | null {
  const edits = readEditsRecord(editsJson);
  if (!edits) return null;
  return [
    ...new Set([
      ...(markerUrls(edits) ?? []),
      ...urlList(edits[UNRECLAIMED_URLS_KEY]),
    ]),
  ];
}

/**
 * The edits as the editor should see them. Mid-burn the top level still holds
 * the edits from before the burn — the marker carries the ones it finishes
 * with — so an editor opened then must start from the marker's, or its next
 * save would put the burned boxes back as pending and lose the burn's marks.
 */
export function editorScreenshotEditsJson(
  editsJson: string | null | undefined,
): string {
  const edits = readEditsRecord(editsJson);
  if (!edits) return editsJson ?? "{}";
  const marker = edits[BURN_IN_PROGRESS_KEY] as
    | { editsJson?: unknown }
    | undefined;
  const effective =
    typeof marker?.editsJson === "string"
      ? (readEditsRecord(marker.editsJson) ?? {})
      : { ...edits };
  delete effective[BURN_IN_PROGRESS_KEY];
  delete effective[UNRECLAIMED_URLS_KEY];
  delete effective[DELETE_CLAIM_KEY];
  return JSON.stringify(effective);
}

/**
 * The edits as a viewer sees them. The page needs the video editor's entries
 * to play a clip, but a screenshot's marks are already in the picture it is
 * served, and `redactions` and pending `overlays` say where a secret was and
 * how big it was.
 */
export function viewerScreenshotEditsJson(
  editsJson: string | null | undefined,
): string {
  const edits = readEditsRecord(editorScreenshotEditsJson(editsJson));
  if (!edits) return "{}";
  delete edits.redactions;
  delete edits.annotations;
  delete edits.overlays;
  delete edits.crop;
  return JSON.stringify(edits);
}

/** `parseEdits` of the editor's view, for callers that want the typed form. */
export function editorScreenshotEdits(editsJson: string | null | undefined) {
  return parseEdits(editorScreenshotEditsJson(editsJson));
}
