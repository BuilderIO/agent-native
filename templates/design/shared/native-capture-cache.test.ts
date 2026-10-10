import { describe, expect, it, vi } from "vitest";

import { NativeCaptureCache } from "./native-capture-cache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("NativeCaptureCache", () => {
  it("shares a pending capture and commits it once", async () => {
    const cache = new NativeCaptureCache<string>();
    const pending = deferred<string>();
    const capture = vi.fn(() => pending.promise);
    const commit = vi.fn();
    const discard = vi.fn();
    const first = cache.read(capture, commit, discard);
    const second = cache.read(capture, commit, discard);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(capture).toHaveBeenCalledTimes(1);
    pending.resolve("pixels");
    expect(await first).toBe("pixels");
    expect(await cache.read(capture, commit, discard)).toBe("pixels");
    expect(commit).toHaveBeenCalledExactlyOnceWith("pixels");
    expect(discard).not.toHaveBeenCalled();
  });

  it("rejects a capture invalidated while pending without installing stale pixels", async () => {
    const cache = new NativeCaptureCache<string>();
    const pending = deferred<string>();
    const commit = vi.fn();
    const discard = vi.fn();
    const stale = cache.read(() => pending.promise, commit, discard);
    await Promise.resolve();
    const rejected = expect(stale).rejects.toMatchObject({
      code: "source-capture-stale",
    });
    cache.invalidate();
    await rejected;
    pending.resolve("old pixels");
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledExactlyOnceWith("old pixels");
    expect(await cache.read(async () => "new pixels", commit, discard)).toBe(
      "new pixels",
    );
    expect(commit).toHaveBeenCalledExactlyOnceWith("new pixels");
  });

  it("retains an unchanged typed failure and retries only after invalidation", async () => {
    const cache = new NativeCaptureCache<string>();
    const error = new TypeError("font unavailable");
    const capture = vi.fn(async () => {
      if (capture.mock.calls.length === 1) throw error;
      return "font pixels";
    });
    const commit = vi.fn();
    const discard = vi.fn();
    await expect(cache.read(capture, commit, discard)).rejects.toBe(error);
    for (let frame = 0; frame < 10; frame++)
      await expect(cache.read(capture, commit, discard)).rejects.toBe(error);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    cache.invalidate();
    expect(await cache.read(capture, commit, discard)).toBe("font pixels");
    expect(capture).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledExactlyOnceWith("font pixels");
  });

  it("does not start a capture invalidated before its microtask", async () => {
    const cache = new NativeCaptureCache<string>();
    const capture = vi.fn(async () => "old pixels");
    const stale = cache.read(capture, vi.fn(), vi.fn());
    const rejected = expect(stale).rejects.toMatchObject({
      code: "source-capture-stale",
    });
    cache.invalidate();
    await rejected;
    await Promise.resolve();
    expect(capture).not.toHaveBeenCalled();
  });

  it("drains one active factory and starts only the latest queued revision", async () => {
    const cache = new NativeCaptureCache<string>();
    const firstPaint = deferred<string>();
    let running = 0;
    let maxRunning = 0;
    const capture = vi.fn(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      try {
        return capture.mock.calls.length === 1
          ? await firstPaint.promise
          : "latest pixels";
      } finally {
        running--;
      }
    });
    const commit = vi.fn();
    const discard = vi.fn();
    const first = cache.read(capture, commit, discard);
    await Promise.resolve();
    expect(capture).toHaveBeenCalledTimes(1);
    const staleChecks = [
      expect(first).rejects.toMatchObject({ code: "source-capture-stale" }),
    ];
    let latest: Promise<string> | null = null;
    for (let revision = 0; revision < 20; revision++) {
      if (latest)
        staleChecks.push(
          expect(latest).rejects.toMatchObject({
            code: "source-capture-stale",
          }),
        );
      cache.invalidate();
      latest = cache.read(capture, commit, discard);
    }
    expect(capture).toHaveBeenCalledTimes(1);
    firstPaint.resolve("stale pixels");
    await Promise.all(staleChecks);
    expect(await latest).toBe("latest pixels");
    expect(capture).toHaveBeenCalledTimes(2);
    expect(maxRunning).toBe(1);
    expect(discard).toHaveBeenCalledExactlyOnceWith("stale pixels");
    expect(commit).toHaveBeenCalledExactlyOnceWith("latest pixels");
  });

  it("rejects on disposal and fences an already started capture", async () => {
    const cache = new NativeCaptureCache<string>();
    const pending = deferred<string>();
    const commit = vi.fn();
    const discard = vi.fn();
    const stale = cache.read(() => pending.promise, commit, discard);
    await Promise.resolve();
    const rejected = expect(stale).rejects.toMatchObject({
      code: "source-disposed",
    });
    cache.dispose();
    await rejected;
    pending.resolve("old pixels");
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledExactlyOnceWith("old pixels");
    await expect(
      cache.read(async () => "wrong", commit, discard),
    ).rejects.toMatchObject({
      code: "source-disposed",
    });
  });
});
