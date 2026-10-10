import { describe, expect, it } from "vitest";

import {
  NativeDeviceLifecycle,
  NativeDeviceLifecycleError,
} from "./native-device-lifecycle";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe("NativeDeviceLifecycle", () => {
  it("shares one in-flight initialization and commits one resource", async () => {
    const start = deferred<object>();
    let calls = 0;
    const lifecycle = new NativeDeviceLifecycle(async () => {
      calls += 1;
      return start.promise;
    });
    const first = lifecycle.acquire();
    const second = lifecycle.acquire();
    expect(first).toBe(second);
    start.resolve({ device: true });
    expect(await first).toEqual({ device: true });
    expect(await lifecycle.acquire()).toEqual({ device: true });
    expect(calls).toBe(1);
  });

  it("cleans partial initialization and backs off before a bounded retry", async () => {
    let now = 0;
    let cleaned = 0;
    let calls = 0;
    const lifecycle = new NativeDeviceLifecycle(
      async (scope) => {
        calls += 1;
        scope.own(() => {
          cleaned += 1;
        });
        throw new Error("adapter-refused");
      },
      () => now,
      2,
      500,
    );
    await expect(lifecycle.acquire()).rejects.toThrow("adapter-refused");
    expect(cleaned).toBe(1);
    await expect(lifecycle.acquire()).rejects.toMatchObject({
      code: "device-backoff",
    });
    now = 500;
    await expect(lifecycle.acquire()).rejects.toThrow("adapter-refused");
    expect(calls).toBe(2);
    expect(cleaned).toBe(2);
    await expect(lifecycle.acquire()).rejects.toMatchObject({
      code: "device-attempts-exhausted",
    });
    lifecycle.reset();
    now = 0;
    await expect(lifecycle.acquire()).rejects.toThrow("adapter-refused");
    expect(calls).toBe(3);
  });

  it("disposes a late device instead of publishing it", async () => {
    const start = deferred<object>();
    let cleaned = 0;
    const lifecycle = new NativeDeviceLifecycle(async (scope) => {
      scope.own(() => {
        cleaned += 1;
      });
      return start.promise;
    });
    const pending = lifecycle.acquire();
    await Promise.resolve();
    lifecycle.dispose();
    expect(cleaned).toBe(1);
    start.resolve({ device: true });
    await expect(pending).rejects.toMatchObject({ code: "device-disposed" });
    expect(cleaned).toBe(1);
    await expect(lifecycle.acquire()).rejects.toBeInstanceOf(
      NativeDeviceLifecycleError,
    );
  });

  it("invalidates an old pending generation on explicit reset", async () => {
    const old = deferred<object>();
    let cleaned = 0;
    let calls = 0;
    const lifecycle = new NativeDeviceLifecycle(async (scope) => {
      calls += 1;
      scope.own(() => {
        cleaned += 1;
      });
      return calls === 1 ? old.promise : { generation: 2 };
    });
    const pending = lifecycle.acquire();
    await Promise.resolve();
    lifecycle.reset();
    expect(cleaned).toBe(1);
    expect(await lifecycle.acquire()).toEqual({ generation: 2 });
    old.resolve({ generation: 1 });
    await expect(pending).rejects.toMatchObject({ code: "device-backoff" });
    expect(cleaned).toBe(1);
  });

  it("cancels the old scope before a late bootstrap can replace a newer owner", async () => {
    const old = deferred<void>();
    let owner = "none";
    let calls = 0;
    const lifecycle = new NativeDeviceLifecycle(async (scope) => {
      calls += 1;
      const id = calls === 1 ? "old" : "new";
      if (id === "old") await old.promise;
      if (!scope.active)
        throw new NativeDeviceLifecycleError("device-disposed");
      scope.own(() => {
        if (owner === id) owner = "none";
      });
      owner = id;
      return id;
    });
    const stale = lifecycle.acquire();
    await Promise.resolve();
    lifecycle.reset();
    expect(await lifecycle.acquire()).toBe("new");
    old.resolve();
    await expect(stale).rejects.toMatchObject({ code: "device-disposed" });
    expect(owner).toBe("new");
  });
});
