import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
      () => now,
    );

    assert.equal(zoom, 42);
    assert.deepEqual(waits, [250]);
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
      () => now,
    );

    assert.equal(zoom, null);
    assert.equal(reads, 2);
    assert.deepEqual(waits, [250, 250]);
  });

  it("bounds a stalled animation-frame wait", async () => {
    const startedAt = Date.now();
    const frameArrived = await waitForAnimationFrame(
      () => new Promise<void>(() => {}),
      25,
    );

    assert.equal(frameArrived, false);
    assert.ok(Date.now() - startedAt < 1_000);
  });

  it("resolves as soon as the animation-frame callback arrives", async () => {
    const frameArrived = await waitForAnimationFrame(
      () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
      1_000,
    );

    assert.equal(frameArrived, true);
  });
});
