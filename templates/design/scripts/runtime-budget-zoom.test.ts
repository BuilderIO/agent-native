import { describe, expect, it } from "vitest";

import {
  readZoomUntilAvailable,
  waitForAnimationFrame,
} from "./runtime-budget-zoom.ts";

describe("runtime budget zoom waits", () => {
  it("retries an unreadable zoom before its deadline", async () => {
    let now = 0;
    const reads: (number | null)[] = [null, 42];
    const waits: number[] = [];

    const zoom = await readZoomUntilAvailable(
      async () => reads.shift() ?? null,
      async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
      1_000,
      async () => {},
      () => now,
    );

    expect(zoom).toBe(42);
    expect(waits).toEqual([250]);
  });

  it("stops retrying unreadable zoom at the deadline", async () => {
    let now = 0;
    let reads = 0;
    const waits: number[] = [];

    const zoom = await readZoomUntilAvailable(
      async () => {
        reads += 1;
        return null;
      },
      async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
      500,
      async () => {},
      () => now,
    );

    expect(zoom).toBeNull();
    expect(reads).toBe(2);
    expect(waits).toEqual([250, 250]);
  });

  it("cleans up a stalled zoom read when its deadline wins", async () => {
    let resolveRead!: (value: number | null) => void;
    let settled = false;
    let cleanedUp = false;

    const zoom = await readZoomUntilAvailable(
      () =>
        new Promise<number | null>((resolve) => {
          resolveRead = resolve;
        }).finally(() => {
          settled = true;
        }),
      async () => {},
      Date.now() + 25,
      async () => {
        cleanedUp = true;
        resolveRead(null);
      },
    );
    await Promise.resolve();

    expect(zoom).toBeNull();
    expect(cleanedUp).toBe(true);
    expect(settled).toBe(true);
  });

  it("cleans up a stalled animation-frame wait", async () => {
    const startedAt = Date.now();
    let resolveFrame!: () => void;
    let cleanedUp = false;
    const frameArrived = await waitForAnimationFrame(
      () =>
        new Promise<void>((resolve) => {
          resolveFrame = resolve;
        }),
      25,
      async () => {
        cleanedUp = true;
        resolveFrame();
      },
    );

    expect(frameArrived).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(cleanedUp).toBe(true);
  });

  it("resolves as soon as the animation-frame callback arrives", async () => {
    const frameArrived = await waitForAnimationFrame(
      () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
      1_000,
      async () => {},
    );

    expect(frameArrived).toBe(true);
  });
});
