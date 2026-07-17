import { createRequire } from "node:module";
import path from "node:path";

import type {
  NativeHealthResult,
  NativeLockResult,
} from "@agent-native/private-vault-broker";

const SERVICE_VERSION = 1 as const;
const SERVICE_SUITE = "anc/v1" as const;
const PACKAGED_ADDON_NAME = "private-vault-xpc-client.node";

type NativeOperation = "health" | "lock";

interface NativeAddon {
  request(operation: NativeOperation): Promise<unknown>;
}

type NativeAddonLoader = () => Promise<NativeAddon>;

export interface PrivateVaultNativeServiceClient {
  health(): Promise<NativeHealthResult>;
  lock(): Promise<NativeLockResult>;
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
    !hasExactKeys(value, ["version", "operation", "state", "available"]) ||
    value.version !== SERVICE_VERSION ||
    value.operation !== "health" ||
    typeof value.available !== "boolean" ||
    !["unavailable", "uninitialized", "locked", "unlocked", "closed"].includes(
      value.state as string,
    ) ||
    value.available !== (value.state !== "unavailable")
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
  });
}

function parseLock(value: unknown): NativeLockResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "operation", "state"]) ||
    value.version !== SERVICE_VERSION ||
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
