import { createRequire } from "node:module";
import path from "node:path";

import {
  ANC_V1_VAULT_BOOTSTRAP_FRAME_MAX_BYTES,
  E2EE_SIZE_LIMITS,
} from "@agent-native/core/e2ee";
import type {
  NativeAcknowledgeHostedResultRequest,
  NativeAcknowledgeHostedResultResult,
  NativeHealthResult,
  NativeLockResult,
  NativeOpenHostedJobRequest,
  NativeOpenHostedJobResult,
  NativeRecoverHostedResultRequest,
  NativeRecoverHostedResultResult,
  NativeSealHostedResultRequest,
  NativeSealHostedResultResult,
  NativeSignEndpointRequestRequest,
  NativeSignEndpointRequestResult,
  NativeUnlockResult,
} from "@agent-native/private-vault-broker";

import type {
  PrivateVaultBootstrapPageAcceptance,
  PrivateVaultBootstrapPageConsumer,
} from "./content-bootstrap-transport.js";
import type {
  PendingPrivateVaultGenesis,
  PrivateVaultEndpointAuthenticatedRequest,
  PrivateVaultGenesisAdmissionResult,
  PrivateVaultTrustedGenesisOperator,
} from "./genesis-admission-coordinator.js";

const SERVICE_VERSION = 1 as const;
const XPC_PROTOCOL_VERSION = 3 as const;
const SERVICE_SUITE = "anc/v1" as const;
const PACKAGED_ADDON_NAME = "private-vault-xpc-client.node";

type RotationAckState =
  | "unavailable"
  | "idle"
  | "pending"
  | "retrying"
  | "attention";

type NativeOperation =
  | "health"
  | "lock"
  | "unlock"
  | "resume_rotation"
  | "commit_genesis"
  | "create_genesis"
  | "list_genesis"
  | "authorize_admit"
  | "accept_admit"
  | "finalize_genesis"
  | "accept_bootstrap"
  | "recover_begin"
  | "recover_page"
  | "recover_status"
  | "open_job"
  | "seal_result"
  | "complete_result"
  | "pending_result"
  | "sign_request"
  | "prepare_enroll"
  | "challenge_enroll"
  | "confirm_enroll"
  | "authorize_enroll"
  | "activate_enroll";

interface NativeAddon {
  request(
    operation: NativeOperation,
    ...arguments_: Array<string | number | Buffer>
  ): Promise<unknown>;
}

type NativeAddonLoader = () => Promise<NativeAddon>;

export interface PrivateVaultNativeServiceClient
  extends
    PrivateVaultTrustedGenesisOperator,
    PrivateVaultBootstrapPageConsumer {
  health(): Promise<NativeHealthResult>;
  lock(): Promise<NativeLockResult>;
  unlock(vaultId: string): Promise<NativeUnlockResult>;
  openHostedJob(
    request: NativeOpenHostedJobRequest,
  ): Promise<NativeOpenHostedJobResult>;
  sealHostedResult(
    request: NativeSealHostedResultRequest,
  ): Promise<NativeSealHostedResultResult>;
  acknowledgeHostedResult(
    request: NativeAcknowledgeHostedResultRequest,
  ): Promise<NativeAcknowledgeHostedResultResult>;
  recoverHostedResult(
    request: NativeRecoverHostedResultRequest,
  ): Promise<NativeRecoverHostedResultResult>;
  signEndpointRequest(
    request: NativeSignEndpointRequestRequest,
  ): Promise<NativeSignEndpointRequestResult>;
  resumeRotation(vaultId: string): Promise<NativeResumeRotationResult>;
  commitGenesis(
    input: NativeCommitGenesisInput,
  ): Promise<NativeCommitGenesisResult>;
  parseBootstrapFrame(
    encoded: Uint8Array,
  ): Promise<NativeParsedBootstrapFrameResult>;
  prepareBrokerEnrollment(
    vaultId: string,
  ): Promise<NativePrepareEnrollmentResult>;
  buildBrokerEnrollmentChallenge(input: {
    readonly vaultId: string;
  }): Promise<NativeEnrollmentAuthorizerResult>;
  confirmBrokerEnrollment(
    vaultId: string,
    challenge: Uint8Array,
  ): Promise<NativeConfirmEnrollmentResult>;
  buildBrokerEnrollmentAuthorization(input: {
    readonly vaultId: string;
    readonly challenge: Uint8Array;
  }): Promise<NativeEnrollmentAuthorizerResult>;
  activateBrokerEnrollment(
    vaultId: string,
    challenge: Uint8Array,
    authorization: Uint8Array,
  ): Promise<NativeActivateEnrollmentResult>;
}

export interface NativeEnrollmentAuthorizerResult {
  readonly encoded: Uint8Array;
}

export interface NativePrepareEnrollmentResult {
  readonly version: typeof SERVICE_VERSION;
  readonly suite: typeof SERVICE_SUITE;
  readonly operation: "prepare_enroll";
  readonly state: "offered";
  readonly vaultId: string;
  readonly candidateEndpointId: string;
  readonly offerHash: string;
  readonly offer: Uint8Array;
  readonly candidateKeyProof: Uint8Array;
}

export interface NativeConfirmEnrollmentResult {
  readonly version: typeof SERVICE_VERSION;
  readonly suite: typeof SERVICE_SUITE;
  readonly operation: "confirm_enroll";
  readonly state: "confirmed" | "mismatch";
}

export interface NativeActivateEnrollmentResult {
  readonly version: typeof SERVICE_VERSION;
  readonly suite: typeof SERVICE_SUITE;
  readonly operation: "activate_enroll";
  readonly state: "active";
  readonly vaultId: string;
  readonly custodyGeneration: 3;
  readonly activeEpoch: number;
  readonly sequence: number;
  readonly headHash: string;
}

export interface NativeParsedBootstrapFrameResult {
  readonly version: typeof SERVICE_VERSION;
  readonly suite: typeof SERVICE_SUITE;
  readonly operation: "accept_bootstrap";
  readonly state: "parsed";
  readonly vaultId: string;
  readonly throughSequence: number;
  readonly headSequence: number;
  readonly headHash: string;
  readonly complete: boolean;
}

export interface NativeCommitGenesisInput {
  readonly operation: "commit_genesis";
  readonly recoveryConfirmation: Uint8Array;
  readonly bootstrapTranscript: Uint8Array;
  readonly authorization: Uint8Array;
}

export interface NativeCommitGenesisResult {
  readonly version: typeof SERVICE_VERSION;
  readonly suite: typeof SERVICE_SUITE;
  readonly operation: "commit_genesis";
  readonly state: "committed";
  readonly vaultId: string;
  readonly custodyGeneration: 2;
  readonly activeEpoch: 1;
  readonly sequence: 0;
  readonly headHash: string;
  readonly membershipHash: string;
  readonly recoveryGeneration: 1;
  readonly recoveryWrapHash: string;
}

export interface NativeResumeRotationResult {
  readonly version: typeof SERVICE_VERSION;
  readonly suite: typeof SERVICE_SUITE;
  readonly operation: "resume_rotation";
  readonly state: "consumed";
  readonly vaultId: string;
  readonly custodyGeneration: number;
  readonly activeEpoch: number;
  readonly sequence: number;
  readonly headHash: string;
}

export class PrivateVaultNativeServiceClientError extends Error {
  constructor() {
    super("Private Vault native service unavailable");
    this.name = "PrivateVaultNativeServiceClientError";
  }
}

function unavailableHealth(): NativeHealthResult {
  return Object.freeze({
    version: SERVICE_VERSION,
    suite: SERVICE_SUITE,
    operation: "health",
    state: "unavailable",
    available: false,
    ready: false,
    unlocked: false,
    rotationAckState: "unavailable",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(record);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(record, key))
  );
}

function parseHealth(value: unknown): NativeHealthResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "operation",
      "state",
      "available",
      "rotationAckState",
    ]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "health" ||
    typeof value.available !== "boolean" ||
    !["unavailable", "uninitialized", "locked", "unlocked", "closed"].includes(
      value.state as string,
    ) ||
    value.available !== (value.state !== "unavailable") ||
    !["unavailable", "idle", "pending", "retrying", "attention"].includes(
      value.rotationAckState as string,
    ) ||
    (value.state === "unavailable") !==
      (value.rotationAckState === "unavailable")
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }

  const state = value.state as NativeHealthResult["state"];
  return Object.freeze({
    version: SERVICE_VERSION,
    suite: SERVICE_SUITE,
    operation: "health",
    state,
    available: value.available,
    ready: state === "locked" || state === "unlocked",
    unlocked: state === "unlocked",
    rotationAckState: value.rotationAckState as RotationAckState,
  });
}

function parseLock(value: unknown): NativeLockResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "operation", "state"]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "lock" ||
    value.state !== "locked"
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return Object.freeze({
    version: SERVICE_VERSION,
    suite: SERVICE_SUITE,
    operation: "lock",
    state: "locked",
  });
}

function parseUnlock(value: unknown): NativeUnlockResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "operation", "state"]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "unlock" ||
    value.state !== "unlocked"
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return Object.freeze({
    version: SERVICE_VERSION,
    suite: SERVICE_SUITE,
    operation: "unlock",
    state: "unlocked",
  });
}

function isLowerHex(value: unknown, length: number): value is string {
  return (
    typeof value === "string" &&
    value.length === length &&
    /^[0-9a-f]+$/.test(value)
  );
}

function isSafeInteger(value: unknown, positive: boolean): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    (positive ? value > 0 : value >= 0)
  );
}

function parseResumeRotation(
  value: unknown,
  expectedVaultId: string,
): NativeResumeRotationResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "operation",
      "state",
      "vaultId",
      "custodyGeneration",
      "activeEpoch",
      "sequence",
      "headHash",
    ]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "resume_rotation" ||
    value.state !== "consumed" ||
    value.vaultId !== expectedVaultId ||
    !isLowerHex(value.vaultId, 32) ||
    !isLowerHex(value.headHash, 64) ||
    !isSafeInteger(value.custodyGeneration, true) ||
    !isSafeInteger(value.activeEpoch, true) ||
    !isSafeInteger(value.sequence, false)
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return Object.freeze({
    version: SERVICE_VERSION,
    suite: SERVICE_SUITE,
    operation: "resume_rotation",
    state: "consumed",
    vaultId: value.vaultId,
    custodyGeneration: value.custodyGeneration,
    activeEpoch: value.activeEpoch,
    sequence: value.sequence,
    headHash: value.headHash,
  });
}

function parsePrepareEnrollment(
  value: unknown,
  expectedVaultId: string,
): NativePrepareEnrollmentResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "operation",
      "state",
      "vaultId",
      "candidateEndpointId",
      "offerHash",
      "offer",
      "candidateKeyProof",
    ]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "prepare_enroll" ||
    value.state !== "offered" ||
    value.vaultId !== expectedVaultId ||
    !isLowerHex(value.vaultId, 32) ||
    !isLowerHex(value.candidateEndpointId, 32) ||
    !isLowerHex(value.offerHash, 64) ||
    !(value.candidateKeyProof instanceof Uint8Array) ||
    value.candidateKeyProof.byteLength !== 64
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return Object.freeze({
    version: SERVICE_VERSION,
    suite: SERVICE_SUITE,
    operation: "prepare_enroll",
    state: "offered",
    vaultId: value.vaultId,
    candidateEndpointId: value.candidateEndpointId,
    offerHash: value.offerHash,
    offer: copyBoundedBytes(value.offer, 1024),
    candidateKeyProof: copyBoundedBytes(value.candidateKeyProof, 64),
  });
}

function parseConfirmEnrollment(value: unknown): NativeConfirmEnrollmentResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "operation", "state"]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "confirm_enroll" ||
    (value.state !== "confirmed" && value.state !== "mismatch")
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return Object.freeze({
    version: SERVICE_VERSION,
    suite: SERVICE_SUITE,
    operation: "confirm_enroll",
    state: value.state,
  });
}

function parseEnrollmentAuthorizerResult(
  value: unknown,
  operation: "challenge_enroll" | "authorize_enroll",
  expectedVaultId: string,
): NativeEnrollmentAuthorizerResult {
  const field =
    operation === "challenge_enroll" ? "challenge" : "authorization";
  const state = operation === "challenge_enroll" ? "challenged" : "authorized";
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "operation", "state", "vaultId", field]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== operation ||
    value.state !== state ||
    value.vaultId !== expectedVaultId ||
    !isLowerHex(value.vaultId, 32)
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return Object.freeze({
    encoded: copyBoundedBytes(
      value[field],
      operation === "challenge_enroll" ? 64 * 1024 : 256 * 1024,
    ),
  });
}

function parseActivateEnrollment(
  value: unknown,
  expectedVaultId: string,
): NativeActivateEnrollmentResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "operation",
      "state",
      "vaultId",
      "custodyGeneration",
      "activeEpoch",
      "sequence",
      "headHash",
    ]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "activate_enroll" ||
    value.state !== "active" ||
    value.vaultId !== expectedVaultId ||
    !isLowerHex(value.vaultId, 32) ||
    value.custodyGeneration !== 3 ||
    !isSafeInteger(value.activeEpoch, true) ||
    !isSafeInteger(value.sequence, false) ||
    !isLowerHex(value.headHash, 64)
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return Object.freeze({
    version: SERVICE_VERSION,
    suite: SERVICE_SUITE,
    operation: "activate_enroll",
    state: "active",
    vaultId: value.vaultId,
    custodyGeneration: 3,
    activeEpoch: value.activeEpoch,
    sequence: value.sequence,
    headHash: value.headHash,
  });
}

function parseCommitGenesis(value: unknown): NativeCommitGenesisResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "operation",
      "state",
      "vaultId",
      "custodyGeneration",
      "activeEpoch",
      "sequence",
      "headHash",
      "membershipHash",
      "recoveryGeneration",
      "recoveryWrapHash",
    ]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "commit_genesis" ||
    value.state !== "committed" ||
    !isLowerHex(value.vaultId, 32) ||
    value.custodyGeneration !== 2 ||
    value.activeEpoch !== 1 ||
    value.sequence !== 0 ||
    !isLowerHex(value.headHash, 64) ||
    !isLowerHex(value.membershipHash, 64) ||
    value.recoveryGeneration !== 1 ||
    !isLowerHex(value.recoveryWrapHash, 64)
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return Object.freeze({
    version: SERVICE_VERSION,
    suite: SERVICE_SUITE,
    operation: "commit_genesis",
    state: "committed",
    vaultId: value.vaultId,
    custodyGeneration: 2,
    activeEpoch: 1,
    sequence: 0,
    headHash: value.headHash,
    membershipHash: value.membershipHash,
    recoveryGeneration: 1,
    recoveryWrapHash: value.recoveryWrapHash,
  });
}

function parseBootstrapFrame(value: unknown): NativeParsedBootstrapFrameResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "operation",
      "state",
      "vaultId",
      "throughSequence",
      "headSequence",
      "headHash",
      "complete",
    ]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "accept_bootstrap" ||
    value.state !== "parsed" ||
    !isLowerHex(value.vaultId, 32) ||
    !isSafeInteger(value.throughSequence, false) ||
    !isSafeInteger(value.headSequence, false) ||
    value.throughSequence > value.headSequence ||
    !isLowerHex(value.headHash, 64) ||
    typeof value.complete !== "boolean" ||
    (value.complete && value.throughSequence !== value.headSequence)
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return Object.freeze({
    version: SERVICE_VERSION,
    suite: SERVICE_SUITE,
    operation: "accept_bootstrap",
    state: "parsed",
    vaultId: value.vaultId,
    throughSequence: value.throughSequence,
    headSequence: value.headSequence,
    headHash: value.headHash,
    complete: value.complete,
  });
}

function parseRecoveryPage(
  value: unknown,
  operation: "recover_begin" | "recover_page",
): {
  readonly acceptance: PrivateVaultBootstrapPageAcceptance;
  readonly committing: boolean;
} {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "operation",
      "state",
      "vaultId",
      "throughSequence",
      "headSequence",
      "headHash",
      "complete",
    ]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== operation ||
    !isLowerHex(value.vaultId, 32) ||
    !isSafeInteger(value.throughSequence, false) ||
    !isSafeInteger(value.headSequence, false) ||
    value.throughSequence > value.headSequence ||
    !isLowerHex(value.headHash, 64) ||
    typeof value.complete !== "boolean" ||
    value.complete !== (value.throughSequence === value.headSequence) ||
    value.state !== (value.complete ? "committing" : "accepted")
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return Object.freeze({
    acceptance: Object.freeze({
      vaultId: value.vaultId,
      throughSequence: value.throughSequence,
      head: Object.freeze({
        sequence: value.headSequence,
        hash: value.headHash,
      }),
      complete: value.complete,
    }),
    committing: value.state === "committing",
  });
}

function parseRecoveryStatus(
  value: unknown,
  vaultId: string,
): "committing" | "recovered" | "failed" {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "operation", "state", "vaultId"]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "recover_status" ||
    value.vaultId !== vaultId ||
    (value.state !== "committing" &&
      value.state !== "recovered" &&
      value.state !== "failed")
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return value.state;
}

const waitForRecoveryPoll = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 250));

function copyBoundedBytes(value: unknown, maximum: number): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > maximum
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return Uint8Array.from(value);
}

function parsePendingGenesis(value: unknown): PendingPrivateVaultGenesis {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["lookupId", "vaultId", "candidate"]) ||
    !isLowerHex(value.lookupId, 32) ||
    !isLowerHex(value.vaultId, 32)
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return Object.freeze({
    lookupId: value.lookupId,
    candidate: copyBoundedBytes(value.candidate, 1_315_072),
  });
}

function parseCreateGenesis(value: unknown): PendingPrivateVaultGenesis {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "operation",
      "state",
      "lookupId",
      "vaultId",
      "candidate",
    ]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "create_genesis" ||
    value.state !== "committed"
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return parsePendingGenesis({
    lookupId: value.lookupId,
    vaultId: value.vaultId,
    candidate: value.candidate,
  });
}

function parseListGenesis(
  value: unknown,
): readonly PendingPrivateVaultGenesis[] {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "operation", "state", "candidates"]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "list_genesis" ||
    value.state !== "pending" ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > 64
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return Object.freeze(value.candidates.map(parsePendingGenesis));
}

function parseAdmissionRequest(
  value: unknown,
  operation: "authorize_admit" | "accept_admit",
): PrivateVaultEndpointAuthenticatedRequest & {
  accountId: string;
  workspaceId: string;
  vaultId: string;
} {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "operation",
      "state",
      "accountId",
      "workspaceId",
      "vaultId",
      "endpointId",
      "proofHeader",
      "body",
    ]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== operation ||
    value.state !==
      (operation === "authorize_admit" ? "authorized" : "accepted") ||
    typeof value.accountId !== "string" ||
    value.accountId.length < 8 ||
    value.accountId.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.accountId) ||
    typeof value.workspaceId !== "string" ||
    value.workspaceId.length < 8 ||
    value.workspaceId.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.workspaceId) ||
    !isLowerHex(value.vaultId, 32) ||
    !isLowerHex(value.endpointId, 32) ||
    typeof value.proofHeader !== "string" ||
    value.proofHeader.length === 0 ||
    value.proofHeader.length > 8192 ||
    !/^[A-Za-z0-9_-]+$/.test(value.proofHeader)
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return Object.freeze({
    accountId: value.accountId,
    workspaceId: value.workspaceId,
    vaultId: value.vaultId,
    body: copyBoundedBytes(
      value.body,
      operation === "authorize_admit" ? 1_317_376 : 1_114_368,
    ),
    proofHeader: value.proofHeader,
  });
}

function parseFinalizeGenesis(value: unknown, lookupId: string): void {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "operation", "state", "lookupId"]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "finalize_genesis" ||
    value.state !== "cleaned" ||
    value.lookupId !== lookupId
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
}

function parseOpenJob(value: unknown): NativeOpenHostedJobResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "operation",
      "jobHash",
      "jobPayload",
      "resourceId",
      "operationName",
    ]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "open_job" ||
    typeof value.jobHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.jobHash) ||
    !(value.resourceId instanceof Uint8Array) ||
    value.resourceId.byteLength !== 16 ||
    typeof value.operationName !== "string" ||
    !/^[a-z][a-z0-9-]{0,119}$/.test(value.operationName) ||
    !(value.jobPayload instanceof Uint8Array) ||
    value.jobPayload.byteLength > E2EE_SIZE_LIMITS.jobPayloadBytes
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return {
    version: SERVICE_VERSION,
    suite: SERVICE_SUITE,
    operation: "openHostedJob",
    jobHash: value.jobHash,
    jobPayload: value.jobPayload.slice(),
    resourceId: value.resourceId.slice(),
    operationName: value.operationName,
  };
}

function parseSealedResult(value: unknown): NativeSealHostedResultResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "operation", "resultEnvelope"]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "seal_result" ||
    !(value.resultEnvelope instanceof Uint8Array) ||
    value.resultEnvelope.byteLength === 0 ||
    value.resultEnvelope.byteLength > E2EE_SIZE_LIMITS.resultEnvelopeBytes
  )
    throw new PrivateVaultNativeServiceClientError();
  return {
    version: SERVICE_VERSION,
    suite: SERVICE_SUITE,
    operation: "sealHostedResult",
    resultEnvelope: value.resultEnvelope.slice(),
  };
}

function parseCompletedResult(
  value: unknown,
): NativeAcknowledgeHostedResultResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "operation", "state"]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "complete_result" ||
    value.state !== "delivered"
  )
    throw new PrivateVaultNativeServiceClientError();
  return {
    version: SERVICE_VERSION,
    suite: SERVICE_SUITE,
    operation: "acknowledgeHostedResult",
    delivered: true,
  };
}

function parsePendingResult(value: unknown): NativeRecoverHostedResultResult {
  if (
    !isRecord(value) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "pending_result"
  )
    throw new PrivateVaultNativeServiceClientError();
  if (
    value.state === "idle" &&
    hasExactKeys(value, ["version", "operation", "state"])
  ) {
    return {
      version: SERVICE_VERSION,
      suite: SERVICE_SUITE,
      operation: "recoverHostedResult",
      pending: null,
    };
  }
  if (
    value.state !== "pending" ||
    !hasExactKeys(value, [
      "version",
      "operation",
      "state",
      "jobId",
      "jobHash",
      "resultState",
      "epoch",
      "retryCount",
      "algorithmId",
      "resultEnvelope",
    ]) ||
    !isLowerHex(value.jobId, 32) ||
    typeof value.jobHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.jobHash) ||
    (value.resultState !== "completed" && value.resultState !== "failed") ||
    !Number.isSafeInteger(value.epoch) ||
    (value.epoch as number) <= 0 ||
    !Number.isSafeInteger(value.retryCount) ||
    (value.retryCount as number) < 0 ||
    (value.retryCount as number) > 100 ||
    typeof value.algorithmId !== "string" ||
    value.algorithmId.length === 0 ||
    value.algorithmId.length > 160 ||
    !/^[\x21-\x7e]+$/.test(value.algorithmId) ||
    !(value.resultEnvelope instanceof Uint8Array) ||
    value.resultEnvelope.byteLength === 0 ||
    value.resultEnvelope.byteLength > E2EE_SIZE_LIMITS.resultEnvelopeBytes
  )
    throw new PrivateVaultNativeServiceClientError();
  return {
    version: SERVICE_VERSION,
    suite: SERVICE_SUITE,
    operation: "recoverHostedResult",
    pending: {
      jobId: value.jobId,
      jobHash: value.jobHash,
      state: value.resultState,
      epoch: value.epoch as number,
      retryCount: value.retryCount as number,
      algorithmId: value.algorithmId,
      resultEnvelope: value.resultEnvelope.slice(),
    },
  };
}

function parseEndpointSignature(
  value: unknown,
): NativeSignEndpointRequestResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "operation", "signature"]) ||
    value.version !== XPC_PROTOCOL_VERSION ||
    value.operation !== "sign_request" ||
    !(value.signature instanceof Uint8Array) ||
    value.signature.byteLength !== 64
  )
    throw new PrivateVaultNativeServiceClientError();
  return {
    version: SERVICE_VERSION,
    suite: SERVICE_SUITE,
    operation: "signEndpointRequest",
    signature: value.signature.slice(),
  };
}

function copyCommitGenesisInput(
  input: unknown,
): readonly [Buffer, Buffer, Buffer] {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      "operation",
      "recoveryConfirmation",
      "bootstrapTranscript",
      "authorization",
    ]) ||
    input.operation !== "commit_genesis"
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  const fields = [
    [input.recoveryConfirmation, 64 * 1024],
    [input.bootstrapTranscript, 4 * 1024],
    [input.authorization, 256 * 1024],
  ] as const;
  const copies = fields.map(([value, maximum]) => {
    if (
      !(value instanceof Uint8Array) ||
      value.byteLength === 0 ||
      value.byteLength > maximum
    ) {
      throw new PrivateVaultNativeServiceClientError();
    }
    return Buffer.from(value);
  });
  return copies as unknown as readonly [Buffer, Buffer, Buffer];
}

function validateAddon(value: unknown): NativeAddon {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.request !== "function"
  ) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return value as unknown as NativeAddon;
}

async function loadPackagedAddon(): Promise<NativeAddon> {
  if (process.platform !== "darwin" || !process.versions.electron) {
    throw new PrivateVaultNativeServiceClientError();
  }
  const { app } = await import("electron");
  if (!app.isPackaged) throw new PrivateVaultNativeServiceClientError();

  const resourcesPath = (
    process as NodeJS.Process & { resourcesPath?: unknown }
  ).resourcesPath;
  if (typeof resourcesPath !== "string" || !path.isAbsolute(resourcesPath)) {
    throw new PrivateVaultNativeServiceClientError();
  }
  const addonPath = path.join(resourcesPath, "native", PACKAGED_ADDON_NAME);
  // Packaging contract: before this require is reachable, composition must
  // verify the universal addon and sign it with the same trusted identity as
  // the hardened Desktop app. Development builds remain deliberately unsigned
  // and unavailable; this loader never ad-hoc signs or weakens library checks.
  const require = createRequire(import.meta.url);
  return validateAddon(require(addonPath));
}

class NativeServiceClient implements PrivateVaultNativeServiceClient {
  readonly #addon: Promise<NativeAddon>;
  #tail: Promise<void> = Promise.resolve();
  #healthFlight: Promise<NativeHealthResult> | null = null;
  #lockFlight: Promise<NativeLockResult> | null = null;
  #genesisPending = false;
  #bootstrapStarted = false;
  #bootstrapComplete = false;

  constructor(loader: NativeAddonLoader) {
    this.#addon = loader();
    void this.#addon.catch(() => undefined);
  }

  health(): Promise<NativeHealthResult> {
    if (this.#healthFlight) return this.#healthFlight;
    const flight = this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseHealth(await addon.request("health"));
      } catch {
        return unavailableHealth();
      }
    });
    this.#healthFlight = flight;
    void flight.then(
      () => this.#clearHealthFlight(flight),
      () => this.#clearHealthFlight(flight),
    );
    return flight;
  }

  lock(): Promise<NativeLockResult> {
    if (this.#lockFlight) return this.#lockFlight;
    const flight = this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseLock(await addon.request("lock"));
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      }
    });
    this.#lockFlight = flight;
    void flight.then(
      () => this.#clearLockFlight(flight),
      () => this.#clearLockFlight(flight),
    );
    return flight;
  }

  unlock(vaultId: string): Promise<NativeUnlockResult> {
    if (!isLowerHex(vaultId, 32)) {
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseUnlock(await addon.request("unlock", vaultId));
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      }
    });
  }

  openHostedJob(
    request: NativeOpenHostedJobRequest,
  ): Promise<NativeOpenHostedJobResult> {
    if (
      request.version !== SERVICE_VERSION ||
      request.suite !== SERVICE_SUITE ||
      request.operation !== "openHostedJob" ||
      !isLowerHex(request.vaultId, 32) ||
      !isLowerHex(request.endpointId, 32) ||
      !isLowerHex(request.jobId, 32) ||
      !Number.isSafeInteger(request.epoch) ||
      request.epoch <= 0 ||
      !Number.isSafeInteger(request.retryCount) ||
      request.retryCount < 0 ||
      request.retryCount > 100 ||
      typeof request.algorithmId !== "string" ||
      request.algorithmId.length === 0 ||
      request.algorithmId.length > 160 ||
      !/^[\x21-\x7e]+$/.test(request.algorithmId) ||
      !(request.jobEnvelope instanceof Uint8Array) ||
      request.jobEnvelope.byteLength === 0 ||
      request.jobEnvelope.byteLength > E2EE_SIZE_LIMITS.jobEnvelopeBytes
    ) {
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    const envelope = Buffer.from(request.jobEnvelope);
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseOpenJob(
          await addon.request(
            "open_job",
            request.vaultId,
            request.jobId,
            envelope,
            request.epoch,
            request.retryCount,
            request.algorithmId,
          ),
        );
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      } finally {
        envelope.fill(0);
      }
    });
  }

  sealHostedResult(
    request: NativeSealHostedResultRequest,
  ): Promise<NativeSealHostedResultResult> {
    if (
      request.version !== SERVICE_VERSION ||
      request.suite !== SERVICE_SUITE ||
      request.operation !== "sealHostedResult" ||
      !isLowerHex(request.vaultId, 32) ||
      !isLowerHex(request.endpointId, 32) ||
      !isLowerHex(request.jobId, 32) ||
      !/^[0-9a-f]{64}$/.test(request.jobHash) ||
      (request.state !== "completed" && request.state !== "failed") ||
      !(request.resultPayload instanceof Uint8Array) ||
      request.resultPayload.byteLength > E2EE_SIZE_LIMITS.resultPayloadBytes
    )
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    const payload = Buffer.from(request.resultPayload);
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseSealedResult(
          await addon.request(
            "seal_result",
            request.vaultId,
            request.jobId,
            request.jobHash,
            request.state,
            payload,
          ),
        );
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      } finally {
        payload.fill(0);
      }
    });
  }

  acknowledgeHostedResult(
    request: NativeAcknowledgeHostedResultRequest,
  ): Promise<NativeAcknowledgeHostedResultResult> {
    if (
      request.version !== SERVICE_VERSION ||
      request.suite !== SERVICE_SUITE ||
      request.operation !== "acknowledgeHostedResult" ||
      !isLowerHex(request.vaultId, 32) ||
      !isLowerHex(request.endpointId, 32) ||
      !isLowerHex(request.jobId, 32) ||
      !/^[0-9a-f]{64}$/.test(request.jobHash) ||
      (request.state !== "completed" && request.state !== "failed")
    )
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseCompletedResult(
          await addon.request(
            "complete_result",
            request.vaultId,
            request.jobId,
            request.jobHash,
            request.state,
          ),
        );
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      }
    });
  }

  recoverHostedResult(
    request: NativeRecoverHostedResultRequest,
  ): Promise<NativeRecoverHostedResultResult> {
    if (
      request.version !== SERVICE_VERSION ||
      request.suite !== SERVICE_SUITE ||
      request.operation !== "recoverHostedResult" ||
      !isLowerHex(request.vaultId, 32) ||
      !isLowerHex(request.endpointId, 32)
    )
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parsePendingResult(
          await addon.request("pending_result", request.vaultId),
        );
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      }
    });
  }

  signEndpointRequest(
    request: NativeSignEndpointRequestRequest,
  ): Promise<NativeSignEndpointRequestResult> {
    if (
      request.version !== SERVICE_VERSION ||
      request.suite !== SERVICE_SUITE ||
      request.operation !== "signEndpointRequest" ||
      !(request.unsignedProof instanceof Uint8Array) ||
      request.unsignedProof.byteLength === 0 ||
      request.unsignedProof.byteLength > 64 * 1024
    )
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    const proof = Buffer.from(request.unsignedProof);
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseEndpointSignature(
          await addon.request("sign_request", proof),
        );
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      } finally {
        proof.fill(0);
      }
    });
  }

  prepareBrokerEnrollment(
    vaultId: string,
  ): Promise<NativePrepareEnrollmentResult> {
    if (!isLowerHex(vaultId, 32))
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parsePrepareEnrollment(
          await addon.request("prepare_enroll", vaultId),
          vaultId,
        );
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      }
    });
  }

  buildBrokerEnrollmentChallenge(input: {
    readonly vaultId: string;
  }): Promise<NativeEnrollmentAuthorizerResult> {
    if (!isLowerHex(input.vaultId, 32))
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseEnrollmentAuthorizerResult(
          await addon.request("challenge_enroll", input.vaultId),
          "challenge_enroll",
          input.vaultId,
        );
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      }
    });
  }

  confirmBrokerEnrollment(
    vaultId: string,
    challenge: Uint8Array,
  ): Promise<NativeConfirmEnrollmentResult> {
    if (!isLowerHex(vaultId, 32))
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    let challengeCopy: Buffer;
    try {
      challengeCopy = Buffer.from(copyBoundedBytes(challenge, 64 * 1024));
    } catch {
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseConfirmEnrollment(
          await addon.request("confirm_enroll", vaultId, challengeCopy),
        );
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      } finally {
        challengeCopy.fill(0);
      }
    });
  }

  buildBrokerEnrollmentAuthorization(input: {
    readonly vaultId: string;
    readonly challenge: Uint8Array;
  }): Promise<NativeEnrollmentAuthorizerResult> {
    if (!isLowerHex(input.vaultId, 32))
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    let challengeCopy: Buffer;
    try {
      challengeCopy = Buffer.from(copyBoundedBytes(input.challenge, 64 * 1024));
    } catch {
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseEnrollmentAuthorizerResult(
          await addon.request("authorize_enroll", input.vaultId, challengeCopy),
          "authorize_enroll",
          input.vaultId,
        );
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      } finally {
        challengeCopy.fill(0);
      }
    });
  }

  activateBrokerEnrollment(
    vaultId: string,
    challenge: Uint8Array,
    authorization: Uint8Array,
  ): Promise<NativeActivateEnrollmentResult> {
    if (!isLowerHex(vaultId, 32))
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    let challengeCopy: Buffer | null = null;
    let authorizationCopy: Buffer | null = null;
    try {
      challengeCopy = Buffer.from(copyBoundedBytes(challenge, 64 * 1024));
      authorizationCopy = Buffer.from(
        copyBoundedBytes(authorization, 256 * 1024),
      );
    } catch {
      challengeCopy?.fill(0);
      authorizationCopy?.fill(0);
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    const safeChallenge = challengeCopy;
    const safeAuthorization = authorizationCopy;
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseActivateEnrollment(
          await addon.request(
            "activate_enroll",
            vaultId,
            safeChallenge,
            safeAuthorization,
          ),
          vaultId,
        );
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      } finally {
        safeChallenge.fill(0);
        safeAuthorization.fill(0);
      }
    });
  }

  resumeRotation(vaultId: string): Promise<NativeResumeRotationResult> {
    if (!isLowerHex(vaultId, 32))
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseResumeRotation(
          await addon.request("resume_rotation", vaultId),
          vaultId,
        );
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      }
    });
  }

  commitGenesis(
    input: NativeCommitGenesisInput,
  ): Promise<NativeCommitGenesisResult> {
    if (this.#genesisPending) {
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    this.#genesisPending = true;
    let fields: readonly [Buffer, Buffer, Buffer];
    try {
      fields = copyCommitGenesisInput(input);
    } catch {
      this.#genesisPending = false;
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseCommitGenesis(
          await addon.request("commit_genesis", ...fields),
        );
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      } finally {
        for (const field of fields) field.fill(0);
        this.#genesisPending = false;
      }
    });
  }

  parseBootstrapFrame(
    encoded: Uint8Array,
  ): Promise<NativeParsedBootstrapFrameResult> {
    let frame: Buffer;
    try {
      frame = Buffer.from(
        copyBoundedBytes(encoded, ANC_V1_VAULT_BOOTSTRAP_FRAME_MAX_BYTES),
      );
    } catch {
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseBootstrapFrame(
          await addon.request("accept_bootstrap", frame),
        );
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      } finally {
        frame.fill(0);
      }
    });
  }

  acceptPage(
    encoded: Uint8Array,
  ): Promise<PrivateVaultBootstrapPageAcceptance> {
    if (this.#bootstrapComplete) {
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    let frame: Buffer;
    try {
      frame = Buffer.from(
        copyBoundedBytes(encoded, ANC_V1_VAULT_BOOTSTRAP_FRAME_MAX_BYTES),
      );
    } catch {
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    return this.#enqueue(async () => {
      if (this.#bootstrapComplete) {
        frame.fill(0);
        throw new PrivateVaultNativeServiceClientError();
      }
      const operation = this.#bootstrapStarted
        ? "recover_page"
        : "recover_begin";
      try {
        const addon = await this.#addon;
        const parsed = parseRecoveryPage(
          await addon.request(operation, frame),
          operation,
        );
        this.#bootstrapStarted = true;
        if (parsed.committing) {
          let recovered = false;
          for (let attempt = 0; attempt < 240; attempt += 1) {
            const state = parseRecoveryStatus(
              await addon.request("recover_status", parsed.acceptance.vaultId),
              parsed.acceptance.vaultId,
            );
            if (state === "recovered") {
              recovered = true;
              break;
            }
            if (state === "failed") {
              throw new PrivateVaultNativeServiceClientError();
            }
            await waitForRecoveryPoll();
          }
          if (!recovered) {
            throw new PrivateVaultNativeServiceClientError();
          }
        }
        this.#bootstrapComplete = parsed.acceptance.complete;
        return parsed.acceptance;
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      } finally {
        frame.fill(0);
      }
    });
  }

  beginTrustedGenesis(): Promise<PendingPrivateVaultGenesis> {
    if (this.#genesisPending) {
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    this.#genesisPending = true;
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseCreateGenesis(await addon.request("create_genesis"));
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      } finally {
        this.#genesisPending = false;
      }
    });
  }

  listPendingGenesis(): Promise<readonly PendingPrivateVaultGenesis[]> {
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        return parseListGenesis(await addon.request("list_genesis"));
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      }
    });
  }

  authorizeAdmission(input: {
    readonly lookupId: string;
    readonly challenge: Uint8Array;
  }): Promise<PrivateVaultEndpointAuthenticatedRequest> {
    if (
      !isRecord(input) ||
      !hasExactKeys(input, ["lookupId", "challenge"]) ||
      !isLowerHex(input.lookupId, 32)
    ) {
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    let challenge: Buffer;
    try {
      challenge = Buffer.from(copyBoundedBytes(input.challenge, 2048));
    } catch {
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        const authorized = parseAdmissionRequest(
          await addon.request("authorize_admit", input.lookupId, challenge),
          "authorize_admit",
        );
        return Object.freeze({
          body: authorized.body,
          proofHeader: authorized.proofHeader,
        });
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      } finally {
        challenge.fill(0);
      }
    });
  }

  acceptAdmissionReceipt(input: {
    readonly lookupId: string;
    readonly challenge: Uint8Array;
    readonly receipt: Uint8Array;
  }): Promise<
    PrivateVaultGenesisAdmissionResult &
      PrivateVaultEndpointAuthenticatedRequest
  > {
    if (
      !isRecord(input) ||
      !hasExactKeys(input, ["lookupId", "challenge", "receipt"]) ||
      !isLowerHex(input.lookupId, 32)
    ) {
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    let challenge: Buffer;
    let receipt: Buffer;
    try {
      challenge = Buffer.from(copyBoundedBytes(input.challenge, 2048));
      receipt = Buffer.from(copyBoundedBytes(input.receipt, 2048));
    } catch {
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        const accepted = parseAdmissionRequest(
          await addon.request(
            "accept_admit",
            input.lookupId,
            challenge,
            receipt,
          ),
          "accept_admit",
        );
        return Object.freeze({
          accountId: accepted.accountId,
          workspaceId: accepted.workspaceId,
          vaultId: accepted.vaultId,
          body: accepted.body,
          proofHeader: accepted.proofHeader,
        });
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      } finally {
        challenge.fill(0);
        receipt.fill(0);
      }
    });
  }

  finalizeHostedAppend(input: {
    readonly lookupId: string;
    readonly receipt: Uint8Array;
  }): Promise<void> {
    if (
      !isRecord(input) ||
      !hasExactKeys(input, ["lookupId", "receipt"]) ||
      !isLowerHex(input.lookupId, 32)
    ) {
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    let receipt: Buffer;
    try {
      receipt = Buffer.from(copyBoundedBytes(input.receipt, 2048));
    } catch {
      return Promise.reject(new PrivateVaultNativeServiceClientError());
    }
    return this.#enqueue(async () => {
      try {
        const addon = await this.#addon;
        parseFinalizeGenesis(
          await addon.request("finalize_genesis", input.lookupId, receipt),
          input.lookupId,
        );
      } catch {
        throw new PrivateVaultNativeServiceClientError();
      } finally {
        receipt.fill(0);
      }
    });
  }

  #enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #clearHealthFlight(flight: Promise<NativeHealthResult>): void {
    if (this.#healthFlight === flight) this.#healthFlight = null;
  }

  #clearLockFlight(flight: Promise<NativeLockResult>): void {
    if (this.#lockFlight === flight) this.#lockFlight = null;
  }
}

/**
 * Construct the production client. It has no path, loader, packaging, or
 * platform overrides: only the signed packaged Electron main process can load
 * the addon from its fixed resources location.
 */
export function createPrivateVaultNativeServiceClient(): PrivateVaultNativeServiceClient {
  return new NativeServiceClient(loadPackagedAddon);
}

/** Explicitly gated dependency seam for unit tests; never available at runtime. */
export function createPrivateVaultNativeServiceClientForTest(
  loader: NativeAddonLoader,
): PrivateVaultNativeServiceClient {
  if (process.env.VITEST !== "true" || process.versions.electron) {
    throw new PrivateVaultNativeServiceClientError();
  }
  return new NativeServiceClient(loader);
}
