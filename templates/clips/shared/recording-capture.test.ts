import { describe, expect, it } from "vitest";

import {
  SCREEN_CAPTURE_FRAME_RATE,
  SCREEN_CAPTURE_MAX_HEIGHT,
  SCREEN_CAPTURE_MAX_WIDTH,
  screenCaptureVideoConstraints,
  screenCaptureDisplayOptions,
  type ScreenCaptureSurface,
} from "./recording-capture";

describe("screen capture quality policy", () => {
  it.each<ScreenCaptureSurface>(["browser", "window", "monitor"])(
    "caps %s capture before encoding",
    (surface) => {
      expect(screenCaptureVideoConstraints(surface)).toEqual({
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
        displaySurface: surface,
      });
    },
  );

  it("uses only getDisplayMedia-safe numeric constraint members", () => {
    const constraints = screenCaptureVideoConstraints("monitor");

    for (const value of [
      constraints.frameRate,
      constraints.width,
      constraints.height,
    ]) {
      expect(value).not.toHaveProperty("min");
      expect(value).not.toHaveProperty("exact");
    }
  });
});

describe("screen capture audio policy", () => {
  it("requests screen audio regardless of the microphone", () => {
    // The recorder used one flag for BOTH mic capture and whether Chrome even
    // offered the "share tab audio" checkbox. With the mic off, a screen
    // recording captured zero audio tracks: 345 production recordings landed
    // with has_audio=false and were told "No speech was detected because this
    // recording was saved without audio" — 64% of recent transcript failures,
    // blaming the recording for a capture setting.
    for (const surface of ["browser", "window", "monitor"] as const) {
      const options = screenCaptureDisplayOptions(surface);
      expect(options.audio).toBe(true);
      expect(options.systemAudio).toBe("include");
    }
  });

  it("still opens the tab picker only for browser-surface capture", () => {
    expect(screenCaptureDisplayOptions("browser").selfBrowserSurface).toBe(
      "include",
    );
    expect(screenCaptureDisplayOptions("window").selfBrowserSurface).toBe(
      "exclude",
    );
  });
});
