import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultDesktopController,
  PrivateVaultDesktopControllerError,
  type PrivateVaultLifecycleSource,
  type PrivateVaultRuntimeController,
} from "./controller.js";

function runtime(): PrivateVaultRuntimeController {
  let ready = false;
  let unlocked = false;
  return {
    health: () => ({
      state: unlocked ? "unlocked" : "locked",
      ready,
      unlocked,
    }),
    initialize: vi.fn(async () => {
      ready = true;
    }),
    unlock: vi.fn(async () => {
      unlocked = true;
    }),
    lock: vi.fn(async () => {
      unlocked = false;
    }),
    close: vi.fn(async () => {
      ready = false;
      unlocked = false;
    }),
  };
}

function lifecycle() {
  const listeners = new Map<string, () => void>();
  const source: PrivateVaultLifecycleSource = {
    on: vi.fn((event, listener) => {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    }),
  };
  return { source, listeners };
}

describe("PrivateVaultDesktopController", () => {
  it("fails closed without a production integrity trust root", async () => {
    const broker = runtime();
    for (const decision of [
      { trusted: false, mode: "production" as const, trustRootId: null },
      { trusted: true, mode: "production" as const, trustRootId: "short" },
      {
        trusted: true,
        mode: "synthetic_test" as const,
        trustRootId: "synthetic:test-root",
      },
    ]) {
      const controller = new PrivateVaultDesktopController({
        runtime: broker,
        integrity: { verify: async () => decision },
      });
      await expect(controller.initialize()).rejects.toMatchObject({
        code: "integrity_untrusted",
        message: "Private Vault desktop operation failed",
      });
      expect(controller.health()).toMatchObject({
        ready: false,
        unlocked: false,
        integrityTrusted: false,
        blockedReason: "integrity_untrusted",
      });
    }
    expect(broker.initialize).not.toHaveBeenCalled();
  });

  it("permits an explicit synthetic root only in synthetic test mode", async () => {
    const broker = runtime();
    const controller = new PrivateVaultDesktopController({
      runtime: broker,
      integrity: {
        verify: async () => ({
          trusted: true,
          mode: "synthetic_test",
          trustRootId: "synthetic:test-root",
        }),
      },
      allowSyntheticIntegrity: true,
    });
    await controller.initialize();
    expect(controller.health()).toMatchObject({
      ready: true,
      integrityTrusted: true,
      integrityMode: "synthetic_test",
    });
  });

  it("serializes unlock with suspend and screen-lock key eviction", async () => {
    const broker = runtime();
    const events = lifecycle();
    let releaseUnlock!: () => void;
    vi.mocked(broker.unlock).mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          releaseUnlock = resolve;
        }),
    );
    const controller = new PrivateVaultDesktopController({
      runtime: broker,
      integrity: {
        verify: async () => ({
          trusted: true,
          mode: "production",
          trustRootId: "mac-team:W3PMF2T3MW",
        }),
      },
      lifecycle: events.source,
    });
    await controller.initialize();
    const unlocking = controller.unlock("vault:test-controller");
    await vi.waitFor(() => expect(releaseUnlock).toBeTypeOf("function"));
    events.listeners.get("suspend")?.();
    expect(broker.lock).not.toHaveBeenCalled();
    releaseUnlock();
    await unlocking;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(broker.lock).toHaveBeenCalledTimes(1);

    await controller.unlock("vault:test-controller");
    events.listeners.get("screen_lock")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(broker.lock).toHaveBeenCalledTimes(2);
  });

  it("revalidates integrity on every unlock and collapses runtime diagnostics", async () => {
    const broker = runtime();
    const verify = vi
      .fn()
      .mockResolvedValueOnce({
        trusted: true,
        mode: "production",
        trustRootId: "mac-team:W3PMF2T3MW",
      })
      .mockResolvedValueOnce({
        trusted: true,
        mode: "production",
        trustRootId: "mac-team:W3PMF2T3MW",
      })
      .mockResolvedValueOnce({
        trusted: false,
        mode: "production",
        trustRootId: null,
      });
    const controller = new PrivateVaultDesktopController({
      runtime: broker,
      integrity: { verify },
    });
    await controller.initialize();
    await controller.unlock("vault:test-controller");
    await expect(controller.unlock("vault:test-controller")).rejects.toEqual(
      new PrivateVaultDesktopControllerError("integrity_untrusted"),
    );
    expect(broker.unlock).toHaveBeenCalledTimes(1);
    expect(broker.lock).toHaveBeenCalledTimes(1);
    expect(controller.health()).toMatchObject({
      unlocked: false,
      integrityTrusted: false,
      blockedReason: "integrity_untrusted",
    });
  });

  it("falls back to runtime close when integrity eviction cannot lock", async () => {
    const broker = runtime();
    vi.mocked(broker.lock).mockRejectedValueOnce(new Error("sensitive detail"));
    const verify = vi
      .fn()
      .mockResolvedValueOnce({
        trusted: true,
        mode: "production",
        trustRootId: "mac-team:W3PMF2T3MW",
      })
      .mockResolvedValueOnce({
        trusted: true,
        mode: "production",
        trustRootId: "mac-team:W3PMF2T3MW",
      })
      .mockResolvedValueOnce({
        trusted: false,
        mode: "production",
        trustRootId: null,
      });
    const controller = new PrivateVaultDesktopController({
      runtime: broker,
      integrity: { verify },
    });
    await controller.initialize();
    await controller.unlock("vault:test-controller");
    await expect(controller.unlock("vault:test-controller")).rejects.toEqual(
      new PrivateVaultDesktopControllerError("integrity_untrusted"),
    );
    expect(broker.close).toHaveBeenCalledTimes(1);
    expect(controller.health()).toMatchObject({
      ready: false,
      unlocked: false,
      blockedReason: "closed",
    });
  });

  it("keeps failed close retryable and reports resident runtime state truthfully", async () => {
    const broker = runtime();
    const fatal = vi.fn();
    vi.mocked(broker.close).mockRejectedValueOnce(
      new Error("sensitive detail"),
    );
    const controller = new PrivateVaultDesktopController({
      runtime: broker,
      integrity: {
        verify: async () => ({
          trusted: true,
          mode: "production",
          trustRootId: "mac-team:W3PMF2T3MW",
        }),
      },
      onFatalEvictionFailure: fatal,
    });
    await controller.initialize();
    await controller.unlock("vault:test-controller");
    await expect(controller.close()).rejects.toEqual(
      new PrivateVaultDesktopControllerError("close_failed"),
    );
    expect(controller.health()).toMatchObject({
      ready: false,
      unlocked: true,
      blockedReason: "zeroization_failed",
    });
    expect(fatal).toHaveBeenCalledWith("quit");

    await controller.close();
    expect(broker.close).toHaveBeenCalledTimes(2);
    expect(controller.health()).toMatchObject({
      ready: false,
      unlocked: false,
      blockedReason: "closed",
    });
  });

  it("escalates a lifecycle eviction failure when lock and close both fail", async () => {
    const broker = runtime();
    const events = lifecycle();
    const fatal = vi.fn();
    vi.mocked(broker.lock).mockRejectedValueOnce(new Error("sensitive detail"));
    vi.mocked(broker.close).mockRejectedValueOnce(
      new Error("sensitive detail"),
    );
    const controller = new PrivateVaultDesktopController({
      runtime: broker,
      integrity: {
        verify: async () => ({
          trusted: true,
          mode: "production",
          trustRootId: "mac-team:W3PMF2T3MW",
        }),
      },
      lifecycle: events.source,
      onFatalEvictionFailure: fatal,
    });
    await controller.initialize();
    await controller.unlock("vault:test-controller");
    events.listeners.get("suspend")?.();
    await vi.waitFor(() => expect(fatal).toHaveBeenCalledWith("suspend"));
    expect(controller.health()).toMatchObject({
      unlocked: true,
      blockedReason: "zeroization_failed",
    });
    await expect(controller.unlock("vault:must-not-load")).rejects.toEqual(
      new PrivateVaultDesktopControllerError("invalid_state"),
    );
    expect(broker.unlock).toHaveBeenCalledTimes(1);
    await controller.close();
    expect(broker.close).toHaveBeenCalledTimes(2);
    expect(controller.health().blockedReason).toBe("closed");
  });

  it("closes once, unregisters lifecycle hooks, and exposes no vault identity", async () => {
    const broker = runtime();
    const events = lifecycle();
    const controller = new PrivateVaultDesktopController({
      runtime: broker,
      integrity: {
        verify: async () => ({
          trusted: true,
          mode: "production",
          trustRootId: "mac-team:W3PMF2T3MW",
        }),
      },
      lifecycle: events.source,
    });
    await controller.initialize();
    await controller.unlock("vault:secret-name");
    expect(JSON.stringify(controller.health())).not.toContain("secret-name");
    events.listeners.get("quit")?.();
    await vi.waitFor(() => expect(broker.close).toHaveBeenCalledTimes(1));
    await controller.close();
    await controller.close();
    expect(broker.close).toHaveBeenCalledTimes(1);
    expect(events.listeners.size).toBe(0);
    expect(controller.health()).toMatchObject({
      ready: false,
      unlocked: false,
      blockedReason: "closed",
    });
  });
});
