import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  issueFaultGrant,
  requireFaultResult,
  requireReviewedLiveFault,
} from "./_native-presentation-fault-local.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const context = {
  designId: "owned-design",
  fileId: "owned-file",
  ownerTabId: "owned-tab",
  sourceVersionHash: "v1",
  sourceContent: "<html>owned source</html>",
  generatedRuntimeIife: "owned runtime",
  enabledInstanceCount: 1,
  targetPlacement: "layer",
  cases: [
    {
      caseId: "case-1",
      instanceId: "instance-1",
      nodeId: "node-1",
      definitionId: "owned-effect",
      definitionVersion: 1,
      executionHash: "a".repeat(64),
      timeSeconds: 0,
      presentationFault: "simulated-gpu-validation" as const,
    },
  ],
};
const pin = {
  designId: context.designId,
  fileId: context.fileId,
  ownerTabId: context.ownerTabId,
  sourceVersionHash: context.sourceVersionHash,
  sourceSha256: hash(context.sourceContent),
  caseId: "case-1",
  instanceId: "instance-1",
  nodeId: "node-1",
  definitionId: "owned-effect",
  definitionVersion: 1,
  executionHash: "a".repeat(64),
  runtimeSha256: hash(context.generatedRuntimeIife),
};
const base = { environment: "local", reviewedPin: pin, context };
const requestId = "00000000-0000-4000-8000-000000000001";
const grantId = "00000000-0000-4000-8000-000000000002";

describe("reviewed local presentation fault action boundary", () => {
  it("derives canonical byte hashes and refuses wrong source, runtime, owner, or reviewed pin", () => {
    expect(requireReviewedLiveFault(base).pin).toEqual(pin);
    for (const change of [
      { context: { ...context, sourceContent: context.sourceContent + " " } },
      {
        context: {
          ...context,
          generatedRuntimeIife: context.generatedRuntimeIife + "x",
        },
      },
      { context: { ...context, ownerTabId: "other-tab" } },
      {
        context: {
          ...context,
          cases: [{ ...context.cases[0], executionHash: "b".repeat(64) }],
        },
      },
      { environment: "production" },
      { reviewedPin: null },
    ])
      expect(() => requireReviewedLiveFault({ ...base, ...change })).toThrow();
  });

  it("requires the sole live layer case at time zero", () => {
    for (const item of [
      { ...context.cases[0], fixture: {} },
      { ...context.cases[0], mountedFrame: {} },
      { ...context.cases[0], mountedMeasurement: {} },
      { ...context.cases[0], expectedLinearSamples: [] },
      { ...context.cases[0], timeSeconds: 1 / 60 },
    ])
      expect(() =>
        requireReviewedLiveFault({
          ...base,
          context: { ...context, cases: [item] },
        }),
      ).toThrow("presentation-fault-sole-live-case-required");
    expect(() =>
      requireReviewedLiveFault({
        ...base,
        context: { ...context, cases: [...context.cases, ...context.cases] },
      }),
    ).toThrow();
    expect(() =>
      requireReviewedLiveFault({
        ...base,
        context: { ...context, targetPlacement: "fill" },
      }),
    ).toThrow();
  });

  it("issues one bounded five-second grant only after claim", () => {
    const grant = issueFaultGrant({
      ...base,
      requestId,
      requestStatus: "running",
      existing: undefined,
      now: 1000,
      makeId: () => grantId,
    });
    expect(grant).toMatchObject({
      grantId,
      issuedAt: 1000,
      expiresAt: 6000,
      runtimeSha256: pin.runtimeSha256,
    });
    expect(() =>
      issueFaultGrant({
        ...base,
        requestId,
        requestStatus: "running",
        existing: grant,
        now: 1001,
      }),
    ).toThrow("presentation-fault-not-preparable");
    expect(() =>
      issueFaultGrant({
        ...base,
        requestId,
        requestStatus: "pending",
        existing: undefined,
        now: 1001,
      }),
    ).toThrow("presentation-fault-not-preparable");
  });

  it("refuses ordinary ready, undrained scope, or unsubmitted simulated results", () => {
    const result = {
      status: "last-good",
      code: "gpu-validation",
      simulated: true,
      scopeDrained: true,
      submitted: true,
    };
    expect(() =>
      requireFaultResult({ kind: "simulated-gpu-validation", result }),
    ).not.toThrow();
    for (const invalid of [
      { status: "ready" },
      { scopeDrained: false },
      { submitted: false },
      { simulated: false },
    ])
      expect(() =>
        requireFaultResult({
          kind: "simulated-gpu-validation",
          result: { ...result, ...invalid },
        }),
      ).toThrow("presentation-fault-result-mismatch");
  });
});
