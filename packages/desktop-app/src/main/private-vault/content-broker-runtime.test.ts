import type {
  BrokerStateStore,
  PrivateVaultBrokerSupervisorHealth,
} from "@agent-native/private-vault-broker";
import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultContentBrokerRuntime,
  PrivateVaultContentBrokerRuntimeError,
} from "./content-broker-runtime.js";
import type { PrivateVaultNativeServiceClient } from "./native-service-client.js";

const descriptor = {
  version: 1,
  suite: "anc/v1",
  state: "active",
  vaultId: "00112233445566778899aabbccddeeff",
  endpointId: "11112222333344445555666677778888",
  head: { sequence: 7, hash: "ab".repeat(32) },
} as const;

const health: PrivateVaultBrokerSupervisorHealth = {
  state: "running",
  ready: true,
  processing: false,
  lastOutcome: null,
  retryAt: null,
  consecutiveOfflineChecks: 0,
};

function fixture(
  input: { descriptorFails?: boolean; startFails?: boolean } = {},
) {
  const lock = vi.fn(async () => ({
    version: 1 as const,
    suite: "anc/v1" as const,
    operation: "lock" as const,
    state: "locked" as const,
  }));
  const native = { lock } as unknown as PrivateVaultNativeServiceClient;
  const start = vi.fn(async () => {
    if (input.startFails) throw new Error("no");
  });
  const stop = vi.fn(async () => undefined);
  const compose = vi.fn(() => ({ start, stop, health: () => health }));
  const read = vi.fn(async () => {
    if (input.descriptorFails) throw new Error("no");
    return descriptor;
  });
  const runtime = new PrivateVaultContentBrokerRuntime({
    origin: "https://content.example.test",
    descriptor: { read },
    native,
    store: {} as BrokerStateStore,
    actions: { "get-document": { run: vi.fn() } },
    compose,
  });
  return { runtime, read, compose, start, stop, lock };
}

describe("Content broker desktop runtime", () => {
  it("discovers, starts, reports, and stops one serialized supervisor", async () => {
    const value = fixture();
    await expect(value.runtime.start()).resolves.toBeUndefined();
    expect(value.compose).toHaveBeenCalledWith(
      expect.objectContaining({
        descriptor,
        origin: "https://content.example.test",
      }),
    );
    expect(value.runtime.health()).toEqual(health);
    await expect(value.runtime.stop()).resolves.toBeUndefined();
    expect(value.stop).toHaveBeenCalledOnce();
    expect(value.runtime.health()).toBeNull();
  });

  it("locks native custody and collapses discovery or startup failures", async () => {
    for (const value of [
      fixture({ descriptorFails: true }),
      fixture({ startFails: true }),
    ]) {
      await expect(value.runtime.start()).rejects.toEqual(
        new PrivateVaultContentBrokerRuntimeError(),
      );
      expect(value.lock).toHaveBeenCalledOnce();
      expect(value.runtime.health()).toBeNull();
    }
  });
});
