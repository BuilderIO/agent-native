import { describe, expect, it } from "vitest";

import {
  MOTION_CAPTURE_FRAME_RATE,
  MOTION_STREAM_FRAME_RATE,
  SCREEN_CAPTURE_FRAME_RATE,
  SCREEN_CAPTURE_MAX_HEIGHT,
  SCREEN_CAPTURE_MAX_WIDTH,
  captureFrameRate,
  captureMetadataJsonToStore,
  trackReportedCaptureFrameRate,
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

  it("uses the resolved native monitor resolution when supplied", () => {
    const options = screenCaptureDisplayOptions("monitor", false, {
      width: 3456,
      height: 2234,
    });
    expect(options.video.width).toEqual({ ideal: 3456, max: 3456 });
    expect(options.video.height).toEqual({ ideal: 2234, max: 2234 });
  });

  it("requests 60 fps only for motion-quality capture, from a stream with room for it", () => {
    expect(captureFrameRate()).toBe(24);
    expect(captureFrameRate("motion")).toBe(60);
    expect(MOTION_STREAM_FRAME_RATE).toBeGreaterThan(MOTION_CAPTURE_FRAME_RATE);
    expect(screenCaptureVideoConstraints("window", "motion").frameRate).toEqual(
      {
        ideal: MOTION_STREAM_FRAME_RATE,
        max: MOTION_STREAM_FRAME_RATE,
      },
    );
  });

  it("reports observed cadence only when the live track exposes it", () => {
    const observed = {
      getSettings: () => ({ frameRate: 58.7 }),
    } as MediaStreamTrack;
    const roomier = {
      getSettings: () => ({ frameRate: MOTION_STREAM_FRAME_RATE }),
    } as MediaStreamTrack;
    const unavailable = {
      getSettings: () => ({}),
    } as MediaStreamTrack;

    expect(trackReportedCaptureFrameRate(observed)).toBe(58.7);
    expect(trackReportedCaptureFrameRate(roomier)).toBe(
      MOTION_CAPTURE_FRAME_RATE,
    );
    expect(trackReportedCaptureFrameRate(unavailable)).toBeNull();
    expect(trackReportedCaptureFrameRate(null)).toBeNull();
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
    expect(screenCaptureDisplayOptions("window", true).selfBrowserSurface).toBe(
      "exclude",
    );
  });
});

describe("stored capture metadata", () => {
  const motion = JSON.stringify({ captureMode: "motion" });

  it("never lets a later Normal request downgrade a stored Motion take", () => {
    expect(captureMetadataJsonToStore({ captureMode: "normal" }, motion)).toBe(
      undefined,
    );
    expect(captureMetadataJsonToStore({}, motion)).toBe(undefined);
  });

  it("stores Motion over anything and Normal over a Normal or empty row", () => {
    expect(
      captureMetadataJsonToStore(
        { captureMode: "motion" },
        JSON.stringify({ captureMode: "normal" }),
      ),
    ).toBe(JSON.stringify({ captureMode: "motion" }));
    expect(captureMetadataJsonToStore({ captureMode: "normal" }, null)).toBe(
      JSON.stringify({ captureMode: "normal" }),
    );
    expect(captureMetadataJsonToStore(undefined, motion)).toBe(undefined);
  });
});
