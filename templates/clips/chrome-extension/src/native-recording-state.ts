export type NativeRecordingStateStatus =
  | "recording"
  | "paused"
  | "stopping"
  | "uploading"
  | "complete"
  | "error";

export type OffscreenRecordingState = {
  activeSessionId?: string;
  preparedSessionId?: string;
};

export function hasLiveOffscreenSession(
  sessionId: string,
  state: OffscreenRecordingState,
): boolean {
  return (
    state.activeSessionId === sessionId || state.preparedSessionId === sessionId
  );
}

export function shouldReconcilePersistedRecording(
  status: NativeRecordingStateStatus,
  sessionId: string,
  state: OffscreenRecordingState,
): boolean {
  // Preserve terminal errors so the popup can explain an upload failure and
  // offer the existing discard/re-upload path.
  if (status === "error" || status === "complete") return false;
  return !hasLiveOffscreenSession(sessionId, state);
}
