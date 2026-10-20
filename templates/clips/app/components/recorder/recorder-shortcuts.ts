export type RecorderUiState =
  | "idle"
  | "pickingSources"
  | "countdown"
  | "recording"
  | "compressing"
  | "uploading"
  | "pendingUpload"
  | "complete"
  | "error";

export type RecorderShortcutAction =
  | "stop"
  | "pause"
  | "confirm-discard"
  | "confirm-restart"
  | "cancel-setup"
  | "restart"
  | "confetti";

/**
 * The recorder action a key press asks for. Anything that would delete
 * recorded video (a live recording, an unfinished upload, a local copy) only
 * opens a confirmation; setup with nothing recorded cancels right away.
 */
export function recorderShortcutAction(
  event: Pick<
    KeyboardEvent,
    "key" | "code" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey"
  >,
  state: {
    uiState: RecorderUiState;
    engineState: string | undefined;
    hasRecordingToLose: boolean;
  },
): RecorderShortcutAction | null {
  const { uiState, engineState, hasRecordingToLose } = state;
  const k = event.key.toLowerCase();
  const nothingRecordedYet =
    uiState === "countdown" || uiState === "pickingSources";

  if (
    event.key === "Escape" ||
    event.key === "Esc" ||
    event.code === "Escape"
  ) {
    if (uiState === "countdown") return "cancel-setup";
    if (
      uiState === "recording" ||
      engineState === "recording" ||
      engineState === "paused"
    ) {
      return "stop";
    }
  }
  if (event.altKey && event.shiftKey && k === "p" && uiState === "recording") {
    return "pause";
  }
  if (event.altKey && event.shiftKey && k === "c" && uiState !== "idle") {
    if (nothingRecordedYet) return "cancel-setup";
    return hasRecordingToLose ||
      uiState === "recording" ||
      uiState === "uploading" ||
      uiState === "compressing" ||
      uiState === "pendingUpload"
      ? "confirm-discard"
      : "cancel-setup";
  }
  if (event.altKey && event.shiftKey && k === "r") {
    if (uiState === "countdown") return "restart";
    if (uiState === "recording") return "confirm-restart";
  }
  if (
    uiState === "recording" &&
    k === "c" &&
    ((event.ctrlKey && event.metaKey) || (event.ctrlKey && event.altKey))
  ) {
    return "confetti";
  }
  return null;
}
