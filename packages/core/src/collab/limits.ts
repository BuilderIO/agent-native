/** Largest request body the collab routes accept by default. */
export const COLLAB_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

/** Largest encoded document a live copy holds by default. */
export const COLLAB_MAX_STATE_BYTES = 4 * 1024 * 1024;

// The update's JSON body carries the request source and field names beside it.
const UPDATE_BODY_OVERHEAD_BYTES = 1024;

/**
 * Largest Yjs update one request can carry under the default payload limit:
 * the update travels base64-encoded, four characters for every three bytes.
 */
export const COLLAB_MAX_UPDATE_BYTES =
  Math.floor((COLLAB_MAX_PAYLOAD_BYTES - UPDATE_BODY_OVERHEAD_BYTES) / 4) * 3;

/**
 * Whether the server would take an update of `updateBytes` that leaves the
 * document's encoded state at `resultingStateBytes`, under the default limits.
 * The server measures the document after the update, so one that deletes
 * fits a document at its limit.
 */
export function collabUpdateFits(
  updateBytes: number,
  resultingStateBytes: number,
): boolean {
  return (
    updateBytes <= COLLAB_MAX_UPDATE_BYTES &&
    resultingStateBytes <= COLLAB_MAX_STATE_BYTES
  );
}
