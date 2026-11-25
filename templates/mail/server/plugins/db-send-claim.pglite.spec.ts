import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

type Exec = {
  execute: (
    q: string | { sql: string; args?: unknown[] },
  ) => Promise<{ rows: Record<string, unknown>[] }>;
};

let exec: Exec;

const LEGACY_TABLE = `CREATE TABLE queued_email_drafts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  requester_name TEXT,
  to_recipients TEXT NOT NULL,
  cc_recipients TEXT,
  bcc_recipients TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  context TEXT,
  source TEXT NOT NULL DEFAULT 'agent',
  source_thread_id TEXT,
  account_email TEXT,
  compose_id TEXT,
  sent_message_id TEXT,
  send_claim_id TEXT,
  send_claimed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  sent_at BIGINT
)`;

const CLAIM = `UPDATE queued_email_drafts
  SET send_claim_id = ?, send_claimed_at = ?, updated_at = ?
  WHERE id = ? AND (send_claim_id IS NULL OR send_claimed_at < ?)
  RETURNING send_claim_id`;

function claimArgs(now: number) {
  return ["claim-1", now, now, "qd_1", now - 15 * 60_000];
}

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  const core = await import("@agent-native/core/db");
  exec = core.getDbExec() as unknown as Exec;
});

async function seedLegacyDraft() {
  await exec.execute(LEGACY_TABLE);
  await exec.execute({
    sql: `INSERT INTO queued_email_drafts
          (id, org_id, owner_email, requester_email, to_recipients, subject,
           body, created_at, updated_at)
          VALUES ('qd_1', 'org-1', 'owner@example.com', 'asker@example.com',
                  'to@example.com', 'Hello', 'Body', ?, ?)`,
    args: [Date.now(), Date.now()],
  });
}

afterEach(async () => {
  const { closeDbExec } = await import("@agent-native/core/db");
  await closeDbExec();
  Reflect.deleteProperty(globalThis as object, "__agentNativePgliteClients");
  Reflect.deleteProperty(
    globalThis as object,
    "__agentNativePgliteProcessLocks",
  );
  Reflect.deleteProperty(
    globalThis as object,
    "__agentNativePgliteProcessExitCleanupRegistered",
  );
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("queued draft send claims (PGlite)", () => {
  it("can't claim a draft while send_claimed_at is 32-bit", async () => {
    await seedLegacyDraft();
    await expect(
      exec.execute({ sql: CLAIM, args: claimArgs(Date.now()) }),
    ).rejects.toThrow(/out of range for type integer/);
  });

  it("claims a draft once Mail's migrations widen send_claimed_at", async () => {
    await seedLegacyDraft();
    const { default: initializeMailDb } = await import("./db.js");
    await initializeMailDb({});

    const { rows: columns } = await exec.execute({
      sql: `SELECT data_type FROM information_schema.columns
            WHERE table_name = 'queued_email_drafts'
              AND column_name = 'send_claimed_at'`,
    });
    expect(columns).toEqual([{ data_type: "bigint" }]);

    const now = Date.now();
    const { rows } = await exec.execute({ sql: CLAIM, args: claimArgs(now) });
    expect(rows).toEqual([{ send_claim_id: "claim-1" }]);
  });
});

describe("Mail's millisecond timestamps (PGlite)", () => {
  it("stores every *_at, *_date and *_until column as BIGINT on a new database", async () => {
    const { default: initializeMailDb } = await import("./db.js");
    await initializeMailDb({});

    const { rows } = await exec.execute({
      sql: `SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public'
              AND data_type = 'integer'
              AND (right(column_name, 3) = '_at' OR right(column_name, 5) = '_date' OR right(column_name, 6) = '_until')
            ORDER BY table_name, column_name`,
    });
    expect(rows).toEqual([]);
  });

  it("declares every *_at, *_date and *_until column as bigint", async () => {
    const { is } = await import("drizzle-orm");
    const { PgTable, getTableConfig } = await import("drizzle-orm/pg-core");
    const schema = await import("../db/schema.js");
    const narrow = Object.values(schema).flatMap((value) => {
      if (!is(value, PgTable)) return [];
      const { name, columns } = getTableConfig(value);
      return columns
        .filter(
          (column) =>
            /_(at|date|until)$/.test(column.name) &&
            column.getSQLType() !== "bigint",
        )
        .map((column) => `${name}.${column.name}`);
    });
    expect(narrow).toEqual([]);
  });

  it("schedules a send at a millisecond timestamp", async () => {
    const { default: initializeMailDb } = await import("./db.js");
    await initializeMailDb({});

    const now = Date.now();
    await exec.execute({
      sql: `INSERT INTO scheduled_jobs (id, type, payload, run_at, created_at)
            VALUES ('job-1', 'send_later', '{}', ?, ?)`,
      args: [now + 60_000, now],
    });
    const { rows } = await exec.execute(
      `SELECT run_at FROM scheduled_jobs WHERE id = 'job-1'`,
    );
    expect(rows.map((row) => Number(row.run_at))).toEqual([now + 60_000]);
  });
});
