import { describe, expect, it } from "vitest";

import {
  SCREEN_CAPTURE_FRAME_RATE,
  SCREEN_CAPTURE_MAX_HEIGHT,
  SCREEN_CAPTURE_MAX_WIDTH,
  screenCaptureVideoConstraints,
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
