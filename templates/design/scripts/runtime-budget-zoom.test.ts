import { describe, expect, it } from "vitest";

import type { ZoomSnapshot } from "./runtime-budget-zoom-snapshot";
import {
  expectedCanvasScaleAtZoomPercent,
  measureRuntimeZoom,
  readZoomUntilAvailable,
  waitForAnimationFrame,
} from "./runtime-budget-zoom.ts";

function snapshot(overrides: Partial<ZoomSnapshot> = {}): ZoomSnapshot {
  return {
    sampledAt: 0,
    sampleRevision: 1,
    renderRevision: 1,
    committedCanvasScale: 60 / 1.125,
    camera: {
      sampleRevision: 1,
      scale: 60 / 1.125,
      transform: `scale(${0.6 / 1.125})`,
    },
    basis: {
      sampleRevision: 1,
      screenId: "screen-a",
      frameWidth: 1440,
      sourceWidth: 1280,
      scale: 1.125,
    },
    routeZoom: 60,
    label: "60%",
    ...overrides,
  };
}

describe("runtime zoom measurement contract", () => {
  it("accepts exact display 60% independently of a fractional low-zoom route baseline", () => {
    const before = snapshot({
      committedCanvasScale: 2.334 / 1.125,
      routeZoom: 2.33,
      label: "2%",
    });
    const expected = measureRuntimeZoom(before, 60).expectedScale!;
    const oldExpected = (before.committedCanvasScale * 60) / before.routeZoom!;
    expect(Math.abs(oldExpected - expected)).toBeGreaterThan(
      Math.max(0.005, oldExpected * 0.001),
    );
    expect(expected).toBeCloseTo(53.333333333333336, 12);
    expect(measureRuntimeZoom(snapshot(), 60).failedChecks).toEqual([]);
  });

  it("waits for delayed route synchronization without changing the camera expectation", async () => {
    let now = 0;
    const samples = [
      snapshot({ routeZoom: 8 }),
      snapshot({ routeZoom: 4 }),
      snapshot(),
    ];
    const actual = await readZoomUntilAvailable(
      async () => {
        const sample = samples.shift()!;
        const result = measureRuntimeZoom(sample, 60);
        expect(result.expectedScale).toBe(60 / 1.125);
        return result.failedChecks.length ? null : sample.camera.scale;
      },
      async (ms) => {
        now += ms;
      },
      10_000,
      async () => {},
      () => now,
    );
    expect(actual).toBe(60 / 1.125);
    expect(now).toBe(500);
  });

  it("fails an unapplied camera for the entire unchanged deadline despite a correct route and label", async () => {
    let now = 0;
    let reads = 0;
    const sample = snapshot({
      camera: {
        sampleRevision: 1,
        scale: 4 / 1.125,
        transform: `scale(${0.04 / 1.125})`,
      },
    });
    expect(measureRuntimeZoom(sample, 60).failedChecks).toEqual([
      "camera",
      "committedCamera",
    ]);
    const actual = await readZoomUntilAvailable(
      async () => {
        reads++;
        return measureRuntimeZoom(sample, 60).failedChecks.length
          ? null
          : sample.camera.scale;
      },
      async (ms) => {
        now += ms;
      },
      10_000,
      async () => {},
      () => now,
    );
    expect(actual).toBeNull();
    expect(reads).toBe(40);
    expect(now).toBe(10_000);
  });

  it("uses the final normalization basis after a basis change", () => {
    const next = snapshot({
      sampleRevision: 2,
      committedCanvasScale: 100,
      camera: { sampleRevision: 2, scale: 100, transform: "scale(1)" },
      basis: {
        sampleRevision: 2,
        screenId: "screen-b",
        frameWidth: 768,
        sourceWidth: 1280,
        scale: 0.6,
      },
    });
    expect(measureRuntimeZoom(next, 60).failedChecks).toEqual([]);
    expect(
      measureRuntimeZoom({ ...next, camera: snapshot().camera }, 60)
        .failedChecks,
    ).toEqual(["sampleRevision", "camera", "committedCamera"]);
    expect(
      measureRuntimeZoom({ ...next, basis: snapshot().basis }, 60).failedChecks,
    ).toEqual(["sampleRevision", "camera"]);
  });

  it("keeps route and toolbar as independent failure conjuncts", () => {
    expect(
      measureRuntimeZoom(snapshot({ routeZoom: 8 }), 60).failedChecks,
    ).toEqual(["route"]);
    expect(
      measureRuntimeZoom(snapshot({ label: "8%" }), 60).failedChecks,
    ).toEqual(["toolbar"]);
    expect(measureRuntimeZoom(null, 60).failedChecks).toContain("available");
  });
});

describe("runtime budget zoom waits", () => {
  it("scales the canvas transform with the displayed zoom on overview boards", () => {
    expect(expectedCanvasScaleAtZoomPercent(1.125, 13)).toBeCloseTo(
      11.5555555556,
    );
  });

  it("rejects unavailable or invalid zoom measurements", () => {
    expect(expectedCanvasScaleAtZoomPercent(null, 13)).toBeNull();
    expect(expectedCanvasScaleAtZoomPercent(0, 13)).toBeNull();
  });

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
