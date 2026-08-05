import { describe, expect, it } from "vitest";

import {
  audioRecorderFailureMessage,
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

  it("surfaces an iOS media-services reset even without a native error flag", () => {
    expect(
      audioRecorderFailureMessage({
        error: null,
        hasError: false,
        mediaServicesDidReset: true,
      }),
    ).toBe(
      "iOS interrupted the audio recorder. Tap Try again to start a new recording.",
    );
    expect(
      audioRecorderFailureMessage({
        error: null,
        hasError: false,
      }),
    ).toBeNull();
  });

  it("only stops camera capture once the app is actually backgrounded", () => {
    expect(shouldStopVideoForAppState("inactive")).toBe(false);
    expect(shouldStopVideoForAppState("background")).toBe(true);
    expect(shouldStopVideoForAppState("active")).toBe(false);
  });
});
