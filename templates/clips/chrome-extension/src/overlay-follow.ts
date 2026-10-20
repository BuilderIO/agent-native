export type OverlayFollowPhase =
  | "idle"
  | "countdown"
  | "recording"
  | "paused"
  | "saving";

export function shouldFollowOverlay(
  phase: OverlayFollowPhase,
  hasActiveNativeRecording: boolean,
  hasArmingNativeRecording: boolean,
): boolean {
  return (
    phase !== "idle" && (hasActiveNativeRecording || hasArmingNativeRecording)
  );
}

export async function sendWithInjectionFallback(
  sendMessage: () => Promise<boolean>,
  injectContentScript: () => Promise<boolean>,
): Promise<boolean> {
  if (await sendMessage()) return true;
  if (!(await injectContentScript())) return false;
  return sendMessage();
}
