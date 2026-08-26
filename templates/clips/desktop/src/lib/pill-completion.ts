/**
 * How the recording pill's completion card reads a `clips:native-upload-finished`
 * payload.
 *
 * The card is fed from three places — the recorder's event, a localStorage
 * hand-off for a pill that was still mounting, and a Rust-side replay of the
 * last result — and the pill's window is reused across a restart, so a payload
 * can arrive for a recording the window has already moved past.
 */

export type PillDoneStage = "finishing" | "uploading" | "uploaded" | "failed";

export type NativeUploadFinished = {
  recordingId?: string;
  ok?: boolean;
  viewUrl?: string;
  error?: string | null;
  localFilePath?: string | null;
};

export type PillCompletion = {
  stage: "uploaded" | "failed";
  savedLocally: boolean;
  viewUrl: string | null;
};

/**
 * The completion state the card should show, or `null` when the payload
 * belongs to a different recording than the one on screen and must be ignored.
 *
 * `sessionRecordingId` is the id the recorder announced for the session that
 * owns this card. When both sides name an id and they differ, the payload is a
 * late completion from an earlier take — taking it would repaint the current
 * card with the old clip's link and status. When either side has no id there is
 * nothing to compare (a local-only session has no server recording, and a pill
 * that mounted after the session event never learned one), so the payload is
 * taken, which is the contract the pill has always had.
 */
export function resolveCompletion(
  sessionRecordingId: string | null | undefined,
  payload: NativeUploadFinished,
): PillCompletion | null {
  if (
    sessionRecordingId &&
    payload.recordingId &&
    payload.recordingId !== sessionRecordingId
  ) {
    return null;
  }
  return {
    // A local-only stop succeeds with no view URL — the file on disk is the
    // whole result — so success is `ok`, never the presence of a link.
    stage: payload.ok ? "uploaded" : "failed",
    savedLocally: Boolean(payload.localFilePath),
    viewUrl: payload.viewUrl ?? null,
  };
}
