import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetPreviewSaveLanes,
  activeLaneCount,
  enqueuePreviewSave,
} from "./previewSaveLane";

beforeEach(() => __resetPreviewSaveLanes());
afterEach(() => __resetPreviewSaveLanes());

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("previewSaveLane", () => {
  it("serializes saves for the SAME key in enqueue order", async () => {
    const order: string[] = [];
    const gates: Array<() => void> = [];
    const run = (label: string) => () =>
      new Promise<void>((resolve) =>
        gates.push(() => {
          order.push(label);
          resolve();
        }),
      );

    const a = enqueuePreviewSave("k", run("a"));
    const b = enqueuePreviewSave("k", run("b"));
    const c = enqueuePreviewSave("k", run("c"));

    // Only the first has started (serialized): release in order.
    await tick();
    expect(gates).toHaveLength(1);
    gates[0]();
    await a;
    await tick();
    expect(gates).toHaveLength(2);
    gates[1]();
    await b;
    await tick();
    expect(gates).toHaveLength(3);
    gates[2]();
    await c;

    expect(order).toEqual(["a", "b", "c"]);
  });

  it("runs saves for DIFFERENT keys independently (no head-of-line blocking)", async () => {
    const order: string[] = [];
    let resolveX!: () => void;
    const x = enqueuePreviewSave(
      "x",
      () =>
        new Promise<void>((resolve) => {
          resolveX = () => {
            order.push("x");
            resolve();
          };
        }),
    );
    const y = enqueuePreviewSave("y", () => {
      order.push("y");
      return Promise.resolve();
    });

    // y completes even though x is still blocked — independent lanes.
    await y;
    expect(order).toEqual(["y"]);
    resolveX();
    await x;
    expect(order).toEqual(["y", "x"]);
  });

  it("a rejected save does not wedge the lane; later saves for the key still run", async () => {
    const order: string[] = [];
    const failing = enqueuePreviewSave("k", () =>
      Promise.reject(new Error("boom")),
    );
    const next = enqueuePreviewSave("k", () => {
      order.push("next");
      return Promise.resolve();
    });

    await expect(failing).rejects.toThrow("boom");
    await next;
    expect(order).toEqual(["next"]);
  });

  it("surfaces the failure to the issuing caller", async () => {
    await expect(
      enqueuePreviewSave("k", () => Promise.reject(new Error("nope"))),
    ).rejects.toThrow("nope");
  });

  it("drops idle lanes so the registry does not grow unbounded", async () => {
    await enqueuePreviewSave("k1", () => Promise.resolve());
    await enqueuePreviewSave("k2", () => Promise.resolve());
    await tick();
    expect(activeLaneCount()).toBe(0);
  });
});
