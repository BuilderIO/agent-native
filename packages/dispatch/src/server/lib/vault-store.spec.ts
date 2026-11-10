import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentOrgId: vi.fn(),
  currentOwnerEmail: vi.fn(),
  deleteAppSecret: vi.fn(),
  discoverAgents: vi.fn(),
  getDbExec: vi.fn(),
  getDb: vi.fn(),
  getOrgSetting: vi.fn(),
  getUserSetting: vi.fn(),
  listAppSecretsForScope: vi.fn(),
  readAppSecret: vi.fn(),
  recordAudit: vi.fn(),
  readOrgMemberRole: vi.fn(),
  writeAppSecret: vi.fn(),
}));

vi.mock("@agent-native/core/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/secrets")>()),
  deleteAppSecret: mocks.deleteAppSecret,
  listAppSecretsForScope: mocks.listAppSecretsForScope,
  readAppSecret: mocks.readAppSecret,
  writeAppSecret: mocks.writeAppSecret,
}));

vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getDbExec: mocks.getDbExec,
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  readOrgMemberRole: (...args: unknown[]) => mocks.readOrgMemberRole(...args),
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  discoverAgents: mocks.discoverAgents,
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: mocks.getOrgSetting,
  getUserSetting: mocks.getUserSetting,
  putOrgSetting: vi.fn(),
  putUserSetting: vi.fn(),
}));

vi.mock("./dispatch-store.js", () => ({
  currentOrgId: mocks.currentOrgId,
  currentOwnerEmail: mocks.currentOwnerEmail,
  recordAudit: mocks.recordAudit,
}));

vi.mock("../../db/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/index.js")>();
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

import { schema } from "../../db/index.js";
import {
  assertCanManageVault,
  cleanupSyncedCredentialKeysIfUnused,
  createSecret,
  credentialStoreScopeForVaultCtx,
  getGrant,
  getVaultSecretMetadata,
  listGrants,
  listVaultSecretMetadata,
  updateSecret,
} from "./vault-store.js";

beforeEach(() => {
  // clearAllMocks keeps implementations, so a rejection set by one test would
  // leak into the next.
  mocks.writeAppSecret.mockReset();
  mocks.readAppSecret.mockReset();
  mocks.listAppSecretsForScope.mockReset();
});

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

describe("vault authorization", () => {
  it("rejects an organization member before reading shared vault values", async () => {
    mocks.currentOrgId.mockReturnValue("org_123");
    mocks.currentOwnerEmail.mockReturnValue("member@example.test");
    mocks.readOrgMemberRole.mockResolvedValue("member");

    await expect(assertCanManageVault()).rejects.toMatchObject({
      message:
        "Only organization owners and admins can manage the workspace vault.",
      statusCode: 403,
    });
  });

  it("rejects organization members before listing or reading grants", async () => {
    mocks.currentOrgId.mockReturnValue("org_123");
    mocks.currentOwnerEmail.mockReturnValue("member@example.test");
    mocks.readOrgMemberRole.mockResolvedValue("member");

    await expect(listGrants()).rejects.toThrow(
      "Only organization owners and admins can manage the workspace vault.",
    );
    await expect(getGrant("grant-1")).rejects.toThrow(
      "Only organization owners and admins can manage the workspace vault.",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"])(
    "allows an organization %s to manage shared vault values",
    async (role) => {
      mocks.currentOrgId.mockReturnValue("org_123");
      mocks.currentOwnerEmail.mockReturnValue(`${role}@example.test`);
      mocks.readOrgMemberRole.mockResolvedValue(role);

      await expect(assertCanManageVault()).resolves.toBeUndefined();
    },
  );

  it("caps a delegated owner before vault management", async () => {
    mocks.currentOrgId.mockReturnValue("org_123");
    mocks.currentOwnerEmail.mockReturnValue("owner@example.test");
    mocks.readOrgMemberRole.mockResolvedValue("member");

    await expect(assertCanManageVault()).rejects.toMatchObject({
      statusCode: 403,
      message:
        "Only organization owners and admins can manage the workspace vault.",
    });
    expect(mocks.readOrgMemberRole).toHaveBeenCalledWith(
      "org_123",
      "owner@example.test",
    );
  });

  it("allows a solo workspace owner to manage their own vault", async () => {
    mocks.currentOrgId.mockReturnValue(null);

    await expect(assertCanManageVault()).resolves.toBeUndefined();
    expect(mocks.getDbExec).not.toHaveBeenCalled();
  });
});

describe("vault secret metadata", () => {
  const row = (overrides: Record<string, unknown> = {}) =>
    ({
      id: "secret-1",
      ownerEmail: "admin@example.test",
      orgId: "org_123",
      name: "Test key",
      credentialKey: "TEST_KEY",
      value: "",
      provider: "other",
      description: "Fake test credential",
      createdBy: "admin@example.test",
      createdAt: 1,
      updatedAt: 2,
      ...overrides,
    }) as any;
  const ctx = { ownerEmail: "admin@example.test", orgId: "org_123" };

  // oracle-change: the vault no longer pushes to apps or re-syncs plaintext, so the tests for syncGrantsToApp, the env-var URL check and the resync page are replaced by single-copy write tests.
  it("takes the masked preview from the encrypted copy, one read per scope", async () => {
    mocks.listAppSecretsForScope.mockResolvedValue([
      { key: "TEST_KEY", last4: "••••mple" },
      { key: "OTHER_KEY", last4: "••••9999" },
    ]);

    const metadata = await listVaultSecretMetadata(
      [row(), row({ id: "secret-2", credentialKey: "OTHER_KEY" })],
      ctx,
    );

    expect(mocks.listAppSecretsForScope).toHaveBeenCalledTimes(1);
    expect(mocks.listAppSecretsForScope).toHaveBeenCalledWith("org", "org_123");
    expect(metadata.map((m) => m.last4)).toEqual(["••••mple", "••••9999"]);
    expect(metadata[0]).not.toHaveProperty("value");
  });

  it("reads each scope separately and leaves a missing copy blank", async () => {
    mocks.listAppSecretsForScope.mockImplementation(async (scope: string) =>
      scope === "org" ? [{ key: "TEST_KEY", last4: "••••mple" }] : [],
    );

    const metadata = await listVaultSecretMetadata(
      [row(), row({ id: "solo-1", orgId: null, credentialKey: "SOLO_KEY" })],
      ctx,
    );

    expect(mocks.listAppSecretsForScope).toHaveBeenCalledTimes(2);
    expect(metadata.map((m) => m.last4)).toEqual(["••••mple", ""]);
  });

  it("reads a single preview straight from the credential store", async () => {
    mocks.readAppSecret.mockResolvedValue({
      value: "sk-live",
      last4: "••••live",
    });

    const metadata = await getVaultSecretMetadata(row(), ctx);

    expect(mocks.readAppSecret).toHaveBeenCalledWith({
      key: "TEST_KEY",
      scope: "org",
      scopeId: "org_123",
    });
    expect(metadata?.last4).toBe("••••live");
    expect(JSON.stringify(metadata)).not.toContain("sk-live");
    expect(await getVaultSecretMetadata(null, ctx)).toBeNull();
  });
});

describe("vault writes keep the value out of vault_secrets", () => {
  const admin = "admin@example.test";
  const existingRow = (overrides: Record<string, unknown> = {}) => ({
    id: "secret-1",
    ownerEmail: admin,
    orgId: "org_123",
    name: "OpenAI API Key",
    credentialKey: "OPENAI_API_KEY",
    value: "",
    provider: null,
    description: null,
    createdBy: admin,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  });

  function fakeVaultDb(rows: Array<Record<string, unknown>>) {
    const writes = {
      inserted: [] as Array<Record<string, unknown>>,
      updated: [] as Array<Record<string, unknown>>,
    };
    const select: any = {
      from: () => select,
      where: () => select,
      orderBy: () => select,
      limit: async () => rows,
    };
    mocks.getDb.mockReturnValue({
      select: () => select,
      insert: (table: unknown) => ({
        values: async (values: Record<string, unknown>) => {
          if (table === schema.vaultSecrets) writes.inserted.push(values);
        },
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            if (table === schema.vaultSecrets) writes.updated.push(values);
          },
        }),
      }),
    });
    return writes;
  }

  function actAsOrgAdmin() {
    mocks.currentOwnerEmail.mockReturnValue(admin);
    mocks.currentOrgId.mockReturnValue("org_123");
    mocks.readOrgMemberRole.mockResolvedValue("admin");
  }

  const orgStore = (key: string) => ({
    key,
    scope: "org",
    scopeId: "org_123",
  });

  it("encrypts a new secret into the credential store and saves an empty vault value", async () => {
    actAsOrgAdmin();
    const writes = fakeVaultDb([]);

    await createSecret({
      credentialKey: "OPENAI_API_KEY",
      value: "sk-test-key",
      name: "OpenAI API Key",
    });

    expect(mocks.writeAppSecret).toHaveBeenCalledWith({
      ...orgStore("OPENAI_API_KEY"),
      value: "sk-test-key",
      description: "Synced from Dispatch vault: OpenAI API Key",
    });
    expect(writes.inserted).toHaveLength(1);
    expect(writes.inserted[0]).toMatchObject({
      credentialKey: "OPENAI_API_KEY",
      value: "",
    });
    expect(JSON.stringify(writes)).not.toContain("sk-test-key");
    // The value must be stored before the row claims it exists.
    expect(mocks.writeAppSecret.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getDb.mock.invocationCallOrder.at(-1)!,
    );
  });

  it("saves nothing when the encrypted write fails", async () => {
    actAsOrgAdmin();
    const writes = fakeVaultDb([]);
    mocks.writeAppSecret.mockRejectedValue(new Error("store unavailable"));

    await expect(
      createSecret({
        credentialKey: "OPENAI_API_KEY",
        value: "sk-test-key",
        name: "OpenAI API Key",
      }),
    ).rejects.toThrow("store unavailable");

    expect(writes.inserted).toEqual([]);
  });

  it("rejects an empty value instead of saving a secret with nothing behind it", async () => {
    actAsOrgAdmin();
    const writes = fakeVaultDb([]);

    await expect(
      createSecret({
        credentialKey: "OPENAI_API_KEY",
        value: "",
        name: "OpenAI API Key",
      }),
    ).rejects.toThrow("Secret value is required");

    expect(mocks.writeAppSecret).not.toHaveBeenCalled();
    expect(writes.inserted).toEqual([]);
  });

  it("overwrites an existing key's copy and keeps the row's value empty", async () => {
    actAsOrgAdmin();
    const writes = fakeVaultDb([existingRow()]);

    await createSecret({
      credentialKey: "OPENAI_API_KEY",
      value: "sk-rotated",
      name: "OpenAI API Key",
    });

    expect(mocks.writeAppSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        ...orgStore("OPENAI_API_KEY"),
        value: "sk-rotated",
      }),
    );
    expect(writes.updated[0]).toMatchObject({ value: "" });
  });

  it("lets metadata-only edits through on a row that holds no plaintext", async () => {
    actAsOrgAdmin();
    const writes = fakeVaultDb([existingRow()]);

    await updateSecret("secret-1", { name: "Renamed", description: "note" });

    expect(mocks.writeAppSecret).not.toHaveBeenCalled();
    expect(writes.updated[0]).toMatchObject({
      name: "Renamed",
      description: "note",
      value: "",
    });
  });

  it("stores a new value from an edit", async () => {
    actAsOrgAdmin();
    const writes = fakeVaultDb([existingRow()]);

    await updateSecret("secret-1", { value: "sk-rotated" });

    expect(mocks.writeAppSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        ...orgStore("OPENAI_API_KEY"),
        value: "sk-rotated",
      }),
    );
    expect(writes.updated[0]).toMatchObject({ value: "" });
  });

  it("rejects an explicit empty value on edit", async () => {
    actAsOrgAdmin();
    fakeVaultDb([existingRow()]);

    await expect(updateSecret("secret-1", { value: "" })).rejects.toThrow(
      "Secret value is required",
    );
    expect(mocks.writeAppSecret).not.toHaveBeenCalled();
  });

  it("seals a legacy plaintext row the first time it is edited", async () => {
    actAsOrgAdmin();
    const writes = fakeVaultDb([existingRow({ value: "sk-legacy" })]);

    await updateSecret("secret-1", { name: "Renamed" });

    expect(mocks.writeAppSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        ...orgStore("OPENAI_API_KEY"),
        value: "sk-legacy",
      }),
    );
    expect(writes.updated[0]).toMatchObject({ value: "" });
    expect(JSON.stringify(writes)).not.toContain("sk-legacy");
  });

  it("carries the stored value to the new key on a rename", async () => {
    actAsOrgAdmin();
    const writes = fakeVaultDb([existingRow()]);
    mocks.readAppSecret.mockResolvedValue({
      value: "sk-stored",
      last4: "••••ored",
    });

    await updateSecret("secret-1", { credentialKey: "OPENAI_KEY_V2" });

    expect(mocks.readAppSecret).toHaveBeenCalledWith(
      orgStore("OPENAI_API_KEY"),
    );
    expect(mocks.writeAppSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        ...orgStore("OPENAI_KEY_V2"),
        value: "sk-stored",
      }),
    );
    expect(writes.updated[0]).toMatchObject({
      credentialKey: "OPENAI_KEY_V2",
      value: "",
    });
  });

  it("renames a row with no stored copy without inventing a value", async () => {
    actAsOrgAdmin();
    fakeVaultDb([existingRow()]);
    mocks.readAppSecret.mockResolvedValue(null);

    await updateSecret("secret-1", { credentialKey: "OPENAI_KEY_V2" });

    expect(mocks.writeAppSecret).not.toHaveBeenCalled();
  });

  it("fails the rename when the stored copy cannot be read", async () => {
    actAsOrgAdmin();
    const writes = fakeVaultDb([existingRow()]);
    mocks.readAppSecret.mockRejectedValue(new Error("cannot decrypt"));

    await expect(
      updateSecret("secret-1", { credentialKey: "OPENAI_KEY_V2" }),
    ).rejects.toThrow("cannot decrypt");

    expect(writes.updated).toEqual([]);
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
