import type { AncV1CryptoProvider } from "./crypto/provider.js";
import { sodiumNativeAncV1 } from "./crypto/sodium-native.js";
import type { KeyCustodyAdapter } from "./key-custody.js";
import type { BrokerStateStore } from "./state-store.js";

export type PrivateVaultBrokerState =
  | "uninitialized"
  | "initializing"
  | "locked"
  | "unlocking"
  | "unlocked"
  | "locking"
  | "closing"
  | "closed";

export interface PrivateVaultBrokerHealth {
  readonly state: PrivateVaultBrokerState;
  readonly ready: boolean;
  readonly unlocked: boolean;
  readonly vaultId: string | null;
  readonly initializedAt: string | null;
}

export interface PrivateVaultBrokerRuntimeOptions {
  readonly custody: KeyCustodyAdapter;
  readonly store: BrokerStateStore;
  readonly crypto?: AncV1CryptoProvider;
  readonly now?: () => Date;
}

export class PrivateVaultBrokerLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateVaultBrokerLifecycleError";
  }
}

const VAULT_KEY_BYTES = 32;

export class PrivateVaultBrokerRuntime {
  readonly #custody: KeyCustodyAdapter;
  readonly #store: BrokerStateStore;
  readonly #crypto: AncV1CryptoProvider;
  readonly #now: () => Date;
  #state: PrivateVaultBrokerState = "uninitialized";
  #vaultId: string | null = null;
  #vaultKey: Uint8Array | null = null;
  #initializedAt: string | null = null;
  readonly #activeKeyOperations = new Set<Promise<void>>();

  constructor(options: PrivateVaultBrokerRuntimeOptions) {
    this.#custody = options.custody;
    this.#store = options.store;
    this.#crypto = options.crypto ?? sodiumNativeAncV1;
    this.#now = options.now ?? (() => new Date());
  }

  health(): PrivateVaultBrokerHealth {
    return Object.freeze({
      state: this.#state,
      ready: this.#state === "locked" || this.#state === "unlocked",
      unlocked: this.#state === "unlocked",
      vaultId: this.#state === "unlocked" ? this.#vaultId : null,
      initializedAt: this.#initializedAt,
    });
  }

  async initialize(): Promise<void> {
    if (this.#state !== "uninitialized") {
      throw new PrivateVaultBrokerLifecycleError(
        `Cannot initialize broker while ${this.#state}`,
      );
    }
    this.#state = "initializing";
    try {
      await this.#store.initialize();
      await this.#custody.initialize();
      this.#initializedAt = this.#now().toISOString();
      this.#state = "locked";
    } catch (error) {
      this.#clearVaultKey();
      await this.#closeAfterFailure(this.#store);
      await this.#closeAfterFailure(this.#custody);
      this.#initializedAt = null;
      this.#state = "uninitialized";
      throw error;
    }
  }

  async unlock(vaultId: string): Promise<void> {
    if (this.#state !== "locked") {
      throw new PrivateVaultBrokerLifecycleError(
        `Cannot unlock broker while ${this.#state}`,
      );
    }
    if (!vaultId.trim()) {
      throw new PrivateVaultBrokerLifecycleError("Vault ID must not be empty");
    }
    this.#state = "unlocking";
    let loadedKey: Uint8Array | null = null;
    try {
      loadedKey = await this.#custody.loadVaultKey(vaultId);
      if (loadedKey === null) {
        throw new PrivateVaultBrokerLifecycleError(
          `No custody key is available for vault ${vaultId}`,
        );
      }
      if (loadedKey.byteLength !== VAULT_KEY_BYTES) {
        throw new PrivateVaultBrokerLifecycleError(
          `Vault key must be exactly ${VAULT_KEY_BYTES} bytes`,
        );
      }
      this.#vaultKey = Uint8Array.from(loadedKey);
      this.#vaultId = vaultId;
      this.#state = "unlocked";
    } catch (error) {
      this.#clearVaultKey();
      this.#state = "locked";
      throw error;
    } finally {
      if (loadedKey !== null) this.#crypto.zeroize(loadedKey);
    }
  }

  async lock(): Promise<void> {
    if (this.#state === "closed" || this.#state === "closing") {
      throw new PrivateVaultBrokerLifecycleError(
        `Cannot lock broker while ${this.#state}`,
      );
    }
    if (this.#state !== "locked" && this.#state !== "unlocked") {
      throw new PrivateVaultBrokerLifecycleError(
        `Cannot lock broker while ${this.#state}`,
      );
    }
    this.#state = "locking";
    this.#clearVaultKey();
    await Promise.all(this.#activeKeyOperations);
    this.#state = "locked";
  }

  async withVaultKey<T>(
    operation: (key: Uint8Array, vaultId: string) => Promise<T> | T,
  ): Promise<T> {
    if (this.#state !== "unlocked" || !this.#vaultKey || !this.#vaultId) {
      throw new PrivateVaultBrokerLifecycleError("Broker is locked");
    }
    const ephemeralKey = Uint8Array.from(this.#vaultKey);
    let releaseOperation!: () => void;
    const activeOperation = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    this.#activeKeyOperations.add(activeOperation);
    try {
      return await operation(ephemeralKey, this.#vaultId);
    } finally {
      this.#crypto.zeroize(ephemeralKey);
      releaseOperation();
      this.#activeKeyOperations.delete(activeOperation);
    }
  }

  async close(): Promise<void> {
    if (this.#state === "closed") return;
    if (
      this.#state === "initializing" ||
      this.#state === "unlocking" ||
      this.#state === "locking" ||
      this.#state === "closing"
    ) {
      throw new PrivateVaultBrokerLifecycleError(
        `Cannot close broker while ${this.#state}`,
      );
    }
    this.#state = "closing";
    this.#clearVaultKey();
    await Promise.all(this.#activeKeyOperations);
    const results = await Promise.allSettled([
      this.#custody.close(),
      this.#store.close(),
    ]);
    this.#state = "closed";
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
  }

  #clearVaultKey(): void {
    if (this.#vaultKey) this.#crypto.zeroize(this.#vaultKey);
    this.#vaultKey = null;
    this.#vaultId = null;
  }

  async #closeAfterFailure(adapter: { close(): Promise<void> }): Promise<void> {
    try {
      await adapter.close();
    } catch {
      // Preserve the initialization error while still attempting every cleanup.
    }
  }
}
