import type { AncV1CryptoProvider } from "./crypto/provider.js";
import { sodiumNativeAncV1 } from "./crypto/sodium-native.js";
import type {
  NativeHealthResult,
  NativeLockResult,
  NativeUnlockResult,
} from "./native-service.js";
import type { BrokerStateStore } from "./state-store.js";
import type {
  PrivateVaultBrokerWorker,
  PrivateVaultBrokerWorkerOutcome,
} from "./worker.js";

const base = { version: 1 as const, suite: "anc/v1" as const };
const CHECKPOINT_NAMESPACE = "broker-supervisor";
const CHECKPOINT_KEY = "worker-checkpoint";
const MIN_IDENTITY_BYTES = 8;
const MAX_IDENTITY_BYTES = 160;
const DEFAULT_IDLE_DELAY_MS = 2_000;
const DEFAULT_OFFLINE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 300_000;

export type PrivateVaultBrokerSupervisorState =
  | "stopped"
  | "starting"
  | "running"
  | "offline"
  | "revoked"
  | "stopping"
  | "closed";

export interface PrivateVaultBrokerSupervisorHealth {
  readonly state: PrivateVaultBrokerSupervisorState;
  readonly ready: boolean;
  readonly processing: boolean;
  readonly lastOutcome: "idle" | "completed" | "failed" | "retry_wait" | null;
  readonly retryAt: string | null;
  readonly consecutiveOfflineChecks: number;
}

export interface PrivateVaultBrokerSupervisorNative {
  health(request: {
    readonly version: 1;
    readonly suite: "anc/v1";
    readonly operation: "health";
  }): Promise<NativeHealthResult>;
  unlock(request: {
    readonly version: 1;
    readonly suite: "anc/v1";
    readonly operation: "unlock";
    readonly vaultId: string;
  }): Promise<NativeUnlockResult>;
  lock(request: {
    readonly version: 1;
    readonly suite: "anc/v1";
    readonly operation: "lock";
  }): Promise<NativeLockResult>;
}

export interface PrivateVaultBrokerRevocationVerifier {
  verify(input: {
    readonly vaultId: string;
    readonly endpointId: string;
  }): Promise<"active" | "revoked">;
}

export interface PrivateVaultBrokerScheduler {
  set(delayMs: number, task: () => void): unknown;
  clear(handle: unknown): void;
}

export interface PrivateVaultBrokerSupervisorOptions {
  readonly vaultId: string;
  readonly endpointId: string;
  readonly native: PrivateVaultBrokerSupervisorNative;
  readonly worker: Pick<PrivateVaultBrokerWorker, "processOnce">;
  readonly store: BrokerStateStore;
  readonly revocation: PrivateVaultBrokerRevocationVerifier;
  readonly scheduler?: PrivateVaultBrokerScheduler;
  readonly crypto?: AncV1CryptoProvider;
  readonly now?: () => Date;
  readonly idleDelayMs?: number;
  readonly offlineDelayMs?: number;
}

export class PrivateVaultBrokerSupervisorError extends Error {
  constructor() {
    super("Private Vault broker supervision failed");
    this.name = "PrivateVaultBrokerSupervisorError";
  }
}

interface PersistedCheckpoint {
  readonly version: 1;
  readonly outcome: PrivateVaultBrokerSupervisorHealth["lastOutcome"];
  readonly observedAt: string;
  readonly retryAt: string | null;
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function decodeCheckpoint(
  value: Uint8Array | null,
): PersistedCheckpoint | null {
  if (value === null) return null;
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > 512
  )
    throw new PrivateVaultBrokerSupervisorError();
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(value);
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    const record = parsed as Record<string, unknown>;
    const outcomes = new Set(["idle", "completed", "failed", "retry_wait"]);
    if (
      Object.keys(record).sort().join("\0") !==
        "observedAt\0outcome\0retryAt\0version" ||
      record.version !== 1 ||
      typeof record.outcome !== "string" ||
      !outcomes.has(record.outcome) ||
      !canonicalTimestamp(record.observedAt) ||
      (record.retryAt !== null && !canonicalTimestamp(record.retryAt)) ||
      (record.outcome === "retry_wait") !== (record.retryAt !== null) ||
      JSON.stringify(record) !== text
    )
      throw new Error();
    return Object.freeze({
      version: 1,
      outcome: record.outcome as PersistedCheckpoint["outcome"],
      observedAt: record.observedAt,
      retryAt: record.retryAt as string | null,
    });
  } catch {
    throw new PrivateVaultBrokerSupervisorError();
  }
}

function identity(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < MIN_IDENTITY_BYTES ||
    value.length > MAX_IDENTITY_BYTES
  ) {
    throw new PrivateVaultBrokerSupervisorError();
  }
  return value;
}

function delay(value: number | undefined, fallback: number): number {
  const candidate = value ?? fallback;
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < 1 ||
    candidate > MAX_DELAY_MS
  ) {
    throw new PrivateVaultBrokerSupervisorError();
  }
  return candidate;
}

function defaultScheduler(): PrivateVaultBrokerScheduler {
  return {
    set: (delayMs, task) => {
      const timer = setTimeout(task, delayMs);
      timer.unref?.();
      return timer;
    },
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

function validHealth(result: NativeHealthResult): boolean {
  return (
    result.version === 1 &&
    result.suite === "anc/v1" &&
    result.operation === "health" &&
    result.available === true &&
    result.ready === true
  );
}

export class PrivateVaultBrokerSupervisor {
  readonly #vaultId: string;
  readonly #endpointId: string;
  readonly #native: PrivateVaultBrokerSupervisorNative;
  readonly #worker: Pick<PrivateVaultBrokerWorker, "processOnce">;
  readonly #store: BrokerStateStore;
  readonly #revocation: PrivateVaultBrokerRevocationVerifier;
  readonly #scheduler: PrivateVaultBrokerScheduler;
  readonly #crypto: AncV1CryptoProvider;
  readonly #now: () => Date;
  readonly #idleDelayMs: number;
  readonly #offlineDelayMs: number;
  #state: PrivateVaultBrokerSupervisorState = "stopped";
  #lastOutcome: PrivateVaultBrokerSupervisorHealth["lastOutcome"] = null;
  #retryAt: string | null = null;
  #consecutiveOfflineChecks = 0;
  #processing: Promise<void> | null = null;
  #timer: unknown = null;
  #storeInitialized = false;

  constructor(options: PrivateVaultBrokerSupervisorOptions) {
    this.#vaultId = identity(options.vaultId);
    this.#endpointId = identity(options.endpointId);
    this.#native = options.native;
    this.#worker = options.worker;
    this.#store = options.store;
    this.#revocation = options.revocation;
    this.#scheduler = options.scheduler ?? defaultScheduler();
    this.#crypto = options.crypto ?? sodiumNativeAncV1;
    this.#now = options.now ?? (() => new Date());
    this.#idleDelayMs = delay(options.idleDelayMs, DEFAULT_IDLE_DELAY_MS);
    this.#offlineDelayMs = delay(
      options.offlineDelayMs,
      DEFAULT_OFFLINE_DELAY_MS,
    );
  }

  health(): PrivateVaultBrokerSupervisorHealth {
    return Object.freeze({
      state: this.#state,
      ready: this.#state === "running" || this.#state === "offline",
      processing: this.#processing !== null,
      lastOutcome: this.#lastOutcome,
      retryAt: this.#retryAt,
      consecutiveOfflineChecks: this.#consecutiveOfflineChecks,
    });
  }

  async start(): Promise<void> {
    if (this.#state !== "stopped")
      throw new PrivateVaultBrokerSupervisorError();
    this.#state = "starting";
    try {
      await this.#store.initialize();
      this.#storeInitialized = true;
      const checkpoint = decodeCheckpoint(
        await this.#store.read(CHECKPOINT_NAMESPACE, CHECKPOINT_KEY),
      );
      this.#lastOutcome = checkpoint?.outcome ?? null;
      this.#retryAt = checkpoint?.retryAt ?? null;
      const health = await this.#native.health({
        ...base,
        operation: "health",
      });
      if (!validHealth(health)) throw new PrivateVaultBrokerSupervisorError();
      if ((await this.#verifyRevocation()) === "revoked") {
        await this.#native.lock({ ...base, operation: "lock" });
        this.#state = "revoked";
        return;
      }
      if (!health.unlocked) {
        const unlocked = await this.#native.unlock({
          ...base,
          operation: "unlock",
          vaultId: this.#vaultId,
        });
        if (unlocked.state !== "unlocked") {
          throw new PrivateVaultBrokerSupervisorError();
        }
      }
      const confirmed = await this.#native.health({
        ...base,
        operation: "health",
      });
      if (!validHealth(confirmed) || !confirmed.unlocked) {
        throw new PrivateVaultBrokerSupervisorError();
      }
      this.#state = "running";
      this.#schedule(0);
    } catch {
      await this.#failClosed();
      throw new PrivateVaultBrokerSupervisorError();
    }
  }

  async processNow(): Promise<void> {
    if (this.#state !== "running" && this.#state !== "offline") {
      throw new PrivateVaultBrokerSupervisorError();
    }
    if (this.#processing) return this.#processing;
    this.#clearTimer();
    const operation = this.#processOne();
    this.#processing = operation;
    try {
      await operation;
    } finally {
      if (this.#processing === operation) this.#processing = null;
    }
  }

  async stop(): Promise<void> {
    if (this.#state === "closed") return;
    if (this.#state === "stopping") {
      await this.#processing;
      return;
    }
    this.#state = "stopping";
    this.#clearTimer();
    await this.#processing;
    let failed = false;
    try {
      await this.#native.lock({ ...base, operation: "lock" });
    } catch {
      failed = true;
    }
    if (this.#storeInitialized) {
      try {
        await this.#store.close();
      } catch {
        failed = true;
      }
      this.#storeInitialized = false;
    }
    this.#state = failed ? "stopped" : "closed";
    if (failed) throw new PrivateVaultBrokerSupervisorError();
  }

  async #processOne(): Promise<void> {
    try {
      const health = await this.#native.health({
        ...base,
        operation: "health",
      });
      if (!validHealth(health)) throw new PrivateVaultBrokerSupervisorError();
      const membership = await this.#verifyRevocation();
      if (membership === "revoked") {
        this.#state = "revoked";
        await this.#native.lock({ ...base, operation: "lock" });
        return;
      }
      if (!health.unlocked) {
        const unlocked = await this.#native.unlock({
          ...base,
          operation: "unlock",
          vaultId: this.#vaultId,
        });
        if (unlocked.state !== "unlocked") {
          throw new PrivateVaultBrokerSupervisorError();
        }
      }
      const outcome = await this.#worker.processOnce();
      this.#consecutiveOfflineChecks = 0;
      this.#state = "running";
      this.#lastOutcome = outcome.state;
      this.#retryAt = outcome.state === "retry_wait" ? outcome.retryAt : null;
      await this.#writeCheckpoint(outcome);
      this.#schedule(this.#nextDelay(outcome));
    } catch {
      if (this.#state === "revoked" || this.#state === "stopping") return;
      try {
        await this.#native.lock({ ...base, operation: "lock" });
      } catch {}
      this.#state = "offline";
      this.#consecutiveOfflineChecks += 1;
      this.#schedule(
        Math.min(
          MAX_DELAY_MS,
          this.#offlineDelayMs *
            2 ** Math.min(6, this.#consecutiveOfflineChecks - 1),
        ),
      );
    }
  }

  async #verifyRevocation(): Promise<"active" | "revoked"> {
    const status = await this.#revocation.verify({
      vaultId: this.#vaultId,
      endpointId: this.#endpointId,
    });
    if (status !== "active" && status !== "revoked") {
      throw new PrivateVaultBrokerSupervisorError();
    }
    return status;
  }

  #nextDelay(outcome: PrivateVaultBrokerWorkerOutcome): number {
    if (outcome.state !== "retry_wait") {
      return outcome.state === "idle" ? this.#idleDelayMs : 1;
    }
    const retryAt = Date.parse(outcome.retryAt);
    if (!Number.isFinite(retryAt))
      throw new PrivateVaultBrokerSupervisorError();
    return Math.max(1, Math.min(MAX_DELAY_MS, retryAt - this.#now().getTime()));
  }

  async #writeCheckpoint(
    outcome: PrivateVaultBrokerWorkerOutcome,
  ): Promise<void> {
    const checkpoint: PersistedCheckpoint = {
      version: 1,
      outcome: outcome.state,
      observedAt: this.#now().toISOString(),
      retryAt: outcome.state === "retry_wait" ? outcome.retryAt : null,
    };
    const encoded = new TextEncoder().encode(JSON.stringify(checkpoint));
    try {
      await this.#store.write(CHECKPOINT_NAMESPACE, CHECKPOINT_KEY, encoded);
    } finally {
      this.#crypto.zeroize(encoded);
    }
  }

  #schedule(delayMs: number): void {
    if (this.#state !== "running" && this.#state !== "offline") return;
    this.#clearTimer();
    this.#timer = this.#scheduler.set(delayMs, () => {
      this.#timer = null;
      void this.processNow().catch(() => {});
    });
  }

  #clearTimer(): void {
    if (this.#timer === null) return;
    this.#scheduler.clear(this.#timer);
    this.#timer = null;
  }

  async #failClosed(): Promise<void> {
    this.#clearTimer();
    try {
      await this.#native.lock({ ...base, operation: "lock" });
    } catch {}
    if (this.#storeInitialized) {
      try {
        await this.#store.close();
      } catch {}
      this.#storeInitialized = false;
    }
    this.#state = "stopped";
  }
}
