import { describe, expect, it } from "vitest";

import {
  reconcileAudioCaptureState,
  shouldStopVideoForAppState,
} from "./capture-lifecycle";

describe("capture lifecycle", () => {
  it("tracks the native audio recorder after recording begins", () => {
    expect(reconcileAudioCaptureState("ready", true, true)).toBe("recording");
    expect(reconcileAudioCaptureState("recording", false, true)).toBe("paused");
    expect(reconcileAudioCaptureState("recording", false, false)).toBe(
      "recording",
    );
  });

  it("only stops camera capture once the app is actually backgrounded", () => {
    expect(shouldStopVideoForAppState("inactive")).toBe(false);
    expect(shouldStopVideoForAppState("background")).toBe(true);
    expect(shouldStopVideoForAppState("active")).toBe(false);
  });
});
