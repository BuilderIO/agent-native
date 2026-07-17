import { describe, expect, it, vi } from "vitest";

import type { AncV1CryptoProvider } from "./crypto/provider.js";
import { sodiumNativeAncV1 } from "./crypto/sodium-native.js";
import type { KeyCustodyAdapter } from "./key-custody.js";
import {
  PrivateVaultBrokerLifecycleError,
  PrivateVaultBrokerRuntime,
} from "./runtime.js";
import type { BrokerStateStore } from "./state-store.js";

function adapters(key = new Uint8Array(32).fill(7)) {
  const custody: KeyCustodyAdapter = {
    initialize: vi.fn(async () => undefined),
    loadVaultKey: vi.fn(async () => Uint8Array.from(key)),
    storeVaultKey: vi.fn(async () => undefined),
    deleteVaultKey: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const store: BrokerStateStore = {
    initialize: vi.fn(async () => undefined),
    read: vi.fn(async () => null),
    write: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  return { custody, store };
}

function trackingCrypto(zeroized: Uint8Array[]): AncV1CryptoProvider {
  return {
    ...sodiumNativeAncV1,
    zeroize(value: Uint8Array) {
      zeroized.push(value);
      value.fill(0);
    },
  };
}

describe("PrivateVaultBrokerRuntime", () => {
  it("initializes locked and exposes only content-free health", async () => {
    const { custody, store } = adapters();
    const runtime = new PrivateVaultBrokerRuntime({
      custody,
      store,
      now: () => new Date("2026-07-16T12:00:00.000Z"),
    });

    expect(runtime.health()).toEqual({
      state: "uninitialized",
      ready: false,
      unlocked: false,
      vaultId: null,
      initializedAt: null,
    });
    await runtime.initialize();
    expect(store.initialize).toHaveBeenCalledBefore(
      vi.mocked(custody.initialize),
    );
    expect(runtime.health()).toEqual({
      state: "locked",
      ready: true,
      unlocked: false,
      vaultId: null,
      initializedAt: "2026-07-16T12:00:00.000Z",
    });
  });

  it("unlocks, scopes key access, and zeroizes every transferred copy", async () => {
    const sourceKey = new Uint8Array(32).fill(9);
    const { custody, store } = adapters(sourceKey);
    const zeroized: Uint8Array[] = [];
    const runtime = new PrivateVaultBrokerRuntime({
      custody,
      store,
      crypto: trackingCrypto(zeroized),
    });
    await runtime.initialize();
    await runtime.unlock("vault-12345678");

    expect(runtime.health()).toMatchObject({
      state: "unlocked",
      ready: true,
      unlocked: true,
      vaultId: "vault-12345678",
    });
    let callbackKey: Uint8Array | undefined;
    await expect(
      runtime.withVaultKey((key, vaultId) => {
        callbackKey = key;
        expect(vaultId).toBe("vault-12345678");
        expect(key).toEqual(sourceKey);
        return "done";
      }),
    ).resolves.toBe("done");
    expect(callbackKey).toEqual(new Uint8Array(32));

    await runtime.lock();
    expect(runtime.health()).toMatchObject({
      state: "locked",
      unlocked: false,
      vaultId: null,
    });
    await expect(runtime.withVaultKey(() => undefined)).rejects.toThrow(
      "Broker is locked",
    );
    expect(zeroized).toHaveLength(3);
    expect(zeroized.every((value) => value.every((byte) => byte === 0))).toBe(
      true,
    );
  });

  it("zeroizes ephemeral key access even when the operation throws", async () => {
    const { custody, store } = adapters();
    const zeroized: Uint8Array[] = [];
    const runtime = new PrivateVaultBrokerRuntime({
      custody,
      store,
      crypto: trackingCrypto(zeroized),
    });
    await runtime.initialize();
    await runtime.unlock("vault-12345678");
    await expect(
      runtime.withVaultKey(() => {
        throw new Error("operation failed");
      }),
    ).rejects.toThrow("operation failed");
    expect(zeroized.at(-1)).toEqual(new Uint8Array(32));
  });

  it("stops new key access and waits for active access before locking", async () => {
    const { custody, store } = adapters();
    const runtime = new PrivateVaultBrokerRuntime({ custody, store });
    await runtime.initialize();
    await runtime.unlock("vault-12345678");

    let release!: () => void;
    const operation = runtime.withVaultKey(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const locking = runtime.lock();
    expect(runtime.health().state).toBe("locking");
    await expect(runtime.withVaultKey(() => undefined)).rejects.toThrow(
      "Broker is locked",
    );

    let locked = false;
    void locking.then(() => {
      locked = true;
    });
    await Promise.resolve();
    expect(locked).toBe(false);
    release();
    await operation;
    await locking;
    expect(runtime.health().state).toBe("locked");
  });

  it("fails closed and zeroizes invalid custody material", async () => {
    const invalidKey = new Uint8Array(31).fill(4);
    const { custody, store } = adapters(invalidKey);
    const zeroized: Uint8Array[] = [];
    const runtime = new PrivateVaultBrokerRuntime({
      custody,
      store,
      crypto: trackingCrypto(zeroized),
    });
    await runtime.initialize();
    await expect(runtime.unlock("vault-12345678")).rejects.toThrow(
      "Vault key must be exactly 32 bytes",
    );
    expect(runtime.health()).toMatchObject({
      state: "locked",
      unlocked: false,
    });
    expect(zeroized).toHaveLength(1);
    expect(zeroized[0]).toEqual(new Uint8Array(31));
  });

  it("rolls back initialization and closes initialized adapters on failure", async () => {
    const { custody, store } = adapters();
    vi.mocked(custody.initialize).mockRejectedValueOnce(
      new Error("custody unavailable"),
    );
    const runtime = new PrivateVaultBrokerRuntime({ custody, store });
    await expect(runtime.initialize()).rejects.toThrow("custody unavailable");
    expect(store.close).toHaveBeenCalledOnce();
    expect(custody.close).toHaveBeenCalledOnce();
    expect(runtime.health()).toMatchObject({
      state: "uninitialized",
      ready: false,
      initializedAt: null,
    });
  });

  it("rejects invalid transitions and missing custody keys", async () => {
    const { custody, store } = adapters();
    vi.mocked(custody.loadVaultKey).mockResolvedValueOnce(null);
    const runtime = new PrivateVaultBrokerRuntime({ custody, store });
    await expect(runtime.unlock("vault-12345678")).rejects.toBeInstanceOf(
      PrivateVaultBrokerLifecycleError,
    );
    await runtime.initialize();
    await expect(runtime.initialize()).rejects.toThrow(
      "Cannot initialize broker while locked",
    );
    await expect(runtime.unlock("   ")).rejects.toThrow(
      "Vault ID must not be empty",
    );
    await expect(runtime.unlock("vault-12345678")).rejects.toThrow(
      "No custody key is available",
    );
    expect(runtime.health().state).toBe("locked");
  });

  it("zeroizes before closing both adapters and remains closed on close failure", async () => {
    const { custody, store } = adapters();
    const zeroized: Uint8Array[] = [];
    vi.mocked(custody.close).mockRejectedValueOnce(
      new Error("custody close failed"),
    );
    const runtime = new PrivateVaultBrokerRuntime({
      custody,
      store,
      crypto: trackingCrypto(zeroized),
    });
    await runtime.initialize();
    await runtime.unlock("vault-12345678");
    await expect(runtime.close()).rejects.toThrow("custody close failed");
    expect(store.close).toHaveBeenCalledOnce();
    expect(runtime.health()).toMatchObject({
      state: "closed",
      ready: false,
      unlocked: false,
      vaultId: null,
    });
    expect(zeroized.every((value) => value.every((byte) => byte === 0))).toBe(
      true,
    );
    await expect(runtime.close()).resolves.toBeUndefined();
  });
});
