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
  it("requests screen audio when the microphone is on", () => {
    for (const surface of ["browser", "window", "monitor"] as const) {
      const options = screenCaptureDisplayOptions(surface, true);
      expect(options.audio).toBe(true);
      expect(options.systemAudio).toBe("include");
    }
  });

  it("does not request system audio when the mic is off (privacy: mic off means no audio captured at all — Slack thread 1786086902028429)", () => {
    for (const surface of ["browser", "window", "monitor"] as const) {
      const options = screenCaptureDisplayOptions(surface, false);
      expect(options.audio).toBe(false);
      expect(options.systemAudio).toBe("exclude");
    }
  });

  it("still opens the tab picker only for browser-surface capture", () => {
    expect(
      screenCaptureDisplayOptions("browser", true).selfBrowserSurface,
    ).toBe("include");
    expect(
      screenCaptureDisplayOptions("window", true).selfBrowserSurface,
    ).toBe("exclude");
  });
});
