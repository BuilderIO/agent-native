import { createRequire } from "node:module";
import path from "node:path";

import { ANC_V1_VAULT_BOOTSTRAP_FRAME_MAX_BYTES } from "@agent-native/core/e2ee";
import type {
  NativeHealthResult,
  NativeLockResult,
} from "@agent-native/private-vault-broker";

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
  | "resume_rotation"
  | "commit_genesis"
  | "create_genesis"
  | "list_genesis"
  | "authorize_admit"
  | "accept_admit"
  | "finalize_genesis"
  | "accept_bootstrap";

interface NativeAddon {
  request(
    operation: NativeOperation,
    ...arguments_: Array<string | Buffer>
  ): Promise<unknown>;
}

type NativeAddonLoader = () => Promise<NativeAddon>;

export interface PrivateVaultNativeServiceClient extends PrivateVaultTrustedGenesisOperator {
  health(): Promise<NativeHealthResult>;
  lock(): Promise<NativeLockResult>;
  resumeRotation(vaultId: string): Promise<NativeResumeRotationResult>;
  commitGenesis(
    input: NativeCommitGenesisInput,
  ): Promise<NativeCommitGenesisResult>;
  parseBootstrapFrame(
    encoded: Uint8Array,
  ): Promise<NativeParsedBootstrapFrameResult>;
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
