import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteAppSecret: vi.fn(),
  getDb: vi.fn(),
  listAppSecretsForScope: vi.fn(),
  readAppSecret: vi.fn(),
  writeAppSecret: vi.fn(),
}));

vi.mock("@agent-native/core/secrets", () => ({
  deleteAppSecret: mocks.deleteAppSecret,
  listAppSecretsForScope: mocks.listAppSecretsForScope,
  readAppSecret: mocks.readAppSecret,
  writeAppSecret: mocks.writeAppSecret,
}));

vi.mock("../../db/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/index.js")>();
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

import { readAppSecret } from "@agent-native/core/secrets";

import {
  cleanupSyncedCredentialKeysIfUnused,
  credentialStoreScopeForVaultCtx,
  isTrustedEnvVarSyncAgentUrl,
  resyncAllVaultSecretsToCredentialStore,
  syncSecretsToCredentialStore,
} from "./vault-store.js";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("credentialStoreScopeForVaultCtx", () => {
  it("uses org scope when vault sync runs inside an org", () => {
    expect(
      credentialStoreScopeForVaultCtx({
        ownerEmail: "admin@example.test",
        orgId: "org_123",
      }),
    ).toEqual({ scope: "org", scopeId: "org_123" });
  });

  it("uses workspace solo scope when no org is active", () => {
    expect(
      credentialStoreScopeForVaultCtx({
        ownerEmail: "owner@example.test",
        orgId: null,
      }),
    ).toEqual({
      scope: "workspace",
      scopeId: "solo:owner@example.test",
    });
  });
});

describe("isTrustedEnvVarSyncAgentUrl", () => {
  it("allows localhost development app URLs", () => {
    expect(isTrustedEnvVarSyncAgentUrl("http://localhost:9201")).toBe(true);
    expect(isTrustedEnvVarSyncAgentUrl("http://127.0.0.1:9201")).toBe(true);
  });

  it("allows same-origin workspace app URLs from deploy metadata", () => {
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "https://workspace.example.test");

    expect(
      isTrustedEnvVarSyncAgentUrl("https://workspace.example.test/slides"),
    ).toBe(true);
  });

  it("rejects remote custom agent origins", () => {
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "https://workspace.example.test");

    expect(isTrustedEnvVarSyncAgentUrl("https://attacker.example.test")).toBe(
      false,
    );
  });
});

describe("syncSecretsToCredentialStore", () => {
  it("writes vault secrets into app_secrets without returning values", async () => {
    const result = await syncSecretsToCredentialStore(
      [
        {
          name: "OpenAI API Key",
          credentialKey: "OPENAI_API_KEY",
          value: "sk-test-key",
        } as any,
      ],
      { ownerEmail: "admin@example.test", orgId: "org_123" },
    );

    expect(mocks.writeAppSecret).toHaveBeenCalledWith({
      key: "OPENAI_API_KEY",
      value: "sk-test-key",
      scope: "org",
      scopeId: "org_123",
      description: "Synced from Dispatch vault: OpenAI API Key",
    });
    expect(result).toEqual({
      scope: "org",
      scopeId: "org_123",
      keys: ["OPENAI_API_KEY"],
    });
  });
});

describe("cleanupSyncedCredentialKeysIfUnused", () => {
  function mockVaultSecretLookup(rows: Array<{ id: string }> = []) {
    const query = {
      select: vi.fn(() => query),
      from: vi.fn(() => query),
      where: vi.fn(() => query),
      limit: vi.fn(async () => rows),
    };
    mocks.getDb.mockReturnValue(query);
    return query;
  }

  it("deletes a candidate synced credential when no vault secret still uses it", async () => {
    mockVaultSecretLookup([]);

    await cleanupSyncedCredentialKeysIfUnused(
      { ownerEmail: "admin@example.test", orgId: "org_123" },
      ["OLD_API_KEY"],
    );

    expect(mocks.deleteAppSecret).toHaveBeenCalledWith({
      key: "OLD_API_KEY",
      scope: "org",
      scopeId: "org_123",
    });
  });

  it("uses the secret row scope for personal vault cleanup", async () => {
    mockVaultSecretLookup([]);

    await cleanupSyncedCredentialKeysIfUnused(
      { ownerEmail: "owner@example.test", orgId: null },
      ["PERSONAL_API_KEY"],
    );

    expect(mocks.deleteAppSecret).toHaveBeenCalledWith({
      key: "PERSONAL_API_KEY",
      scope: "workspace",
      scopeId: "solo:owner@example.test",
    });
  });

  it("keeps a candidate synced credential when another vault secret still uses it", async () => {
    mockVaultSecretLookup([{ id: "secret_1" }]);

    await cleanupSyncedCredentialKeysIfUnused(
      { ownerEmail: "admin@example.test", orgId: "org_123" },
      ["SHARED_API_KEY"],
    );

    expect(mocks.deleteAppSecret).not.toHaveBeenCalled();
  });

  it("can scan synced app secrets to recover stale keys after a retry", async () => {
    mockVaultSecretLookup([]);
    mocks.listAppSecretsForScope.mockResolvedValue([
      {
        key: "STALE_KEY",
        description: "Synced from Dispatch vault: Old key",
      },
      {
        key: "HAND_WRITTEN_KEY",
        description: "Created manually",
      },
    ]);

    await cleanupSyncedCredentialKeysIfUnused({
      ownerEmail: "admin@example.test",
      orgId: "org_123",
    });

    expect(mocks.listAppSecretsForScope).toHaveBeenCalledWith("org", "org_123");
    expect(mocks.deleteAppSecret).toHaveBeenCalledTimes(1);
    expect(mocks.deleteAppSecret).toHaveBeenCalledWith({
      key: "STALE_KEY",
      scope: "org",
      scopeId: "org_123",
    });
  });
});

describe("resyncAllVaultSecretsToCredentialStore", () => {
  function mockVaultSecretsRows(rows: Array<Record<string, unknown>>) {
    mocks.getDb.mockReturnValue({
      select: () => ({
        from: () => Promise.resolve(rows),
      }),
    });
  }

  /** In-memory stand-in for the shared credential store, keyed the same way
   * the real app_secrets table is: scope + scopeId + key. */
  function fakeCredentialStore() {
    const store = new Map<string, string>();
    mocks.writeAppSecret.mockImplementation(async (args: any) => {
      store.set(`${args.scope}:${args.scopeId}:${args.key}`, args.value);
      return "app-secret-id";
    });
    mocks.readAppSecret.mockImplementation(async (ref: any) => {
      const value = store.get(`${ref.scope}:${ref.scopeId}:${ref.key}`);
      return value === undefined ? null : { value, updatedAt: Date.now() };
    });
    return store;
  }

  afterEach(() => {
    mocks.writeAppSecret.mockReset();
    mocks.readAppSecret.mockReset();
  });

  it("syncs vault secrets from different tenants into their own credential-store scopes", async () => {
    fakeCredentialStore();
    mockVaultSecretsRows([
      {
        id: "secret_org",
        ownerEmail: "admin@example.test",
        orgId: "org_123",
        name: "OpenAI API Key",
        credentialKey: "OPENAI_API_KEY",
        value: "sk-org-key",
      },
      {
        id: "secret_solo",
        ownerEmail: "owner@example.test",
        orgId: null,
        name: "Personal API Key",
        credentialKey: "PERSONAL_API_KEY",
        value: "sk-personal-key",
      },
    ]);

    const result = await resyncAllVaultSecretsToCredentialStore();

    expect(result).toEqual({ groups: 2, failedGroups: 0, syncedKeys: 2 });

    const orgScope = credentialStoreScopeForVaultCtx({
      ownerEmail: "admin@example.test",
      orgId: "org_123",
    });
    const soloScope = credentialStoreScopeForVaultCtx({
      ownerEmail: "owner@example.test",
      orgId: null,
    });

    await expect(
      readAppSecret({ key: "OPENAI_API_KEY", ...orgScope }),
    ).resolves.toMatchObject({ value: "sk-org-key" });
    await expect(
      readAppSecret({ key: "PERSONAL_API_KEY", ...soloScope }),
    ).resolves.toMatchObject({ value: "sk-personal-key" });
  });

  it("logs and skips a group that fails without blocking the other groups", async () => {
    const store = fakeCredentialStore();
    const writeImpl = mocks.writeAppSecret.getMockImplementation();
    mocks.writeAppSecret.mockImplementation(async (args: any) => {
      if (args.key === "BROKEN_KEY") {
        throw new Error("simulated credential-store write failure");
      }
      return writeImpl!(args);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockVaultSecretsRows([
      {
        id: "secret_broken",
        ownerEmail: "admin@broken.test",
        orgId: "org_broken",
        name: "Broken Key",
        credentialKey: "BROKEN_KEY",
        value: "sk-broken-value",
      },
      {
        id: "secret_solo",
        ownerEmail: "owner@example.test",
        orgId: null,
        name: "Personal API Key",
        credentialKey: "PERSONAL_API_KEY",
        value: "sk-personal-key",
      },
    ]);

    const result = await resyncAllVaultSecretsToCredentialStore();

    expect(result).toEqual({ groups: 2, failedGroups: 1, syncedKeys: 1 });

    // The failed org's key never landed in the credential store.
    expect(store.get("org:org_broken:BROKEN_KEY")).toBeUndefined();

    // The other tenant's group still synced successfully.
    const soloScope = credentialStoreScopeForVaultCtx({
      ownerEmail: "owner@example.test",
      orgId: null,
    });
    await expect(
      readAppSecret({ key: "PERSONAL_API_KEY", ...soloScope }),
    ).resolves.toMatchObject({ value: "sk-personal-key" });

    // Exactly one warning, naming the key but never the plaintext value.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [warnMessage] = warnSpy.mock.calls[0]!;
    expect(String(warnMessage)).toContain("BROKEN_KEY");
    expect(String(warnMessage)).not.toContain("sk-broken-value");

    warnSpy.mockRestore();
  });
});
