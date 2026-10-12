import { describe, expect, it } from "vitest";

import {
  nativeLinearGoldenSummarySchema,
  nativeShaderValidationCaseSchema,
  nativeShaderValidationCaseResultSchema,
  nativeShaderValidationRequestSchema,
} from "./native-shader-validation";

const fixture = {
  sourceKind: "owned-image",
  aspect: "landscape",
  alpha: "transparent",
  rounded: false,
  seed: 7,
};

const baseCase = {
  caseId: "linearHdr",
  instanceId: "instance-1",
  nodeId: "image-1",
  definitionId: "effect-1",
  definitionVersion: 1,
  executionHash: "a".repeat(64),
  timeSeconds: 0,
  fixture,
};

describe("native validation linear golden contract", () => {
  it("accepts bounded numeric goldens on held-session control captures", () => {
    const sample = (x: number) => ({
      x,
      y: 0,
      expected: [0, 0, 0, 1] as [number, number, number, number],
      tolerance: 0.001,
    });
    const sequence = [
      { kind: "advance" as const, stepId: "start" },
      ...Array.from({ length: 17 }, (_, index) => [
        {
          kind: "set-params" as const,
          stepId: `set_${index}`,
          params: { amount: index },
        },
        {
          kind: "capture" as const,
          stepId: `sample_${index}`,
          expectedLinearSamples: Array.from(
            { length: index < 12 ? 2 : 1 },
            (_, sampleIndex) => sample(index * 2 + sampleIndex),
          ),
        },
      ]).flat(),
    ];
    const request = {
      ...baseCase,
      fixture: undefined,
      mountedFrame: { viewport: { width: 64, height: 8 }, pixelRatio: 1 },
      statefulSequence: sequence,
    };
    expect(nativeShaderValidationCaseSchema.safeParse(request).success).toBe(
      true,
    );
    const overSampled = structuredClone(request);
    overSampled.statefulSequence[2] = {
      kind: "capture",
      stepId: "sample_0",
      expectedLinearSamples: Array.from({ length: 33 }, (_, index) =>
        sample(index),
      ),
    };
    expect(
      nativeShaderValidationCaseSchema.safeParse(overSampled).success,
    ).toBe(false);
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...request,
        captureFeedbackState: true,
      }).success,
    ).toBe(false);
    const tooManyParameterWrites = [
      { kind: "advance" as const, stepId: "initial" },
      ...Array.from({ length: 5 }, (_, index) => ({
        kind: "set-params" as const,
        stepId: `set_${index}`,
        params: Object.fromEntries(
          Array.from({ length: 16 }, (_value, propertyIndex) => [
            `p${propertyIndex}`,
            index,
          ]),
        ),
      })),
      {
        kind: "capture" as const,
        stepId: "sample",
        expectedLinearSamples: [sample(0)],
      },
    ];
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...request,
        statefulSequence: tooManyParameterWrites,
      }).success,
    ).toBe(false);
  });

  it("keeps the feedback sequence bounds while ordinary captures use the wider limit", () => {
    const feedbackSteps = (captureCount: number, total: number) => {
      const captures = new Set([
        ...Array.from({ length: Math.max(0, captureCount - 1) }, (_, i) => i),
        total - 2,
      ]);
      return [
        { kind: "advance", stepId: "start" },
        ...Array.from({ length: total - 1 }, (_, slot) =>
          captures.has(slot)
            ? { kind: "capture", stepId: `capture_${slot}` }
            : {
                kind: "set-params",
                stepId: `set_${slot}`,
                params: { phase: slot },
              },
        ),
      ];
    };
    const feedbackCase = {
      ...baseCase,
      fixture: undefined,
      mountedFrame: { viewport: { width: 64, height: 8 }, pixelRatio: 1 },
      captureFeedbackState: true,
    };
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...feedbackCase,
        statefulSequence: feedbackSteps(8, 12),
      }).success,
    ).toBe(true);
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...feedbackCase,
        statefulSequence: feedbackSteps(9, 12),
      }).success,
    ).toBe(false);
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...feedbackCase,
        statefulSequence: feedbackSteps(8, 13),
      }).success,
    ).toBe(false);
  });

  it("accepts numeric sequence receipts without inventing feedback snapshots", () => {
    const result = {
      caseId: "linearHdr",
      definitionId: "effect-1",
      definitionVersion: 1,
      executionHash: "a".repeat(64),
      backend: "webgpu",
      status: "ready",
      frames: 1,
      sourceCaptures: 0,
      estimatedResourceBytes: 128,
      statefulRenderMode: "same-held-session-sequence",
      statefulSequence: [
        {
          kind: "advance",
          stepId: "start",
          frameIndex: 0,
          timeSeconds: 0,
          pixelSha256: "b".repeat(64),
          pixelWidth: 8,
          pixelHeight: 8,
          mountOutput: {
            scope: "exact-mount-output-linear-premultiplied",
            instanceId: "instance-1",
            nodeId: "image-1",
            definitionId: "effect-1",
            definitionVersion: 1,
            executionHash: "a".repeat(64),
            width: 8,
            height: 8,
            pixelSha256: "c".repeat(64),
            nonTransparentPixels: 64,
            partialAlphaPixels: 0,
            nonZeroRgbaPixels: 64,
          },
          comparisons: [],
        },
        {
          kind: "capture",
          stepId: "control",
          frameIndex: 0,
          timeSeconds: 0,
          pixelSha256: "d".repeat(64),
          pixelWidth: 8,
          pixelHeight: 8,
          mountOutput: {
            scope: "exact-mount-output-linear-premultiplied",
            instanceId: "instance-1",
            nodeId: "image-1",
            definitionId: "effect-1",
            definitionVersion: 1,
            executionHash: "a".repeat(64),
            width: 8,
            height: 8,
            pixelSha256: "e".repeat(64),
            nonTransparentPixels: 64,
            partialAlphaPixels: 0,
            nonZeroRgbaPixels: 64,
          },
          linearGolden: { sampleCount: 1, maxAbsError: 0, passed: true },
          comparisons: [],
        },
      ],
    };
    expect(
      nativeShaderValidationCaseResultSchema.safeParse(result).success,
    ).toBe(true);
  });

  it("requires a bounded mounted frame for typed feedback state capture", () => {
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...baseCase,
        fixture: undefined,
        mountedFrame: {
          viewport: { width: 128, height: 128 },
          pixelRatio: 1,
        },
        captureFeedbackState: true,
      }).success,
    ).toBe(true);
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...baseCase,
        captureFeedbackState: true,
      }).success,
    ).toBe(false);
  });

  it("accepts bounded signed float samples for clean fixtures or an exact mounted frame", () => {
    const sample = {
      x: 14,
      y: 8,
      expected: [-0.25, 2.5, 0.75, 0.5],
      tolerance: 0.002,
    };
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...baseCase,
        expectedLinearSamples: [sample],
      }).success,
    ).toBe(true);
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...baseCase,
        fixture: undefined,
        expectedLinearSamples: [sample],
      }).success,
    ).toBe(false);
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...baseCase,
        fixture: undefined,
        mountedFrame: {
          viewport: { width: 200, height: 180 },
          pixelRatio: 2,
        },
        timeSeconds: 1.5,
        expectedLinearSamples: [sample],
      }).success,
    ).toBe(true);
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...baseCase,
        expectedLinearSamples: [sample, sample],
      }).success,
    ).toBe(false);
  });

  it("rejects unbounded mounted readback, conflicting fixtures, and off-frame coordinates", () => {
    const sample = {
      x: 199,
      y: 359,
      expected: [0, 0, 0, 1],
      tolerance: 0.005,
    };
    const mounted = {
      ...baseCase,
      fixture: undefined,
      mountedFrame: {
        viewport: { width: 200, height: 180 },
        pixelRatio: 2,
      },
      timeSeconds: 1.5,
      expectedLinearSamples: [sample],
    };
    expect(nativeShaderValidationCaseSchema.safeParse(mounted).success).toBe(
      true,
    );
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...mounted,
        mountedFrame: {
          viewport: { width: 1160, height: 450 },
          pixelRatio: 1,
        },
        expectedLinearSamples: undefined,
      }).success,
    ).toBe(true);
    for (const invalid of [
      { ...mounted, fixture },
      { ...mounted, timeSeconds: 1.51 },
      { ...mounted, timeSeconds: 2.5 },
      { ...mounted, expectedLinearSamples: [{ ...sample, y: 360 }] },
      {
        ...mounted,
        mountedFrame: { ...mounted.mountedFrame, pixelRatio: 2.01 },
      },
      {
        ...mounted,
        mountedFrame: { viewport: { width: 2049, height: 180 }, pixelRatio: 2 },
      },
      {
        ...mounted,
        mountedFrame: {
          viewport: { width: 2048, height: 2048 },
          pixelRatio: 2,
        },
      },
    ])
      expect(nativeShaderValidationCaseSchema.safeParse(invalid).success).toBe(
        false,
      );
  });

  it("rejects unbounded, nonfinite, and unreadable golden metrics", () => {
    const sample = {
      x: 8192,
      y: 0,
      expected: [0, 0, 0, 1],
      tolerance: 0.01,
    };
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...baseCase,
        expectedLinearSamples: [sample],
      }).success,
    ).toBe(false);
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...baseCase,
        expectedLinearSamples: [{ ...sample, x: 0, tolerance: NaN }],
      }).success,
    ).toBe(false);
    expect(
      nativeLinearGoldenSummarySchema.safeParse({
        sampleCount: 1,
        maxAbsError: Infinity,
        passed: false,
      }).success,
    ).toBe(false);
  });

  it("requires published GPU presentation provenance on simulated fault results", () => {
    const fault = {
      kind: "simulated-gpu-validation",
      simulated: true,
      submitted: true,
      scopeDrained: true,
      grantId: "00000000-0000-4000-8000-000000000001",
      beforePreparedFrameCount: 1,
      preparedFrameCount: 1,
      priorFrameCount: 2,
      afterFrameCount: 2,
      pixelSource: "last-published-gpu-presentation",
      pixelFormat: "bgra8unorm",
      beforePixelSha256: "b".repeat(64),
      afterPixelSha256: "b".repeat(64),
      pixelWidth: 513,
      pixelHeight: 385,
      nonTransparentPixels: 1,
    };
    const result = {
      caseId: "fault",
      definitionId: "effect-1",
      definitionVersion: 1,
      executionHash: "a".repeat(64),
      backend: "webgpu",
      status: "last-good",
      code: "gpu-validation",
      frames: 2,
      sourceCaptures: 0,
      estimatedResourceBytes: 4096,
      presentationFault: fault,
    };
    expect(
      nativeShaderValidationCaseResultSchema.safeParse(result).success,
    ).toBe(true);
    for (const invalid of [
      { pixelSource: "canvas-2d-post-present" },
      { pixelSource: undefined },
      { pixelFormat: "rgba16float" },
      { beforePixelSha256: "bad" },
      { beforePreparedFrameCount: 0 },
      { preparedFrameCount: 0 },
      { priorFrameCount: 3 },
      { afterFrameCount: 3 },
    ])
      expect(
        nativeShaderValidationCaseResultSchema.safeParse({
          ...result,
          presentationFault: { ...fault, ...invalid },
        }).success,
      ).toBe(false);
    expect(
      nativeShaderValidationCaseResultSchema.safeParse({
        ...result,
        frames: 1,
      }).success,
    ).toBe(false);
  });
});

describe("native full-scene pixel sample contract", () => {
  const coordinates = Array.from({ length: 20 }, (_, index) => ({
    x: index,
    y: 0,
  }));
  const mounted = {
    ...baseCase,
    fixture: undefined,
    mountedFrame: { viewport: { width: 20, height: 10 }, pixelRatio: 1 },
    scenePixelSampleCoordinates: coordinates,
  };

  it("bounds full-scene coordinates independently from mount-local linear goldens", () => {
    expect(nativeShaderValidationCaseSchema.safeParse(mounted).success).toBe(
      true,
    );
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...mounted,
        scenePixelSampleCoordinates: [...coordinates, { x: 20, y: 0 }],
      }).success,
    ).toBe(false);
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...mounted,
        scenePixelSampleCoordinates: [{ x: 20, y: 0 }],
      }).success,
    ).toBe(false);
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...mounted,
        scenePixelSampleCoordinates: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      }).success,
    ).toBe(false);
    expect(
      nativeShaderValidationCaseSchema.safeParse({
        ...mounted,
        statefulSequence: [
          { kind: "advance", stepId: "a" },
          {
            kind: "capture",
            stepId: "b",
            expectedLinearSamples: [
              { x: 0, y: 0, expected: [0, 0, 0, 1], tolerance: 0 },
            ],
          },
        ],
        scenePixelSampleCoordinates: [{ x: 0, y: 0 }],
      }).success,
    ).toBe(false);
  });

  it("caps the total scene samples across a multi-case request", () => {
    const caseWith = (caseId: string, count: number) => ({
      ...mounted,
      caseId,
      scenePixelSampleCoordinates: Array.from(
        { length: count },
        (_, index) => ({
          x: index,
          y: 0,
        }),
      ),
    });
    const input = {
      designId: "design-1",
      fileId: "file-1",
      expectedVersionHash: "source-v1",
      cases: [caseWith("one", 10), caseWith("two", 10)],
    };
    expect(nativeShaderValidationRequestSchema.safeParse(input).success).toBe(
      true,
    );
    expect(
      nativeShaderValidationRequestSchema.safeParse({
        ...input,
        cases: [caseWith("one", 11), caseWith("two", 10)],
      }).success,
    ).toBe(false);
  });

  it("records exact sRGB straight-alpha values and rejects coordinates outside the returned extent", () => {
    const value = {
      scope: "full-scene-composition-srgb-straight-u8",
      requestId: "00000000-0000-4000-8000-000000000001",
      sourceVersionHash: "source-v1",
      frameIndex: 30,
      timeSeconds: 0.5,
      width: 20,
      height: 10,
      pixelRatio: 1,
      colorSpace: "srgb",
      alpha: "straight",
      samples: [{ x: 19, y: 9, rgba8: [12, 34, 56, 0] }],
    };
    const result = {
      caseId: "linearHdr",
      definitionId: "effect-1",
      definitionVersion: 1,
      executionHash: "a".repeat(64),
      backend: "webgpu",
      status: "ready",
      frames: 1,
      sourceCaptures: 0,
      estimatedResourceBytes: 128,
      fullScenePixelSamples: value,
    };
    expect(
      nativeShaderValidationCaseResultSchema.safeParse(result).success,
    ).toBe(true);
    expect(
      nativeShaderValidationCaseResultSchema.safeParse({
        ...result,
        fullScenePixelSamples: {
          ...value,
          samples: [{ x: 20, y: 9, rgba8: [12, 34, 56, 0] }],
        },
      }).success,
    ).toBe(false);
    expect(
      nativeShaderValidationCaseResultSchema.safeParse({
        ...result,
        fullScenePixelSamples: {
          ...value,
          alpha: "premultiplied",
        },
      }).success,
    ).toBe(false);
  });
});
