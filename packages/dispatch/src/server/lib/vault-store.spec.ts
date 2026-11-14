import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Every test here runs the store against a real database: the claims worth
// proving are about rows (which table holds a value, which scope a key lands
// in, which grant matches), and a mocked query cannot fail for them.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const mocks = vi.hoisted(() => ({
  discoverAgents: vi.fn(async () => [] as unknown[]),
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  discoverAgents: mocks.discoverAgents,
}));

vi.mock("@agent-native/core/extensions/url-safety", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/extensions/url-safety")
  >()),
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

const admin = "admin+vault@example.test";
const member = "member+vault@example.test";
const orgId = "org_vault";
const otherOrgId = "org_vault_other";
const PLAINTEXT = "fake-secret-value-1111";

const originalEnv = {
  APP_NAME: process.env.APP_NAME,
  DATABASE_URL: process.env.DATABASE_URL,
  DISPATCH_DATABASE_URL: process.env.DISPATCH_DATABASE_URL,
};

let tempDir: string | null = null;

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function boot() {
  const [{ runWithRequestContext }, db, secrets, settings, vault] =
    await Promise.all([
      import("@agent-native/core/server"),
      import("@agent-native/core/db"),
      import("@agent-native/core/secrets"),
      import("@agent-native/core/settings"),
      import("./vault-store.js"),
    ]);
  const exec = db.getDbExec();
  await exec.execute({
    sql: `CREATE TABLE IF NOT EXISTS org_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at BIGINT NOT NULL,
      federation_removal_pending_at INTEGER
    )`,
    args: [],
  });
  for (const [id, org, email, role] of [
    ["vault-admin", orgId, admin, "admin"],
    ["vault-member", orgId, member, "member"],
    ["vault-other-owner", otherOrgId, admin, "owner"],
  ]) {
    await exec.execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
      args: [id, org, email, role, Date.now()],
    });
  }
  // The credential and settings stores create their tables on first use.
  await secrets.listAppSecretSummaries("org", orgId);
  await settings.getOrgSetting(orgId, "dispatch-vault-access-settings");

  const as = <T>(
    userEmail: string,
    run: () => Promise<T>,
    org: string | null = orgId,
  ): Promise<T> =>
    runWithRequestContext({ userEmail, orgId: org ?? undefined }, run);
  // raw-sql-ok: a test helper; every caller passes a literal statement.
  const rows = async (sql: string, args: unknown[] = []) =>
    (await exec.execute({ sql, args })).rows;
  const orgRef = (key: string) => ({
    key,
    scope: "org" as const,
    scopeId: orgId,
  });
  // One statement per table: no interpolated identifiers.
  const everythingStored = async () =>
    JSON.stringify(
      await Promise.all([
        rows("SELECT to_jsonb(t) AS row FROM app_secrets t"),
        rows("SELECT to_jsonb(t) AS row FROM vault_secrets t"),
        rows("SELECT to_jsonb(t) AS row FROM vault_grants t"),
        rows("SELECT to_jsonb(t) AS row FROM vault_requests t"),
        rows("SELECT to_jsonb(t) AS row FROM vault_audit_log t"),
        rows("SELECT to_jsonb(t) AS row FROM dispatch_audit_events t"),
      ]),
    );
  return { as, exec, rows, orgRef, secrets, vault, everythingStored };
}

let current: Awaited<ReturnType<typeof boot>>;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-vault-store-"));
  process.env.DATABASE_URL = `pglite:${tempDir}`;
  delete process.env.APP_NAME;
  delete process.env.DISPATCH_DATABASE_URL;

  const [{ runMigrations, closeDbExec }, { dispatchMigrations }] =
    await Promise.all([
      import("@agent-native/core/db"),
      import("../../db/migrations.js"),
    ]);
  await runMigrations(dispatchMigrations, {
    table: "dispatch_migrations",
  })({});
  await closeDbExec();
  current = await boot();
  // A database upgraded from before the table was retired still holds it;
  // fresh installs no longer create it.
  await current.exec.execute({
    sql: `CREATE TABLE vault_secrets (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      name TEXT NOT NULL,
      credential_key TEXT NOT NULL,
      value TEXT NOT NULL,
      provider TEXT,
      description TEXT,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`,
    args: [],
  });
});

afterAll(async () => {
  try {
    const { closeDbExec } = await import("@agent-native/core/db");
    await closeDbExec();
  } catch {
    // The database may never have opened if setup failed first.
  }
  restoreEnv();
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

beforeEach(async () => {
  // Each test starts from an empty vault, in the same database.
  for (const statement of [
    "DELETE FROM app_secrets",
    "DELETE FROM vault_secrets",
    "DELETE FROM vault_grants",
    "DELETE FROM vault_requests",
    "DELETE FROM vault_audit_log",
    "DELETE FROM dispatch_audit_events",
    "DELETE FROM settings",
  ]) {
    await current.exec.execute({ sql: statement, args: [] });
  }
  mocks.discoverAgents.mockReset();
  mocks.discoverAgents.mockResolvedValue([]);
  mocks.ssrfSafeFetch.mockReset();
});

/** The vault under test, a request-context runner, and direct row access. */
async function load() {
  return current;
}

describe("credentialStoreScopeForVaultCtx", () => {
  it("uses org scope when the caller has an organization", async () => {
    const { vault } = await load();
    expect(
      vault.credentialStoreScopeForVaultCtx({
        ownerEmail: admin,
        orgId: "org_123",
      }),
    ).toEqual({ scope: "org", scopeId: "org_123" });
  });

  it("uses the caller's own workspace scope when no organization is active", async () => {
    const { vault } = await load();
    expect(
      vault.credentialStoreScopeForVaultCtx({ ownerEmail: admin, orgId: null }),
    ).toEqual({ scope: "workspace", scopeId: `solo:${admin}` });
  });
});

describe("vault authorization", () => {
  it.each([
    ["owner", "vault-owner-role"],
    ["admin", "vault-admin-role"],
  ])("lets an organization %s manage the vault", async (role, id) => {
    const { as, exec, vault } = await load();
    await exec.execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
      args: [id, orgId, `${role}+vault@example.test`, role, Date.now()],
    });

    await expect(
      as(`${role}+vault@example.test`, () => vault.assertCanManageVault()),
    ).resolves.toBeUndefined();
  });

  it("rejects an organization member before anything is read or written", async () => {
    const { as, rows, vault } = await load();
    const message =
      "Only organization owners and admins can manage the workspace vault.";

    await as(admin, () =>
      vault.createSecret({
        credentialKey: "FAKE_API_KEY",
        value: PLAINTEXT,
        name: "Fake API key",
      }),
    );
    const [{ id }] = (await rows("SELECT id FROM app_secrets")) as [
      { id: string },
    ];

    await expect(as(member, () => vault.listSecrets())).rejects.toThrow(
      message,
    );
    await expect(
      as(member, () =>
        vault.createSecret({
          credentialKey: "OTHER_KEY",
          value: PLAINTEXT,
          name: "Other",
        }),
      ),
    ).rejects.toMatchObject({ message, statusCode: 403 });
    await expect(
      as(member, () => vault.updateSecret(id, { name: "Renamed" })),
    ).rejects.toThrow(message);
    await expect(as(member, () => vault.deleteSecret(id))).rejects.toThrow(
      message,
    );
    await expect(as(member, () => vault.listGrants())).rejects.toThrow(message);
    await expect(as(member, () => vault.getGrant("grant-1"))).rejects.toThrow(
      message,
    );

    expect(await rows("SELECT key, label FROM app_secrets")).toEqual([
      { key: "FAKE_API_KEY", label: "Fake API key" },
    ]);
  });

  it("lets a solo workspace owner manage their own vault", async () => {
    const { as, rows, vault } = await load();

    const created = await as(
      admin,
      () =>
        vault.createSecret({
          credentialKey: "SOLO_KEY",
          value: PLAINTEXT,
          name: "Solo key",
        }),
      null,
    );

    expect(created.credentialKey).toBe("SOLO_KEY");
    expect(await rows("SELECT scope, scope_id FROM app_secrets")).toEqual([
      { scope: "workspace", scope_id: `solo:${admin}` },
    ]);
  });
});

describe("a vault key is one app_secrets row", () => {
  it("stores the value only in the encrypted column and leaves vault_secrets alone", async () => {
    const { as, rows, secrets, vault, everythingStored } = await load();
    const legacy = [
      "legacy-vault-id",
      admin,
      orgId,
      "Legacy key",
      "LEGACY_KEY",
      "legacy-plaintext-value",
      admin,
      1,
      2,
    ];
    await rows(
      `INSERT INTO vault_secrets (id, owner_email, org_id, name, credential_key, value, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      legacy,
    );
    const legacyBefore = await rows("SELECT * FROM vault_secrets");

    const created = await as(admin, () =>
      vault.createSecret({
        credentialKey: "FAKE_API_KEY",
        value: PLAINTEXT,
        name: "Fake API key",
        provider: "other",
        description: "Used by the tests",
      }),
    );
    await as(admin, () =>
      vault.updateSecret(created.id, { value: "fake-rotated-value-2222" }),
    );
    await as(admin, () =>
      vault.updateSecret(created.id, { credentialKey: "FAKE_API_KEY_V2" }),
    );

    expect(created).toMatchObject({
      name: "Fake API key",
      credentialKey: "FAKE_API_KEY",
      last4: "••••1111",
      valueStatus: "stored",
      provider: "other",
      description: "Used by the tests",
      createdBy: admin,
    });
    const [stored] = await rows("SELECT * FROM app_secrets WHERE id = ?", [
      created.id,
    ]);
    expect(stored).toMatchObject({
      scope: "org",
      scope_id: orgId,
      key: "FAKE_API_KEY_V2",
      label: "Fake API key",
      provider: "other",
      description: "Used by the tests",
      created_by: admin,
    });
    expect(String(stored.encrypted_value)).toMatch(/^v1:/);
    expect(
      (
        await secrets.readAppSecret({
          key: "FAKE_API_KEY_V2",
          scope: "org",
          scopeId: orgId,
        })
      )?.value,
    ).toBe("fake-rotated-value-2222");

    const everything = await everythingStored();
    expect(everything).not.toContain(PLAINTEXT);
    expect(everything).not.toContain("fake-rotated-value-2222");
    expect(await rows("SELECT * FROM vault_secrets")).toEqual(legacyBefore);
  });

  it("uses the app_secrets row id as the secret id everywhere", async () => {
    const { as, rows, vault } = await load();

    const created = await as(admin, () =>
      vault.createSecret({
        credentialKey: "FAKE_API_KEY",
        value: PLAINTEXT,
        name: "Fake API key",
      }),
    );

    const [row] = await rows("SELECT id FROM app_secrets");
    expect(created.id).toBe(row.id);
    expect(await as(admin, () => vault.getSecret(created.id))).toMatchObject({
      id: row.id,
      credentialKey: "FAKE_API_KEY",
    });
    expect(
      (await as(admin, () => vault.listSecretOptions())).map((s) => s.id),
    ).toEqual([row.id]);
    expect(
      (await as(admin, () => vault.listSecrets())).map((s) => s.id),
    ).toEqual([row.id]);
  });

  it("rejects an empty key or value instead of saving a key with nothing behind it", async () => {
    const { as, rows, vault } = await load();

    await expect(
      as(admin, () =>
        vault.createSecret({ credentialKey: " ", value: PLAINTEXT, name: "x" }),
      ),
    ).rejects.toThrow("Credential key is required");
    await expect(
      as(admin, () =>
        vault.createSecret({
          credentialKey: "FAKE_API_KEY",
          value: "",
          name: "x",
        }),
      ),
    ).rejects.toThrow("Secret value is required");

    expect(await rows("SELECT * FROM app_secrets")).toEqual([]);
  });

  it("updates a key that already exists when it is created again, and keeps its creator", async () => {
    const { as, exec, rows, secrets, vault, orgRef } = await load();
    const secondAdmin = "second-admin+vault@example.test";
    await exec.execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
      args: ["vault-second-admin", orgId, secondAdmin, "admin", Date.now()],
    });
    const first = await as(admin, () =>
      vault.createSecret({
        credentialKey: "FAKE_API_KEY",
        value: PLAINTEXT,
        name: "First label",
        provider: "other",
      }),
    );

    const second = await as(secondAdmin, () =>
      vault.createSecret({
        credentialKey: "FAKE_API_KEY",
        value: "fake-rotated-value-2222",
        name: "Second label",
      }),
    );

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      name: "Second label",
      provider: null,
      createdBy: admin,
      last4: "••••2222",
    });
    expect(await rows("SELECT id FROM app_secrets")).toHaveLength(1);
    expect((await secrets.readAppSecret(orgRef("FAKE_API_KEY")))?.value).toBe(
      "fake-rotated-value-2222",
    );
  });
});

describe("editing a key", () => {
  async function seeded() {
    const loaded = await load();
    const created = await loaded.as(admin, () =>
      loaded.vault.createSecret({
        credentialKey: "FAKE_API_KEY",
        value: PLAINTEXT,
        name: "Fake API key",
        provider: "other",
        description: "Used by the tests",
      }),
    );
    const ciphertext = async () =>
      loaded.rows(
        "SELECT encrypted_value, shared_encrypted_value FROM app_secrets WHERE id = ?",
        [created.id],
      );
    return { ...loaded, created, ciphertext };
  }

  it("changes the label, provider and description without touching the stored value", async () => {
    const { as, vault, created, ciphertext, secrets, orgRef } = await seeded();
    const before = await ciphertext();

    const updated = await as(admin, () =>
      vault.updateSecret(created.id, {
        name: "Renamed label",
        provider: null,
        description: "New note",
      }),
    );

    expect(updated).toMatchObject({
      name: "Renamed label",
      provider: null,
      description: "New note",
      credentialKey: "FAKE_API_KEY",
      last4: "••••1111",
    });
    expect(await ciphertext()).toEqual(before);
    expect((await secrets.readAppSecret(orgRef("FAKE_API_KEY")))?.value).toBe(
      PLAINTEXT,
    );
  });

  it("rotates the value and keeps every label field", async () => {
    const { as, vault, created, ciphertext } = await seeded();
    const before = await ciphertext();

    const updated = await as(admin, () =>
      vault.updateSecret(created.id, { value: "fake-rotated-value-2222" }),
    );

    expect(updated).toMatchObject({
      name: "Fake API key",
      provider: "other",
      description: "Used by the tests",
      last4: "••••2222",
    });
    expect(await ciphertext()).not.toEqual(before);
  });

  it("accepts a bare value, as the older call form did", async () => {
    const { as, vault, created } = await seeded();

    const updated = await as(admin, () =>
      vault.updateSecret(created.id, "fake-rotated-value-2222"),
    );

    expect(updated.last4).toBe("••••2222");
  });

  it("rejects an empty value or name and changes nothing", async () => {
    const { as, vault, created, ciphertext } = await seeded();
    const before = await ciphertext();

    await expect(
      as(admin, () => vault.updateSecret(created.id, { value: "" })),
    ).rejects.toThrow("Secret value is required");
    await expect(
      as(admin, () => vault.updateSecret(created.id, { name: "  " })),
    ).rejects.toThrow("Secret name is required");

    expect(await ciphertext()).toEqual(before);
  });

  it("renames a key in place: the value, the id and the creator come along", async () => {
    const { as, vault, created, ciphertext, secrets, orgRef } = await seeded();
    const before = await ciphertext();

    const renamed = await as(admin, () =>
      vault.updateSecret(created.id, { credentialKey: "FAKE_API_KEY_V2" }),
    );

    expect(renamed).toMatchObject({
      id: created.id,
      credentialKey: "FAKE_API_KEY_V2",
      name: "Fake API key",
      createdBy: admin,
      last4: "••••1111",
    });
    expect(await ciphertext()).toEqual(before);
    expect(await secrets.readAppSecret(orgRef("FAKE_API_KEY"))).toBeNull();
    expect(
      (await secrets.readAppSecret(orgRef("FAKE_API_KEY_V2")))?.value,
    ).toBe(PLAINTEXT);
  });

  it("refuses to rename onto a key that exists in the scope, whoever created it", async () => {
    const { as, rows, vault, created, secrets, orgRef, ciphertext } =
      await seeded();
    await secrets.writeAppSecret({
      ...orgRef("APP_OWNED_KEY"),
      value: "fake-app-owned-value",
    });
    const before = await ciphertext();

    await expect(
      as(admin, () =>
        vault.updateSecret(created.id, { credentialKey: "APP_OWNED_KEY" }),
      ),
    ).rejects.toThrow('Credential key "APP_OWNED_KEY" is already in use');

    expect(await ciphertext()).toEqual(before);
    expect((await secrets.readAppSecret(orgRef("APP_OWNED_KEY")))?.value).toBe(
      "fake-app-owned-value",
    );
    expect(
      (await rows("SELECT key FROM app_secrets ORDER BY key")).map(
        (row) => row.key,
      ),
    ).toEqual(["APP_OWNED_KEY", "FAKE_API_KEY"]);
  });

  it("says a key is missing instead of editing another scope's row", async () => {
    const { as, vault, created } = await seeded();

    await expect(
      as(
        admin,
        () => vault.updateSecret(created.id, { name: "Hijacked" }),
        otherOrgId,
      ),
    ).rejects.toThrow("Secret not found");
    await expect(
      as(admin, () => vault.updateSecret("missing-id", { name: "x" })),
    ).rejects.toThrow("Secret not found");
    expect((await as(admin, () => vault.getSecret(created.id)))?.name).toBe(
      "Fake API key",
    );
  });

  it("marks a key an app registered as Vault-managed once the Vault edits it", async () => {
    const { as, rows, secrets, vault, orgRef } = await load();
    const appRegisteredId = await secrets.writeAppSecret({
      ...orgRef("APP_OWNED_KEY"),
      value: "fake-app-owned-value",
    });

    await as(admin, () =>
      vault.updateSecret(appRegisteredId, { name: "Adopted label" }),
    );

    expect(
      await rows("SELECT label, created_by FROM app_secrets WHERE id = ?", [
        appRegisteredId,
      ]),
    ).toEqual([{ label: "Adopted label", created_by: admin }]);
  });
});

describe("deleting a key", () => {
  it("removes the row and revokes the key's grants, leaving other keys alone", async () => {
    const { as, rows, secrets, vault, orgRef } = await load();
    await as(admin, () => vault.setVaultAccessSettings({ mode: "manual" }));
    const doomed = await as(admin, () =>
      vault.createSecret({
        credentialKey: "DOOMED_KEY",
        value: PLAINTEXT,
        name: "Doomed",
      }),
    );
    const kept = await as(admin, () =>
      vault.createSecret({
        credentialKey: "KEPT_KEY",
        value: "fake-kept-value",
        name: "Kept",
      }),
    );
    await secrets.writeAppSecret({
      ...orgRef("APP_OWNED_KEY"),
      value: "fake-app-owned-value",
    });
    await as(admin, () => vault.createGrant(doomed.id, "mail"));
    await as(admin, () => vault.createGrant(kept.id, "mail"));

    await as(admin, () => vault.deleteSecret(doomed.id));

    expect(
      (await rows("SELECT key FROM app_secrets ORDER BY key")).map(
        (row) => row.key,
      ),
    ).toEqual(["APP_OWNED_KEY", "KEPT_KEY"]);
    expect(
      await rows(
        "SELECT credential_key, status FROM vault_grants ORDER BY credential_key",
      ),
    ).toEqual([
      { credential_key: "DOOMED_KEY", status: "revoked" },
      { credential_key: "KEPT_KEY", status: "active" },
    ]);
    expect(await as(admin, () => vault.getSecret(doomed.id))).toBeNull();
  });

  it("says a key is missing when the id belongs to another scope", async () => {
    const { as, vault, secrets, orgRef } = await load();
    const id = await secrets.writeAppSecret({
      ...orgRef("APP_OWNED_KEY"),
      value: "fake-app-owned-value",
    });

    await expect(
      as(admin, () => vault.deleteSecret(id), otherOrgId),
    ).rejects.toThrow("Secret not found");
    expect(await secrets.readAppSecret(orgRef("APP_OWNED_KEY"))).not.toBeNull();
  });

  // Runs `body` with a trigger that fires when a grant is revoked, the last
  // write before the store's delete, so whatever the trigger does to
  // app_secrets lands between the store's lookup and its delete.
  // raw-sql-ok: a test helper; each caller passes a literal CREATE FUNCTION.
  async function whileRevokeRaces(
    exec: Awaited<ReturnType<typeof load>>["exec"],
    functionSql: string,
    body: () => Promise<void>,
  ) {
    await exec.execute({ sql: functionSql, args: [] });
    await exec.execute({
      sql: `CREATE TRIGGER race_on_revoke AFTER UPDATE ON vault_grants
        FOR EACH ROW EXECUTE FUNCTION race_on_revoke()`,
      args: [],
    });
    try {
      await body();
    } finally {
      await exec.execute({
        sql: "DROP TRIGGER race_on_revoke ON vault_grants",
        args: [],
      });
      await exec.execute({ sql: "DROP FUNCTION race_on_revoke()", args: [] });
    }
  }

  it("removes the key it looked up, not another that took over its old name mid-delete", async () => {
    const { as, exec, rows, vault } = await load();
    await as(admin, () => vault.setVaultAccessSettings({ mode: "manual" }));
    const raced = await as(admin, () =>
      vault.createSecret({
        credentialKey: "RACED_KEY",
        value: PLAINTEXT,
        name: "Raced",
      }),
    );
    await as(admin, () => vault.createGrant(raced.id, "mail"));

    await whileRevokeRaces(
      exec,
      `CREATE FUNCTION race_on_revoke() RETURNS trigger AS $$
        BEGIN
          UPDATE app_secrets SET key = 'RACED_KEY_RENAMED' WHERE id = NEW.secret_id;
          INSERT INTO app_secrets (id, scope, scope_id, key, encrypted_value, created_at, updated_at)
            SELECT 'replacement-id', scope, scope_id, 'RACED_KEY', encrypted_value, created_at, updated_at
            FROM app_secrets WHERE id = NEW.secret_id;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`,
      async () => {
        await as(admin, () => vault.deleteSecret(raced.id));
      },
    );

    // Only the row that was looked up is gone; the replacement keeps the name.
    expect(await rows("SELECT id, key FROM app_secrets")).toEqual([
      { id: "replacement-id", key: "RACED_KEY" },
    ]);
    expect(
      await rows(
        "SELECT secret_id FROM vault_audit_log WHERE action = 'secret.deleted'",
      ),
    ).toEqual([{ secret_id: raced.id }]);
  });

  it("fails, and records no delete, when another admin deleted the key mid-delete", async () => {
    const { as, exec, rows, vault } = await load();
    await as(admin, () => vault.setVaultAccessSettings({ mode: "manual" }));
    const raced = await as(admin, () =>
      vault.createSecret({
        credentialKey: "RACED_KEY",
        value: PLAINTEXT,
        name: "Raced",
      }),
    );
    await as(admin, () => vault.createGrant(raced.id, "mail"));

    await whileRevokeRaces(
      exec,
      `CREATE FUNCTION race_on_revoke() RETURNS trigger AS $$
        BEGIN
          DELETE FROM app_secrets WHERE id = NEW.secret_id;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`,
      async () => {
        await expect(
          as(admin, () => vault.deleteSecret(raced.id)),
        ).rejects.toThrow("Secret not found");
      },
    );

    expect(
      await rows(
        "SELECT action FROM vault_audit_log WHERE action = 'secret.deleted'",
      ),
    ).toEqual([]);
  });
});

describe("what the vault lists", () => {
  it("lists every key in the organization scope and nothing from any other scope", async () => {
    const { as, secrets, vault, orgRef } = await load();
    const created = await as(admin, () =>
      vault.createSecret({
        credentialKey: "VAULT_CREATED_KEY",
        value: PLAINTEXT,
        name: "Vault created",
      }),
    );
    await secrets.writeAppSecret({
      ...orgRef("APP_OWNED_KEY"),
      value: "fake-app-owned-value",
    });
    await secrets.writeAppSecret({
      ...orgRef("LEGACY_VAULT_KEY"),
      value: "fake-legacy-value",
      description: "Synced from Dispatch vault: Legacy label",
    });
    await secrets.writeAppSecret({
      key: "PERSONAL_KEY",
      scope: "user",
      scopeId: admin,
      value: "fake-personal-value",
    });
    await secrets.writeAppSecret({
      key: "SOLO_KEY",
      scope: "workspace",
      scopeId: `solo:${admin}`,
      value: "fake-solo-value",
    });
    await secrets.writeAppSecret({
      key: "OTHER_ORG_KEY",
      scope: "org",
      scopeId: otherOrgId,
      value: "fake-other-org-value",
    });

    const listed = await as(admin, () => vault.listSecrets());

    expect(listed.map((row) => row.credentialKey).sort()).toEqual([
      "APP_OWNED_KEY",
      "LEGACY_VAULT_KEY",
      "VAULT_CREATED_KEY",
    ]);
    expect(listed.find((row) => row.id === created.id)).toMatchObject({
      name: "Vault created",
      createdBy: admin,
    });
    // No label yet: the key stands in for it. A release's description marker
    // is not the user's text, and an app's key has no creator.
    expect(
      listed.find((row) => row.credentialKey === "LEGACY_VAULT_KEY"),
    ).toMatchObject({
      name: "LEGACY_VAULT_KEY",
      description: null,
      valueStatus: "stored",
    });
    expect(
      listed.find((row) => row.credentialKey === "APP_OWNED_KEY"),
    ).toMatchObject({ name: "APP_OWNED_KEY", createdBy: null });
    expect(JSON.stringify(listed)).not.toContain("fake-");
  });

  it("lists only the caller's own solo scope when no organization is active", async () => {
    const { as, secrets, vault, orgRef } = await load();
    await secrets.writeAppSecret({
      ...orgRef("ORG_KEY"),
      value: "fake-org-value",
    });
    await secrets.writeAppSecret({
      key: "MY_SOLO_KEY",
      scope: "workspace",
      scopeId: `solo:${admin}`,
      value: "fake-solo-value",
    });
    await secrets.writeAppSecret({
      key: "THEIR_SOLO_KEY",
      scope: "workspace",
      scopeId: `solo:${member}`,
      value: "fake-their-value",
    });

    const listed = await as(admin, () => vault.listSecrets(), null);

    expect(listed.map((row) => row.credentialKey)).toEqual(["MY_SOLO_KEY"]);
  });

  it("reports a value this deployment cannot decrypt as unreadable, never as empty or missing", async () => {
    const { as, rows, vault } = await load();
    const created = await as(admin, () =>
      vault.createSecret({
        credentialKey: "FAKE_API_KEY",
        value: PLAINTEXT,
        name: "Fake API key",
      }),
    );
    await rows(
      "UPDATE app_secrets SET encrypted_value = 'not-a-ciphertext', shared_encrypted_value = NULL WHERE id = ?",
      [created.id],
    );

    const [listed] = await as(admin, () => vault.listSecrets());
    const single = await as(admin, () => vault.getSecret(created.id));

    expect(listed).toMatchObject({ last4: "", valueStatus: "unreadable" });
    expect(single).toMatchObject({ last4: "", valueStatus: "unreadable" });
  });

  it("offers an admin everything in the scope and a member only keys the Vault manages", async () => {
    const { as, secrets, vault, orgRef } = await load();
    await as(admin, () =>
      vault.createSecret({
        credentialKey: "VAULT_CREATED_KEY",
        value: PLAINTEXT,
        name: "Vault created",
      }),
    );
    await secrets.writeAppSecret({
      ...orgRef("LEGACY_VAULT_KEY"),
      value: "fake-legacy-value",
      description: "Synced from Dispatch vault: Legacy label",
    });
    await secrets.writeAppSecret({
      ...orgRef("APP_OWNED_KEY"),
      value: "fake-app-owned-value",
    });

    const keys = async (email: string) =>
      (await as(email, () => vault.listSecretOptions()))
        .map((option) => option.credentialKey)
        .sort();

    expect(await keys(admin)).toEqual([
      "APP_OWNED_KEY",
      "LEGACY_VAULT_KEY",
      "VAULT_CREATED_KEY",
    ]);
    expect(await keys(member)).toEqual([
      "LEGACY_VAULT_KEY",
      "VAULT_CREATED_KEY",
    ]);
    expect(
      Object.keys(
        (await as(member, () => vault.listSecretOptions()))[0],
      ).sort(),
    ).toEqual(["credentialKey", "description", "id", "name", "provider"]);
  });
});

describe("grants", () => {
  async function seededManual() {
    const loaded = await load();
    await loaded.as(admin, () =>
      loaded.vault.setVaultAccessSettings({ mode: "manual" }),
    );
    const created = await loaded.as(admin, () =>
      loaded.vault.createSecret({
        credentialKey: "FAKE_API_KEY",
        value: PLAINTEXT,
        name: "Fake API key",
      }),
    );
    return { ...loaded, created };
  }

  it("records the grant against the key, with the app_secrets id beside it", async () => {
    const { as, rows, vault, created } = await seededManual();

    const grant = await as(admin, () => vault.createGrant(created.id, "mail"));

    expect(grant).toMatchObject({
      secretId: created.id,
      credentialKey: "FAKE_API_KEY",
      appId: "mail",
      status: "active",
      orgId,
    });
    // The row core's manual-mode check reads.
    expect(
      await rows(
        `SELECT 1 FROM vault_grants WHERE org_id = ? AND app_id = ? AND status = 'active' AND credential_key = ? LIMIT 1`,
        [orgId, "mail", "FAKE_API_KEY"],
      ),
    ).toHaveLength(1);
    expect(
      await rows(
        `SELECT 1 FROM vault_grants WHERE org_id = ? AND app_id = ? AND status = 'active' AND credential_key = ? LIMIT 1`,
        [orgId, "calendar", "FAKE_API_KEY"],
      ),
    ).toHaveLength(0);
  });

  it("does not duplicate a grant, and reinstates a revoked one in place", async () => {
    const { as, rows, vault, created } = await seededManual();

    const first = await as(admin, () => vault.createGrant(created.id, "mail"));
    const retry = await as(admin, () => vault.createGrant(created.id, "mail"));
    expect(retry?.id).toBe(first?.id);

    const revoked = await as(admin, () => vault.revokeGrant(first!.id));
    expect(revoked?.status).toBe("revoked");
    expect(
      await rows(
        "SELECT 1 FROM vault_grants WHERE status = 'active' AND credential_key = ?",
        ["FAKE_API_KEY"],
      ),
    ).toHaveLength(0);

    const again = await as(admin, () => vault.createGrant(created.id, "mail"));
    expect(again).toMatchObject({ id: first!.id, status: "active" });
    expect(await rows("SELECT id FROM vault_grants")).toHaveLength(1);
  });

  it("lists a key's grants by the key's id, and by app", async () => {
    const { as, vault, created } = await seededManual();
    const other = await as(admin, () =>
      vault.createSecret({
        credentialKey: "OTHER_KEY",
        value: "fake-other-value",
        name: "Other",
      }),
    );
    await as(admin, () => vault.createGrant(created.id, "mail"));
    await as(admin, () => vault.createGrant(created.id, "calendar"));
    await as(admin, () => vault.createGrant(other.id, "mail"));

    const forKey = await as(admin, () =>
      vault.listGrants({ secretId: created.id }),
    );
    const forApp = await as(admin, () => vault.listGrants({ appId: "mail" }));

    expect(forKey.map((grant) => grant.appId).sort()).toEqual([
      "calendar",
      "mail",
    ]);
    expect(forApp.map((grant) => grant.credentialKey).sort()).toEqual([
      "FAKE_API_KEY",
      "OTHER_KEY",
    ]);
  });

  it("grants several keys to an app and skips the ones it already has", async () => {
    const { as, vault, created } = await seededManual();
    const other = await as(admin, () =>
      vault.createSecret({
        credentialKey: "OTHER_KEY",
        value: "fake-other-value",
        name: "Other",
      }),
    );
    await as(admin, () => vault.createGrant(created.id, "mail"));

    const result = await as(admin, () =>
      vault.grantSecretsToApp([created.id, other.id, created.id], "mail"),
    );

    expect(result.accessMode).toBe("manual");
    expect(result.skipped).toEqual([created.id]);
    expect(result.created.map((grant) => grant.credentialKey)).toEqual([
      "OTHER_KEY",
    ]);
  });

  it("writes no grants in all-apps mode", async () => {
    const { as, rows, vault } = await load();
    const created = await as(admin, () =>
      vault.createSecret({
        credentialKey: "FAKE_API_KEY",
        value: PLAINTEXT,
        name: "Fake API key",
      }),
    );

    const result = await as(admin, () =>
      vault.grantSecretsToApp([created.id], "mail"),
    );

    expect(result).toMatchObject({
      accessMode: "all-apps",
      created: [],
      skipped: [created.id],
    });
    expect(await rows("SELECT id FROM vault_grants")).toEqual([]);
  });

  it("moves a key's grants with it when the key is renamed", async () => {
    const { as, rows, vault, created } = await seededManual();
    await as(admin, () => vault.createGrant(created.id, "mail"));

    await as(admin, () =>
      vault.updateSecret(created.id, { credentialKey: "FAKE_API_KEY_V2" }),
    );

    expect(
      await rows("SELECT credential_key, secret_id, status FROM vault_grants"),
    ).toEqual([
      {
        credential_key: "FAKE_API_KEY_V2",
        secret_id: created.id,
        status: "active",
      },
    ]);
  });

  it("does not move another scope's grant of the same key name on a rename", async () => {
    const { as, rows, vault, created } = await seededManual();
    await as(admin, () => vault.createGrant(created.id, "mail"));
    await rows(
      `INSERT INTO vault_grants (id, owner_email, org_id, secret_id, credential_key, app_id, granted_by, status, created_at, updated_at)
       VALUES ('foreign-grant', ?, ?, 'foreign-secret', 'FAKE_API_KEY', 'mail', ?, 'active', 1, 2)`,
      [admin, otherOrgId, admin],
    );

    await as(admin, () =>
      vault.updateSecret(created.id, { credentialKey: "FAKE_API_KEY_V2" }),
    );

    expect(
      await rows(
        "SELECT credential_key FROM vault_grants WHERE id = 'foreign-grant'",
      ),
    ).toEqual([{ credential_key: "FAKE_API_KEY" }]);
  });

  it("counts and shows a grant from before grants named their key only once it is backfilled", async () => {
    const { as, rows, vault, created } = await seededManual();
    await rows(
      `INSERT INTO vault_grants (id, owner_email, org_id, secret_id, app_id, granted_by, status, created_at, updated_at)
       VALUES ('legacy-grant', ?, ?, 'old-vault-secret-id', 'mail', ?, 'active', 1, 2)`,
      [admin, orgId, admin],
    );

    // Core's manual-mode check needs the key, so this row grants nothing.
    expect(await as(admin, () => vault.listVaultOverview())).toMatchObject({
      manualGrantCount: 0,
      activeGrantCount: 0,
    });
    expect(
      await as(admin, () => vault.listGrants({ secretId: created.id })),
    ).toEqual([]);

    // The same key granted again gets its own row; the inert one stays inert.
    const fresh = await as(admin, () => vault.createGrant(created.id, "mail"));
    expect(await rows("SELECT id FROM vault_grants")).toHaveLength(2);

    await rows(
      "UPDATE vault_grants SET credential_key = 'FAKE_API_KEY' WHERE id = 'legacy-grant'",
    );
    const shown = await as(admin, () =>
      vault.listGrants({ secretId: created.id }),
    );
    expect(shown.map((grant) => grant.id).sort()).toEqual(
      [fresh!.id, "legacy-grant"].sort(),
    );
    // Reported against the key's current id, so the Vault page can match it.
    expect(shown.map((grant) => grant.secretId)).toEqual([
      created.id,
      created.id,
    ]);
  });

  it("revokes the grants of a key that is deleted, including a backfilled one", async () => {
    const { as, rows, vault, created } = await seededManual();
    await as(admin, () => vault.createGrant(created.id, "mail"));
    await rows(
      `INSERT INTO vault_grants (id, owner_email, org_id, secret_id, credential_key, app_id, granted_by, status, created_at, updated_at)
       VALUES ('backfilled-grant', ?, ?, 'old-vault-secret-id', 'FAKE_API_KEY', 'calendar', ?, 'active', 1, 2)`,
      [admin, orgId, admin],
    );

    await as(admin, () => vault.deleteSecret(created.id));

    expect(
      await rows("SELECT status FROM vault_grants WHERE status = 'active'"),
    ).toEqual([]);
  });

  it("counts effective grants in manual mode and every key in all-apps mode", async () => {
    const { as, vault, created } = await seededManual();
    await as(admin, () => vault.createGrant(created.id, "mail"));
    await as(admin, () => vault.createGrant(created.id, "calendar"));

    expect(await as(admin, () => vault.listVaultOverview())).toMatchObject({
      accessMode: "manual",
      secretCount: 1,
      manualGrantCount: 2,
      activeGrantCount: 2,
      pendingRequestCount: 0,
    });

    await as(admin, () => vault.setVaultAccessSettings({ mode: "all-apps" }));
    expect(await as(admin, () => vault.listVaultOverview())).toMatchObject({
      accessMode: "all-apps",
      secretCount: 1,
      activeGrantCount: 1,
      manualGrantCount: 2,
    });
  });

  it("shows an app which keys it can use, by grant in manual mode and by default otherwise", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "mail",
        name: "Mail",
        url: "https://mail.example.test",
        color: "#000000",
      },
    ]);
    mocks.ssrfSafeFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          key: "FAKE_API_KEY",
          label: "Fake",
          required: true,
          configured: false,
        },
        {
          key: "OTHER_KEY",
          label: "Other",
          required: false,
          configured: false,
        },
      ],
    });
    const { as, vault, created } = await seededManual();
    await as(admin, () =>
      vault.createSecret({
        credentialKey: "OTHER_KEY",
        value: "fake-other-value",
        name: "Other",
      }),
    );
    await as(admin, () => vault.createGrant(created.id, "mail"));

    const manual = await as(admin, () => vault.listIntegrationsCatalog());
    expect(
      manual[0].integrations.map((entry) => [entry.key, entry.vaultGranted]),
    ).toEqual([
      ["FAKE_API_KEY", true],
      ["OTHER_KEY", false],
    ]);
    expect(manual[0].integrations[0].vaultSecretId).toBe(created.id);

    await as(admin, () => vault.setVaultAccessSettings({ mode: "all-apps" }));
    const open = await as(admin, () => vault.listIntegrationsCatalog());
    expect(open[0].integrations.map((entry) => entry.vaultGranted)).toEqual([
      true,
      true,
    ]);
  });
});

describe("key requests", () => {
  it("approving one stores the key in the vault scope, grants it, and keeps the value out of every other table", async () => {
    const { as, rows, secrets, vault, orgRef, everythingStored } = await load();
    await as(admin, () => vault.setVaultAccessSettings({ mode: "manual" }));
    const request = await as(member, () =>
      vault.createRequest({
        credentialKey: "REQUESTED_KEY",
        appId: "mail",
        reason: "needed for tests",
      }),
    );

    const approved = await as(admin, () =>
      vault.approveRequest(request!.id, PLAINTEXT, "Requested key"),
    );

    expect(approved).toMatchObject({ status: "approved", reviewedBy: admin });
    expect((await secrets.readAppSecret(orgRef("REQUESTED_KEY")))?.value).toBe(
      PLAINTEXT,
    );
    const [stored] = await rows(
      "SELECT scope, scope_id, label, created_by FROM app_secrets WHERE key = 'REQUESTED_KEY'",
    );
    expect(stored).toMatchObject({
      scope: "org",
      scope_id: orgId,
      label: "Requested key",
    });
    expect(stored.created_by).toBeTruthy();
    expect(
      await rows(
        "SELECT credential_key, app_id, status FROM vault_grants WHERE org_id = ?",
        [orgId],
      ),
    ).toEqual([
      { credential_key: "REQUESTED_KEY", app_id: "mail", status: "active" },
    ]);
    expect(await everythingStored()).not.toContain(PLAINTEXT);
  });

  it("grants a key that already exists in the scope without overwriting it", async () => {
    const { as, rows, secrets, vault, orgRef } = await load();
    await as(admin, () => vault.setVaultAccessSettings({ mode: "manual" }));
    await secrets.writeAppSecret({
      ...orgRef("APP_OWNED_KEY"),
      value: "fake-app-owned-value",
    });
    const request = await as(member, () =>
      vault.createRequest({ credentialKey: "APP_OWNED_KEY", appId: "mail" }),
    );

    await as(admin, () =>
      vault.approveRequest(request!.id, "fake-approver-value"),
    );

    expect((await secrets.readAppSecret(orgRef("APP_OWNED_KEY")))?.value).toBe(
      "fake-app-owned-value",
    );
    expect(
      await rows(
        "SELECT label, created_by FROM app_secrets WHERE key = 'APP_OWNED_KEY'",
      ),
    ).toEqual([{ label: null, created_by: null }]);
    expect(
      await rows("SELECT credential_key, status FROM vault_grants"),
    ).toEqual([{ credential_key: "APP_OWNED_KEY", status: "active" }]);
  });

  it("denying one stores nothing and grants nothing", async () => {
    const { as, rows, vault } = await load();
    const request = await as(member, () =>
      vault.createRequest({ credentialKey: "REQUESTED_KEY", appId: "mail" }),
    );

    const denied = await as(admin, () =>
      vault.denyRequest(request!.id, "not needed"),
    );

    expect(denied).toMatchObject({ status: "denied", reviewedBy: admin });
    expect(await rows("SELECT * FROM app_secrets")).toEqual([]);
    expect(await rows("SELECT * FROM vault_grants")).toEqual([]);
  });

  it("lets admins see every request and members only their own", async () => {
    const { as, vault } = await load();
    await as(member, () =>
      vault.createRequest({ credentialKey: "MEMBER_KEY", appId: "mail" }),
    );
    await as(admin, () =>
      vault.createRequest({ credentialKey: "ADMIN_KEY", appId: "mail" }),
    );

    const keys = async (email: string) =>
      (await as(email, () => vault.listRequests()))
        .map((request) => request.credentialKey)
        .sort();

    expect(await keys(admin)).toEqual(["ADMIN_KEY", "MEMBER_KEY"]);
    expect(await keys(member)).toEqual(["MEMBER_KEY"]);
  });
});

describe("the audit log", () => {
  it("names the key in every entry, and still does after the key is gone", async () => {
    const { as, vault } = await load();
    await as(admin, () => vault.setVaultAccessSettings({ mode: "manual" }));
    const created = await as(admin, () =>
      vault.createSecret({
        credentialKey: "FAKE_API_KEY",
        value: PLAINTEXT,
        name: "Fake API key",
      }),
    );
    const grant = await as(admin, () => vault.createGrant(created.id, "mail"));
    await as(admin, () =>
      vault.updateSecret(created.id, { credentialKey: "FAKE_API_KEY_V2" }),
    );
    await as(admin, () => vault.revokeGrant(grant!.id));
    await as(admin, () => vault.deleteSecret(created.id));
    const request = await as(member, () =>
      vault.createRequest({ credentialKey: "REQUESTED_KEY", appId: "mail" }),
    );
    await as(admin, () => vault.denyRequest(request!.id));

    const audit = await as(admin, () => vault.listVaultAudit(50));
    const entry = (action: string) =>
      audit.find((row) => row.action === action);
    const keyOf = (action: string) =>
      JSON.parse(entry(action)?.metadata ?? "{}").credentialKey;

    expect(entry("secret.created")).toMatchObject({ secretId: created.id });
    expect(keyOf("secret.created")).toBe("FAKE_API_KEY");
    expect(keyOf("secret.updated")).toBe("FAKE_API_KEY_V2");
    expect(keyOf("grant.created")).toBe("FAKE_API_KEY");
    expect(keyOf("grant.revoked")).toBe("FAKE_API_KEY_V2");
    expect(entry("secret.deleted")).toMatchObject({ secretId: created.id });
    expect(keyOf("secret.deleted")).toBe("FAKE_API_KEY_V2");
    expect(keyOf("request.created")).toBe("REQUESTED_KEY");
    expect(keyOf("request.denied")).toBe("REQUESTED_KEY");
    expect(JSON.stringify(audit)).not.toContain(PLAINTEXT);
  });
});
