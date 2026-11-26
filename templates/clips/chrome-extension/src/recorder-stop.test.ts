import { afterEach, describe, expect, it, vi } from "vitest";

import { CANCEL_STOP_TIMEOUT_MS, stopRecorderWithin } from "./recorder-stop";

function recorder(state: RecordingState) {
  return { state, stop: vi.fn() };
}

describe("stopRecorderWithin", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves at once for an inactive recorder without waiting for its stop", async () => {
    const inactive = recorder("inactive");
    const neverStops = new Promise<never>(() => undefined);

    await expect(
      stopRecorderWithin(inactive, neverStops, CANCEL_STOP_TIMEOUT_MS),
    ).resolves.toBe("already-inactive");
    expect(inactive.stop).not.toHaveBeenCalled();
  });

  it("reports stopped when the recorder confirms before the timeout", async () => {
    const active = recorder("recording");

    await expect(
      stopRecorderWithin(active, Promise.resolve(), CANCEL_STOP_TIMEOUT_MS),
    ).resolves.toBe("stopped");
    expect(active.stop).toHaveBeenCalledTimes(1);
  });

  it("gives up after the timeout when the recorder never reports stopped", async () => {
    vi.useFakeTimers();
    const active = recorder("recording");
    const neverStops = new Promise<never>(() => undefined);
    let outcome: string | null = null;

    const pending = stopRecorderWithin(
      active,
      neverStops,
      CANCEL_STOP_TIMEOUT_MS,
    ).then((value) => {
      outcome = value;
    });
    await vi.advanceTimersByTimeAsync(CANCEL_STOP_TIMEOUT_MS - 1);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(outcome).toBe("timed-out");
    expect(active.stop).toHaveBeenCalledTimes(1);
  });
});
