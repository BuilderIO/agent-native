import { describe, expect, it } from "vitest";

import {
  captureSetupForCamera,
  captureSetupForMode,
  normalizeCaptureSetup,
} from "./capture-mode";

describe("capture mode state", () => {
  it.each([
    ["screen", { mode: "screen", cameraOn: false }],
    ["screen-camera", { mode: "screen-camera", cameraOn: true }],
    ["camera", { mode: "camera", cameraOn: true }],
  ] as const)("keeps %s mode and camera state in sync", (mode, expected) => {
    expect(captureSetupForMode(mode)).toEqual(expected);
  });

  it("moves from screen-only to screen and camera when camera is enabled", () => {
    expect(captureSetupForCamera("screen", true)).toEqual({
      mode: "screen-camera",
      cameraOn: true,
    });
  });

  it.each(["screen-camera", "camera"] as const)(
    "moves from %s to screen-only when camera is disabled",
    (mode) => {
      expect(captureSetupForCamera(mode, false)).toEqual({
        mode: "screen",
        cameraOn: false,
      });
    },
  );

  it("repairs contradictory and invalid persisted state", () => {
    expect(normalizeCaptureSetup("screen", true)).toEqual({
      mode: "screen",
      cameraOn: false,
    });
    expect(normalizeCaptureSetup("camera", false)).toEqual({
      mode: "screen",
      cameraOn: false,
    });
    expect(normalizeCaptureSetup("unknown", true)).toEqual({
      mode: "screen",
      cameraOn: false,
    });
  });
});
