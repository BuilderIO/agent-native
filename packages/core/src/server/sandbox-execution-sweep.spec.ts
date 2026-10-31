import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stopBackgroundJobs } from "./background-jobs.js";
import { startSandboxExecutionSweep } from "./sandbox-execution-sweep.js";

// The first tick that sweeps: 25s startup delay, then the 30s interval.
const FIRST_SWEEP_MS = 55_000;

describe("sandbox execution sweep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    const stopped = stopBackgroundJobs(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await stopped;
    vi.useRealTimers();
  });

  it("runs one sweep at a time, but starts another once one has stalled", async () => {
    const drain = vi.fn(() => new Promise<void>(() => {}));
    const stop = startSandboxExecutionSweep({
      drain,
      waitForExecutions: async () => {},
    });

    await vi.advanceTimersByTimeAsync(FIRST_SWEEP_MS);
    expect(drain).toHaveBeenCalledOnce();

    // Well past the 2-minute interval, the stuck sweep still holds the slot.
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(drain).toHaveBeenCalledOnce();

    // Ten minutes after it started, the next tick gives up on it.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(drain).toHaveBeenCalledTimes(2);
    stop();
  });

  it("waits for every sweep still running, then for the executions, when stopped", async () => {
    const events: string[] = [];
    const finishes: (() => void)[] = [];
    const drain = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishes.push(resolve);
        }),
    );
    startSandboxExecutionSweep({
      drain,
      waitForExecutions: async () => {
        events.push("executions");
      },
    });

    // Two sweeps in flight: the first stalled, so a later tick started another.
    await vi.advanceTimersByTimeAsync(FIRST_SWEEP_MS + 10 * 60_000);
    expect(drain).toHaveBeenCalledTimes(2);

    const stopping = stopBackgroundJobs(60_000).then(() => {
      events.push("stopped");
    });
    await vi.advanceTimersByTimeAsync(0);
    finishes[1]();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([]);

    finishes[0]();
    await stopping;
    expect(events).toEqual(["executions", "stopped"]);
  });
});
