import { describe, expect, it } from "vitest";

import {
  nativeShaderValidationRequestSchema,
  nativeShaderMountedMeasurementSchema,
  nativeMountedOutputSummarySchema,
} from "./native-shader-validation";

const hash = "a".repeat(64);
const measuredCase = {
  caseId: "mounted_perf",
  instanceId: "effect-1",
  nodeId: "node-1",
  definitionId: "definition-1",
  definitionVersion: 1,
  executionHash: hash,
  timeSeconds: 0,
  mountedMeasurement: { warmupRafIntervals: 120, measuredRafIntervals: 840 },
};
const request = {
  designId: "design-1",
  fileId: "file-1",
  expectedVersionHash: "version-1",
  cases: [measuredCase],
};

describe("mounted measurement validation", () => {
  it("accepts one source-pinned live case", () => {
    expect(
      nativeShaderValidationRequestSchema.parse(request).cases,
    ).toHaveLength(1);
  });

  it("rejects mixed cases, seeks, held frames, and altered window bounds", () => {
    const extra = {
      ...measuredCase,
      caseId: "second",
      mountedMeasurement: undefined,
    };
    expect(
      nativeShaderValidationRequestSchema.safeParse({
        ...request,
        cases: [measuredCase, extra],
      }).success,
    ).toBe(false);
    expect(
      nativeShaderValidationRequestSchema.safeParse({
        ...request,
        cases: [{ ...measuredCase, timeSeconds: 1 }],
      }).success,
    ).toBe(false);
    expect(
      nativeShaderValidationRequestSchema.safeParse({
        ...request,
        cases: [
          {
            ...measuredCase,
            mountedMeasurement: {
              warmupRafIntervals: 119,
              measuredRafIntervals: 840,
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      nativeShaderValidationRequestSchema.safeParse({
        ...request,
        cases: [
          {
            ...measuredCase,
            mountedFrame: {
              viewport: { width: 100, height: 100 },
              pixelRatio: 1,
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("labels the complete window separately from a sparse GPU snapshot", () => {
    const stats = (count: number) => ({
      count,
      p50: 1,
      p95: 2,
      p99: 3,
      max: 4,
    });
    const profileAtEnd = {
      state: "available",
      scope: "mounted-scene",
      capturedAt: Date.now(),
      sampleWindow: "rolling-120-render/raf",
      renderWallMs: stats(120),
      rafIntervalMs: stats(120),
      preview: {
        requestedQuality: "auto",
        frameRateTarget: 60,
        effectivePixelRatio: 1.6,
      },
      textures: {
        allocatedBytes: 1,
        mountedBytes: 1,
        queuedRetirementBytes: 0,
        inFlightRetirementBytes: 0,
        sharedBytes: 0,
        unattributedBytes: 0,
        omittedMounts: 0,
      },
      gpu: { kind: "unavailable", code: "timestamp-query-unavailable" },
    };
    const measurement = {
      scope: "live-mounted-scene",
      warmupRafIntervals: 120,
      measuredRafIntervals: 840,
      measuredRenderFrames: 400,
      rafIntervalMs: stats(840),
      renderWallMs: stats(400),
      sourceWallMs: stats(400),
      composeWallMs: stats(400),
      deadlines: { over60Hz: 200, over120Hz: 400 },
      sourceCaptureDelta: 801,
      gpuScope: "latest-sampled-mount-not-full-scene",
      profileAtEnd,
    };
    expect(
      nativeShaderMountedMeasurementSchema.parse(measurement).rafIntervalMs
        .count,
    ).toBe(840);
    const hostWallPhases = {
      scope: "wall-intervals-not-CPU-or-GPU-time",
      stats: {
        deviceWallMs: stats(400),
        layoutCallWallMs: stats(400),
        effectPassesWallMs: stats(400),
        finishWallMs: stats(400),
        presentWallMs: stats(400),
        submitCallWallMs: stats(400),
        errorScopeWallMs: stats(400),
        postSubmitWallMs: stats(400),
      },
    };
    expect(
      nativeShaderMountedMeasurementSchema.safeParse({
        ...measurement,
        hostWallPhases,
      }).success,
    ).toBe(true);
    expect(
      nativeShaderMountedMeasurementSchema.safeParse({
        ...measurement,
        hostWallPhases: {
          ...hostWallPhases,
          stats: {
            ...hostWallPhases.stats,
            errorScopeWallMs: stats(399),
          },
        },
      }).success,
    ).toBe(false);
    expect(
      nativeShaderMountedMeasurementSchema.safeParse({
        ...measurement,
        hostWallPhases: {
          ...hostWallPhases,
          stats: {
            ...hostWallPhases.stats,
            untrackedWallMs: stats(400),
          },
        },
      }).success,
    ).toBe(false);
    const fullFrameWallPhases = {
      scope: "full-render-internal-wall-intervals-not-CPU-or-GPU-time",
      stats: {
        renderInternalWallMs: stats(400),
        deviceWallMs: stats(400),
        mountAwaitWallMs: stats(400),
        scenePresentationWallMs: stats(400),
        retirementWallMs: stats(400),
      },
      scenePresentation: {
        scope:
          "nested-in-scene-presentation-wall-intervals-not-CPU-or-GPU-time",
        stats: {
          sourceReadWallMs: stats(400),
          composeWallMs: stats(400),
          encodeWallMs: stats(400),
          submitWallMs: stats(400),
          errorScopeWallMs: stats(400),
          publicationWallMs: stats(400),
        },
      },
    };
    const accepted = nativeShaderMountedMeasurementSchema.parse({
      ...measurement,
      fullFrameWallPhases,
    });
    expect(accepted.fullFrameWallPhases).toEqual(fullFrameWallPhases);
    const zeroReadStats = { count: 400, p50: 0, p95: 0, p99: 0, max: 0 };
    const sourceReadDetail = {
      scope:
        "read-scene-wall-intervals-and-explicit-traversal-counts-not-CPU-or-GPU-time",
      stats: {
        calls: zeroReadStats,
        scenePresentationCalls: zeroReadStats,
        mountSourceCalls: zeroReadStats,
        dependencyRefreshCalls: zeroReadStats,
        otherCalls: zeroReadStats,
        wallMs: zeroReadStats,
        walkWallMs: zeroReadStats,
        validationWallMs: zeroReadStats,
        leafWaitWallMs: zeroReadStats,
        walkNodeVisits: zeroReadStats,
        walkDirectStyleReads: zeroReadStats,
        walkDirectLayoutSizeReads: zeroReadStats,
        walkDirectAffineReads: zeroReadStats,
        recordDirectStyleReads: zeroReadStats,
        recordDirectLayoutSizeReads: zeroReadStats,
        recordDirectAffineReads: zeroReadStats,
        recordDirectRectReads: zeroReadStats,
      },
    };
    const highTraversalCount = {
      ...sourceReadDetail,
      stats: {
        ...sourceReadDetail.stats,
        walkNodeVisits: {
          count: 400,
          p50: 120_001,
          p95: 120_001,
          p99: 120_001,
          max: 120_001,
        },
      },
    };
    expect(
      nativeShaderMountedMeasurementSchema.safeParse({
        ...measurement,
        fullFrameWallPhases,
        sourceReadDetail: highTraversalCount,
      }).success,
    ).toBe(true);
    for (const invalid of [
      {
        ...sourceReadDetail,
        scope:
          "read-scene-wall-intervals-leaf-waits-nested-in-walk-not-CPU-or-GPU-time",
      },
      {
        ...sourceReadDetail,
        stats: {
          ...sourceReadDetail.stats,
          calls: { ...zeroReadStats, max: 1025 },
        },
      },
      {
        ...sourceReadDetail,
        stats: {
          ...sourceReadDetail.stats,
          calls: { ...zeroReadStats, max: 0.5 },
        },
      },
      {
        ...sourceReadDetail,
        stats: {
          ...sourceReadDetail.stats,
          walkNodeVisits: {
            ...zeroReadStats,
            p95: 1_000_001,
            p99: 1_000_001,
            max: 1_000_001,
          },
        },
      },
      {
        ...sourceReadDetail,
        stats: {
          ...sourceReadDetail.stats,
          recordDirectLayoutSizeReads: undefined,
        },
      },
      {
        ...sourceReadDetail,
        stats: {
          ...sourceReadDetail.stats,
          walkDirectStyleReads: { ...zeroReadStats, count: 399 },
        },
      },
      {
        ...sourceReadDetail,
        stats: {
          ...sourceReadDetail.stats,
          wallMs: { ...zeroReadStats, max: 0.1 },
        },
      },
      {
        ...sourceReadDetail,
        stats: { ...sourceReadDetail.stats, extra: zeroReadStats },
      },
      {
        ...sourceReadDetail,
        stats: { ...sourceReadDetail.stats, wallMs: undefined },
      },
    ])
      expect(
        nativeShaderMountedMeasurementSchema.safeParse({
          ...measurement,
          fullFrameWallPhases,
          sourceReadDetail: invalid,
        }).success,
      ).toBe(false);
    for (const payload of [
      null,
      false,
      {},
      {
        ...fullFrameWallPhases,
        stats: { ...fullFrameWallPhases.stats, mountAwaitWallMs: stats(399) },
      },
      {
        ...fullFrameWallPhases,
        stats: {
          ...fullFrameWallPhases.stats,
          renderInternalWallMs: { ...stats(400), max: 5 },
        },
      },
      {
        ...fullFrameWallPhases,
        scenePresentation: {
          ...fullFrameWallPhases.scenePresentation,
          stats: {
            ...fullFrameWallPhases.scenePresentation.stats,
            errorScopeWallMs: { ...stats(400), max: 5 },
          },
        },
      },
      { ...fullFrameWallPhases, extra: 1 },
    ])
      expect(
        nativeShaderMountedMeasurementSchema.safeParse({
          ...measurement,
          fullFrameWallPhases: payload,
        }).success,
      ).toBe(false);
    expect(
      nativeShaderMountedMeasurementSchema.safeParse({
        ...measurement,
        renderWallMs: stats(399),
      }).success,
    ).toBe(false);
    expect(
      nativeShaderMountedMeasurementSchema.safeParse({
        ...measurement,
        gpuScope: "full-scene",
      }).success,
    ).toBe(false);
  });
  it("binds a target GPU snapshot to its measured-window boundary and rejects a stale or wrong owner", () => {
    const stats = (count: number) => ({
      count,
      p50: 1,
      p95: 1,
      p99: 1,
      max: 1,
    });
    const profileAtEnd = {
      state: "available",
      scope: "mounted-scene",
      capturedAt: 1,
      sampleWindow: "rolling-120-render/raf",
      renderWallMs: stats(120),
      rafIntervalMs: stats(120),
      preview: {
        requestedQuality: "auto",
        frameRateTarget: 60,
        effectivePixelRatio: 1.6,
      },
      textures: {
        allocatedBytes: 0,
        mountedBytes: 0,
        queuedRetirementBytes: 0,
        inFlightRetirementBytes: 0,
        sharedBytes: 0,
        unattributedBytes: 0,
        omittedMounts: 0,
      },
      gpuTargetInstanceId: "chosen",
      gpuScope: "target-mount-command-encoder-not-full-scene",
      gpu: {
        kind: "ready",
        frameIndex: 13,
        passCount: 1,
        gpuPassSumMs: 1,
        passes: [{ label: "chosen:effect:main", gpuMs: 1 }],
        estimatedResourceBytes: 2304,
      },
    };
    const measured = {
      scope: "live-mounted-scene",
      warmupRafIntervals: 120,
      measuredRafIntervals: 840,
      measuredRenderFrames: 840,
      rafIntervalMs: stats(840),
      renderWallMs: stats(840),
      sourceWallMs: stats(840),
      composeWallMs: stats(840),
      deadlines: { over60Hz: 0, over120Hz: 0 },
      sourceCaptureDelta: 1,
      gpuScope: "target-mount-command-encoder-not-full-scene",
      gpuTargetInstanceId: "chosen",
      gpuAfterFrameIndex: 12,
      profileAtEnd,
    };
    expect(
      nativeShaderMountedMeasurementSchema.safeParse(measured).success,
    ).toBe(true);
    for (const override of [
      { gpuTargetInstanceId: "other" },
      { gpuAfterFrameIndex: 13 },
      { gpuAfterFrameIndex: undefined },
    ])
      expect(
        nativeShaderMountedMeasurementSchema.safeParse({
          ...measured,
          ...override,
        }).success,
      ).toBe(false);
    expect(
      nativeShaderMountedMeasurementSchema.safeParse({
        ...measured,
        profileAtEnd: {
          ...profileAtEnd,
          gpu: {
            kind: "error",
            code: "stale-sample",
            estimatedResourceBytes: 2304,
          },
        },
      }).success,
    ).toBe(true);
  });
});

describe("same-session feedback validation sequence", () => {
  const baseCase = {
    caseId: "feedback_replay",
    instanceId: "effect-1",
    nodeId: "node-1",
    definitionId: "feedback-1",
    definitionVersion: 1,
    executionHash: hash,
    timeSeconds: 0,
    mountedFrame: { viewport: { width: 64, height: 64 }, pixelRatio: 1 },
    captureFeedbackState: true,
    statefulSequence: [
      { kind: "advance", stepId: "initial" },
      {
        kind: "capture",
        stepId: "same_time",
        compare: {
          referenceStepId: "initial",
          feedbackState: "same",
          pixels: "same",
        },
      },
    ],
  };

  it("accepts exact same-time captures and bounded numeric patches", () => {
    expect(
      nativeShaderValidationRequestSchema.safeParse({
        designId: "design-1",
        fileId: "file-1",
        expectedVersionHash: "version-1",
        cases: [baseCase],
      }).success,
    ).toBe(true);
    expect(
      nativeShaderValidationRequestSchema.safeParse({
        designId: "design-1",
        fileId: "file-1",
        expectedVersionHash: "version-1",
        cases: [
          {
            ...baseCase,
            statefulSequence: [
              baseCase.statefulSequence[0],
              { kind: "set-params", stepId: "edit", params: { seed: 42 } },
              {
                kind: "capture",
                stepId: "after_edit",
                compare: {
                  referenceStepId: "initial",
                  feedbackState: "different",
                  pixels: "different",
                },
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects future references, capture-before-frame, excessive controls, and nonnumeric patches", () => {
    const requestFor = (sequence: unknown, overrides = {}) =>
      nativeShaderValidationRequestSchema.safeParse({
        designId: "design-1",
        fileId: "file-1",
        expectedVersionHash: "version-1",
        cases: [{ ...baseCase, ...overrides, statefulSequence: sequence }],
      }).success;
    expect(
      requestFor([
        { kind: "advance", stepId: "initial" },
        {
          kind: "capture",
          stepId: "later",
          compare: { referenceStepId: "future", pixels: "same" },
        },
      ]),
    ).toBe(false);
    expect(
      requestFor([
        {
          kind: "capture",
          stepId: "early",
          compare: { referenceStepId: "initial", pixels: "same" },
        },
        { kind: "advance", stepId: "initial" },
      ]),
    ).toBe(false);
    expect(
      requestFor([
        { kind: "advance", stepId: "initial" },
        {
          kind: "set-params",
          stepId: "edit",
          params: { palette: "blue" },
        },
      ]),
    ).toBe(false);
    expect(
      requestFor(baseCase.statefulSequence, {
        captureFeedbackState: undefined,
      }),
    ).toBe(false);
  });

  it("requires an exact RGBA16F state readback byte count", () => {
    const mountOutput = {
      scope: "exact-mount-output-linear-premultiplied",
      instanceId: "effect-1",
      nodeId: "node-1",
      definitionId: "feedback-1",
      definitionVersion: 1,
      executionHash: hash,
      width: 2,
      height: 2,
      pixelSha256: hash,
      nonTransparentPixels: 0,
      partialAlphaPixels: 0,
      nonZeroRgbaPixels: 0,
      feedbackState: {
        availability: "available",
        scope: "exact-feedback-state-linear-rgba16f",
        width: 2,
        height: 2,
        completedStep: 0,
        byteLength: 32,
        sha256: hash,
        followups: {
          sourceTransition: {
            availability: "unavailable",
            code: "second-source-fixture-required",
          },
          lifecycleReplay: {
            availability: "unavailable",
            code: "multi-action-editor-sequence-required",
          },
        },
      },
    };
    expect(
      nativeMountedOutputSummarySchema.safeParse(mountOutput).success,
    ).toBe(true);
    expect(
      nativeMountedOutputSummarySchema.safeParse({
        ...mountOutput,
        feedbackState: { ...mountOutput.feedbackState, byteLength: 31 },
      }).success,
    ).toBe(false);
  });
});

describe("GPU measurement distribution contract", () => {
  function measurement() {
    const stats = (count: number) => ({
      count,
      p50: 1,
      p95: 1,
      p99: 1,
      max: 1,
    });
    const gpu = {
      kind: "ready",
      frameIndex: 13,
      passCount: 1,
      gpuPassSumMs: 1,
      passes: [{ label: "chosen:effect:main", gpuMs: 1 }],
      estimatedResourceBytes: 2304,
    };
    return {
      scope: "live-mounted-scene",
      warmupRafIntervals: 120,
      measuredRafIntervals: 840,
      measuredRenderFrames: 840,
      rafIntervalMs: stats(840),
      renderWallMs: stats(840),
      sourceWallMs: stats(840),
      composeWallMs: stats(840),
      deadlines: { over60Hz: 0, over120Hz: 0 },
      sourceCaptureDelta: 1,
      gpuScope: "target-mount-command-encoder-not-full-scene",
      gpuTargetInstanceId: "chosen",
      gpuAfterFrameIndex: 12,
      gpuThroughFrameIndex: 14,
      gpuWindow: {
        scope: "sparse-target-mount-command-encoder",
        targetInstanceId: "chosen",
        sampleEveryFrames: 60,
        maxSamples: 128,
        warmupAfterFrameIndex: 10,
        afterFrameIndex: 12,
        throughFrameIndex: 14,
        kind: "ready",
        code: "complete",
        samples: [
          {
            frameIndex: 13,
            phase: "measurement",
            status: "ready",
            profile: gpu,
          },
        ],
        skippedCapacity: { warmup: 0, measurement: 0 },
        omittedSamples: 0,
        gpuPassSumMs: stats(1),
      },
      profileAtEnd: {
        state: "available",
        scope: "mounted-scene",
        capturedAt: 1,
        sampleWindow: "rolling-120-render/raf",
        renderWallMs: stats(120),
        rafIntervalMs: stats(120),
        preview: {
          requestedQuality: "auto",
          frameRateTarget: 60,
          effectivePixelRatio: 1,
        },
        textures: {
          allocatedBytes: 0,
          mountedBytes: 0,
          queuedRetirementBytes: 0,
          inFlightRetirementBytes: 0,
          sharedBytes: 0,
          unattributedBytes: 0,
          omittedMounts: 0,
        },
        gpuTargetInstanceId: "chosen",
        gpuScope: "target-mount-command-encoder-not-full-scene",
        gpu,
      },
    };
  }

  it("accepts bounded frozen distributions separately from later outside-window snapshots", () => {
    const valid = measurement();
    expect(nativeShaderMountedMeasurementSchema.safeParse(valid).success).toBe(
      true,
    );
    expect(
      nativeShaderMountedMeasurementSchema.safeParse({
        ...valid,
        profileAtEnd: {
          ...valid.profileAtEnd,
          gpu: {
            kind: "error",
            code: "outside-window",
            estimatedResourceBytes: 2304,
          },
        },
      }).success,
    ).toBe(true);
    for (const bad of [
      { ...valid, gpuThroughFrameIndex: undefined },
      { ...valid, gpuWindow: undefined },
      { ...valid, gpuThroughFrameIndex: 15 },
      { ...valid, gpuAfterFrameIndex: 11 },
      { ...valid, gpuTargetInstanceId: "other" },
      {
        ...valid,
        profileAtEnd: {
          ...valid.profileAtEnd,
          gpu: { ...valid.profileAtEnd.gpu, frameIndex: 15 },
        },
      },
      {
        ...valid,
        gpuWindow: {
          ...valid.gpuWindow,
          samples: [
            {
              ...valid.gpuWindow.samples[0],
              profile: { ...valid.profileAtEnd.gpu, gpuPassSumMs: 0 },
            },
          ],
        },
      },
      {
        ...valid,
        gpuWindow: {
          ...valid.gpuWindow,
          gpuPassSumMs: { count: 1, p50: 0, p95: 0, p99: 0, max: 0 },
        },
      },
    ])
      expect(nativeShaderMountedMeasurementSchema.safeParse(bad).success).toBe(
        false,
      );
  });

  it("retains pending and failed evidence with null percentiles and refuses zero or partial success", () => {
    const valid = measurement();
    const sample = valid.gpuWindow.samples[0];
    for (const status of ["reserved", "submitted"] as const) {
      const pending = {
        ...valid,
        gpuWindow: {
          ...valid.gpuWindow,
          kind: "pending",
          code: "readback-pending",
          samples: [
            { frameIndex: sample.frameIndex, phase: "measurement", status },
          ],
          gpuPassSumMs: null,
        },
      };
      expect(
        nativeShaderMountedMeasurementSchema.safeParse(pending).success,
      ).toBe(true);
      expect(
        nativeShaderMountedMeasurementSchema.safeParse({
          ...pending,
          gpuWindow: {
            ...pending.gpuWindow,
            gpuPassSumMs: { count: 1, p50: 0, p95: 0, p99: 0, max: 0 },
          },
        }).success,
      ).toBe(false);
    }
    expect(
      nativeShaderMountedMeasurementSchema.safeParse({
        ...valid,
        gpuWindow: {
          ...valid.gpuWindow,
          kind: "error",
          code: "read-failed",
          samples: [
            {
              frameIndex: 13,
              phase: "measurement",
              status: "error",
              errorCode: "read-failed",
            },
          ],
          gpuPassSumMs: null,
        },
      }).success,
    ).toBe(true);
  });
});
