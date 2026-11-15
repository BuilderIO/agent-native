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
