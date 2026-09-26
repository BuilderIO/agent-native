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
import { BURN_IN_PROGRESS_KEY } from "./pending-redactions.js";

export const UNRECLAIMED_URLS_KEY = "unreclaimedUrls";

type EditsRecord = Record<string, unknown>;

/**
 * Reads the raw JSON. `null` means unreadable, which callers must not treat
 * as "no edits": a save built on it would wipe what is stored.
 */
function readEdits(editsJson: string | null | undefined): EditsRecord | null {
  if (!editsJson) return {};
  try {
    const parsed = JSON.parse(editsJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as EditsRecord)
      : null;
    // coercion-ok: null is the typed "unreadable" value, distinct from {}
  } catch {
    return null;
  }
}

export function isReadableEditsJson(
  editsJson: string | null | undefined,
): boolean {
  return readEdits(editsJson) !== null;
}

function urlList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((url): url is string => typeof url === "string" && !!url)
    : [];
}

export function unreclaimedUrls(editsJson: string | null | undefined) {
  return urlList(readEdits(editsJson)?.[UNRECLAIMED_URLS_KEY]);
}

/**
 * Every stored file the edits say is left over and still to be deleted, or
 * `null` when the edits cannot be read — then the list is unknown, not empty.
 */
export function screenshotLeftoverUrls(
  editsJson: string | null | undefined,
): string[] | null {
  const edits = readEdits(editsJson);
  if (!edits) return null;
  const marker = edits[BURN_IN_PROGRESS_KEY] as
    | { staleUrls?: unknown }
    | undefined;
  return [
    ...new Set([
      ...urlList(marker?.staleUrls),
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
  const edits = readEdits(editsJson);
  if (!edits) return editsJson ?? "{}";
  const marker = edits[BURN_IN_PROGRESS_KEY] as
    | { editsJson?: unknown }
    | undefined;
  const effective =
    typeof marker?.editsJson === "string"
      ? (readEdits(marker.editsJson) ?? {})
      : { ...edits };
  delete effective[BURN_IN_PROGRESS_KEY];
  delete effective[UNRECLAIMED_URLS_KEY];
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
  const edits = readEdits(editorScreenshotEditsJson(editsJson));
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
