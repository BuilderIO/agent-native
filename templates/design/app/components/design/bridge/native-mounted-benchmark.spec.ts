import { describe, expect, it } from "vitest";

import {
  emptyNativeBenchmarkPhaseValues,
  emptyNativeBenchmarkFullFrameValues,
  emptyNativeSourceReadSceneMetrics,
  type NativeBenchmarkFullFrameValues,
  NativeMountedBenchmarkError,
  NativeMountedBenchmarkRun,
  NativeMountedBenchmarkWindowCollector,
  type NativeBenchmarkPhaseValues,
} from "./native-mounted-benchmark";

const request = { warmupRafIntervals: 120, measuredRafIntervals: 840 } as const;

function collect(render = true) {
  const window = new NativeMountedBenchmarkWindowCollector(request);
  for (let index = 0; index <= 960; index += 1) {
    window.onRaf(index * 10, "visible");
    if (render)
      window.onRender({
        renderWallMs: 4,
        sourceWallMs: 1,
        composeWallMs: 2,
        failureCount: 0,
      });
  }
  return window;
}

describe("live mounted benchmark window", () => {
  it("keeps complete frame awaits separate from their nested full-scene phases", () => {
    const window = new NativeMountedBenchmarkWindowCollector(request);
    for (let index = 0; index <= 960; index += 1) {
      window.onRaf(index * 10, "visible");
      window.onRender({
        renderWallMs: 40,
        sourceWallMs: 9,
        composeWallMs: 1,
        fullFrameWallPhases: {
          frame: {
            renderInternalWallMs: 40,
            deviceWallMs: 1,
            mountAwaitWallMs: 15,
            scenePresentationWallMs: 20,
            retirementWallMs: 1,
          },
          scene: {
            sourceReadWallMs: 7,
            composeWallMs: 3,
            encodeWallMs: 1,
            submitWallMs: 1,
            errorScopeWallMs: 6,
            publicationWallMs: 1,
          },
        },
        failureCount: 0,
      });
    }
    const result = window.result();
    expect(result.fullFrameWallPhases?.stats.renderInternalWallMs).toEqual(
      result.renderWallMs,
    );
    expect(result.fullFrameWallPhases?.stats.mountAwaitWallMs).toMatchObject({
      count: 840,
      p95: 15,
    });
    expect(result.fullFrameWallPhases?.stats.scenePresentationWallMs.p95).toBe(
      20,
    );
    expect(
      result.fullFrameWallPhases?.scenePresentation.stats.errorScopeWallMs.p95,
    ).toBe(6);
    expect(result.sourceWallMs.p95).toBe(9);
    expect(result.hostWallPhases).toBeUndefined();
  });

  it("reports bounded readScene calls and nested waits without adding them to frame time", () => {
    const window = new NativeMountedBenchmarkWindowCollector(request);
    for (let index = 0; index <= 960; index += 1) {
      window.onRaf(index * 10, "visible");
      const phases = emptyNativeBenchmarkFullFrameValues();
      phases.frame.renderInternalWallMs = 40;
      phases.frame.mountAwaitWallMs = 15;
      phases.frame.scenePresentationWallMs = 20;
      phases.scene.sourceReadWallMs = 7;
      window.onRender({
        renderWallMs: 40,
        sourceWallMs: 9,
        composeWallMs: 1,
        fullFrameWallPhases: phases,
        sourceReadDetail: {
          ...emptyNativeSourceReadSceneMetrics(),
          calls: 2,
          wallMs: 12,
          walkWallMs: 9,
          validationWallMs: 2,
          leafWaitWallMs: 6,
          scenePresentationCalls: 1,
          mountSourceCalls: 1,
          walkNodeVisits: 7,
          walkDirectStyleReads: 2,
          walkDirectLayoutSizeReads: 4,
          walkDirectAffineReads: 1,
          recordDirectStyleReads: 5,
          recordDirectLayoutSizeReads: 3,
          recordDirectAffineReads: 2,
        },
        failureCount: 0,
      });
    }
    const result = window.result();
    expect(result.sourceReadDetail?.stats.calls).toMatchObject({
      count: 840,
      p95: 2,
    });
    expect(result.sourceReadDetail?.stats.leafWaitWallMs.p95).toBe(6);
    expect(result.sourceReadDetail?.stats.scenePresentationCalls.p95).toBe(1);
    expect(result.sourceReadDetail?.stats.walkNodeVisits.p95).toBe(7);
    expect(result.sourceReadDetail?.stats.recordDirectStyleReads.p95).toBe(5);
    expect(result.fullFrameWallPhases?.stats.renderInternalWallMs.p95).toBe(40);
  });

  it("accepts a full-frame Fill render with no readScene calls and zero source intervals", () => {
    const window = new NativeMountedBenchmarkWindowCollector(request);
    for (let index = 0; index <= 960; index += 1) {
      window.onRaf(index * 10, "visible");
      const phases = emptyNativeBenchmarkFullFrameValues();
      phases.frame.renderInternalWallMs = 4;
      phases.frame.mountAwaitWallMs = 3;
      window.onRender({
        renderWallMs: 4,
        sourceWallMs: 1,
        composeWallMs: 1,
        fullFrameWallPhases: phases,
        sourceReadDetail: {
          ...emptyNativeSourceReadSceneMetrics(),
          calls: 0,
          wallMs: 0,
          walkWallMs: 0,
          validationWallMs: 0,
          leafWaitWallMs: 0,
        },
        failureCount: 0,
      });
    }
    expect(window.result().sourceReadDetail?.stats.calls).toMatchObject({
      count: 840,
      p95: 0,
      max: 0,
    });
  });

  it.each([
    {
      ...emptyNativeSourceReadSceneMetrics(),
      calls: 0,
      wallMs: 1,
      walkWallMs: 1,
      validationWallMs: 0,
      leafWaitWallMs: 0,
    },
    {
      ...emptyNativeSourceReadSceneMetrics(),
      calls: 2,
      wallMs: 1,
      walkWallMs: 0.8,
      validationWallMs: 0.3,
      leafWaitWallMs: 0,
    },
    {
      ...emptyNativeSourceReadSceneMetrics(),
      calls: 2,
      wallMs: 1,
      walkWallMs: 0.5,
      validationWallMs: 0,
      leafWaitWallMs: 0.6,
    },
    {
      ...emptyNativeSourceReadSceneMetrics(),
      calls: 2,
      wallMs: Number.NaN,
      walkWallMs: 0,
      validationWallMs: 0,
      leafWaitWallMs: 0,
    },
    {
      ...emptyNativeSourceReadSceneMetrics(),
      calls: 1025,
      wallMs: 0,
      walkWallMs: 0,
      validationWallMs: 0,
      leafWaitWallMs: 0,
    },
    {
      ...emptyNativeSourceReadSceneMetrics(),
      calls: 0,
      wallMs: 0,
      walkWallMs: 0,
      validationWallMs: 0.01,
      leafWaitWallMs: 0,
    },
    {
      ...emptyNativeSourceReadSceneMetrics(),
      calls: 1,
      wallMs: 0,
      walkWallMs: 0,
      validationWallMs: 0,
      leafWaitWallMs: 0,
      extra: 0,
    },
    Object.assign(Object.create({ walkWallMs: 0 }), {
      ...emptyNativeSourceReadSceneMetrics(),
      calls: 1,
      wallMs: 0,
      validationWallMs: 0,
      leafWaitWallMs: 0,
      extra: 0,
    }),
  ])("rejects invalid readScene details %#", (sourceReadDetail) => {
    const window = new NativeMountedBenchmarkWindowCollector(request);
    for (let index = 0; index <= 120; index += 1)
      window.onRaf(index * 10, "visible");
    const phases = emptyNativeBenchmarkFullFrameValues();
    phases.frame.renderInternalWallMs = 4;
    expect(() =>
      window.onRender({
        renderWallMs: 4,
        sourceWallMs: 0,
        composeWallMs: 0,
        fullFrameWallPhases: phases,
        sourceReadDetail,
        failureCount: 0,
      }),
    ).toThrowError("benchmark-unavailable");
  });

  it.each([
    null,
    false,
    [],
    {},
    { frame: {}, scene: {} },
    {
      ...emptyNativeBenchmarkFullFrameValues(),
      frame: {
        ...emptyNativeBenchmarkFullFrameValues().frame,
        renderInternalWallMs: 4,
      },
      extra: 1,
    },
    {
      frame: {
        ...emptyNativeBenchmarkFullFrameValues().frame,
        renderInternalWallMs: 4,
        mountAwaitWallMs: Number.NaN,
      },
      scene: emptyNativeBenchmarkFullFrameValues().scene,
    },
    {
      frame: {
        ...emptyNativeBenchmarkFullFrameValues().frame,
        renderInternalWallMs: 5,
      },
      scene: emptyNativeBenchmarkFullFrameValues().scene,
    },
    {
      frame: {
        ...emptyNativeBenchmarkFullFrameValues().frame,
        renderInternalWallMs: 4,
        scenePresentationWallMs: 2,
      },
      scene: {
        ...emptyNativeBenchmarkFullFrameValues().scene,
        errorScopeWallMs: 3,
      },
    },
  ])(
    "rejects unreadable, incomplete, or mismatched full-frame phases %#",
    (payload) => {
      const window = new NativeMountedBenchmarkWindowCollector(request);
      for (let index = 0; index <= 120; index += 1)
        window.onRaf(index * 10, "visible");
      expect(() =>
        window.onRender({
          renderWallMs: 4,
          sourceWallMs: 1,
          composeWallMs: 1,
          fullFrameWallPhases:
            payload as unknown as NativeBenchmarkFullFrameValues,
          failureCount: 0,
        }),
      ).toThrowError("benchmark-unavailable");
    },
  );

  it("accepts binary64 adjacent sums without clamping their original samples", () => {
    const window = new NativeMountedBenchmarkWindowCollector(request);
    for (let index = 0; index <= 960; index += 1) {
      window.onRaf(index * 10, "visible");
      const values = emptyNativeBenchmarkFullFrameValues();
      values.frame.renderInternalWallMs = 0.3;
      values.frame.deviceWallMs = 0.2;
      values.frame.scenePresentationWallMs = 0.1;
      values.scene.sourceReadWallMs = 0.1;
      window.onRender({
        renderWallMs: 0.3,
        sourceWallMs: 0,
        composeWallMs: 0,
        fullFrameWallPhases: values,
        failureCount: 0,
      });
    }
    const result = window.result();
    expect(result.fullFrameWallPhases?.stats.deviceWallMs.p95).toBe(0.2);
    expect(result.fullFrameWallPhases?.stats.scenePresentationWallMs.p95).toBe(
      0.1,
    );
    expect(result.renderWallMs.p95).toBe(0.3);
  });

  it.each([
    "frame-overlap",
    "scene-overlap",
    "beyond-rounding",
    "scene-beyond-rounding",
  ])("rejects disjoint interval sum overflow: %s", (caseName) => {
    const values = emptyNativeBenchmarkFullFrameValues();
    values.frame.renderInternalWallMs = caseName.endsWith("rounding") ? 0.3 : 4;
    if (caseName === "frame-overlap") {
      values.frame.deviceWallMs = 3;
      values.frame.mountAwaitWallMs = 3;
    } else if (caseName === "scene-overlap") {
      values.frame.scenePresentationWallMs = 4;
      values.scene.sourceReadWallMs = 3;
      values.scene.errorScopeWallMs = 3;
    } else if (caseName === "beyond-rounding") {
      values.frame.deviceWallMs = 0.200001;
      values.frame.scenePresentationWallMs = 0.1;
    } else {
      values.frame.scenePresentationWallMs = 0.3;
      values.scene.sourceReadWallMs = 0.200001;
      values.scene.errorScopeWallMs = 0.1;
    }
    const window = new NativeMountedBenchmarkWindowCollector(request);
    for (let index = 0; index <= 120; index += 1)
      window.onRaf(index * 10, "visible");
    expect(() =>
      window.onRender({
        renderWallMs: values.frame.renderInternalWallMs,
        sourceWallMs: 0,
        composeWallMs: 0,
        fullFrameWallPhases: values,
        failureCount: 0,
      }),
    ).toThrowError("benchmark-unavailable");
  });

  it("refuses a partial full-frame window and accepts explicit no-scene zero work", () => {
    const window = new NativeMountedBenchmarkWindowCollector(request);
    for (let index = 0; index <= 120; index += 1)
      window.onRaf(index * 10, "visible");
    const values = emptyNativeBenchmarkFullFrameValues();
    values.frame.renderInternalWallMs = 4;
    values.frame.mountAwaitWallMs = 3;
    window.onRender({
      renderWallMs: 4,
      sourceWallMs: 1,
      composeWallMs: 1,
      fullFrameWallPhases: values,
      failureCount: 0,
    });
    expect(() =>
      window.onRender({
        renderWallMs: 4,
        sourceWallMs: 1,
        composeWallMs: 1,
        failureCount: 0,
      }),
    ).toThrowError("benchmark-unavailable");
  });

  it("preserves typed saved-source refusal at the warmup boundary", async () => {
    const run = new NativeMountedBenchmarkRun(
      request,
      new AbortController().signal,
      40_000,
      () => {
        throw new NativeMountedBenchmarkError("benchmark-unpersisted-preview");
      },
    );
    for (let index = 0; index <= 120; index += 1)
      run.onFrame(index * 10, () => "visible");
    await expect(run.done).rejects.toMatchObject({
      code: "benchmark-unpersisted-preview",
    });
  });

  it("excludes exactly 120 warmup intervals and measures the next 840", () => {
    const result = collect().result();
    expect(result.rafIntervalMs.count).toBe(840);
    expect(result.measuredRenderFrames).toBe(840);
    expect(result.renderWallMs.count).toBe(840);
    expect(result.sourceWallMs.p95).toBe(1);
    expect(result.composeWallMs.p99).toBe(2);
    expect(result.hostWallPhases).toBeUndefined();
    expect(result.deadlines).toEqual({ over60Hz: 0, over120Hz: 840 });
  });

  it("records complete host wall phases without labeling async waits as CPU work", () => {
    const window = new NativeMountedBenchmarkWindowCollector(request);
    for (let index = 0; index <= 960; index += 1) {
      window.onRaf(index * 10, "visible");
      window.onRender({
        renderWallMs: 12,
        sourceWallMs: 1,
        composeWallMs: 2,
        hostWallPhases: {
          ...emptyNativeBenchmarkPhaseValues(),
          effectPassesWallMs: index % 2 ? 5 : 7,
          errorScopeWallMs: 3,
        },
        failureCount: 0,
      });
    }
    const result = window.result();
    expect(result.hostWallPhases?.scope).toBe(
      "wall-intervals-not-CPU-or-GPU-time",
    );
    expect(result.hostWallPhases?.stats.effectPassesWallMs).toMatchObject({
      count: 840,
      p99: 7,
    });
    expect(result.hostWallPhases?.stats.errorScopeWallMs.count).toBe(840);
  });

  it("refuses a partially instrumented or invalid host wall window", () => {
    const measured = new NativeMountedBenchmarkWindowCollector(request);
    for (let index = 0; index <= 120; index += 1)
      measured.onRaf(index * 10, "visible");
    measured.onRender({
      renderWallMs: 4,
      sourceWallMs: 1,
      composeWallMs: 1,
      hostWallPhases: emptyNativeBenchmarkPhaseValues(),
      failureCount: 0,
    });
    expect(() =>
      measured.onRender({
        renderWallMs: 4,
        sourceWallMs: 1,
        composeWallMs: 1,
        failureCount: 0,
      }),
    ).toThrowError("benchmark-unavailable");
    const invalid = new NativeMountedBenchmarkWindowCollector(request);
    for (let index = 0; index <= 120; index += 1)
      invalid.onRaf(index * 10, "visible");
    expect(() =>
      invalid.onRender({
        renderWallMs: 4,
        sourceWallMs: 1,
        composeWallMs: 1,
        hostWallPhases: {
          ...emptyNativeBenchmarkPhaseValues(),
          errorScopeWallMs: Number.NaN,
        },
        failureCount: 0,
      }),
    ).toThrowError("benchmark-unavailable");
  });

  it.each([null, false, 0])(
    "rejects an explicitly supplied falsy phase payload (%s)",
    (payload) => {
      const measured = new NativeMountedBenchmarkWindowCollector(request);
      for (let index = 0; index <= 120; index += 1)
        measured.onRaf(index * 10, "visible");
      expect(() =>
        measured.onRender({
          renderWallMs: 4,
          sourceWallMs: 1,
          composeWallMs: 1,
          hostWallPhases: payload as unknown as NativeBenchmarkPhaseValues,
          failureCount: 0,
        }),
      ).toThrowError("benchmark-unavailable");
    },
  );

  it.each([
    ["hidden", "benchmark-hidden"],
    ["offscreen", "benchmark-offscreen"],
  ] as const)("rejects a %s iframe", (visibility, code) => {
    const window = new NativeMountedBenchmarkWindowCollector(request);
    expect(() => window.onRaf(1, visibility)).toThrowError(code);
  });

  it("refuses no-render, incomplete, and failed render windows", () => {
    expect(() => collect(false).result()).toThrowError("benchmark-no-render");
    const incomplete = new NativeMountedBenchmarkWindowCollector(request);
    incomplete.onRaf(0, "visible");
    expect(() => incomplete.result()).toThrowError("benchmark-timeout");
    for (let index = 1; index <= 120; index += 1)
      incomplete.onRaf(index * 10, "visible");
    expect(() =>
      incomplete.onRender({
        renderWallMs: 1,
        sourceWallMs: 0,
        composeWallMs: 0,
        failureCount: 1,
      }),
    ).toThrowError("benchmark-render-failed");
  });

  it("rejects unbounded intervals and invalid wall samples", () => {
    const window = new NativeMountedBenchmarkWindowCollector(request);
    window.onRaf(0, "visible");
    expect(() => window.onRaf(120_001, "visible")).toThrowError(
      NativeMountedBenchmarkError,
    );
    const measured = new NativeMountedBenchmarkWindowCollector(request);
    for (let index = 0; index <= 120; index += 1)
      measured.onRaf(index * 10, "visible");
    expect(() =>
      measured.onRender({
        renderWallMs: Number.NaN,
        sourceWallMs: 0,
        composeWallMs: 0,
        failureCount: 0,
      }),
    ).toThrowError("benchmark-unavailable");
  });

  it("aborts without later claiming a complete measurement", async () => {
    const controller = new AbortController();
    const run = new NativeMountedBenchmarkRun(request, controller.signal);
    controller.abort();
    await expect(run.done).rejects.toMatchObject({ code: "benchmark-aborted" });
    for (let index = 0; index <= 960; index += 1)
      run.onRaf(index * 10, "visible");
    expect(run.collector.isComplete).toBe(false);
  });

  it("does not count synchronous frame kicks as RAF intervals", async () => {
    const run = new NativeMountedBenchmarkRun(
      request,
      new AbortController().signal,
    );
    for (let index = 0; index < 200; index += 1)
      run.onFrame(undefined, () => "visible");
    expect(run.collector.isMeasuring).toBe(false);
    for (let index = 0; index <= 960; index += 1) {
      run.onFrame(index * 10, () => "visible");
      run.onRender({
        renderWallMs: 3,
        sourceWallMs: 1,
        composeWallMs: 1,
        failureCount: 0,
      });
    }
    const result = await run.done;
    expect(result.rafIntervalMs.count).toBe(840);
    expect(result.measuredRenderFrames).toBe(840);
  });

  it("starts capture accounting after warmup and never on a manual kick", async () => {
    let captures = 7;
    let measuredCaptureStart: number | null = null;
    let startCount = 0;
    const run = new NativeMountedBenchmarkRun(
      request,
      new AbortController().signal,
      40_000,
      () => {
        measuredCaptureStart = captures;
        startCount += 1;
      },
    );
    for (let index = 0; index < 50; index += 1) {
      captures += 1;
      run.onFrame(undefined, () => "visible");
    }
    expect(measuredCaptureStart).toBeNull();
    for (let index = 0; index <= 120; index += 1) {
      captures += 1;
      run.onFrame(index * 10, () => "visible");
    }
    expect(measuredCaptureStart).toBe(captures);
    expect(startCount).toBe(1);
    for (let index = 121; index <= 960; index += 1) {
      captures += 1;
      run.onFrame(index * 10, () => "visible");
      run.onRender({
        renderWallMs: 3,
        sourceWallMs: 1,
        composeWallMs: 1,
        failureCount: 0,
      });
    }
    expect((await run.done).rafIntervalMs.count).toBe(840);
    expect(captures - measuredCaptureStart!).toBe(840);
  });

  it("times out on a stalled RAF window", async () => {
    const run = new NativeMountedBenchmarkRun(
      request,
      new AbortController().signal,
      5,
    );
    await expect(run.done).rejects.toMatchObject({ code: "benchmark-timeout" });
  });

  it("preserves a bounded primary renderer diagnostic without completing the window", async () => {
    const run = new NativeMountedBenchmarkRun(
      request,
      new AbortController().signal,
    );
    for (let index = 0; index <= 120; index += 1)
      run.onFrame(index * 10, () => "visible");
    run.onRender({
      renderWallMs: 3,
      sourceWallMs: 1,
      composeWallMs: 1,
      failureCount: 1,
      failure: {
        code: "source-epoch-stale",
        instanceId: "effect-instance-123",
        message: "The authored source changed before presentation.",
      },
    });

    await expect(run.done).rejects.toMatchObject({
      code: "benchmark-render-failed",
      message:
        "benchmark-render-failed: effect-instance-123: source-epoch-stale: The authored source changed before presentation.",
    });
    expect(run.collector.isComplete).toBe(false);
  });

  it("bounds malformed renderer diagnostics in the benchmark failure message", async () => {
    const run = new NativeMountedBenchmarkRun(
      request,
      new AbortController().signal,
    );
    for (let index = 0; index <= 120; index += 1)
      run.onFrame(index * 10, () => "visible");
    run.onRender({
      renderWallMs: 3,
      sourceWallMs: 1,
      composeWallMs: 1,
      failureCount: 1,
      failure: {
        code: "!malformed-code",
        instanceId: "i".repeat(200),
        message: "m".repeat(500),
      },
    });

    const error = await run.done.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "benchmark-render-failed" });
    expect(error).toHaveProperty(
      "message",
      expect.stringContaining("render-failed"),
    );
    expect((error as Error).message.length).toBeLessThanOrEqual(300);
  });
});

describe("measurement end boundary", () => {
  it("closes GPU ownership synchronously at the final RAF before later render submissions or source verification", async () => {
    let attemptedSample = -1;
    let lower: number | null = null,
      upper: number | null = null;
    let ends = 0;
    const run = new NativeMountedBenchmarkRun(
      request,
      new AbortController().signal,
      40_000,
      () => {
        lower = attemptedSample;
      },
      () => {
        upper = attemptedSample;
        ends += 1;
      },
    );
    for (let index = 0; index <= 960; index++) {
      run.onFrame(index * 10, () => "visible");
      if (index === 960) expect(upper).toBe(959);
      attemptedSample = index;
      run.onRender({
        renderWallMs: 1,
        sourceWallMs: 0,
        composeWallMs: 0,
        failureCount: 0,
      });
    }
    expect(lower).toBe(119);
    expect(ends).toBe(1);
    await run.done;
    expect(upper).toBe(959);
    run.onFrame(9610, () => "visible");
    expect(ends).toBe(1);
  });

  it("does not report a complete window when freezing its GPU boundary fails", async () => {
    const run = new NativeMountedBenchmarkRun(
      request,
      new AbortController().signal,
      40_000,
      undefined,
      () => {
        throw new Error("fake owner change");
      },
    );
    for (let index = 0; index <= 960; index++) {
      run.onFrame(index * 10, () => "visible");
      run.onRender({
        renderWallMs: 1,
        sourceWallMs: 0,
        composeWallMs: 0,
        failureCount: 0,
      });
    }
    await expect(run.done).rejects.toMatchObject({
      code: "benchmark-unavailable",
    });
  });
});
