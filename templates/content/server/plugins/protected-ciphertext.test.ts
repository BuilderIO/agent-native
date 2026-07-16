import { beforeEach, describe, expect, it, vi } from "vitest";

const registerProtectedCiphertextProvider = vi.hoisted(() => vi.fn());
const vercelProtectedCiphertextProvider = vi.hoisted(() => ({
  id: "vercel-protected-ciphertext",
  isConfigured: vi.fn(() => false),
  storageGeneration: vi.fn(() => null as string | null),
}));
const legacyPrivateBlobModuleLoaded = vi.hoisted(() => vi.fn());
const insertValues = vi.hoisted(() => vi.fn());
const selectLimit = vi.hoisted(() => vi.fn());
const getDb = vi.hoisted(() => vi.fn());
const awaitContentDatabaseReady = vi.hoisted(() => vi.fn());
const trackPluginInit = vi.hoisted(() => vi.fn());

const insert = vi.hoisted(() => vi.fn());
const select = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", () => ({
  getDb,
  schema: {
    contentEncryptedVaultStorageBindings: {
      bindingId: "binding_id",
    },
  },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(() => "predicate") }));
vi.mock("./db.js", () => ({ awaitContentDatabaseReady }));
vi.mock("@agent-native/core/server", () => ({ trackPluginInit }));

vi.mock("@agent-native/core/protected-ciphertext", () => ({
  registerProtectedCiphertextProvider,
  vercelProtectedCiphertextProvider,
}));
vi.mock("@agent-native/core/private-blob", () => {
  legacyPrivateBlobModuleLoaded();
  return {};
});

import contentProtectedCiphertextPlugin from "./protected-ciphertext";

describe("Content protected ciphertext plugin", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vercelProtectedCiphertextProvider.isConfigured.mockReturnValue(false);
    vercelProtectedCiphertextProvider.storageGeneration.mockReturnValue(null);
    awaitContentDatabaseReady.mockResolvedValue(undefined);
    insertValues.mockReturnValue({ onConflictDoNothing: vi.fn() });
    selectLimit.mockResolvedValue([]);
    insert.mockReturnValue({ values: insertValues });
    select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: selectLimit })),
      })),
    });
    getDb.mockReturnValue({ insert, select });
  });

  it("registers exactly the Vercel protected provider without loading private-blob", async () => {
    await contentProtectedCiphertextPlugin();

    expect(registerProtectedCiphertextProvider).toHaveBeenCalledTimes(1);
    expect(registerProtectedCiphertextProvider).toHaveBeenCalledWith(
      vercelProtectedCiphertextProvider,
    );
    expect(legacyPrivateBlobModuleLoaded).not.toHaveBeenCalled();
  });

  it("pins the configured provider generation before registration", async () => {
    vercelProtectedCiphertextProvider.isConfigured.mockReturnValue(true);
    vercelProtectedCiphertextProvider.storageGeneration.mockReturnValue(
      "store:test-generation-v1",
    );
    selectLimit.mockImplementation(async () => {
      const written = insertValues.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      return [written];
    });

    await contentProtectedCiphertextPlugin();

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: "content-private-vault-v1",
        providerId: vercelProtectedCiphertextProvider.id,
        generationDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(registerProtectedCiphertextProvider).toHaveBeenCalledTimes(1);
  });

  it("waits for migrations and registers a request readiness barrier", async () => {
    let releaseDatabase!: () => void;
    awaitContentDatabaseReady.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseDatabase = resolve;
      }),
    );
    const nitroApp = {};

    const ready = contentProtectedCiphertextPlugin(nitroApp);
    await Promise.resolve();
    expect(registerProtectedCiphertextProvider).not.toHaveBeenCalled();
    expect(trackPluginInit).toHaveBeenCalledWith(nitroApp, ready, {
      paths: ["/_agent-native/health", "/api/private-vault"],
    });

    releaseDatabase();
    await ready;
    expect(registerProtectedCiphertextProvider).toHaveBeenCalledTimes(1);
  });

  it("collapses binding database failures to a stable startup error", async () => {
    vercelProtectedCiphertextProvider.isConfigured.mockReturnValue(true);
    vercelProtectedCiphertextProvider.storageGeneration.mockReturnValue(
      "store:test-generation-v1",
    );
    insertValues.mockReturnValue({
      onConflictDoNothing: vi.fn().mockRejectedValue(new Error("raw query")),
    });

    await expect(contentProtectedCiphertextPlugin()).rejects.toThrow(
      "Protected ciphertext storage binding is unavailable",
    );
    expect(registerProtectedCiphertextProvider).not.toHaveBeenCalled();
  });

  it("fails closed when deployment storage identity changes", async () => {
    vercelProtectedCiphertextProvider.isConfigured.mockReturnValue(true);
    vercelProtectedCiphertextProvider.storageGeneration.mockReturnValue(
      "store:new-generation-v2",
    );
    selectLimit.mockResolvedValue([
      {
        bindingId: "content-private-vault-v1",
        providerId: vercelProtectedCiphertextProvider.id,
        generationDigest: "0".repeat(64),
      },
    ]);

    await expect(contentProtectedCiphertextPlugin()).rejects.toThrow(
      /differs from the immutable deployment binding/i,
    );
    expect(registerProtectedCiphertextProvider).not.toHaveBeenCalled();
  });
});
