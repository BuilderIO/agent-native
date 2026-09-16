import type { AppStateStatus } from "react-native";

export type AudioCaptureUiState =
  | "checking-permission"
  | "ready"
  | "recording"
  | "paused"
  | "saving"
  | "permission-denied"
  | "error";

export function audioRecorderFailureMessage(status: {
  error: string | null;
  hasError: boolean;
  mediaServicesDidReset?: boolean;
}): string | null {
  if (status.mediaServicesDidReset) {
    return "iOS interrupted the audio recorder. Tap Try again to start a new recording.";
  }
  if (!status.hasError) return null;
  return status.error?.trim() || "The recording was interrupted.";
}

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
