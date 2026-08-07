import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { startIntervalJob } from "./interval-job.js";

describe("startIntervalJob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs immediately and then on the configured interval", async () => {
    const runOnce = vi.fn().mockResolvedValue(undefined);
    const job = startIntervalJob(runOnce, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(runOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    job.stop();
  });

  it("never overlaps a slow run", async () => {
    let resolveFirst: (() => void) | undefined;
    const runOnce = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValue(undefined);
    const job = startIntervalJob(runOnce, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(runOnce).toHaveBeenCalledTimes(1);
    resolveFirst?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    job.stop();
  });

  it("stop() prevents further runs", async () => {
    const runOnce = vi.fn().mockResolvedValue(undefined);
    const job = startIntervalJob(runOnce, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    job.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it("bounds a hanging run with the configured timeout", async () => {
    const onError = vi.fn();
    const runOnce = vi.fn().mockImplementation(
      (signal: AbortSignal) =>
        new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const job = startIntervalJob(runOnce, {
      intervalMs: 1000,
      timeoutMs: 5000,
      onError,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    job.stop();
  });
});
