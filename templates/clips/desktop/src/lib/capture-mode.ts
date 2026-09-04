import type { CaptureMode } from "./recorder";

export interface CaptureSetup {
  mode: CaptureMode;
  cameraOn: boolean;
}

export function normalizeCaptureSetup(
  savedMode: string,
  savedCameraOn: boolean,
): CaptureSetup {
  if (
    savedCameraOn &&
    (savedMode === "screen-camera" || savedMode === "camera")
  ) {
    return { mode: savedMode, cameraOn: true };
  }

  return { mode: "screen", cameraOn: false };
}

export function captureSetupForMode(mode: CaptureMode): CaptureSetup {
  return { mode, cameraOn: mode !== "screen" };
}

export function captureSetupForCamera(
  mode: CaptureMode,
  cameraOn: boolean,
): CaptureSetup {
  if (!cameraOn) return { mode: "screen", cameraOn: false };
  return {
    mode: mode === "screen" ? "screen-camera" : mode,
    cameraOn: true,
  };
}
