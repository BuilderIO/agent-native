import { describe, expect, it } from "vitest";

import { RecordingStartStopState } from "./recording-start-stop";

describe("RecordingStartStopState", () => {
  it("cancels the start when Stop lands before capture may be live", () => {
    const state = new RecordingStartStopState();
    expect(state.requestStop()).toBe(true);
    expect(state.outcomeForStarted(true)).toBe("cancel");
  });

  it("finishes the normal stop with the resolved handle when Stop lands while begin is being acknowledged", () => {
    const state = new RecordingStartStopState();
    // onCaptureStartAttempted: native begin / Rewind start has been sent.
    state.markCaptureMayBeLive();
    // Stop arrives before the acknowledgement: it must not cancel the start.
    expect(state.requestStop()).toBe(false);
    // The start resolves later: its handle goes through the normal stop.
    expect(state.outcomeForStarted(false)).toBe("finish-stop");
  });

  it("finishes the normal stop when the attempt was aborted after capture may be live", () => {
    const state = new RecordingStartStopState();
    state.markCaptureMayBeLive();
    expect(state.outcomeForStarted(true)).toBe("finish-stop");
  });

  it("keeps the handle when nothing stopped the start", () => {
    const state = new RecordingStartStopState();
    expect(state.outcomeForStarted(false)).toBe("keep");
    state.markCaptureMayBeLive();
    expect(state.outcomeForStarted(false)).toBe("keep");
  });
});
