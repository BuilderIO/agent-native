import { describe, expect, it, vi } from "vitest";

import {
  NativePipelineCache,
  NativePipelineCacheInvalidatedError,
} from "./native-pipeline-cache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("NativePipelineCache", () => {
  it("shares one pending factory and retains its successful result", async () => {
    const cache = new NativePipelineCache<object>();
    const pending = deferred<object>();
    const factory = vi.fn(() => pending.promise);
    const first = cache.getOrCreate(
      "shader/layout/format/blend/device-1",
      factory,
    );
    const second = cache.getOrCreate(
      "shader/layout/format/blend/device-1",
      factory,
    );
    expect(second).toBe(first);
    expect(cache.has("shader/layout/format/blend/device-1")).toBe(true);
    await Promise.resolve();
    expect(factory).toHaveBeenCalledTimes(1);
    const pipeline = {};
    pending.resolve(pipeline);
    expect(await first).toBe(pipeline);
    expect(
      await cache.getOrCreate("shader/layout/format/blend/device-1", factory),
    ).toBe(pipeline);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("retains the original compiler failure without retrying every frame", async () => {
    const cache = new NativePipelineCache<object>();
    const error = new TypeError("WGSL compilation failed at line 4");
    const factory = vi.fn(async () => {
      throw error;
    });
    const first = cache.getOrCreate("bad-shader/device-1", factory);
    await expect(first).rejects.toBe(error);
    for (let frame = 0; frame < 10; frame++)
      await expect(
        cache.getOrCreate("bad-shader/device-1", factory),
      ).rejects.toBe(error);
    expect(factory).toHaveBeenCalledTimes(1);
    cache.reset();
    await expect(
      cache.getOrCreate("bad-shader/device-1", factory),
    ).rejects.toBe(error);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("retries only after the exact key changes or a reset", async () => {
    const cache = new NativePipelineCache<number>();
    const factory = vi.fn(async () => factory.mock.calls.length);
    expect(await cache.getOrCreate("shader/device-1", factory)).toBe(1);
    expect(await cache.getOrCreate("shader/device-1", factory)).toBe(1);
    expect(await cache.getOrCreate("shader/device-2", factory)).toBe(2);
    cache.reset();
    expect(cache.size).toBe(0);
    expect(cache.has("shader/device-2")).toBe(false);
    expect(await cache.getOrCreate("shader/device-2", factory)).toBe(3);
  });

  it("bounds entries and evicts the least recently used key", async () => {
    const cache = new NativePipelineCache<string>(2);
    const factory = vi.fn(async (key: string) => key);
    await cache.getOrCreate("a", () => factory("a"));
    await cache.getOrCreate("b", () => factory("b"));
    await cache.getOrCreate("a", () => factory("a"));
    await cache.getOrCreate("c", () => factory("c"));
    expect(cache.size).toBe(2);
    await cache.getOrCreate("a", () => factory("a"));
    expect(factory).toHaveBeenCalledTimes(3);
    await cache.getOrCreate("b", () => factory("b"));
    expect(factory).toHaveBeenCalledTimes(4);
  });

  it("rejects pending waiters on reset and fences late compiler completion", async () => {
    const cache = new NativePipelineCache<string>();
    const pending = deferred<string>();
    const stale = cache.getOrCreate("shader/device-1", () => pending.promise);
    await Promise.resolve();
    const rejected = expect(stale).rejects.toMatchObject({
      code: "native_pipeline_cache_invalidated",
      reason: "reset",
    });
    cache.reset();
    await rejected;
    pending.resolve("stale pipeline");
    await Promise.resolve();
    expect(cache.size).toBe(0);
    expect(
      await cache.getOrCreate("shader/device-1", async () => "fresh pipeline"),
    ).toBe("fresh pipeline");
  });

  it("invalidates an evicted pending entry rather than exposing a stale pipeline", async () => {
    const cache = new NativePipelineCache<string>(1);
    const pending = deferred<string>();
    const stale = cache.getOrCreate("a", () => pending.promise);
    await Promise.resolve();
    const rejected = expect(stale).rejects.toBeInstanceOf(
      NativePipelineCacheInvalidatedError,
    );
    expect(await cache.getOrCreate("b", async () => "b")).toBe("b");
    await rejected;
    pending.resolve("a");
    await Promise.resolve();
    expect(cache.size).toBe(1);
    expect(await cache.getOrCreate("b", async () => "wrong")).toBe("b");
  });

  it("does not start a compiler factory after a synchronous reset", async () => {
    const cache = new NativePipelineCache<string>();
    const factory = vi.fn(async () => "stale");
    const stale = cache.getOrCreate("shader/device-1", factory);
    const rejected = expect(stale).rejects.toMatchObject({
      code: "native_pipeline_cache_invalidated",
      reason: "reset",
    });
    cache.reset();
    await rejected;
    await Promise.resolve();
    expect(factory).not.toHaveBeenCalled();
    expect(await cache.getOrCreate("shader/device-1", factory)).toBe("stale");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("does not start an evicted compiler factory before its microtask", async () => {
    const cache = new NativePipelineCache<string>(1);
    const firstFactory = vi.fn(async () => "stale");
    const secondFactory = vi.fn(async () => "current");
    const stale = cache.getOrCreate("a", firstFactory);
    const rejected = expect(stale).rejects.toMatchObject({
      code: "native_pipeline_cache_invalidated",
      reason: "evicted",
    });
    const current = cache.getOrCreate("b", secondFactory);
    await rejected;
    expect(await current).toBe("current");
    expect(firstFactory).not.toHaveBeenCalled();
    expect(secondFactory).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid cache bounds", () => {
    expect(() => new NativePipelineCache(0)).toThrow(RangeError);
    expect(() => new NativePipelineCache(Number.NaN)).toThrow(RangeError);
    expect(() => new NativePipelineCache(257)).toThrow(RangeError);
  });
});
