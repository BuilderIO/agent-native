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

function overlay() {
  return {
    show: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
  };
}

describe("showPreparingAfterCountdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows Preparing while capture is not live after the countdown, and hides it once live", async () => {
    const countdown = deferred();
    const options = overlay();
    const preparing = showPreparingAfterCountdown(countdown.promise, options);

    countdown.resolve();
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS);
    expect(options.show).toHaveBeenCalledTimes(1);

    // A slow server, warm-up or begin keeps it up until the caller says live.
    await vi.advanceTimersByTimeAsync(8_000);
    expect(options.hide).not.toHaveBeenCalled();
    await preparing.done();
    expect(options.hide).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when capture is live before the countdown ends", async () => {
    const countdown = deferred();
    const options = overlay();
    const preparing = showPreparingAfterCountdown(countdown.promise, options);

    await preparing.done();
    countdown.resolve();
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS * 2);
    expect(options.show).not.toHaveBeenCalled();
    expect(options.hide).not.toHaveBeenCalled();
  });

  it("does not delay a start that goes live within the grace period", async () => {
    const countdown = deferred();
    const options = overlay();
    const preparing = showPreparingAfterCountdown(countdown.promise, options);

    countdown.resolve();
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS / 2);
    // done() resolves without waiting for the rest of the delay.
    let finished = false;
    void preparing.done().then(() => {
      finished = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(true);
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS);
    expect(options.show).not.toHaveBeenCalled();
  });

  it("hides Preparing when the start fails or is cancelled after it was shown", async () => {
    const countdown = deferred();
    const options = overlay();
    const preparing = showPreparingAfterCountdown(countdown.promise, options);

    countdown.resolve();
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS);
    await preparing.done();
    expect(options.show).toHaveBeenCalledTimes(1);
    expect(options.hide).toHaveBeenCalledTimes(1);
    // A second done() (e.g. from an outer cleanup) does not hide twice.
    await preparing.done();
    expect(options.hide).toHaveBeenCalledTimes(1);
  });

  it("waits for a show that is still in flight before hiding", async () => {
    const countdown = deferred();
    const shown = deferred();
    const order: string[] = [];
    const preparing = showPreparingAfterCountdown(countdown.promise, {
      show: async () => {
        order.push("show:start");
        await shown.promise;
        order.push("show:end");
      },
      hide: async () => {
        order.push("hide");
      },
    });

    countdown.resolve();
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS);
    const finishing = preparing.done();
    await Promise.resolve();
    expect(order).toEqual(["show:start"]);
    shown.resolve();
    await finishing;
    expect(order).toEqual(["show:start", "show:end", "hide"]);
  });

  it("logs a failed show and still hides whatever was built", async () => {
    const countdown = deferred();
    const hide = vi.fn(async () => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const preparing = showPreparingAfterCountdown(countdown.promise, {
      show: async () => {
        throw new Error("preparing window build failed");
      },
      hide,
    });

    countdown.resolve();
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS);
    await expect(preparing.done()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      "[clips-recorder] showing Preparing failed:",
      expect.objectContaining({ message: "preparing window build failed" }),
    );
    expect(hide).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("retries a failed hide and logs it instead of failing the start", async () => {
    const countdown = deferred();
    const hide = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("window busy"))
      .mockResolvedValueOnce(undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const preparing = showPreparingAfterCountdown(countdown.promise, {
      show: async () => {},
      hide,
    });

    countdown.resolve();
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS);
    await expect(preparing.done()).resolves.toBeUndefined();
    expect(hide).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("shows nothing when the countdown is cancelled", async () => {
    const countdown = deferred();
    const options = overlay();
    const preparing = showPreparingAfterCountdown(countdown.promise, options);

    countdown.reject(new Error("Recording cancelled during countdown"));
    await vi.advanceTimersByTimeAsync(PREPARING_AFTER_COUNTDOWN_DELAY_MS * 2);
    await preparing.done();
    expect(options.show).not.toHaveBeenCalled();
  });
});
