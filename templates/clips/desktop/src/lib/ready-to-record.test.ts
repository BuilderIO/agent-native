import { describe, expect, it } from "vitest";

import {
  applyReadyToRecordToggle,
  cursorEffectsAvailability,
  cursorEffectsOn,
  DEFAULT_CURSOR_EFFECTS,
  isReadyToRecordToggle,
  onOffLabel,
  type ReadyToRecordState,
} from "./ready-to-record";

const state: ReadyToRecordState = {
  mode: "screen-camera",
  source: "full-screen",
  cameraOn: true,
  cameraLabel: "FaceTime HD Camera",
  cameraError: null,
  micOn: false,
  micLabel: "MacBook Pro Microphone",
  systemAudioOn: true,
  nativeCapture: true,
};

describe("ready to record panel", () => {
  it("defaults to Snagit's cursor effect colours with both effects on", () => {
    expect(DEFAULT_CURSOR_EFFECTS).toEqual({
      highlightEnabled: true,
      clickEnabled: true,
      highlightColor: "#FFFF00",
      clickColor: "#FF594B",
      secondaryClickColor: "#1DB1FC",
    });
    expect(cursorEffectsOn(DEFAULT_CURSOR_EFFECTS)).toBe(true);
    expect(
      cursorEffectsOn({
        ...DEFAULT_CURSOR_EFFECTS,
        highlightEnabled: false,
        clickEnabled: false,
      }),
    ).toBe(false);
  });

  it("offers cursor effects only when the screen itself is recorded", () => {
    expect(cursorEffectsAvailability(state)).toEqual({ available: true });
    expect(cursorEffectsAvailability({ ...state, source: "region" })).toEqual({
      available: true,
    });
    expect(cursorEffectsAvailability({ ...state, source: "window" })).toEqual({
      available: false,
      reason: "Cursor effects are disabled for Window captures.",
    });
    expect(cursorEffectsAvailability({ ...state, mode: "camera" })).toEqual({
      available: false,
      reason: "Cursor effects need a screen recording.",
    });
    expect(
      cursorEffectsAvailability({ ...state, nativeCapture: false }),
    ).toEqual({
      available: false,
      reason: "Cursor effects need native screen capture.",
    });
  });

  it("flips only the toggled option", () => {
    expect(applyReadyToRecordToggle(state, "mic")).toEqual({
      ...state,
      micOn: true,
    });
    expect(applyReadyToRecordToggle(state, "camera")).toEqual({
      ...state,
      cameraOn: false,
    });
    expect(applyReadyToRecordToggle(state, "systemAudio")).toEqual({
      ...state,
      systemAudioOn: false,
    });
  });

  it("accepts only known toggle targets from other windows", () => {
    expect(isReadyToRecordToggle("camera")).toBe(true);
    expect(isReadyToRecordToggle("mic")).toBe(true);
    expect(isReadyToRecordToggle("systemAudio")).toBe(true);
    expect(isReadyToRecordToggle("cursor")).toBe(false);
    expect(isReadyToRecordToggle(undefined)).toBe(false);
  });

  it("labels states the way Snagit does", () => {
    expect(onOffLabel(true)).toBe("On");
    expect(onOffLabel(false)).toBe("Off");
  });
});
