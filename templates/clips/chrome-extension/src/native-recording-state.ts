export type NativeRecordingStateStatus =
  | "recording"
  | "paused"
  | "stopping"
  | "uploading"
  | "complete"
  | "error";

export type RestartUploadMode = "streaming" | "buffered";

export type OffscreenRecordingState = {
  activeSessionId?: string;
  activeRecordingId?: string;
  preparedSessionId?: string;
};

const finalizingSessions = new Set<string>();

export function claimRecordingFinalization(
  sessionId: string,
): (() => void) | null {
  if (finalizingSessions.has(sessionId)) return null;
  finalizingSessions.add(sessionId);
  return () => finalizingSessions.delete(sessionId);
}

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
  if (status === "error" || status === "complete") return false;
  return !hasLiveOffscreenSession(sessionId, state);
}

export function shouldClearTerminalSavingOverlay(
  phase: string,
  status: NativeRecordingStateStatus,
): boolean {
  return phase === "saving" && (status === "error" || status === "complete");
}

export function restartUploadResetBody(mimeType: string): {
  requestStreaming: true;
  mimeType: string;
} {
  return { requestStreaming: true, mimeType };
}

export function restartUploadModeFromResponse(
  value: unknown,
): RestartUploadMode | null {
  if (!value || typeof value !== "object") return null;
  const uploadMode = (value as { uploadMode?: unknown }).uploadMode;
  return uploadMode === "streaming" || uploadMode === "buffered"
    ? uploadMode
    : null;
}
