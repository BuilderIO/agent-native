export const SCREEN_CAPTURE_FRAME_RATE = 24;
export const SCREEN_CAPTURE_MAX_WIDTH = 1920;
export const SCREEN_CAPTURE_MAX_HEIGHT = 1080;

export type ScreenCaptureSurface = "browser" | "window" | "monitor";

export type ScreenCaptureVideoConstraints = MediaTrackConstraints & {
  displaySurface: ScreenCaptureSurface;
};

export function screenCaptureVideoConstraints(
  displaySurface: ScreenCaptureSurface,
): ScreenCaptureVideoConstraints {
  return {
    frameRate: {
      ideal: SCREEN_CAPTURE_FRAME_RATE,
      max: SCREEN_CAPTURE_FRAME_RATE,
    },
    width: {
      ideal: SCREEN_CAPTURE_MAX_WIDTH,
      max: SCREEN_CAPTURE_MAX_WIDTH,
    },
    height: {
      ideal: SCREEN_CAPTURE_MAX_HEIGHT,
      max: SCREEN_CAPTURE_MAX_HEIGHT,
    },
    displaySurface,
  };
}

export type ScreenCaptureDisplayOptions = {
  video: ScreenCaptureVideoConstraints;
  audio: boolean;
  selfBrowserSurface: "include" | "exclude";
  surfaceSwitching: "include" | "exclude";
  systemAudio: "include" | "exclude";
};

export function screenCaptureDisplayOptions(
  displaySurface: ScreenCaptureSurface,
  wantsMic: boolean,
): ScreenCaptureDisplayOptions {
  return {
    video: screenCaptureVideoConstraints(displaySurface),
    audio: wantsMic,
    selfBrowserSurface: displaySurface === "browser" ? "include" : "exclude",
    surfaceSwitching: "include",
    systemAudio: wantsMic ? "include" : "exclude",
  };
}
