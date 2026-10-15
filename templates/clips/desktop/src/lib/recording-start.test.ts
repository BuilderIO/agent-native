import { describe, expect, it, vi } from "vitest";

import { settleRecordingStart } from "./recording-start";

describe("settleRecordingStart", () => {
  it("requests earlier screen time before stopping a take whose start finishes late", async () => {
    const events: string[] = [];
    const handle = { recordingId: "recording-1" };
    const finishStop = vi.fn(async () => {
      events.push("stop");
    });

    const result = await settleRecordingStart(handle, {
      stopRequested: true,
      requestLookback: () => events.push("request-lookback"),
      finishStop,
    });

    expect(result).toEqual({ handle: null, stoppedDuringStart: true });
    expect(finishStop).toHaveBeenCalledWith(handle);
    expect(events).toEqual(["request-lookback", "stop"]);
  });

  it("requests earlier screen time and returns the active handle normally", async () => {
    const events: string[] = [];
    const handle = { recordingId: "recording-1" };
    const finishStop = vi.fn(async () => {
      events.push("stop");
    });

    const result = await settleRecordingStart(handle, {
      stopRequested: false,
      requestLookback: () => events.push("request-lookback"),
      finishStop,
    });

    expect(result).toEqual({ handle, stoppedDuringStart: false });
    expect(finishStop).not.toHaveBeenCalled();
    expect(events).toEqual(["request-lookback"]);
  });
});
