import { createRequire } from "node:module";
import path from "node:path";

import type {
  NativeHealthResult,
  NativeLockResult,
} from "@agent-native/private-vault-broker";

const SERVICE_VERSION = 1 as const;
const XPC_PROTOCOL_VERSION = 2 as const;
const SERVICE_SUITE = "anc/v1" as const;
const PACKAGED_ADDON_NAME = "private-vault-xpc-client.node";

type RotationAckState =
  | "unavailable"
  | "idle"
  | "pending"
  | "retrying"
  | "attention";

type NativeOperation = "health" | "lock" | "resume_rotation";

interface NativeAddon {
  request(operation: NativeOperation, vaultId?: string): Promise<unknown>;
}

type NativeAddonLoader = () => Promise<NativeAddon>;

export interface PrivateVaultNativeServiceClient {
  health(): Promise<NativeHealthResult>;
  lock(): Promise<NativeLockResult>;
  resumeRotation(vaultId: string): Promise<NativeResumeRotationResult>;
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
