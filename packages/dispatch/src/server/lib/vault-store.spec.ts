import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteAppSecret: vi.fn(),
  getDb: vi.fn(),
  listAppSecretsForScope: vi.fn(),
  writeAppSecret: vi.fn(),
}));

vi.mock("@agent-native/core/secrets", () => ({
  deleteAppSecret: mocks.deleteAppSecret,
  listAppSecretsForScope: mocks.listAppSecretsForScope,
  writeAppSecret: mocks.writeAppSecret,
}));

vi.mock("../../db/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/index.js")>();
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

import {
  cleanupSyncedCredentialKeysIfUnused,
  credentialStoreScopeForVaultCtx,
  isTrustedEnvVarSyncAgentUrl,
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
