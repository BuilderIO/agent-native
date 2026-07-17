import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_PATH = join(
  tmpdir(),
  `private-vault-replay-upgrade-${process.pid}-${Date.now()}.sqlite`,
);
const DATABASE_URL = `file:${DATABASE_PATH}`;
const MIGRATIONS_TABLE = "private_vault_replay_upgrade_test_migrations";
const NAMED_TABLE = `${MIGRATIONS_TABLE}_named`;

let getDbExec: (typeof import("@agent-native/core/db"))["getDbExec"];

beforeAll(async () => {
  const legacy = createClient({ url: DATABASE_URL });
  await legacy.batch(
    [
      `CREATE TABLE ${MIGRATIONS_TABLE} (version INTEGER PRIMARY KEY)`,
      `CREATE TABLE ${NAMED_TABLE} (name TEXT PRIMARY KEY, version INTEGER, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`,
      `INSERT INTO ${MIGRATIONS_TABLE} (version) VALUES (79)`,
      `INSERT INTO ${NAMED_TABLE} (name, version) VALUES ('content-private-vault-endpoint-request-replay-fence', 79)`,
      `CREATE TABLE content_encrypted_vault_endpoint_request_nonces (
        id TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL,
        endpoint_id TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT NOT NULL DEFAULT '',
        nonce TEXT NOT NULL,
        claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL
      )`,
      `INSERT INTO content_encrypted_vault_endpoint_request_nonces
        (id, vault_id, endpoint_id, owner_email, org_id, nonce, expires_at)
        VALUES ('legacy-claim', 'vault:legacy', 'endpoint:legacy', 'owner@example.com', '', '${"ab".repeat(16)}', '2026-07-17T02:06:00.000Z')`,
    ],
    "write",
  );
  legacy.close();

  process.env.DATABASE_URL = DATABASE_URL;
  const coreDb = await import("@agent-native/core/db");
  getDbExec = coreDb.getDbExec;
  const migrate = coreDb.runMigrations(
    [
      {
        version: 79,
        name: "content-private-vault-endpoint-request-replay-fence",
        sql: "SELECT 79",
      },
      {
        version: 80,
        name: "content-private-vault-content-free-replay-fence",
        sql: `CREATE TABLE IF NOT EXISTS content_encrypted_vault_endpoint_request_nonce_claims_v2 (
          id TEXT PRIMARY KEY,
          vault_id TEXT NOT NULL,
          endpoint_id TEXT NOT NULL,
          owner_email TEXT NOT NULL,
          org_id TEXT NOT NULL DEFAULT '',
          version INTEGER NOT NULL DEFAULT 1,
          nonce_digest TEXT NOT NULL,
          claimed_at_bucket INTEGER NOT NULL,
          expires_at_bucket INTEGER NOT NULL
        )`,
      },
    ],
    { table: MIGRATIONS_TABLE },
  );
  await migrate(undefined as never);
  await migrate(undefined as never);
}, 30_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${DATABASE_PATH}${suffix}`, { force: true });
  }
});

describe("Private Vault replay-fence migration lineage", () => {
  it("keeps committed v79 intact and additively applies the content-free v80 table", async () => {
    const names = await getDbExec().execute(
      `SELECT name, version FROM ${NAMED_TABLE} ORDER BY version`,
    );
    expect(names.rows).toEqual([
      {
        name: "content-private-vault-endpoint-request-replay-fence",
        version: 79,
      },
      {
        name: "content-private-vault-content-free-replay-fence",
        version: 80,
      },
    ]);
    const columns = await getDbExec().execute(
      "PRAGMA table_info(content_encrypted_vault_endpoint_request_nonce_claims_v2)",
    );
    expect(columns.rows.map((row) => row.name)).toEqual([
      "id",
      "vault_id",
      "endpoint_id",
      "owner_email",
      "org_id",
      "version",
      "nonce_digest",
      "claimed_at_bucket",
      "expires_at_bucket",
    ]);

    const rawBeforeExpiry = await getDbExec().execute(
      "SELECT nonce FROM content_encrypted_vault_endpoint_request_nonces",
    );
    expect(rawBeforeExpiry.rows).toEqual([{ nonce: "ab".repeat(16) }]);
  });
});
