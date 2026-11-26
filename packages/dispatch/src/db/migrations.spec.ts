import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
};

let tempDir: string | null = null;

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function setupTempDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-migrations-"));
  process.env.DATABASE_URL = `pglite:${tempDir}`;
  vi.resetModules();
}

beforeEach(async () => {
  await setupTempDb();
});

afterEach(async () => {
  try {
    const { closeDbExec } = await import("@agent-native/core/db");
    await closeDbExec();
  } catch {}
  restoreEnv();
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
  vi.restoreAllMocks();
});

describe("dispatch migrations", () => {
  it("quietly records source_health when the column already exists", async () => {
    const [{ getDbExec, runMigrations }, { dispatchMigrations }] =
      await Promise.all([
        import("@agent-native/core/db"),
        import("./migrations.js"),
      ]);
    const exec = getDbExec();
    await exec.execute(`
      CREATE TABLE dispatch_dreams (
        id TEXT PRIMARY KEY,
        source_health TEXT
      )
    `);
    await exec.execute(`
      CREATE TABLE dispatch_approval_requests (
        reviewed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    await exec.execute(
      "CREATE TABLE dispatch_migrations (version INTEGER PRIMARY KEY)",
    );
    await exec.execute({
      sql: "INSERT INTO dispatch_migrations VALUES (?)",
      args: [3],
    });

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await runMigrations(dispatchMigrations, {
      table: "dispatch_migrations",
    })({});

    await (await import("@agent-native/core/db")).closeDbExec();
    const freshExec = (await import("@agent-native/core/db")).getDbExec();
    expect(consoleError).not.toHaveBeenCalled();
    const { rows } = await freshExec.execute(
      "SELECT MAX(version) as version FROM dispatch_migrations",
    );
    // oracle-change: migration 10 adds vault_grants.credential_key, so the highest version is now 10.
    expect(rows[0]?.version).toBe(10);
    const { rows: identityRows } = await freshExec.execute({
      sql: `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ?`,
      args: ["identity_sso_authorization_code"],
    });
    expect(identityRows).toHaveLength(1);
    const { rows: bootstrapColumns } = await freshExec.execute({
      sql: `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ?
        ORDER BY column_name`,
      args: ["identity_sso_bootstrap"],
    });
    expect(bootstrapColumns).toEqual(
      expect.arrayContaining([
        { column_name: "created_at", data_type: "bigint" },
        { column_name: "expires_at", data_type: "bigint" },
        { column_name: "consumed_at", data_type: "bigint" },
        { column_name: "activation_expires_at", data_type: "bigint" },
        { column_name: "browser_binding_hash", data_type: "text" },
        { column_name: "org_id", data_type: "text" },
        { column_name: "auth_provider", data_type: "text" },
      ]),
    );
    const { rows: widenedRows } = await freshExec.execute({
      sql: `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ?
        ORDER BY column_name`,
      args: ["dispatch_approval_requests"],
    });
    expect(widenedRows.map((row) => [row.column_name, row.data_type])).toEqual([
      ["created_at", "bigint"],
      ["reviewed_at", "bigint"],
      ["updated_at", "bigint"],
    ]);
  });

  it("fills credential_key on grants that predate it, from the key they pointed at", async () => {
    const [{ getDbExec, runMigrations, closeDbExec }, { dispatchMigrations }] =
      await Promise.all([
        import("@agent-native/core/db"),
        import("./migrations.js"),
      ]);
    const exec = getDbExec();
    await exec.execute(`
      CREATE TABLE vault_secrets (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        credential_key TEXT NOT NULL
      )
    `);
    await exec.execute(`
      CREATE TABLE vault_grants (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        secret_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        status TEXT NOT NULL
      )
    `);
    await exec.execute(
      "CREATE TABLE dispatch_migrations (version INTEGER PRIMARY KEY)",
    );
    await exec.execute({
      sql: "INSERT INTO dispatch_migrations VALUES (?)",
      args: [9],
    });
    for (const [id, org, key] of [
      ["secret-a", "org-a", "HUBSPOT_ACCESS_TOKEN"],
      ["secret-b", "org-b", "OTHER_KEY"],
    ]) {
      await exec.execute({
        sql: "INSERT INTO vault_secrets (id, org_id, credential_key) VALUES (?, ?, ?)",
        args: [id, org, key],
      });
    }
    for (const [id, org, secretId] of [
      ["grant-matches", "org-a", "secret-a"],
      ["grant-other-org", "org-a", "secret-b"],
      ["grant-orphan", "org-a", "secret-gone"],
    ]) {
      await exec.execute({
        sql: "INSERT INTO vault_grants (id, org_id, secret_id, app_id, status) VALUES (?, ?, ?, 'coach', 'active')",
        args: [id, org, secretId],
      });
    }

    await runMigrations(dispatchMigrations, {
      table: "dispatch_migrations",
    })({});

    await closeDbExec();
    const { rows } = await (
      await import("@agent-native/core/db")
    )
      .getDbExec()
      .execute("SELECT id, credential_key FROM vault_grants ORDER BY id");
    // Only a grant whose key sits in the same organization is filled in; the
    // rest stay NULL and grant nothing until someone backfills them.
    expect(rows).toEqual([
      { id: "grant-matches", credential_key: "HUBSPOT_ACCESS_TOKEN" },
      { id: "grant-orphan", credential_key: null },
      { id: "grant-other-org", credential_key: null },
    ]);
  });

  it("still applies the grant migration once the retired vault_secrets table is gone", async () => {
    const [{ getDbExec, runMigrations, closeDbExec }, { dispatchMigrations }] =
      await Promise.all([
        import("@agent-native/core/db"),
        import("./migrations.js"),
      ]);
    const exec = getDbExec();
    await exec.execute(`
      CREATE TABLE vault_grants (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        secret_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        status TEXT NOT NULL
      )
    `);
    await exec.execute({
      sql: "INSERT INTO vault_grants (id, org_id, secret_id, app_id, status) VALUES ('grant-1', 'org-a', 'secret-a', 'coach', 'active')",
      args: [],
    });
    await exec.execute(
      "CREATE TABLE dispatch_migrations (version INTEGER PRIMARY KEY)",
    );
    await exec.execute({
      sql: "INSERT INTO dispatch_migrations VALUES (?)",
      args: [9],
    });

    await runMigrations(dispatchMigrations, {
      table: "dispatch_migrations",
    })({});

    await closeDbExec();
    const freshExec = (await import("@agent-native/core/db")).getDbExec();
    const { rows: columns } = await freshExec.execute({
      sql: `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
      args: ["vault_grants", "credential_key"],
    });
    expect(columns).toHaveLength(1);
    const { rows: grants } = await freshExec.execute(
      "SELECT id, credential_key FROM vault_grants",
    );
    expect(grants).toEqual([{ id: "grant-1", credential_key: null }]);
  });

  it("migrates a fresh install all the way without creating the retired vault_secrets table", async () => {
    const [{ getDbExec, runMigrations, closeDbExec }, { dispatchMigrations }] =
      await Promise.all([
        import("@agent-native/core/db"),
        import("./migrations.js"),
      ]);
    getDbExec();

    await runMigrations(dispatchMigrations, {
      table: "dispatch_migrations",
    })({});

    await closeDbExec();
    const exec = (await import("@agent-native/core/db")).getDbExec();
    const { rows: tables } = await exec.execute(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'vault\\_%'
      ORDER BY table_name
    `);
    expect(tables.map((row) => row.table_name)).toEqual([
      "vault_audit_log",
      "vault_grants",
      "vault_requests",
    ]);
    const { rows: columns } = await exec.execute({
      sql: `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
      args: ["vault_grants", "credential_key"],
    });
    expect(columns).toHaveLength(1);
  });

  it("leaves an existing vault_secrets table and its rows alone", async () => {
    const [{ getDbExec, runMigrations, closeDbExec }, { dispatchMigrations }] =
      await Promise.all([
        import("@agent-native/core/db"),
        import("./migrations.js"),
      ]);
    const exec = getDbExec();
    await exec.execute(`
      CREATE TABLE vault_secrets (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        credential_key TEXT NOT NULL
      )
    `);
    await exec.execute({
      sql: "INSERT INTO vault_secrets (id, org_id, credential_key) VALUES ('secret-a', 'org-a', 'HUBSPOT_ACCESS_TOKEN')",
      args: [],
    });

    await runMigrations(dispatchMigrations, {
      table: "dispatch_migrations",
    })({});

    await closeDbExec();
    const { rows } = await (
      await import("@agent-native/core/db")
    )
      .getDbExec()
      .execute("SELECT id, credential_key FROM vault_secrets");
    expect(rows).toEqual([
      { id: "secret-a", credential_key: "HUBSPOT_ACCESS_TOKEN" },
    ]);
  });
});
