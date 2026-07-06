// macOS capture/permission messaging shared between the device pickers and the
// recording flow. Centralized so the "is this a hard system block?" heuristic
// and the user-facing copy stay in sync wherever a getUserMedia call can fail.

export const MACOS_CAPTURE_PERMISSION_MESSAGE =
  "Grant the required macOS permissions below, then try again. If you just changed access, restart Clips before retrying.";
export const MACOS_SCREEN_PERMISSION_MESSAGE =
  "Grant Screen Recording permission in macOS Settings, then restart Clips and try again.";
export const MACOS_SPEECH_PERMISSION_MESSAGE =
  "Grant Speech Recognition and Microphone access, then try again. If you just changed access, restart Clips before retrying.";

export function isHardCapturePermissionError(message: string): boolean {
  return /permission denied by system|blocked by system|system settings|screen recording|privacy|sandbox/i.test(
    message,
  );
}
