import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeLegacyClaims = vi.hoisted(() => vi.fn());
const deleteExpired = vi.hoisted(() => vi.fn());
const sweep = vi.hoisted(() => vi.fn());
const awaitContentDatabaseReady = vi.hoisted(() => vi.fn());
const trackPluginInit = vi.hoisted(() => vi.fn());

vi.mock("../lib/private-vault-endpoint-request-nonces.js", () => ({
  sqlPrivateVaultEndpointRequestNonceStore: {
    bridgeLegacyClaims,
    deleteExpired,
  },
}));
vi.mock("../lib/private-vault-retention.js", () => ({
  privateVaultRetentionService: { sweep },
  PRIVATE_VAULT_RETENTION_SWEEP_INTERVAL_MS: 6 * 60 * 60 * 1_000,
}));
vi.mock("./db.js", () => ({ awaitContentDatabaseReady }));
vi.mock("@agent-native/core/server", () => ({ trackPluginInit }));

import contentPrivateVaultRetentionPlugin from "./private-vault-retention.js";

describe("Content Private Vault retention startup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bridgeLegacyClaims.mockResolvedValue(0);
    deleteExpired.mockResolvedValue(0);
    sweep.mockResolvedValue({});
    vi.spyOn(globalThis, "setTimeout").mockReturnValue({
      unref: vi.fn(),
    } as unknown as ReturnType<typeof setTimeout>);
    vi.spyOn(globalThis, "setInterval").mockReturnValue({
      unref: vi.fn(),
    } as unknown as ReturnType<typeof setInterval>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("waits for concurrent database migrations before bridging legacy claims", async () => {
    let releaseDatabase!: () => void;
    awaitContentDatabaseReady.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseDatabase = resolve;
      }),
    );
    const nitroApp = {};

    const ready = contentPrivateVaultRetentionPlugin(nitroApp);
    await Promise.resolve();
    expect(bridgeLegacyClaims).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
    expect(trackPluginInit).toHaveBeenCalledWith(nitroApp, ready, {
      paths: ["/_agent-native/health", "/api/private-vault"],
    });

    releaseDatabase();
    await ready;
    expect(bridgeLegacyClaims).toHaveBeenCalledTimes(1);
    expect(bridgeLegacyClaims).toHaveBeenCalledWith(expect.any(String));
    expect(setTimeout).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenCalledTimes(1);
  });
});
