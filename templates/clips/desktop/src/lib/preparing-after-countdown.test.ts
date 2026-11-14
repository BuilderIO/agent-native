import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PREPARING_AFTER_COUNTDOWN_DELAY_MS,
  showPreparingAfterCountdown,
} from "./preparing-after-countdown";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("showPreparingAfterCountdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows Preparing when capture is not ready after the countdown, and hides it once live", async () => {
    const countdown = deferred();
    const ready = deferred();
    const show = vi.fn(async () => {});
    const hide = vi.fn(async () => {});
    const preparing = showPreparingAfterCountdown(
      countdown.promise,
      ready.promise,
      { show, hide },
    );

    countdown.resolve();
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS);
    expect(show).toHaveBeenCalledTimes(1);

    // The slow server answers 8 s later; capture starts.
    await vi.advanceTimersByTimeAsync(8_000);
    ready.resolve();
    await preparing.done();
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when capture is ready before the countdown ends", async () => {
    const countdown = deferred();
    const ready = deferred();
    const show = vi.fn(async () => {});
    const hide = vi.fn(async () => {});
    const preparing = showPreparingAfterCountdown(
      countdown.promise,
      ready.promise,
      { show, hide },
    );

    ready.resolve();
    await Promise.resolve();
    countdown.resolve();
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS * 2);
    await preparing.done();
    expect(show).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it("does not delay a start that goes live within the grace period", async () => {
    const countdown = deferred();
    const ready = deferred();
    const show = vi.fn(async () => {});
    const hide = vi.fn(async () => {});
    const preparing = showPreparingAfterCountdown(
      countdown.promise,
      ready.promise,
      { show, hide },
    );

    countdown.resolve();
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS / 2);
    ready.resolve();
    // done() resolves without waiting for the rest of the delay.
    let finished = false;
    void preparing.done().then(() => {
      finished = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(true);
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS);
    expect(show).not.toHaveBeenCalled();
  });

  it("hides Preparing when the start fails", async () => {
    const countdown = deferred();
    const ready = deferred();
    const show = vi.fn(async () => {});
    const hide = vi.fn(async () => {});
    const preparing = showPreparingAfterCountdown(
      countdown.promise,
      ready.promise,
      { show, hide },
    );

    countdown.resolve();
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS);
    ready.reject(new Error("create-recording failed"));
    await preparing.done();
    expect(show).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("retries a failed hide and logs it instead of failing the start", async () => {
    const countdown = deferred();
    const ready = deferred();
    const hide = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("window busy"))
      .mockResolvedValueOnce(undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const preparing = showPreparingAfterCountdown(
      countdown.promise,
      ready.promise,
      { show: async () => {}, hide },
    );

    countdown.resolve();
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS);
    ready.resolve();
    await expect(preparing.done()).resolves.toBeUndefined();
    expect(hide).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("shows nothing when the countdown is cancelled", async () => {
    const countdown = deferred();
    const ready = deferred();
    const show = vi.fn(async () => {});
    const preparing = showPreparingAfterCountdown(
      countdown.promise,
      ready.promise,
      { show, hide: async () => {} },
    );

    countdown.reject(new Error("Recording cancelled during countdown"));
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS * 2);
    await preparing.done();
    expect(show).not.toHaveBeenCalled();
  });
});
