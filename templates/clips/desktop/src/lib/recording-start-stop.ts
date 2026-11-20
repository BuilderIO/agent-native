/**
 * How the app treats a Stop that arrives while a recording is still starting.
 *
 * Until capture may be live, a Stop cancels the start. Once the native begin /
 * Rewind start command has been sent (onCaptureStartAttempted) or capture was
 * reported started (onCaptureStartRequested), capture may already be running:
 * a Stop then lets the start finish and stops the resolved handle through the
 * normal stop / finalize flow, so the take is kept.
 */
export type StartedDuringStopOutcome = "cancel" | "finish-stop" | "keep";

export class RecordingStartStopState {
  private captureMayBeLive = false;
  private stopRequested = false;

  /** Native begin / Rewind start was sent, or capture was reported started. */
  markCaptureMayBeLive(): void {
    this.captureMayBeLive = true;
  }

  get mayBeLive(): boolean {
    return this.captureMayBeLive;
  }

  /** Records a Stop; returns true when it should cancel the start. */
  requestStop(): boolean {
    this.stopRequested = true;
    return !this.captureMayBeLive;
  }

  /** What to do with the handle once the start resolves. */
  outcomeForStarted(attemptAborted: boolean): StartedDuringStopOutcome {
    if (!this.captureMayBeLive) return attemptAborted ? "cancel" : "keep";
    return this.stopRequested || attemptAborted ? "finish-stop" : "keep";
  }
}

/**
 * The one Stop decision for a recording that is still starting, shared by
 * every Stop source (the Stop event and the record shortcut). Before capture
 * may be live it cancels the start; after that it only records the Stop, so
 * the resolved handle goes through the normal stop / finalize flow.
 */
export function stopDuringStart(
  state: RecordingStartStopState | null,
  cancelStart: () => void,
): "cancelled" | "finishing" {
  if (state && !state.requestStop()) return "finishing";
  cancelStart();
  return "cancelled";
}

/**
 * The capture identity a tagged Stop must match once native begin / Rewind
 * start was sent. The recording id is known then, before the start is
 * acknowledged, so a Stop tagged with it is not dropped while the
 * acknowledgement is pending.
 */
export function captureIdentityOnStartAttempt(
  current: string | null,
  recordingId: string | null,
): string | null {
  return current ?? recordingId;
}
