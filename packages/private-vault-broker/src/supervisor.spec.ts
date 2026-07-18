import { describe, expect, it, vi } from "vitest";

import type {
  NativeHealthResult,
  NativeLockResult,
  NativeUnlockResult,
} from "./native-service.js";
import type { BrokerStateStore } from "./state-store.js";
import {
  PrivateVaultBrokerSupervisor,
  PrivateVaultBrokerSupervisorError,
  type PrivateVaultBrokerScheduler,
  type PrivateVaultBrokerSupervisorNative,
} from "./supervisor.js";

const vaultId = "vault:test-supervisor";
const endpointId = "endpoint:test-supervisor";
const base = { version: 1 as const, suite: "anc/v1" as const };

function fixture() {
  let unlocked = false;
  const health = vi.fn(
    async (): Promise<NativeHealthResult> => ({
      ...base,
      operation: "health",
      state: unlocked ? "unlocked" : "locked",
      available: true,
      ready: true,
      unlocked,
      rotationAckState: "idle",
    }),
  );
  const unlock = vi.fn(async (): Promise<NativeUnlockResult> => {
    unlocked = true;
    return { ...base, operation: "unlock", state: "unlocked" };
  });
  const lock = vi.fn(async (): Promise<NativeLockResult> => {
    unlocked = false;
    return { ...base, operation: "lock", state: "locked" };
  });
  const native: PrivateVaultBrokerSupervisorNative = { health, unlock, lock };
  const persisted: Uint8Array[] = [];
  const store: BrokerStateStore = {
    initialize: vi.fn(async () => {}),
    read: vi.fn(async () => null),
    write: vi.fn(async (_namespace, _key, value) => {
      persisted.push(Uint8Array.from(value));
    }),
    delete: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const tasks: Array<{ delayMs: number; task: () => void }> = [];
  const scheduler: PrivateVaultBrokerScheduler = {
    set: vi.fn((delayMs, task) => {
      const entry = { delayMs, task };
      tasks.push(entry);
      return entry;
    }),
    clear: vi.fn((handle) => {
      const index = tasks.indexOf(handle as (typeof tasks)[number]);
      if (index >= 0) tasks.splice(index, 1);
    }),
  };
  const worker = {
    processOnce: vi.fn(async () => ({ state: "idle" as const })),
  };
  const revocation = { verify: vi.fn(async () => "active" as const) };
  const supervisor = new PrivateVaultBrokerSupervisor({
    vaultId,
    endpointId,
    native,
    worker,
    store,
    revocation,
    scheduler,
    now: () => new Date("2026-07-18T12:00:00.000Z"),
  });
  return {
    supervisor,
    native,
    health,
    unlock,
    lock,
    store,
    persisted,
    tasks,
    worker,
    revocation,
  };
}

describe("PrivateVaultBrokerSupervisor", () => {
  it("starts only after native health and membership checks, then exposes content-free health", async () => {
    const value = fixture();
    await value.supervisor.start();

    expect(value.store.initialize).toHaveBeenCalledOnce();
    expect(value.revocation.verify).toHaveBeenCalledWith({
      vaultId,
      endpointId,
    });
    expect(value.unlock).toHaveBeenCalledWith({
      ...base,
      operation: "unlock",
      vaultId,
    });
    expect(value.tasks).toHaveLength(1);
    expect(value.tasks[0]?.delayMs).toBe(0);
    expect(JSON.stringify(value.supervisor.health())).not.toContain(vaultId);
    expect(JSON.stringify(value.supervisor.health())).not.toContain(endpointId);
    expect(value.supervisor.health()).toMatchObject({
      state: "running",
      ready: true,
      processing: false,
    });
  });

  it("persists only an encrypted-store checkpoint without job or identity coordinates", async () => {
    const value = fixture();
    value.worker.processOnce.mockResolvedValueOnce({
      state: "completed",
      jobId: "job:must-not-persist",
    });
    await value.supervisor.start();
    await value.supervisor.processNow();

    expect(value.persisted).toHaveLength(1);
    const checkpoint = new TextDecoder().decode(value.persisted[0]);
    expect(JSON.parse(checkpoint)).toEqual({
      version: 1,
      outcome: "completed",
      observedAt: "2026-07-18T12:00:00.000Z",
      retryAt: null,
    });
    expect(checkpoint).not.toContain("job:must-not-persist");
    expect(checkpoint).not.toContain(vaultId);
    expect(checkpoint).not.toContain(endpointId);
  });

  it("locks and stops processing immediately when membership is revoked", async () => {
    const value = fixture();
    value.revocation.verify.mockResolvedValueOnce("revoked");
    await value.supervisor.start();

    expect(value.supervisor.health()).toMatchObject({
      state: "revoked",
      ready: false,
    });
    expect(value.lock).toHaveBeenCalledOnce();
    expect(value.unlock).not.toHaveBeenCalled();
    expect(value.worker.processOnce).not.toHaveBeenCalled();
    expect(value.tasks).toHaveLength(0);
  });

  it("locks during offline backoff and rechecks membership before resuming", async () => {
    const value = fixture();
    await value.supervisor.start();
    value.worker.processOnce.mockRejectedValueOnce(new Error("private detail"));
    await value.supervisor.processNow();

    expect(value.supervisor.health()).toMatchObject({
      state: "offline",
      ready: true,
      consecutiveOfflineChecks: 1,
    });
    expect(value.lock).toHaveBeenCalledOnce();
    expect(value.tasks.at(-1)?.delayMs).toBe(5_000);

    await value.supervisor.processNow();
    expect(value.revocation.verify).toHaveBeenCalledTimes(3);
    expect(value.unlock).toHaveBeenCalledTimes(2);
    expect(value.supervisor.health().state).toBe("running");
  });

  it("waits for in-flight work before locking and closing the encrypted store", async () => {
    const value = fixture();
    let release!: () => void;
    value.worker.processOnce.mockImplementationOnce(
      async () =>
        await new Promise<{ state: "idle" }>((resolve) => {
          release = () => resolve({ state: "idle" });
        }),
    );
    await value.supervisor.start();
    const processing = value.supervisor.processNow();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const stopping = value.supervisor.stop();
    expect(value.lock).not.toHaveBeenCalled();
    release();
    await processing;
    await stopping;

    expect(value.lock).toHaveBeenCalledOnce();
    expect(value.store.close).toHaveBeenCalledOnce();
    expect(value.supervisor.health()).toMatchObject({
      state: "closed",
      ready: false,
      processing: false,
    });
  });

  it("fails closed when native health is unavailable", async () => {
    const value = fixture();
    value.health.mockResolvedValueOnce({
      ...base,
      operation: "health",
      state: "unavailable",
      available: false,
      ready: false,
      unlocked: false,
      rotationAckState: "unavailable",
    });
    await expect(value.supervisor.start()).rejects.toEqual(
      new PrivateVaultBrokerSupervisorError(),
    );
    expect(value.lock).toHaveBeenCalledOnce();
    expect(value.store.close).toHaveBeenCalledOnce();
    expect(value.supervisor.health().state).toBe("stopped");
  });
});
