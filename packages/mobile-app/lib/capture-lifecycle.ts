import type { AppStateStatus } from "react-native";

export type AudioCaptureUiState =
  | "checking-permission"
  | "ready"
  | "recording"
  | "paused"
  | "saving"
  | "permission-denied"
  | "error";

export function reconcileAudioCaptureState(
  state: AudioCaptureUiState,
  nativeIsRecording: boolean,
  nativeRecordingStarted: boolean,
): AudioCaptureUiState {
  if (
    nativeIsRecording &&
    (state === "ready" || state === "paused" || state === "recording")
  ) {
    return "recording";
  }
  if (!nativeIsRecording && nativeRecordingStarted && state === "recording") {
    return "paused";
  }
  return state;
}

export function shouldStopVideoForAppState(state: AppStateStatus): boolean {
  return state === "background";
}
