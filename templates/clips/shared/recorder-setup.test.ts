import { describe, expect, it } from "vitest";

import {
  normalizeRecorderSetup,
  recorderSetupForCamera,
  recorderSetupForMode,
  recorderSetupModeFromBrowser,
  recorderSetupModeToBrowser,
  type RecorderSetupMode,
} from "./recorder-setup";

describe("recorder setup contract", () => {
  it.each<[RecorderSetupMode, boolean]>([
    ["screen", false],
    ["screen-camera", true],
    ["camera", true],
  ])("selecting %s sets cameraOn to %s", (mode, cameraOn) => {
    expect(recorderSetupForMode(mode)).toEqual({ mode, cameraOn });
  });

  it("turns screen mode into screen and camera when the camera is enabled", () => {
    expect(recorderSetupForCamera("screen", true)).toEqual({
      mode: "screen-camera",
      cameraOn: true,
    });
  });

  it.each<RecorderSetupMode>(["screen-camera", "camera"])(
    "returns %s to screen mode when the camera is disabled",
    (mode) => {
      expect(recorderSetupForCamera(mode, false)).toEqual({
        mode: "screen",
        cameraOn: false,
      });
    },
  );

  it("normalizes contradictory saved setup instead of hiding camera state", () => {
    expect(normalizeRecorderSetup("screen-camera", false)).toEqual({
      mode: "screen",
      cameraOn: false,
    });
    expect(normalizeRecorderSetup("camera", true)).toEqual({
      mode: "camera",
      cameraOn: true,
    });
  });

  it("maps the browser spelling without leaking it into the shared contract", () => {
    expect(recorderSetupModeFromBrowser("screen+camera")).toBe("screen-camera");
    expect(recorderSetupModeToBrowser("screen-camera")).toBe("screen+camera");
  });
});
