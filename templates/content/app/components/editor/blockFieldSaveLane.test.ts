import { describe, expect, it } from "vitest";
import { activeLaneCount, enqueueFieldSave } from "./blockFieldSaveLane";

// A deferred we can resolve/reject by hand to control settle order.
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("blockFieldSaveLane", () => {
  it("runs same-key tasks strictly in issue order, one at a time", async () => {
    const started: string[] = [];
    const finished: string[] = [];
    const dA = deferred();
    const dB = deferred();

    // A is enqueued first (e.g. the old instance's unmount flush), then B (the
    // new instance's edit) — both for the SAME field key.
    const pA = enqueueFieldSave("doc:field", () => {
      started.push("A");
      return dA.promise.then(() => {
        finished.push("A");
      });
    });
    const pB = enqueueFieldSave("doc:field", () => {
      started.push("B");
      return dB.promise.then(() => {
        finished.push("B");
      });
    });

    // Only A has started; B must wait for A to settle (no overlap).
    await Promise.resolve();
    expect(started).toEqual(["A"]);

    // Resolve A → B is allowed to start, never before.
    dA.resolve();
    await pA;
    expect(started).toEqual(["A", "B"]);
    expect(finished).toEqual(["A"]);

    dB.resolve();
    await pB;
    // The server saw A before B — issue order preserved, B (newest) wins last.
    expect(finished).toEqual(["A", "B"]);
  });

  it("a rejected task does not poison the lane; later same-key tasks still run", async () => {
    const ran: string[] = [];

    const failing = enqueueFieldSave("k", () => {
      ran.push("fail");
      return Promise.reject(new Error("boom"));
    });
    const next = enqueueFieldSave("k", () => {
      ran.push("next");
      return Promise.resolve();
    });

    // The failing task's promise still rejects (so the caller can stay dirty).
    await expect(failing).rejects.toThrow("boom");
    // But the lane kept going: the next save for the key ran AFTER it.
    await next;
    expect(ran).toEqual(["fail", "next"]);
  });

  it("different keys do not serialize against each other (no cross-key stall)", async () => {
    const started: string[] = [];
    const dK1 = deferred();

    // K1's task blocks indefinitely (resolver not called yet).
    const p1 = enqueueFieldSave("k1", () => {
      started.push("k1");
      return dK1.promise;
    });
    // K2 must run immediately despite K1 being stuck — independent lanes.
    const p2 = enqueueFieldSave("k2", () => {
      started.push("k2");
      return Promise.resolve();
    });

    await p2;
    expect(started).toContain("k2");

    dK1.resolve();
    await p1;
  });

  it("cleans up the lane entry once a key's chain settles (no leak)", async () => {
    await enqueueFieldSave("ephemeral", () => Promise.resolve());
    // Allow the post-settle cleanup microtask to run.
    await Promise.resolve();
    await Promise.resolve();
    expect(activeLaneCount()).toBe(0);
  });
});
