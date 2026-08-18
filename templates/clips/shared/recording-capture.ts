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

export type ScreenCaptureDisplayOptions = {
  video: ScreenCaptureVideoConstraints;
  audio: boolean;
  selfBrowserSurface: "include" | "exclude";
  surfaceSwitching: "include" | "exclude";
  systemAudio: "include" | "exclude";
};

/**
 * The `getDisplayMedia` options for a screen recording.
 *
 * Screen/tab audio is requested ALWAYS, and deliberately does not depend on
 * whether the microphone is on. They are two different sources, and one toggle
 * used to govern both: with the mic off, Chrome was never even offered the
 * "share tab audio" checkbox, so a screen recording of a call or a demo
 * captured zero audio tracks. Measured in production, 345 recordings landed
 * with `has_audio = false` — 95 over a minute, 17 over five — and each was told
 * "No speech was detected because this recording was saved without audio",
 * blaming the recording for a capture setting. That was 64% of recent
 * transcript failures. The Chrome extension always requested display audio and
 * never had the problem.
 *
 * Declining the checkbox is still respected; the user simply gets the choice.
 */
export function screenCaptureDisplayOptions(
  displaySurface: ScreenCaptureSurface,
): ScreenCaptureDisplayOptions {
  return {
    video: screenCaptureVideoConstraints(displaySurface),
    audio: true,
    // Let "Browser tab" open the tab picker. preferCurrentTab turns it into a
    // current-tab shortcut, which makes choosing another tab harder.
    selfBrowserSurface: displaySurface === "browser" ? "include" : "exclude",
    surfaceSwitching: "include",
    systemAudio: "include",
  };
}
