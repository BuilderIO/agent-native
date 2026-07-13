/**
 * Shared screen-capture quality policy for browser-based Clips recorders.
 *
 * Display capture constraints are applied after the user chooses a surface. We
 * use `max` envelopes (never `min`/`exact`) so Retina and 4K sources are
 * downscaled before MediaRecorder has to encode them.
 */

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
