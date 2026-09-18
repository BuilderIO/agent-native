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
 * Screen/tab audio is requested whenever the microphone is enabled, and
 * withheld when it's off. The mic toggle is the only audio control the
 * recorder UI shows, so a user who turns it off reasonably expects the
 * recording to capture no audio at all — not just their voice. Requesting
 * system audio anyway relies on the user separately noticing and unchecking
 * the browser's native "share tab audio" checkbox, which they may not even
 * know exists. See Slack thread 1786086902028429: a user turned the mic off
 * and still got system audio in the recording; the agreed fix is to gate
 * system audio on the same toggle.
 *
 * When the mic IS on, audio is still requested unconditionally (not made
 * conditional on some separate "include system audio" flag) — that used to be
 * one toggle governing both, and with the mic off Chrome never even offered
 * the checkbox, so 345 production recordings landed with `has_audio = false`
 * while recording a call/demo. Declining the checkbox is still respected; the
 * user simply gets the choice whenever the mic is on.
 */
export function screenCaptureDisplayOptions(
  displaySurface: ScreenCaptureSurface,
  wantsMic: boolean,
): ScreenCaptureDisplayOptions {
  return {
    video: screenCaptureVideoConstraints(displaySurface),
    audio: wantsMic,
    // Let "Browser tab" open the tab picker. preferCurrentTab turns it into a
    // current-tab shortcut, which makes choosing another tab harder.
    selfBrowserSurface: displaySurface === "browser" ? "include" : "exclude",
    surfaceSwitching: "include",
    systemAudio: wantsMic ? "include" : "exclude",
  };
}
