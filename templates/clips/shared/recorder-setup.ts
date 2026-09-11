/**
 * Runtime-neutral recorder setup behavior.
 *
 * The desktop mini recorder is the canonical interaction model. Browser and
 * native capture still use different media APIs, but mode and camera changes
 * must resolve to the same visible state in both surfaces.
 */
export type RecorderSetupMode = "screen" | "screen-camera" | "camera";

export type BrowserRecorderSetupMode = "screen" | "screen+camera" | "camera";

export interface RecorderSetup {
  mode: RecorderSetupMode;
  cameraOn: boolean;
}

export function normalizeRecorderSetup(
  savedMode: string,
  savedCameraOn: boolean,
): RecorderSetup {
  if (
    savedCameraOn &&
    (savedMode === "screen-camera" || savedMode === "camera")
  ) {
    return { mode: savedMode, cameraOn: true };
  }

  return { mode: "screen", cameraOn: false };
}

export function recorderSetupForMode(mode: RecorderSetupMode): RecorderSetup {
  return { mode, cameraOn: mode !== "screen" };
}

export function recorderSetupForCamera(
  mode: RecorderSetupMode,
  cameraOn: boolean,
): RecorderSetup {
  if (!cameraOn) return { mode: "screen", cameraOn: false };

  return {
    mode: mode === "screen" ? "screen-camera" : mode,
    cameraOn: true,
  };
}

export function recorderSetupModeFromBrowser(
  mode: BrowserRecorderSetupMode,
): RecorderSetupMode {
  return mode === "screen+camera" ? "screen-camera" : mode;
}

export function recorderSetupModeToBrowser(
  mode: RecorderSetupMode,
): BrowserRecorderSetupMode {
  return mode === "screen-camera" ? "screen+camera" : mode;
}
