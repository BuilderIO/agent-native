import { describe, expect, it, vi } from "vitest";

import { createLatestWriteQueue } from "./latest-write-queue";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("createLatestWriteQueue", () => {
  it("serializes an older write and coalesces queued values to the latest intent", async () => {
    const mobile = deferred();
    const tablet = deferred();
    const calls: string[] = [];
    const queue = createLatestWriteQueue(async (value: string) => {
      calls.push(value);
      await (value === "mobile" ? mobile.promise : tablet.promise);
    });

    queue.enqueue("mobile");
    queue.enqueue("tablet-cascade");
    queue.enqueue("tablet-only");
    expect(calls).toEqual(["mobile"]);
    expect(queue.hasPending()).toBe(true);

    mobile.resolve();
    await vi.waitFor(() => expect(calls).toEqual(["mobile", "tablet-only"]));
    tablet.resolve();
    await queue.whenIdle();

    expect(queue.hasPending()).toBe(false);
    expect(calls).toEqual(["mobile", "tablet-only"]);
  });

  it("continues with the latest queued intent after a rejected write", async () => {
    const first = deferred();
    const writes = vi.fn(async (value: string) => {
      if (value === "mobile") await first.promise;
    });
    const onError = vi.fn();
    const queue = createLatestWriteQueue(writes, onError);

    queue.enqueue("mobile");
    queue.enqueue("tablet-only");
    first.reject(new Error("offline"));
    await queue.whenIdle();

    expect(writes.mock.calls.map(([value]) => value)).toEqual([
      "mobile",
      "tablet-only",
    ]);
    expect(onError).toHaveBeenCalledOnce();
    expect(queue.hasPending()).toBe(false);
  });
});
