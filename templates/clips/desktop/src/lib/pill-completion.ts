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

export type PillCardTone = "pending" | "ok" | "warn";

export type PillCardState = {
  title: string;
  /** Sub-line detail, appended after the take's duration. Empty when the
   * title already says everything there is to say. */
  detail: string;
  tone: PillCardTone;
};

/**
 * The completion card's headline and tone.
 *
 * The card goes up the instant Stop is pressed, before the export or upload
 * has returned anything, so the headline tracks `stage` rather than asserting
 * success. A stop that fails must not leave a green check and "Recording
 * saved" on screen with only a small caption disagreeing — the headline is
 * what a glance and a screen reader both take away.
 */
export function completionCardState(
  stage: PillDoneStage,
  session: { hasLink: boolean; savedLocally: boolean },
): PillCardState {
  switch (stage) {
    case "uploaded":
      return {
        title: "Recording saved",
        // With a link the row below already shows it; without one the file on
        // disk is the only place the take exists, so say where it went.
        detail: session.hasLink ? "" : "saved on this device",
        tone: "ok",
      };
    case "failed":
      return {
        title: "Upload paused",
        detail: session.savedLocally ? "saved on this device" : "",
        tone: "warn",
      };
    case "uploading":
      return { title: "Uploading", detail: "", tone: "pending" };
    case "finishing":
      return { title: "Finishing up", detail: "", tone: "pending" };
  }
}
