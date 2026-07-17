export type PrivateVaultLockReason =
  | "explicit"
  | "suspend"
  | "screen_lock"
  | "update"
  | "quit";

export type PrivateVaultIntegrityMode = "production" | "synthetic_test";

export interface PrivateVaultIntegrityDecision {
  readonly trusted: boolean;
  readonly mode: PrivateVaultIntegrityMode;
  readonly trustRootId: string | null;
}

export interface PrivateVaultIntegrityVerifier {
  verify(): Promise<PrivateVaultIntegrityDecision>;
}

export interface PrivateVaultRuntimeController {
  health(): {
    readonly state: string;
    readonly ready: boolean;
    readonly unlocked: boolean;
  };
  initialize(): Promise<void>;
  unlock(vaultId: string): Promise<void>;
  lock(): Promise<void>;
  close(): Promise<void>;
}

export interface PrivateVaultLifecycleSource {
  on(
    event: Exclude<PrivateVaultLockReason, "explicit">,
    listener: () => void,
  ): () => void;
}

export interface PrivateVaultDesktopHealth {
  readonly ready: boolean;
  readonly unlocked: boolean;
  readonly integrityTrusted: boolean;
  readonly integrityMode: PrivateVaultIntegrityMode | null;
  readonly blockedReason:
    | "integrity_untrusted"
    | "initialization_failed"
    | "zeroization_failed"
    | "closed"
    | null;
}

export type PrivateVaultDesktopControllerErrorCode =
  | "integrity_untrusted"
  | "invalid_state"
  | "initialization_failed"
  | "unlock_failed"
  | "lock_failed"
  | "close_failed";

export class PrivateVaultDesktopControllerError extends Error {
  constructor(readonly code: PrivateVaultDesktopControllerErrorCode) {
    super("Private Vault desktop operation failed");
    this.name = "PrivateVaultDesktopControllerError";
  }
}

export interface PrivateVaultDesktopControllerOptions {
  readonly runtime: PrivateVaultRuntimeController;
  readonly integrity: PrivateVaultIntegrityVerifier;
  readonly lifecycle?: PrivateVaultLifecycleSource;
  readonly allowSyntheticIntegrity?: boolean;
  readonly onFatalEvictionFailure?: (reason: PrivateVaultLockReason) => void;
}

export class PrivateVaultDesktopController {
  readonly #runtime: PrivateVaultRuntimeController;
  readonly #integrity: PrivateVaultIntegrityVerifier;
  readonly #allowSyntheticIntegrity: boolean;
  readonly #onFatalEvictionFailure: (reason: PrivateVaultLockReason) => void;
  readonly #removeLifecycleListeners: Array<() => void> = [];
  #tail: Promise<void> = Promise.resolve();
  #initialized = false;
  #closed = false;
  #integrityDecision: PrivateVaultIntegrityDecision | null = null;
  #blockedReason: PrivateVaultDesktopHealth["blockedReason"] = null;

  constructor(options: PrivateVaultDesktopControllerOptions) {
    this.#runtime = options.runtime;
    this.#integrity = options.integrity;
    this.#allowSyntheticIntegrity = options.allowSyntheticIntegrity ?? false;
    this.#onFatalEvictionFailure =
      options.onFatalEvictionFailure ?? (() => undefined);
    if (options.lifecycle) {
      for (const event of [
        "suspend",
        "screen_lock",
        "update",
        "quit",
      ] as const) {
        this.#removeLifecycleListeners.push(
          options.lifecycle.on(event, () => {
            void (event === "quit" ? this.close() : this.lock(event)).catch(
              () => {},
            );
          }),
        );
      }
    }
  }

  health(): PrivateVaultDesktopHealth {
    const runtime = this.#runtime.health();
    return Object.freeze({
      ready:
        !this.#closed &&
        this.#blockedReason !== "zeroization_failed" &&
        this.#integrityDecision?.trusted === true &&
        runtime.ready,
      unlocked: !this.#closed && runtime.unlocked,
      integrityTrusted: this.#integrityDecision?.trusted === true,
      integrityMode: this.#integrityDecision?.mode ?? null,
      blockedReason: this.#closed ? "closed" : this.#blockedReason,
    });
  }

  initialize(): Promise<void> {
    return this.#enqueue(async () => {
      this.#assertOpen();
      if (this.#initialized) {
        throw new PrivateVaultDesktopControllerError("invalid_state");
      }
      await this.#requireTrustedIntegrity();
      try {
        await this.#runtime.initialize();
        this.#initialized = true;
        this.#blockedReason = null;
      } catch {
        this.#blockedReason = "initialization_failed";
        throw new PrivateVaultDesktopControllerError("initialization_failed");
      }
    });
  }

  unlock(vaultId: string): Promise<void> {
    return this.#enqueue(async () => {
      this.#assertOpen();
      if (this.#blockedReason === "zeroization_failed") {
        throw new PrivateVaultDesktopControllerError("invalid_state");
      }
      if (!this.#initialized) {
        throw new PrivateVaultDesktopControllerError("invalid_state");
      }
      await this.#requireTrustedIntegrity();
      try {
        await this.#runtime.unlock(vaultId);
      } catch {
        throw new PrivateVaultDesktopControllerError("unlock_failed");
      }
    });
  }

  lock(reason: PrivateVaultLockReason = "explicit"): Promise<void> {
    return this.#enqueue(async () => {
      this.#assertOpen();
      if (!this.#initialized) return;
      try {
        await this.#runtime.lock();
      } catch {
        await this.#closeAfterFailedEviction(reason);
        throw new PrivateVaultDesktopControllerError("lock_failed");
      }
    });
  }

  close(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#closed) return;
      if (!this.#initialized) {
        this.#markClosed();
        return;
      }
      try {
        await this.#runtime.close();
      } catch {
        this.#blockedReason = "zeroization_failed";
        this.#reportFatalEvictionFailure("quit");
        throw new PrivateVaultDesktopControllerError("close_failed");
      }
      this.#initialized = false;
      this.#markClosed();
    });
  }

  async #requireTrustedIntegrity(): Promise<void> {
    let decision: PrivateVaultIntegrityDecision;
    try {
      const candidate = await this.#integrity.verify();
      decision = {
        trusted: candidate.trusted === true,
        mode:
          candidate.mode === "synthetic_test" ? "synthetic_test" : "production",
        trustRootId:
          typeof candidate.trustRootId === "string"
            ? candidate.trustRootId
            : null,
      };
    } catch {
      decision = { trusted: false, mode: "production", trustRootId: null };
    }
    const trusted =
      decision.trusted &&
      (decision.mode === "production" || this.#allowSyntheticIntegrity) &&
      typeof decision.trustRootId === "string" &&
      decision.trustRootId.length >= 8;
    this.#integrityDecision = { ...decision, trusted };
    if (!trusted) {
      this.#blockedReason = "integrity_untrusted";
      if (this.#initialized) {
        try {
          await this.#runtime.lock();
        } catch {
          await this.#closeAfterFailedEviction("explicit");
        }
      }
      throw new PrivateVaultDesktopControllerError("integrity_untrusted");
    }
  }

  async #closeAfterFailedEviction(
    reason: PrivateVaultLockReason,
  ): Promise<void> {
    try {
      await this.#runtime.close();
      this.#initialized = false;
      this.#markClosed();
    } catch {
      this.#blockedReason = "zeroization_failed";
      this.#reportFatalEvictionFailure(reason);
      throw new PrivateVaultDesktopControllerError("lock_failed");
    }
  }

  #reportFatalEvictionFailure(reason: PrivateVaultLockReason): void {
    try {
      this.#onFatalEvictionFailure(reason);
    } catch {}
  }

  #markClosed(): void {
    this.#closed = true;
    for (const remove of this.#removeLifecycleListeners.splice(0)) {
      try {
        remove();
      } catch {}
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new PrivateVaultDesktopControllerError("invalid_state");
    }
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(operation, operation);
    this.#tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
