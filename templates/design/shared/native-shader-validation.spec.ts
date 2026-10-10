import { describe, expect, it } from "vitest";

import {
  nativeLinearGoldenSummarySchema,
  nativeShaderValidationCaseSchema,
  nativeShaderValidationCaseResultSchema,
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
