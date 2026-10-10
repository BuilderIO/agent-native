import { describe, expect, it } from "vitest";

import {
  nativeShaderValidationRequestSchema,
  nativeShaderMountedMeasurementSchema,
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
