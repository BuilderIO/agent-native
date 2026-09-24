import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resyncAllVaultSecretsToCredentialStore: vi.fn(),
}));

vi.mock("./vault-store.js", () => ({
  resyncAllVaultSecretsToCredentialStore:
    mocks.resyncAllVaultSecretsToCredentialStore,
}));

import {
  __resetVaultBootResyncGuardForTests,
  scheduleVaultBootResync,
} from "./vault-boot-resync.js";

describe("scheduleVaultBootResync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetVaultBootResyncGuardForTests();
    mocks.resyncAllVaultSecretsToCredentialStore.mockResolvedValue({
      groups: 0,
      failedGroups: 0,
      syncedKeys: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    mocks.resyncAllVaultSecretsToCredentialStore.mockReset();
  });

  it("does not run the resync synchronously — it waits for the boot delay", () => {
    scheduleVaultBootResync();
    expect(mocks.resyncAllVaultSecretsToCredentialStore).not.toHaveBeenCalled();
  });

  it("runs the resync exactly once after the boot delay elapses", async () => {
    scheduleVaultBootResync();
    await vi.runAllTimersAsync();
    expect(mocks.resyncAllVaultSecretsToCredentialStore).toHaveBeenCalledTimes(
      1,
    );
  });

  it("only schedules one timer per process even if called repeatedly", async () => {
    scheduleVaultBootResync();
    scheduleVaultBootResync();
    scheduleVaultBootResync();
    await vi.runAllTimersAsync();
    expect(mocks.resyncAllVaultSecretsToCredentialStore).toHaveBeenCalledTimes(
      1,
    );
  });

  it("swallows a resync failure instead of throwing", async () => {
    mocks.resyncAllVaultSecretsToCredentialStore.mockRejectedValue(
      new Error("boom"),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    scheduleVaultBootResync();
    await vi.runAllTimersAsync();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
