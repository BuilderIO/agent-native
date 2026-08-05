import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { createPollEngine } from "./poll-engine.js";

describe("createPollEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs a leading attempt immediately on start()", async () => {
    const attempt = vi.fn().mockResolvedValue(undefined);
    const engine = createPollEngine(attempt, { intervalMs: 1000 });
    engine.start();
    await vi.waitFor(() => expect(attempt).toHaveBeenCalledTimes(1));
    engine.stop();
  });

  it("does not run leading attempt when leading is false", async () => {
    const attempt = vi.fn().mockResolvedValue(undefined);
    const engine = createPollEngine(attempt, {
      intervalMs: 1000,
      leading: false,
    });
    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempt).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it("schedules the next attempt only after the previous one settles", async () => {
    let resolveFirst: (() => void) | undefined;
    const attempt = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValue(undefined);
    const engine = createPollEngine(attempt, { intervalMs: 1000 });
    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);

    // Interval elapses while the first attempt is still in flight — no second call.
    await vi.advanceTimersByTimeAsync(5000);
    expect(attempt).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await vi.advanceTimersByTimeAsync(0);
    // Second attempt only fires intervalMs after settling, not immediately.
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempt).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it("aborts and reschedules when an attempt hangs past its timeout", async () => {
    const onError = vi.fn();
    let sawAbort = false;
    const attempt = vi.fn().mockImplementation(
      (signal: AbortSignal) =>
        new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => {
            sawAbort = true;
            reject(new Error("aborted"));
          });
        }),
    );
    const engine = createPollEngine(attempt, {
      intervalMs: 1000,
      timeoutMs: 5000,
      onError,
    });
    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(sawAbort).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);

    // Loop recovers and schedules the next attempt intervalMs later.
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempt).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it("never overlaps: pollNow() is a no-op while an attempt is in flight", async () => {
    let resolveFirst: (() => void) | undefined;
    const attempt = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValue(undefined);
    const engine = createPollEngine(attempt, { intervalMs: 1000 });
    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);

    engine.pollNow();
    engine.pollNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await vi.advanceTimersByTimeAsync(0);
    engine.stop();
  });

  it("pollNow() cancels the pending wait and runs immediately", async () => {
    const attempt = vi.fn().mockResolvedValue(undefined);
    const engine = createPollEngine(attempt, { intervalMs: 10_000 });
    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);

    engine.pollNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it("reschedule() re-arms the pending wait with a freshly resolved intervalMs", async () => {
    let hidden = false;
    const attempt = vi.fn().mockResolvedValue(undefined);
    const engine = createPollEngine(attempt, {
      intervalMs: () => (hidden ? 10_000 : 1000),
    });
    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);

    // Pending wait was armed at 1000ms (visible). Go hidden and reschedule —
    // without this call the change wouldn't take effect until the next tick.
    hidden = true;
    engine.reschedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9000);
    expect(attempt).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it("reschedule() is a no-op while an attempt is in flight", async () => {
    let resolveFirst: (() => void) | undefined;
    const attempt = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValue(undefined);
    const engine = createPollEngine(attempt, { intervalMs: 1000 });
    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    engine.reschedule(); // no pending timer yet (still in flight) — no-op, no throw
    resolveFirst?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempt).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it("stop() prevents a late-settling attempt from rescheduling", async () => {
    let resolveFirst: (() => void) | undefined;
    const attempt = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValue(undefined);
    const engine = createPollEngine(attempt, { intervalMs: 1000 });
    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);

    engine.stop();
    resolveFirst?.();
    await vi.advanceTimersByTimeAsync(5000);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("passes an AbortSignal that is not pre-aborted for a healthy attempt", async () => {
    let seenSignal: AbortSignal | undefined;
    const attempt = vi.fn().mockImplementation((signal: AbortSignal) => {
      seenSignal = signal;
      return Promise.resolve();
    });
    const engine = createPollEngine(attempt, { intervalMs: 1000 });
    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(seenSignal?.aborted).toBe(false);
    engine.stop();
  });

  it("start() is idempotent while already running", async () => {
    const attempt = vi.fn().mockResolvedValue(undefined);
    const engine = createPollEngine(attempt, { intervalMs: 1000 });
    engine.start();
    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it("computes the default timeout as max(timeoutFloorMs, intervalMs * 4)", async () => {
    let sawAbortAt = -1;
    const start = Date.now();
    const attempt = vi.fn().mockImplementation(
      (signal: AbortSignal) =>
        new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => {
            sawAbortAt = Date.now() - start;
            reject(new Error("aborted"));
          });
        }),
    );
    // intervalMs * 4 = 12_000, above the 10_000 floor.
    const engine = createPollEngine(attempt, { intervalMs: 3000 });
    engine.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(sawAbortAt).toBe(12_000);
    engine.stop();
  });
});
