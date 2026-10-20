import { describe, expect, it, vi } from "vitest";

import { runRuntimeZoomAttempt } from "./_runtime-budget-zoom-attempt";
import type {
  ZoomSnapshot,
  ZoomSnapshotRead,
} from "./_runtime-budget-zoom-snapshot";
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

describe("runtime zoom attempt diagnostics", () => {
  function io(read: () => Promise<ZoomSnapshotRead>) {
    let clock = 0;
    return {
      read: vi.fn(read),
      apply: vi.fn(async (deadline: number) => {
        expect(deadline).toBe(10_000);
      }),
      wait: vi.fn(async (ms: number) => {
        clock += ms;
      }),
      cleanup: vi.fn(async () => {}),
      now: () => clock,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  it("retains an unreadable baseline's typed fiber reason in the result artifact", async () => {
    const failure: ZoomSnapshotRead = {
      status: "error",
      reason: "fiber-path-unreadable",
      paths: [{ branch: "host", reason: "path-disconnected" }],
    };
    const ports = io(async () => failure);
    const result = await runRuntimeZoomAttempt(60, ports);
    const artifact = JSON.parse(JSON.stringify({ zoomMeasurements: [result] }));
    expect(result.arrived).toBe(false);
    expect(artifact.zoomMeasurements[0].before).toEqual(failure);
    expect(artifact.zoomMeasurements[0].error).toEqual({
      phase: "baseline",
      reason: "snapshot-error",
      snapshotError: failure,
    });
    expect(ports.apply).not.toHaveBeenCalled();
    expect(ports.wait).not.toHaveBeenCalled();
  });

  it("retains a rejected settle read even after the camera was previously readable", async () => {
    const ports = io(
      vi
        .fn<() => Promise<ZoomSnapshotRead>>()
        .mockResolvedValueOnce({ status: "available", snapshot: snapshot() })
        .mockRejectedValueOnce(new Error("CDP read rejected")),
    );
    const result = await runRuntimeZoomAttempt(60, ports);
    const artifact = JSON.parse(JSON.stringify({ zoomMeasurements: [result] }));
    const failure = {
      status: "error",
      reason: "snapshot-read-failed",
      message: "Error: CDP read rejected",
    };
    expect(result.arrived).toBe(false);
    expect(artifact.zoomMeasurements[0].before.status).toBe("available");
    expect(artifact.zoomMeasurements[0].final).toEqual(failure);
    expect(artifact.zoomMeasurements[0].error).toEqual({
      phase: "settle",
      reason: "snapshot-error",
      snapshotError: failure,
    });
    expect(ports.apply).toHaveBeenCalledOnce();
  });

  it("retries legitimate unavailable states and then applies the requested zoom", async () => {
    const ports = io(
      vi
        .fn<() => Promise<ZoomSnapshotRead>>()
        .mockResolvedValueOnce({
          status: "unavailable",
          reason: "world-absent",
        })
        .mockResolvedValueOnce({
          status: "unavailable",
          reason: "active-screen-unresolved",
          activeId: null,
        })
        .mockResolvedValue({ status: "available", snapshot: snapshot() }),
    );
    const result = await runRuntimeZoomAttempt(60, ports);
    expect(result.arrived).toBe(true);
    expect(result.error).toBeNull();
    expect(result.elapsedMs).toBe(500);
    expect(ports.apply).toHaveBeenCalledOnce();
    expect(ports.wait.mock.calls).toEqual([[250], [250]]);
  });

  it("retains the unavailable reason when the baseline exhausts its unchanged deadline", async () => {
    const unavailable: ZoomSnapshotRead = {
      status: "unavailable",
      reason: "world-absent",
    };
    const ports = io(async () => unavailable);
    const result = await runRuntimeZoomAttempt(60, ports);
    expect(result.before).toEqual(unavailable);
    expect(result.error).toEqual({
      phase: "baseline",
      reason: "deadline-exceeded",
    });
    expect(result.arrived).toBe(false);
    expect(result.elapsedMs).toBe(10_000);
    expect(ports.read).toHaveBeenCalledTimes(40);
    expect(ports.apply).not.toHaveBeenCalled();
  });

  it("does not reset the deadline between baseline, apply and settle", async () => {
    const unavailable: ZoomSnapshotRead = {
      status: "unavailable",
      reason: "active-screen-unresolved",
      activeId: null,
    };
    const ports = io(
      vi
        .fn<() => Promise<ZoomSnapshotRead>>()
        .mockResolvedValueOnce({ status: "available", snapshot: snapshot() })
        .mockResolvedValue(unavailable),
    );
    ports.apply.mockImplementationOnce(async () => {
      ports.advance(9_000);
    });
    const result = await runRuntimeZoomAttempt(60, ports);
    expect(result.final).toEqual(unavailable);
    expect(result.error).toEqual({
      phase: "settle",
      reason: "deadline-exceeded",
    });
    expect(result.elapsedMs).toBe(10_000);
    expect(ports.wait).toHaveBeenCalledTimes(4);
    expect(ports.read).toHaveBeenCalledTimes(5);
  });

  it("still refuses a genuinely unapplied camera for all 40 settle polls", async () => {
    const unchanged = snapshot({
      camera: {
        sampleRevision: 1,
        scale: 4 / 1.125,
        transform: `scale(${0.04 / 1.125})`,
      },
    });
    const ports = io(async () => ({
      status: "available",
      snapshot: unchanged,
    }));
    const result = await runRuntimeZoomAttempt(60, ports);
    expect(result.arrived).toBe(false);
    expect(result.finalMeasurement.failedChecks).toEqual([
      "camera",
      "committedCamera",
    ]);
    expect(result.elapsedMs).toBe(10_000);
    expect(ports.read).toHaveBeenCalledTimes(41);
    expect(ports.wait).toHaveBeenCalledTimes(40);
  });

  it("records an apply failure without losing the baseline", async () => {
    const ports = io(async () => ({
      status: "available",
      snapshot: snapshot(),
    }));
    ports.apply.mockRejectedValueOnce(new Error("zoom input detached"));
    const result = await runRuntimeZoomAttempt(60, ports);
    expect(result.before?.status).toBe("available");
    expect(result.final).toBeNull();
    expect(result.arrived).toBe(false);
    expect(result.error).toEqual({
      phase: "apply",
      reason: "attempt-failed",
      message: "Error: zoom input detached",
    });
  });

  it("keeps timeout cleanup and a rejected pending read visible in the artifact", async () => {
    vi.useFakeTimers();
    try {
      let rejectRead!: (cause: Error) => void;
      const read = vi
        .fn<() => Promise<ZoomSnapshotRead>>()
        .mockResolvedValueOnce({ status: "available", snapshot: snapshot() })
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectRead = reject;
            }),
        );
      const cleanup = vi.fn(async () => {
        rejectRead(new Error("read terminated at deadline"));
      });
      const pending = runRuntimeZoomAttempt(60, {
        read,
        apply: async () => {},
        wait: async () => {},
        cleanup,
      });
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;
      expect(result.arrived).toBe(false);
      expect(result.elapsedMs).toBe(10_000);
      expect(result.error).toEqual({
        phase: "settle",
        reason: "deadline-exceeded",
      });
      expect(result.final).toEqual({
        status: "error",
        reason: "snapshot-read-failed",
        message: "Error: read terminated at deadline",
      });
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("records an unresolved read at the deadline even if it rejects after the artifact is returned", async () => {
    vi.useFakeTimers();
    try {
      let rejectRead!: (cause: Error) => void;
      const read = vi
        .fn<() => Promise<ZoomSnapshotRead>>()
        .mockResolvedValueOnce({ status: "available", snapshot: snapshot() })
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectRead = reject;
            }),
        );
      const cleanup = vi.fn(async () => {});
      const pending = runRuntimeZoomAttempt(60, {
        read,
        apply: async () => {},
        wait: async () => {},
        cleanup,
      });
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;
      const artifact = JSON.stringify(result);
      expect(result.arrived).toBe(false);
      expect(result.elapsedMs).toBe(10_000);
      expect(result.error).toEqual({
        phase: "settle",
        reason: "deadline-exceeded",
      });
      expect(result.final).toEqual({
        status: "error",
        reason: "snapshot-read-timed-out",
      });
      rejectRead(new Error("late CDP rejection"));
      await vi.advanceTimersByTimeAsync(0);
      expect(JSON.stringify(result)).toBe(artifact);
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a correct camera read that completes after the deadline before the host timer runs", async () => {
    const ports = io(async () => ({
      status: "available",
      snapshot: snapshot(),
    }));
    ports.apply.mockImplementationOnce(async () => {
      ports.advance(9_999);
    });
    ports.read
      .mockImplementationOnce(async () => ({
        status: "available",
        snapshot: snapshot(),
      }))
      .mockImplementationOnce(async () => {
        ports.advance(2);
        return { status: "available", snapshot: snapshot() };
      });
    const result = await runRuntimeZoomAttempt(60, ports);
    expect(result.arrived).toBe(false);
    expect(result.elapsedMs).toBe(10_001);
    expect(result.error).toEqual({
      phase: "settle",
      reason: "deadline-exceeded",
    });
    expect(result.finalMeasurement.failedChecks).toEqual([]);
  });
});

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
