import { createHash, randomUUID } from "node:crypto";

export type FaultKind = "simulated-gpu-validation";
export type ReviewedFaultPin = {
  designId: string;
  fileId: string;
  ownerTabId: string;
  sourceVersionHash: string;
  sourceSha256: string;
  caseId: string;
  instanceId: string;
  nodeId: string;
  definitionId: string;
  definitionVersion: number;
  executionHash: string;
  runtimeSha256: string;
};
export type FaultCase = {
  caseId: string;
  instanceId: string;
  nodeId: string;
  definitionId: string;
  definitionVersion: number;
  executionHash: string;
  timeSeconds: number;
  presentationFault?: FaultKind;
  fixture?: unknown;
  mountedFrame?: unknown;
  mountedMeasurement?: unknown;
  expectedLinearSamples?: unknown;
};
export type CanonicalFaultContext = {
  designId: string;
  fileId: string;
  ownerTabId: string;
  sourceVersionHash: string;
  sourceContent: string;
  generatedRuntimeIife: string;
  cases: readonly FaultCase[];
  enabledInstanceCount: number;
  targetPlacement: string;
};
export type FaultGrantState = {
  grantId: string;
  issuedAt: number;
  expiresAt: number;
};
export type PreparedFaultGrant = ReviewedFaultPin &
  FaultGrantState & {
    requestId: string;
    kind: FaultKind;
  };

const hex = /^[a-f0-9]{64}$/;
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const fields = [
  "designId",
  "fileId",
  "ownerTabId",
  "sourceVersionHash",
  "sourceSha256",
  "caseId",
  "instanceId",
  "nodeId",
  "definitionId",
  "definitionVersion",
  "executionHash",
  "runtimeSha256",
] as const;
const fail = (code: string): never => {
  throw new Error(code);
};

export function requireReviewedLiveFault(args: {
  environment: string;
  reviewedPin: ReviewedFaultPin | null;
  context: CanonicalFaultContext;
}): { pin: ReviewedFaultPin; kind: FaultKind } {
  if (args.environment !== "local" || !args.reviewedPin)
    fail("presentation-fault-local-review-required");
  const item = args.context.cases[0];
  if (!item || !item.presentationFault)
    throw new Error("presentation-fault-sole-live-case-required");
  const kind = item.presentationFault;
  if (
    args.context.cases.length !== 1 ||
    args.context.enabledInstanceCount !== 1 ||
    args.context.targetPlacement !== "layer" ||
    item.timeSeconds !== 0 ||
    item.fixture !== undefined ||
    item.mountedFrame !== undefined ||
    item.mountedMeasurement !== undefined ||
    item.expectedLinearSamples !== undefined
  )
    fail("presentation-fault-sole-live-case-required");
  const pin: ReviewedFaultPin = {
    designId: args.context.designId,
    fileId: args.context.fileId,
    ownerTabId: args.context.ownerTabId,
    sourceVersionHash: args.context.sourceVersionHash,
    sourceSha256: sha256(args.context.sourceContent),
    caseId: item.caseId,
    instanceId: item.instanceId,
    nodeId: item.nodeId,
    definitionId: item.definitionId,
    definitionVersion: item.definitionVersion,
    executionHash: item.executionHash,
    runtimeSha256: sha256(args.context.generatedRuntimeIife.trim()),
  };
  if (
    !hex.test(pin.sourceSha256) ||
    !hex.test(pin.executionHash) ||
    !hex.test(pin.runtimeSha256) ||
    fields.some((field) => pin[field] !== args.reviewedPin![field])
  )
    fail("presentation-fault-fixture-mismatch");
  return { pin, kind };
}

export function issueFaultGrant(args: {
  environment: string;
  reviewedPin: ReviewedFaultPin | null;
  context: CanonicalFaultContext;
  requestId: string;
  requestStatus: "running" | string;
  existing: FaultGrantState | undefined;
  now: number;
  makeId?: () => string;
}): PreparedFaultGrant {
  const { pin, kind } = requireReviewedLiveFault(args);
  if (
    args.requestStatus !== "running" ||
    args.existing ||
    !Number.isSafeInteger(args.now) ||
    args.now < 0 ||
    !/^[a-f0-9-]{36}$/.test(args.requestId)
  )
    fail("presentation-fault-not-preparable");
  const grantId = (args.makeId ?? randomUUID)();
  if (!/^[a-f0-9-]{36}$/.test(grantId))
    fail("presentation-fault-grant-id-invalid");
  return {
    ...pin,
    requestId: args.requestId,
    kind,
    grantId,
    issuedAt: args.now,
    expiresAt: args.now + 5000,
  };
}

export function requireFaultResult(args: {
  kind: FaultKind;
  result: {
    status: string;
    code?: string;
    simulated?: boolean;
    scopeDrained?: boolean;
    submitted?: boolean;
  };
}): void {
  const expected = "gpu-validation";
  if (
    args.result.status !== "last-good" ||
    args.result.code !== expected ||
    args.result.simulated !== true ||
    args.result.scopeDrained !== true ||
    args.result.submitted !== true
  )
    fail("presentation-fault-result-mismatch");
}

export const REVIEWED_LOCAL_FAULT_PIN: ReviewedFaultPin | null = null;
