import { describe, expect, it, vi } from "vitest";

import { createPauseTransitionQueue } from "./pause-transition";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createPauseTransitionQueue", () => {
  it("applies the latest intent after an in-flight transition", async () => {
    const pause = deferred();
    const resume = deferred();
    const apply = vi.fn((paused: boolean) =>
      paused ? pause.promise : resume.promise,
    );
    const applied: boolean[] = [];
    const queue = createPauseTransitionQueue({
      apply,
      onApplied: (paused) => applied.push(paused),
    });

    queue.request(true);
    queue.request(false);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith(true);

    pause.resolve();
    await flushPromises();

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith(false);

    resume.resolve();
    await flushPromises();

    expect(applied).toEqual([true, false]);
    expect(queue.getAppliedPaused()).toBe(false);
    expect(queue.getDesiredPaused()).toBe(false);
    expect(queue.isTransitioning()).toBe(false);
  });

  it("coalesces duplicate requests for the same state", async () => {
    const pause = deferred();
    const apply = vi.fn(() => pause.promise);
    const queue = createPauseTransitionQueue({ apply });

    queue.request(true);
    queue.request(true);
    queue.request(true);

    expect(apply).toHaveBeenCalledTimes(1);

    pause.resolve();
    await flushPromises();
    expect(queue.getAppliedPaused()).toBe(true);
  });

  it("returns to the applied state after a failed transition", async () => {
    const error = new Error("pause failed");
    const onError = vi.fn();
    const queue = createPauseTransitionQueue({
      apply: () => Promise.reject(error),
      onError,
    });

    queue.request(true);
    await flushPromises();

    expect(onError).toHaveBeenCalledWith(error, true);
    expect(queue.getAppliedPaused()).toBe(false);
    expect(queue.getDesiredPaused()).toBe(false);
    expect(queue.isTransitioning()).toBe(false);
  });

  it("can synchronize an externally detected recorder state", () => {
    const apply = vi.fn();
    const queue = createPauseTransitionQueue({ apply });

    queue.synchronize(true);
    queue.request(false);

    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(false);
  });
});
