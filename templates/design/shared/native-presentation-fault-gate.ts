import type { NativePresentationFaultRuntimeTarget } from "./native-presentation-fault-pin.js";

export type NativePresentationFaultKind = "simulated-gpu-validation";
export type NativePresentationFaultGrant =
  NativePresentationFaultRuntimeTarget & {
    runtimeSha256: string;
    requestId: string;
    grantId: string;
    kind: NativePresentationFaultKind;
    issuedAt: number;
    expiresAt: number;
  };
const sha = /^[a-f0-9]{64}$/;
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const isFaultKind = (value: unknown): value is NativePresentationFaultKind =>
  value === "simulated-gpu-validation";
const pinFields = [
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
] as const;
export class NativePresentationFaultLatch {
  private grant: NativePresentationFaultGrant | null = null;
  private consumedIds = new Set<string>();

  arm(
    grant: NativePresentationFaultGrant,
    reviewedPin: NativePresentationFaultRuntimeTarget | null,
    now: number,
  ): void {
    if (
      !reviewedPin ||
      this.grant ||
      this.consumedIds.has(grant.grantId) ||
      !isFaultKind(grant.kind) ||
      !uuid.test(grant.requestId) ||
      !uuid.test(grant.grantId) ||
      !sha.test(grant.runtimeSha256) ||
      !Number.isSafeInteger(grant.issuedAt) ||
      !Number.isSafeInteger(grant.expiresAt) ||
      now < grant.issuedAt ||
      now >= grant.expiresAt ||
      grant.expiresAt - grant.issuedAt > 5000 ||
      pinFields.some((field) => grant[field] !== reviewedPin[field])
    )
      throw new Error("presentation-fault-grant-invalid");
    this.grant = grant;
  }

  consume(args: {
    instanceId: string;
    nodeId: string;
    definitionId: string;
    definitionVersion: number;
    executionHash: string;
    runtimeSha256: string;
    now: number;
    scopeDrained: boolean;
    submitted: boolean;
    visibleOutputExists: boolean;
    eligibleTwoSurface: boolean;
  }): NativePresentationFaultKind | null {
    const grant = this.grant;
    if (!grant || grant.instanceId !== args.instanceId) return null;
    this.grant = null;
    this.consumedIds.add(grant.grantId);
    if (
      args.nodeId !== grant.nodeId ||
      args.definitionId !== grant.definitionId ||
      args.definitionVersion !== grant.definitionVersion ||
      args.executionHash !== grant.executionHash ||
      args.runtimeSha256 !== grant.runtimeSha256 ||
      args.now < grant.issuedAt ||
      args.now >= grant.expiresAt ||
      !args.scopeDrained ||
      !args.submitted ||
      !args.visibleOutputExists ||
      !args.eligibleTwoSurface
    )
      throw new Error("presentation-fault-frame-mismatch");
    return grant.kind;
  }

  pending(): boolean {
    return this.grant !== null;
  }
  clear(): void {
    this.grant = null;
  }
}
