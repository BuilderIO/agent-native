import { describe, expect, it, vi } from "vitest";

import {
  RecordingStartStopState,
  stopDuringStart,
} from "./recording-start-stop";

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

describe("stopDuringStart (Stop event and record shortcut)", () => {
  it("cancels the start when no capture may be live", () => {
    const cancel = vi.fn();
    expect(stopDuringStart(new RecordingStartStopState(), cancel)).toBe(
      "cancelled",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels when there is no start state (a restart in flight)", () => {
    const cancel = vi.fn();
    expect(stopDuringStart(null, cancel)).toBe("cancelled");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not cancel a record-shortcut Stop once capture may be live, and finishes the take", () => {
    const state = new RecordingStartStopState();
    state.markCaptureMayBeLive();
    const cancel = vi.fn();
    expect(stopDuringStart(state, cancel)).toBe("finishing");
    expect(cancel).not.toHaveBeenCalled();
    expect(state.outcomeForStarted(false)).toBe("finish-stop");
  });
});
