import { z } from "zod";

import { NATIVE_BENCHMARK_SOURCE_READ_SCOPE } from "./native-benchmark-contract.js";

export const NATIVE_SHADER_VALIDATION_PENDING_MS = 90_000;
export const NATIVE_SHADER_VALIDATION_RUNNING_MS = 45_000;

const identifier = z.string().min(1).max(128);
const executionHash = z.string().regex(/^[a-f0-9]{64}$/);

const linearSample = z
  .object({
    x: z.number().int().min(0).max(8191),
    y: z.number().int().min(0).max(8191),
    expected: z.tuple([
      z.number().finite().min(-65504).max(65504),
      z.number().finite().min(-65504).max(65504),
      z.number().finite().min(-65504).max(65504),
      z.number().finite().min(0).max(1),
    ]),
    tolerance: z.number().finite().min(0).max(65504),
  })
  .strict();

export const nativeExpectedLinearSamplesSchema = z
  .array(linearSample)
  .min(1)
  .max(32)
  .refine(
    (samples) =>
      new Set(samples.map((sample) => `${sample.x}:${sample.y}`)).size ===
      samples.length,
    "linear sample coordinates must be unique",
  );

export type NativeExpectedLinearSamples = z.infer<
  typeof nativeExpectedLinearSamplesSchema
>;

const scenePixelCoordinate = z
  .object({
    x: z.number().int().min(0).max(4095),
    y: z.number().int().min(0).max(4095),
  })
  .strict();

export const nativeFullScenePixelSampleCoordinatesSchema = z
  .array(scenePixelCoordinate)
  .min(1)
  .max(20)
  .refine(
    (samples) =>
      new Set(samples.map((sample) => `${sample.x}:${sample.y}`)).size ===
      samples.length,
    "full-scene pixel sample coordinates must be unique",
  );

const nativeFullScenePixelSamplesSchema = z
  .object({
    scope: z.literal("full-scene-composition-srgb-straight-u8"),
    requestId: z.string().uuid(),
    sourceVersionHash: z.string().min(1).max(256),
    frameIndex: z.number().int().min(0).max(120),
    timeSeconds: z.number().finite().min(0).max(2),
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
    pixelRatio: z.number().finite().min(1).max(2),
    colorSpace: z.literal("srgb"),
    alpha: z.literal("straight"),
    samples: z
      .array(
        z
          .object({
            x: z.number().int().min(0).max(4095),
            y: z.number().int().min(0).max(4095),
            rgba8: z.tuple([
              z.number().int().min(0).max(255),
              z.number().int().min(0).max(255),
              z.number().int().min(0).max(255),
              z.number().int().min(0).max(255),
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .refine(
    (value) =>
      value.width * value.height <= 4_194_304 &&
      value.samples.every(
        (sample) => sample.x < value.width && sample.y < value.height,
      ) &&
      new Set(value.samples.map((sample) => `${sample.x}:${sample.y}`)).size ===
        value.samples.length,
    "full-scene pixel samples must fit their exact unique frame coordinates",
  );

export type NativeFullScenePixelSamples = z.infer<
  typeof nativeFullScenePixelSamplesSchema
>;

export const nativeLinearGoldenSummarySchema = z
  .object({
    sampleCount: z.number().int().min(1).max(32),
    maxAbsError: z.number().finite().min(0).max(131008),
    passed: z.boolean(),
  })
  .strict();

export type NativeLinearGoldenSummary = z.infer<
  typeof nativeLinearGoldenSummarySchema
>;

const fixtureParams = z
  .record(z.string().min(1).max(80), z.json())
  .refine(
    (value) => Object.keys(value).length <= 32,
    "too many fixture parameters",
  )
  .refine((value) => {
    const serialized = JSON.stringify(value);
    return (
      typeof serialized === "string" &&
      new TextEncoder().encode(serialized).byteLength <= 4096
    );
  }, "fixture parameters exceed 4 KB or are unreadable");

export const nativeShaderValidationFixtureSchema = z
  .object({
    sourceKind: z.enum(["generated", "owned-image", "editable-text"]),
    aspect: z.enum(["landscape", "portrait", "square"]),
    alpha: z.enum(["opaque", "transparent", "zero"]),
    coverageExpectation: z.enum(["any", "nonzero", "zero"]).optional(),
    rounded: z.boolean(),
    seed: z.number().int().min(0).max(1_000_000),
    params: fixtureParams.optional(),
    presetId: identifier.optional(),
  })
  .strict();

export const nativeShaderValidationMountedFrameSchema = z
  .object({
    viewport: z
      .object({
        width: z.number().int().min(1).max(2048),
        height: z.number().int().min(1).max(2048),
      })
      .strict(),
    pixelRatio: z.number().finite().min(1).max(2),
  })
  .strict()
  .refine((frame) => {
    const width = Math.ceil(frame.viewport.width * frame.pixelRatio);
    const height = Math.ceil(frame.viewport.height * frame.pixelRatio);
    return width <= 4096 && height <= 4096 && width * height <= 4_194_304;
  }, "mounted frame exceeds the sixteen-megabyte pixel budget");

const nativeShaderValidationSequenceStepId = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/);

const nativeShaderValidationSequenceParams = z
  .record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
    z.number().finite().min(-1_000_000).max(1_000_000),
  )
  .refine(
    (params) =>
      Object.keys(params).length > 0 && Object.keys(params).length <= 16,
  )
  .refine((params) => {
    const serialized = JSON.stringify(params);
    return new TextEncoder().encode(serialized).byteLength <= 4096;
  });

export const nativeShaderValidationSequenceStepSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("advance"),
        stepId: nativeShaderValidationSequenceStepId,
      })
      .strict(),
    z
      .object({
        kind: z.literal("set-params"),
        stepId: nativeShaderValidationSequenceStepId,
        params: nativeShaderValidationSequenceParams,
      })
      .strict(),
    z
      .object({
        kind: z.literal("capture"),
        stepId: nativeShaderValidationSequenceStepId,
        expectedLinearSamples: nativeExpectedLinearSamplesSchema.optional(),
        compare: z
          .object({
            referenceStepId: nativeShaderValidationSequenceStepId,
            feedbackState: z.enum(["same", "different"]).optional(),
            pixels: z.enum(["same", "different"]).optional(),
          })
          .strict()
          .refine(
            (value) =>
              value.feedbackState !== undefined || value.pixels !== undefined,
          )
          .optional(),
      })
      .strict(),
  ],
);

export const nativeShaderValidationStatefulSequenceSchema = z
  .array(nativeShaderValidationSequenceStepSchema)
  .min(2)
  .max(40)
  .refine(
    (steps) => new Set(steps.map((step) => step.stepId)).size === steps.length,
  )
  .refine((steps) => steps[0]?.kind === "advance")
  .refine((steps) => steps[steps.length - 1]?.kind === "capture")
  .refine(
    (steps) => steps.filter((step) => step.kind === "advance").length >= 1,
  )
  .refine(
    (steps) => steps.filter((step) => step.kind === "advance").length <= 4,
  )
  .refine(
    (steps) => steps.filter((step) => step.kind === "capture").length <= 17,
  )
  .refine(
    (steps) =>
      steps.reduce(
        (count, step) =>
          count +
          (step.kind === "capture"
            ? (step.expectedLinearSamples?.length ?? 0)
            : 0),
        0,
      ) <= 32,
  )
  .refine((steps) => {
    let writes = 0;
    for (const step of steps) {
      if (step.kind !== "set-params") continue;
      writes += Object.keys(step.params).length;
    }
    return writes <= 64;
  })
  .refine((steps) => {
    const serialized = JSON.stringify(steps);
    return new TextEncoder().encode(serialized).byteLength <= 32_768;
  })
  .refine((steps) => {
    const rendered = new Set<string>();
    let hasFrame = false;
    for (const step of steps) {
      if (step.kind === "advance") {
        rendered.add(step.stepId);
        hasFrame = true;
      } else if (step.kind === "capture") {
        if (!hasFrame) return false;
        if (step.compare && !rendered.has(step.compare.referenceStepId))
          return false;
        rendered.add(step.stepId);
      } else if (!hasFrame) return false;
    }
    return true;
  });

export type NativeShaderValidationStatefulSequence = z.infer<
  typeof nativeShaderValidationStatefulSequenceSchema
>;

export const nativeShaderValidationCaseSchema = z
  .object({
    caseId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
    instanceId: identifier,
    nodeId: identifier,
    definitionId: identifier,
    definitionVersion: z.number().int().positive(),
    executionHash,
    timeSeconds: z.number().finite().min(0).max(3600),
    fixture: nativeShaderValidationFixtureSchema.optional(),
    mountedFrame: nativeShaderValidationMountedFrameSchema.optional(),
    captureFeedbackState: z.literal(true).optional(),
    statefulSequence: nativeShaderValidationStatefulSequenceSchema.optional(),
    presentationFault: z.literal("simulated-gpu-validation").optional(),
    mountedMeasurement: z
      .object({
        warmupRafIntervals: z.literal(120),
        measuredRafIntervals: z.literal(840),
      })
      .strict()
      .optional(),
    expectedLinearSamples: nativeExpectedLinearSamplesSchema.optional(),
    scenePixelSampleCoordinates: nativeFullScenePixelSampleCoordinatesSchema
      .describe(
        "Physical pixel coordinates in the full-scene composition; at most twenty across the request, separate from mount-local linear golden samples",
      )
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.presentationFault ||
      (value.timeSeconds === 0 &&
        !value.fixture &&
        !value.mountedFrame &&
        !value.mountedMeasurement &&
        !value.expectedLinearSamples &&
        !value.scenePixelSampleCoordinates),
    "a presentation fault requires one ordinary live frame at time zero",
  )
  .refine(
    (value) =>
      !value.expectedLinearSamples || !!value.fixture || !!value.mountedFrame,
    "linear samples require a clean fixture or bounded mounted frame",
  )
  .refine(
    (value) => !value.captureFeedbackState || !!value.mountedFrame,
    "feedback state capture requires a bounded mounted frame",
  )
  .refine(
    (value) =>
      !value.statefulSequence ||
      (!!value.mountedFrame &&
        !value.fixture &&
        !value.expectedLinearSamples &&
        !value.presentationFault &&
        !value.mountedMeasurement &&
        value.statefulSequence.some((step) => step.kind === "capture") &&
        ((value.captureFeedbackState === true &&
          value.statefulSequence.every(
            (step) => step.kind !== "capture" || !step.expectedLinearSamples,
          )) ||
          (value.captureFeedbackState !== true &&
            value.statefulSequence.some(
              (step) => step.kind === "capture" && !!step.expectedLinearSamples,
            ))) &&
        Math.abs(
          value.timeSeconds -
            (value.statefulSequence.filter((step) => step.kind === "advance")
              .length -
              1) /
              60,
        ) <= 0.000001),
    "a same-session sequence needs bounded frames, numeric capture samples or feedback snapshots, and exact final frame time",
  )
  .refine(
    (value) =>
      !value.statefulSequence ||
      value.captureFeedbackState !== true ||
      (value.statefulSequence.length <= 12 &&
        value.statefulSequence.filter((step) => step.kind === "capture")
          .length <= 8),
    "feedback sequences retain their existing step and capture bounds",
  )
  .refine(
    (value) =>
      !value.mountedMeasurement ||
      (!value.fixture &&
        !value.mountedFrame &&
        !value.expectedLinearSamples &&
        value.timeSeconds === 0),
    "a live mounted measurement cannot request a held frame, clean fixture, golden samples, or seek",
  )
  .refine(
    (value) => !value.mountedFrame || !value.fixture,
    "a mounted frame cannot use a clean fixture",
  )
  .refine(
    (value) =>
      !value.scenePixelSampleCoordinates ||
      (!!value.mountedFrame &&
        !value.fixture &&
        !value.statefulSequence &&
        !value.mountedMeasurement &&
        !value.presentationFault),
    "full-scene pixel samples require one ordinary bounded mounted frame",
  )
  .refine(
    (value) =>
      !value.fixture ||
      (value.timeSeconds <= 2 &&
        Math.abs(value.timeSeconds * 60 - Math.round(value.timeSeconds * 60)) <=
          0.000001),
    "clean fixture time must align to a 0–2 second 60 fps frame",
  )
  .refine(
    (value) =>
      !value.mountedFrame ||
      (value.timeSeconds <= 2 &&
        Math.abs(value.timeSeconds * 60 - Math.round(value.timeSeconds * 60)) <=
          0.000001),
    "mounted golden time must align to a 0–2 second 60 fps frame",
  )
  .refine((value) => {
    if (!value.mountedFrame) return true;
    const width = Math.ceil(
      value.mountedFrame.viewport.width * value.mountedFrame.pixelRatio,
    );
    const height = Math.ceil(
      value.mountedFrame.viewport.height * value.mountedFrame.pixelRatio,
    );
    const samples = [
      ...(value.expectedLinearSamples ?? []),
      ...(value.scenePixelSampleCoordinates ?? []),
      ...(value.statefulSequence?.flatMap((step) =>
        step.kind === "capture" ? (step.expectedLinearSamples ?? []) : [],
      ) ?? []),
    ];
    return samples.every((sample) => sample.x < width && sample.y < height);
  }, "mounted golden samples must fit the held physical frame");

export const nativeShaderValidationRequestSchema = z
  .object({
    designId: identifier,
    fileId: identifier,
    expectedVersionHash: z.string().min(1).max(256),
    cases: z.array(nativeShaderValidationCaseSchema).min(1).max(4),
  })
  .strict()
  .refine(
    (value) =>
      !value.cases.some((item) => item.presentationFault) ||
      value.cases.length === 1,
    "a presentation fault must be the sole validation case",
  )
  .refine(
    (value) =>
      !value.cases.some((item) => item.mountedMeasurement) ||
      value.cases.length === 1,
    "a live mounted measurement must be the sole validation case",
  )
  .refine(
    (value) =>
      !value.cases.some((item) => item.statefulSequence) ||
      value.cases.length === 1,
    "a same-session feedback sequence must be the sole validation case",
  )
  .refine(
    (value) =>
      new Set(value.cases.map((item) => item.caseId)).size ===
      value.cases.length,
    "case IDs must be unique",
  )
  .refine(
    (value) =>
      value.cases.reduce(
        (count, item) =>
          count + (item.scenePixelSampleCoordinates?.length ?? 0),
        0,
      ) <= 20,
    "a request may sample at most twenty full-scene pixels",
  );

const profileStats = z
  .object({
    count: z.number().int().min(0).max(120),
    p50: z.number().finite().min(0).max(120_000),
    p95: z.number().finite().min(0).max(120_000),
    p99: z.number().finite().min(0).max(120_000),
    max: z.number().finite().min(0).max(120_000),
  })
  .strict()
  .refine(
    (value) =>
      value.p50 <= value.p95 &&
      value.p95 <= value.p99 &&
      value.p99 <= value.max,
    "profile percentiles must be ordered",
  );

const benchmarkStats = profileStats.safeExtend({
  count: z.number().int().min(0).max(840),
});
const benchmarkRenderStats = profileStats.safeExtend({
  count: z.number().int().min(0).max(2520),
});
const benchmarkHostWallPhases = z
  .object({
    scope: z.literal("wall-intervals-not-CPU-or-GPU-time"),
    stats: z
      .object({
        deviceWallMs: benchmarkRenderStats,
        layoutCallWallMs: benchmarkRenderStats,
        effectPassesWallMs: benchmarkRenderStats,
        finishWallMs: benchmarkRenderStats,
        presentWallMs: benchmarkRenderStats,
        submitCallWallMs: benchmarkRenderStats,
        errorScopeWallMs: benchmarkRenderStats,
        postSubmitWallMs: benchmarkRenderStats,
      })
      .strict(),
  })
  .strict();

const benchmarkFullFrameWallPhases = z
  .object({
    scope: z.literal("full-render-internal-wall-intervals-not-CPU-or-GPU-time"),
    stats: z
      .object({
        renderInternalWallMs: benchmarkRenderStats,
        deviceWallMs: benchmarkRenderStats,
        mountAwaitWallMs: benchmarkRenderStats,
        scenePresentationWallMs: benchmarkRenderStats,
        retirementWallMs: benchmarkRenderStats,
      })
      .strict(),
    scenePresentation: z
      .object({
        scope: z.literal(
          "nested-in-scene-presentation-wall-intervals-not-CPU-or-GPU-time",
        ),
        stats: z
          .object({
            sourceReadWallMs: benchmarkRenderStats,
            composeWallMs: benchmarkRenderStats,
            encodeWallMs: benchmarkRenderStats,
            submitWallMs: benchmarkRenderStats,
            errorScopeWallMs: benchmarkRenderStats,
            publicationWallMs: benchmarkRenderStats,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

const benchmarkSourceReadCallsStats = benchmarkRenderStats.safeExtend({
  p50: z.number().int().min(0).max(1024),
  p95: z.number().int().min(0).max(1024),
  p99: z.number().int().min(0).max(1024),
  max: z.number().int().min(0).max(1024),
});
const benchmarkSourceReadCountStats = benchmarkRenderStats.safeExtend({
  p50: z.number().int().min(0).max(1_000_000),
  p95: z.number().int().min(0).max(1_000_000),
  p99: z.number().int().min(0).max(1_000_000),
  max: z.number().int().min(0).max(1_000_000),
});

const benchmarkSourceReadDetail = z
  .object({
    scope: z.literal(NATIVE_BENCHMARK_SOURCE_READ_SCOPE),
    stats: z
      .object({
        calls: benchmarkSourceReadCallsStats,
        scenePresentationCalls: benchmarkSourceReadCallsStats,
        mountSourceCalls: benchmarkSourceReadCallsStats,
        dependencyRefreshCalls: benchmarkSourceReadCallsStats,
        otherCalls: benchmarkSourceReadCallsStats,
        wallMs: benchmarkRenderStats,
        walkWallMs: benchmarkRenderStats,
        validationWallMs: benchmarkRenderStats,
        leafWaitWallMs: benchmarkRenderStats,
        walkNodeVisits: benchmarkSourceReadCountStats,
        walkDirectStyleReads: benchmarkSourceReadCountStats,
        walkDirectLayoutSizeReads: benchmarkSourceReadCountStats,
        walkDirectAffineReads: benchmarkSourceReadCountStats,
        recordDirectStyleReads: benchmarkSourceReadCountStats,
        recordDirectLayoutSizeReads: benchmarkSourceReadCountStats,
        recordDirectAffineReads: benchmarkSourceReadCountStats,
        recordDirectRectReads: benchmarkSourceReadCountStats,
      })
      .strict(),
  })
  .strict();

const profileBytes = z
  .number()
  .int()
  .min(0)
  .max(16 * 1024 * 1024 * 1024);
const gpuReadyProfile = z
  .object({
    kind: z.literal("ready"),
    frameIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    passCount: z.number().int().min(1).max(32),
    gpuPassSumMs: z.number().finite().min(0).max(120_000),
    passes: z
      .array(
        z
          .object({
            label: z.string().min(1).max(140),
            gpuMs: z.number().finite().min(0).max(120_000),
          })
          .strict(),
      )
      .max(32),
    estimatedResourceBytes: profileBytes,
  })
  .strict()
  .refine((value) => value.passes.length === value.passCount);
const gpuProfile = z.discriminatedUnion("kind", [
  gpuReadyProfile,
  z
    .object({
      kind: z.literal("unavailable"),
      code: z.enum([
        "timestamp-query-unavailable",
        "device-lost",
        "disposed",
        "target-unavailable",
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("pending"),
      estimatedResourceBytes: profileBytes,
    })
    .strict(),
  z
    .object({
      kind: z.literal("error"),
      code: z.enum([
        "capacity",
        "read-failed",
        "invalid-timestamps",
        "stale-sample",
        "outside-window",
      ]),
      estimatedResourceBytes: profileBytes,
    })
    .strict(),
]);

const gpuFrameIndex = z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER);
const gpuWindowSampleBase = {
  frameIndex: gpuFrameIndex.refine((value) => value >= 0),
  phase: z.enum(["warmup", "measurement"]),
};
const gpuWindowSample = z.discriminatedUnion("status", [
  z
    .object({
      ...gpuWindowSampleBase,
      status: z.enum(["reserved", "submitted", "abandoned"]),
    })
    .strict(),
  z
    .object({
      ...gpuWindowSampleBase,
      status: z.literal("ready"),
      profile: gpuReadyProfile,
    })
    .strict(),
  z
    .object({
      ...gpuWindowSampleBase,
      status: z.literal("error"),
      errorCode: z.enum(["capacity", "read-failed", "invalid-timestamps"]),
    })
    .strict(),
]);
const gpuWindowStats = profileStats.safeExtend({
  count: z.number().int().min(1).max(128),
});
export const nativeShaderGpuSampleWindowSchema = z
  .object({
    scope: z.literal("sparse-target-mount-command-encoder"),
    targetInstanceId: z.string().min(1).max(64),
    sampleEveryFrames: z.number().int().min(1).max(600),
    maxSamples: z.literal(128),
    warmupAfterFrameIndex: gpuFrameIndex,
    afterFrameIndex: gpuFrameIndex,
    throughFrameIndex: gpuFrameIndex,
    kind: z.enum(["ready", "pending", "unavailable", "error"]),
    code: z.enum([
      "complete",
      "readback-pending",
      "timestamp-query-unavailable",
      "no-measured-samples",
      "capacity",
      "read-failed",
      "invalid-timestamps",
      "abandoned-sample",
      "device-lost",
      "disposed",
      "target-changed",
      "history-capacity",
      "sample-order",
      "profile-unavailable",
    ]),
    samples: z.array(gpuWindowSample).max(128),
    skippedCapacity: z
      .object({
        warmup: z.number().int().min(0).max(1_000_000),
        measurement: z.number().int().min(0).max(1_000_000),
      })
      .strict(),
    omittedSamples: z.number().int().min(0).max(1_000_000),
    gpuPassSumMs: gpuWindowStats.nullable(),
  })
  .strict()
  .refine((value) => {
    if (
      value.warmupAfterFrameIndex > value.afterFrameIndex ||
      value.afterFrameIndex > value.throughFrameIndex
    )
      return false;
    if (
      value.samples.some(
        (sample, index) =>
          sample.frameIndex <= value.warmupAfterFrameIndex ||
          sample.frameIndex > value.throughFrameIndex ||
          (index > 0 &&
            sample.frameIndex <= value.samples[index - 1].frameIndex) ||
          (sample.phase === "warmup"
            ? sample.frameIndex > value.afterFrameIndex
            : sample.frameIndex <= value.afterFrameIndex) ||
          (sample.status === "ready" &&
            (sample.profile.frameIndex !== sample.frameIndex ||
              !sample.profile.passes.every((pass) =>
                pass.label.startsWith(`${value.targetInstanceId}:`),
              ) ||
              Math.abs(
                sample.profile.gpuPassSumMs -
                  sample.profile.passes.reduce(
                    (sum, pass) => sum + pass.gpuMs,
                    0,
                  ),
              ) > 1e-9)),
      )
    )
      return false;
    const measured = value.samples.filter(
      (sample) => sample.phase === "measurement",
    );
    const incomplete = measured.some(
      (sample) => sample.status === "reserved" || sample.status === "submitted",
    );
    const failed = measured.find((sample) => sample.status === "error");
    const abandoned = measured.some((sample) => sample.status === "abandoned");
    if (value.kind === "ready") {
      if (
        value.code !== "complete" ||
        value.omittedSamples !== 0 ||
        value.skippedCapacity.measurement !== 0 ||
        measured.length === 0 ||
        measured.some((sample) => sample.status !== "ready") ||
        !value.gpuPassSumMs
      )
        return false;
      const sorted = measured
        .map((sample) =>
          sample.status === "ready" ? sample.profile.gpuPassSumMs : NaN,
        )
        .sort((a, b) => a - b);
      const at = (fraction: number) =>
        sorted[Math.ceil(sorted.length * fraction) - 1];
      return (
        value.gpuPassSumMs.count === sorted.length &&
        value.gpuPassSumMs.p50 === at(0.5) &&
        value.gpuPassSumMs.p95 === at(0.95) &&
        value.gpuPassSumMs.p99 === at(0.99) &&
        value.gpuPassSumMs.max === at(1)
      );
    }
    if (value.gpuPassSumMs !== null) return false;
    if (value.kind === "pending")
      return (
        value.code === "readback-pending" &&
        incomplete &&
        !failed &&
        !abandoned &&
        value.skippedCapacity.measurement === 0 &&
        value.omittedSamples === 0
      );
    if (value.kind === "unavailable")
      return (
        value.code === "device-lost" ||
        value.code === "disposed" ||
        (value.code === "timestamp-query-unavailable" &&
          value.samples.length === 0 &&
          value.omittedSamples === 0 &&
          value.skippedCapacity.measurement === 0) ||
        (value.code === "no-measured-samples" &&
          measured.length === 0 &&
          value.omittedSamples === 0 &&
          value.skippedCapacity.measurement === 0)
      );
    return (
      value.code === "target-changed" ||
      value.code === "sample-order" ||
      value.code === "profile-unavailable" ||
      (value.code === "history-capacity" &&
        value.omittedSamples > 0 &&
        value.samples.length === 128) ||
      (value.omittedSamples === 0 &&
        (value.code === "capacity"
          ? value.skippedCapacity.measurement > 0 ||
            failed?.errorCode === "capacity"
          : value.code === "abandoned-sample"
            ? abandoned
            : failed?.errorCode === value.code))
    );
  }, "GPU window must retain exact bounded samples and matching statistics");

const sceneProfileBase = {
  scope: z.literal("mounted-scene"),
  capturedAt: z.number().int().nonnegative(),
};

export const nativeShaderValidationSceneProfileSchema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        ...sceneProfileBase,
        state: z.literal("available"),
        sampleWindow: z.literal("rolling-120-render/raf"),
        renderWallMs: profileStats,
        rafIntervalMs: profileStats,
        preview: z
          .object({
            requestedQuality: z.enum(["auto", "performance", "quality"]),
            frameRateTarget: z.union([z.literal(60), z.literal(120)]),
            effectivePixelRatio: z.number().finite().min(0.5).max(4),
          })
          .strict(),
        textures: z
          .object({
            allocatedBytes: profileBytes,
            mountedBytes: profileBytes,
            queuedRetirementBytes: profileBytes,
            inFlightRetirementBytes: profileBytes,
            sharedBytes: profileBytes,
            unattributedBytes: profileBytes,
            omittedMounts: z.number().int().nonnegative().max(1_000_000),
          })
          .strict(),
        gpu: gpuProfile,
        gpuTargetInstanceId: z.string().min(1).max(64).optional(),
        gpuScope: z
          .literal("target-mount-command-encoder-not-full-scene")
          .optional(),
      })
      .strict()
      .refine(
        (value) =>
          (value.gpuTargetInstanceId === undefined) ===
            (value.gpuScope === undefined) &&
          (value.gpuTargetInstanceId === undefined ||
            value.gpu.kind !== "ready" ||
            value.gpu.passes.every((pass) =>
              pass.label.startsWith(`${value.gpuTargetInstanceId}:`),
            )),
      ),
    z
      .object({
        ...sceneProfileBase,
        state: z.literal("unavailable"),
        code: z.enum([
          "frame-unavailable",
          "source-stale",
          "runtime-unavailable",
          "status-unreadable",
          "profile-unavailable",
          "profile-unreadable",
        ]),
      })
      .strict(),
  ],
);

export type NativeShaderValidationSceneProfile = z.infer<
  typeof nativeShaderValidationSceneProfileSchema
>;

export const nativeShaderMountedMeasurementSchema = z
  .object({
    scope: z.literal("live-mounted-scene"),
    warmupRafIntervals: z.literal(120),
    measuredRafIntervals: z.literal(840),
    measuredRenderFrames: z.number().int().min(1).max(2520),
    rafIntervalMs: benchmarkStats.refine((value) => value.count === 840),
    renderWallMs: benchmarkRenderStats,
    sourceWallMs: benchmarkRenderStats,
    composeWallMs: benchmarkRenderStats,
    hostWallPhases: benchmarkHostWallPhases.optional(),
    fullFrameWallPhases: benchmarkFullFrameWallPhases.optional(),
    sourceReadDetail: benchmarkSourceReadDetail.optional(),
    deadlines: z
      .object({
        over60Hz: z.number().int().min(0).max(840),
        over120Hz: z.number().int().min(0).max(840),
      })
      .strict(),
    sourceCaptureDelta: z.number().int().nonnegative().max(1_000_000),
    gpuScope: z.enum([
      "latest-sampled-mount-not-full-scene",
      "target-mount-command-encoder-not-full-scene",
    ]),
    gpuTargetInstanceId: z.string().min(1).max(64).optional(),
    gpuAfterFrameIndex: z
      .number()
      .int()
      .min(-1)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    gpuThroughFrameIndex: gpuFrameIndex.optional(),
    gpuWindow: nativeShaderGpuSampleWindowSchema.optional(),
    profileAtEnd: nativeShaderValidationSceneProfileSchema.refine(
      (value) => value.state === "available",
    ),
  })
  .strict()
  .refine(
    (value) =>
      (value.gpuScope === "latest-sampled-mount-not-full-scene"
        ? value.gpuTargetInstanceId === undefined &&
          value.gpuAfterFrameIndex === undefined &&
          value.gpuThroughFrameIndex === undefined &&
          value.gpuWindow === undefined
        : value.gpuTargetInstanceId !== undefined &&
          value.gpuAfterFrameIndex !== undefined &&
          value.profileAtEnd.state === "available" &&
          value.profileAtEnd.gpuTargetInstanceId ===
            value.gpuTargetInstanceId &&
          value.profileAtEnd.gpuScope === value.gpuScope &&
          (value.profileAtEnd.gpu.kind !== "ready" ||
            value.profileAtEnd.gpu.frameIndex > value.gpuAfterFrameIndex)) &&
      value.renderWallMs.count === value.measuredRenderFrames &&
      value.sourceWallMs.count === value.measuredRenderFrames &&
      value.composeWallMs.count === value.measuredRenderFrames &&
      (!value.hostWallPhases ||
        Object.values(value.hostWallPhases.stats).every(
          (stats) => stats.count === value.measuredRenderFrames,
        )) &&
      (!value.fullFrameWallPhases ||
        [
          ...Object.values(value.fullFrameWallPhases.stats),
          ...Object.values(value.fullFrameWallPhases.scenePresentation.stats),
        ].every((stats) => stats.count === value.measuredRenderFrames)) &&
      (!value.sourceReadDetail ||
        Object.values(value.sourceReadDetail.stats).every(
          (stats) => stats.count === value.measuredRenderFrames,
        )) &&
      (!value.sourceReadDetail || value.fullFrameWallPhases !== undefined) &&
      (!value.sourceReadDetail ||
        value.sourceReadDetail.stats.calls.max !== 0 ||
        (
          [
            "wallMs",
            "walkWallMs",
            "validationWallMs",
            "leafWaitWallMs",
          ] as const
        ).every((key) => value.sourceReadDetail!.stats[key].max === 0)) &&
      value.deadlines.over120Hz >= value.deadlines.over60Hz,
    "mounted measurement counts must agree",
  )
  .refine(
    (value) =>
      !value.fullFrameWallPhases ||
      (["p50", "p95", "p99", "max"] as const).every(
        (key) =>
          value.fullFrameWallPhases!.stats.renderInternalWallMs[key] ===
            value.renderWallMs[key] &&
          Object.values(value.fullFrameWallPhases!.stats).every(
            (stats) => stats[key] <= value.renderWallMs[key],
          ) &&
          Object.values(
            value.fullFrameWallPhases!.scenePresentation.stats,
          ).every(
            (stats) =>
              stats[key] <=
              value.fullFrameWallPhases!.stats.scenePresentationWallMs[key],
          ),
      ),
    "full frame wall phases must fit their enclosing intervals",
  )
  .refine(
    (value) =>
      !value.sourceReadDetail ||
      (["p50", "p95", "p99", "max"] as const).every((key) => {
        const stats = value.sourceReadDetail!.stats;
        return (
          stats.wallMs[key] <= value.renderWallMs[key] &&
          stats.walkWallMs[key] <= stats.wallMs[key] &&
          stats.validationWallMs[key] <= stats.wallMs[key] &&
          stats.leafWaitWallMs[key] <= stats.walkWallMs[key]
        );
      }),
    "source read wall phases must fit their enclosing intervals",
  )
  .refine(
    (value) =>
      (value.gpuThroughFrameIndex === undefined &&
        value.gpuWindow === undefined) ||
      (value.gpuThroughFrameIndex !== undefined &&
        value.gpuWindow !== undefined &&
        value.gpuAfterFrameIndex !== undefined &&
        value.gpuThroughFrameIndex >= value.gpuAfterFrameIndex &&
        value.gpuScope === "target-mount-command-encoder-not-full-scene" &&
        value.gpuWindow.targetInstanceId === value.gpuTargetInstanceId &&
        value.gpuWindow.afterFrameIndex === value.gpuAfterFrameIndex &&
        value.gpuWindow.throughFrameIndex === value.gpuThroughFrameIndex &&
        (value.profileAtEnd.state !== "available" ||
          value.profileAtEnd.gpu.kind !== "ready" ||
          value.profileAtEnd.gpu.frameIndex <= value.gpuThroughFrameIndex)),
    "GPU window must match its measurement boundaries and target",
  );
export type NativeShaderMountedMeasurement = z.infer<
  typeof nativeShaderMountedMeasurementSchema
>;

export const nativeMountedOutputSummarySchema = z
  .object({
    scope: z.literal("exact-mount-output-linear-premultiplied"),
    instanceId: identifier,
    nodeId: identifier,
    definitionId: identifier,
    definitionVersion: z.number().int().positive(),
    executionHash,
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
    pixelSha256: executionHash,
    nonTransparentPixels: z.number().int().nonnegative().max(4_194_304),
    partialAlphaPixels: z.number().int().nonnegative().max(4_194_304),
    nonZeroRgbaPixels: z.number().int().nonnegative().max(4_194_304),
    feedbackState: z
      .discriminatedUnion("availability", [
        z
          .object({
            availability: z.literal("available"),
            scope: z.literal("exact-feedback-state-linear-rgba16f"),
            width: z.number().int().min(1).max(512),
            height: z.number().int().min(1).max(512),
            completedStep: z.number().int().nonnegative().max(36_000),
            byteLength: z.number().int().positive().max(2_097_152),
            sha256: executionHash,
            followups: z
              .object({
                sourceTransition: z
                  .object({
                    availability: z.literal("unavailable"),
                    code: z.literal("second-source-fixture-required"),
                  })
                  .strict(),
                lifecycleReplay: z
                  .object({
                    availability: z.literal("unavailable"),
                    code: z.literal("multi-action-editor-sequence-required"),
                  })
                  .strict(),
              })
              .strict(),
          })
          .strict()
          .refine(
            (state) => state.byteLength === state.width * state.height * 8,
            "feedback state byte length must match its exact RGBA16F extent",
          ),
        z
          .object({
            availability: z.literal("unavailable"),
            code: z.enum([
              "state-uninitialized",
              "state-snapshot-limit",
              "state-snapshot-budget",
            ]),
            followups: z
              .object({
                sourceTransition: z
                  .object({
                    availability: z.literal("unavailable"),
                    code: z.literal("second-source-fixture-required"),
                  })
                  .strict(),
                lifecycleReplay: z
                  .object({
                    availability: z.literal("unavailable"),
                    code: z.literal("multi-action-editor-sequence-required"),
                  })
                  .strict(),
              })
              .strict(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.width * value.height <= 4_194_304 &&
      value.nonTransparentPixels <= value.width * value.height &&
      value.partialAlphaPixels <= value.nonTransparentPixels &&
      value.nonZeroRgbaPixels <= value.width * value.height &&
      value.nonTransparentPixels <= value.nonZeroRgbaPixels,
    "mount coverage must fit its exact output extent",
  );
export type NativeMountedOutputSummary = z.infer<
  typeof nativeMountedOutputSummarySchema
>;

export const nativeShaderValidationCaseResultSchema = z
  .object({
    caseId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
    definitionId: identifier,
    definitionVersion: z.number().int().positive(),
    executionHash,
    backend: z.enum(["webgpu", "unavailable"]),
    status: z.enum(["ready", "error", "last-good", "unavailable"]),
    code: z.string().max(80).optional(),
    message: z.string().max(300).optional(),
    cleanupCode: z.string().max(80).optional(),
    cleanupMessage: z.string().max(300).optional(),
    renderWallMs: z.number().finite().min(0).max(120_000).optional(),
    sourceCaptures: z.number().int().nonnegative().max(1_000_000),
    frames: z.number().int().nonnegative().max(1_000_000),
    estimatedResourceBytes: z.number().int().nonnegative().max(1_073_741_824),
    sceneProfile: nativeShaderValidationSceneProfileSchema.optional(),
    mountedMeasurement: nativeShaderMountedMeasurementSchema.optional(),
    pixelSha256: executionHash.optional(),
    pixelWidth: z.number().int().positive().max(4096).optional(),
    pixelHeight: z.number().int().positive().max(4096).optional(),
    nonTransparentPixels: z
      .number()
      .int()
      .nonnegative()
      .max(4_194_304)
      .optional(),
    partialAlphaPixels: z
      .number()
      .int()
      .nonnegative()
      .max(4_194_304)
      .optional(),
    mountOutput: nativeMountedOutputSummarySchema.optional(),
    linearGolden: nativeLinearGoldenSummarySchema.optional(),
    fullScenePixelSamples: nativeFullScenePixelSamplesSchema.optional(),
    statefulRenderMode: z
      .enum(["fresh-held-replay", "same-held-session-sequence"])
      .optional(),
    statefulSequence: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.enum(["advance", "capture"]),
              stepId: nativeShaderValidationSequenceStepId,
              frameIndex: z.number().int().nonnegative().max(120),
              timeSeconds: z.number().finite().min(0).max(2),
              pixelSha256: executionHash,
              pixelWidth: z.number().int().positive().max(4096),
              pixelHeight: z.number().int().positive().max(4096),
              mountOutput: nativeMountedOutputSummarySchema,
              linearGolden: nativeLinearGoldenSummarySchema.optional(),
              comparisons: z
                .array(
                  z
                    .object({
                      referenceStepId: nativeShaderValidationSequenceStepId,
                      subject: z.enum(["feedback-state", "pixels"]),
                      expected: z.enum(["same", "different"]),
                      observed: z.enum(["same", "different", "unavailable"]),
                      passed: z.boolean(),
                    })
                    .strict(),
                )
                .max(2),
            })
            .strict(),
          z
            .object({
              kind: z.literal("set-params"),
              stepId: nativeShaderValidationSequenceStepId,
              updatedProperties: z
                .array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/))
                .min(1)
                .max(16),
            })
            .strict(),
        ]),
      )
      .min(2)
      .max(40)
      .optional(),
    presentationFault: z
      .object({
        kind: z.literal("simulated-gpu-validation"),
        simulated: z.literal(true),
        submitted: z.literal(true),
        scopeDrained: z.literal(true),
        grantId: z.string().uuid(),
        beforePreparedFrameCount: z.number().int().nonnegative(),
        preparedFrameCount: z.literal(1),
        priorFrameCount: z.number().int().positive(),
        afterFrameCount: z.number().int().positive(),
        pixelSource: z.literal("last-published-gpu-presentation"),
        pixelFormat: z.enum(["bgra8unorm", "rgba8unorm"]),
        beforePixelSha256: executionHash,
        afterPixelSha256: executionHash,
        pixelWidth: z.number().int().min(1).max(2048),
        pixelHeight: z.number().int().min(1).max(2048),
        nonTransparentPixels: z.number().int().min(1).max(1_048_576),
      })
      .strict()
      .refine(
        (fault) =>
          fault.priorFrameCount === fault.beforePreparedFrameCount + 1 &&
          fault.afterFrameCount === fault.priorFrameCount,
        "the prepared frame must publish once and the fault must publish none",
      )
      .optional(),
  })
  .strict()
  .refine(
    (result) =>
      result.nonTransparentPixels === undefined ||
      (result.pixelWidth !== undefined &&
        result.pixelHeight !== undefined &&
        result.nonTransparentPixels <= result.pixelWidth * result.pixelHeight),
    "pixel coverage must fit the validated frame",
  )
  .refine(
    (result) =>
      result.partialAlphaPixels === undefined ||
      (result.nonTransparentPixels !== undefined &&
        result.partialAlphaPixels <= result.nonTransparentPixels),
    "partial alpha coverage must fit nontransparent coverage",
  )
  .refine(
    (result) => !result.mountedMeasurement || result.status === "ready",
    "a mounted measurement requires a ready result",
  )
  .refine(
    (result) =>
      result.status !== "ready" ||
      (result.backend === "webgpu" && result.frames > 0),
    "a ready result requires WebGPU and a rendered frame",
  )
  .refine(
    (result) =>
      !result.presentationFault ||
      result.frames === result.presentationFault.afterFrameCount,
    "fault result frames must match the retained presentation",
  )
  .refine(
    (result) =>
      (result.statefulRenderMode !== "same-held-session-sequence") ===
      (result.statefulSequence === undefined),
    "same-session sequence mode requires its bounded step receipts",
  )
  .refine(
    (result) =>
      !result.statefulSequence ||
      result.statefulRenderMode === "same-held-session-sequence",
    "sequence step receipts require same-session mode",
  )
  .refine(
    (result) =>
      result.status !== "ready" ||
      !result.statefulSequence?.some(
        (step) =>
          step.kind !== "set-params" &&
          (step.comparisons.some((comparison) => !comparison.passed) ||
            (step.kind === "capture" &&
              step.linearGolden !== undefined &&
              !step.linearGolden.passed)),
      ),
    "a ready sequence requires passing comparisons",
  );

export const nativePresentationFaultFailureCodes = [
  "presentation-fault-mirror-unavailable",
  "presentation-fault-pixels-unbounded",
  "presentation-fault-color-unsupported",
  "presentation-fault-gpu-readback-failed",
  "presentation-fault-device-changed",
  "presentation-fault-empty-prior",
  "presentation-fault-proof-incomplete",
  "presentation-fault-published-pixels-changed",
  "gpu-budget-exceeded",
] as const;

export function isNativePresentationFaultFailureCode(
  value: unknown,
): value is (typeof nativePresentationFaultFailureCodes)[number] {
  return (
    typeof value === "string" &&
    nativePresentationFaultFailureCodes.some((code) => code === value)
  );
}

export const nativeShaderValidationFailureSchema = z
  .object({
    code: z.enum([
      "source-stale",
      "editor-left",
      "client-unavailable",
      "canceled",
      "validation-unreadable",
      "render-failed",
      ...nativePresentationFaultFailureCodes,
    ]),
    message: z.string().max(300),
  })
  .strict();

export const nativeShaderValidationStateSchema =
  nativeShaderValidationRequestSchema
    .safeExtend({
      schemaVersion: z.literal(1),
      requestId: z.string().uuid(),
      tabId: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/),
      status: z.enum([
        "pending",
        "running",
        "cancel-requested",
        "canceled",
        "validation-complete",
        "failed",
        "expired",
      ]),
      issuedAt: z.number().int().nonnegative(),
      expiresAt: z.number().int().nonnegative(),
      faultGrantState: z
        .object({
          grantId: z.string().uuid(),
          issuedAt: z.number().int().nonnegative(),
          expiresAt: z.number().int().nonnegative(),
        })
        .strict()
        .optional(),
      results: z
        .array(nativeShaderValidationCaseResultSchema)
        .max(4)
        .optional(),
      failure: nativeShaderValidationFailureSchema.optional(),
    })
    .strict();

export type NativeShaderValidationRequest = z.infer<
  typeof nativeShaderValidationRequestSchema
>;
export type NativeShaderValidationState = z.infer<
  typeof nativeShaderValidationStateSchema
>;
export type NativeShaderValidationCaseResult = z.infer<
  typeof nativeShaderValidationCaseResultSchema
>;

export function nativeShaderValidationStateKey(
  designId: string,
  tabId: string,
): string {
  return `native-shader-validation:${designId}:${tabId}`;
}
