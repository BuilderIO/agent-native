import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { AuditEvent } from "./types.js";

const postgresUrl = process.env.AGENT_NATIVE_AUDIT_POSTGRES_URL;

describe.skipIf(!postgresUrl)("audit store PostgreSQL append order", () => {
  let dbModule: typeof import("../db/client.js");
  let ddlModule: typeof import("../db/ddl-guard.js");
  let store: typeof import("./store.js");

  const event = (id: string, createdAt = 700): AuditEvent => ({
    id,
    createdAt,
    action: "update-schedule",
    caller: "tool",
    actorKind: "agent",
    actorEmail: "alice@example.test",
    orgId: null,
    threadId: null,
    turnId: null,
    targetType: "automation",
    targetId: "automation-1",
    status: "success",
    summary: null,
    input: null,
    errorCode: null,
    ownerEmail: "alice@example.test",
    visibility: "private",
  });

  async function resetEphemeralSchema(): Promise<void> {
    const client = dbModule.getDbExec();
    await client.execute("DROP TABLE IF EXISTS agent_audit_log CASCADE");
    await client.execute(
      "DROP TABLE IF EXISTS agent_audit_append_order CASCADE",
    );
    await client.execute(
      "DROP FUNCTION IF EXISTS agent_audit_allocate_append_order() CASCADE",
    );
    await dbModule.closeDbExec();
    ddlModule.__resetSchemaSnapshotForTests();
    store.__resetAuditInitForTests();
  }

  beforeAll(async () => {
    const parsed = new URL(postgresUrl!);
    expect(["127.0.0.1", "localhost", "::1"]).toContain(parsed.hostname);
    expect(parsed.pathname).toBe("/audit_test");
    vi.stubEnv("DATABASE_URL", postgresUrl!);

    dbModule = await import("../db/client.js");
    ddlModule = await import("../db/ddl-guard.js");
    store = await import("./store.js");

    const version = await dbModule.getDbExec().execute("SHOW server_version");
    expect(String(version.rows[0]?.server_version)).toMatch(/^17\./);
  });

  beforeEach(resetEphemeralSchema);

  afterAll(async () => {
    if (dbModule) {
      await resetEphemeralSchema();
      await dbModule.closeDbExec();
    }
    vi.unstubAllEnvs();
  });

  it("returns exact tied-timestamp pages in append order", async () => {
    await store.insertAuditEvent(event("z-first"));
    await store.insertAuditEvent(event("m-second"));
    await store.insertAuditEvent(event("a-third"));

    const firstPage = await store.queryAuditEvents(
      { userEmail: "alice@example.test" },
      { limit: 2 },
    );
    const secondPage = await store.queryAuditEvents(
      { userEmail: "alice@example.test" },
      { limit: 2, offset: 2 },
    );

    expect(firstPage.map((row) => row.id)).toEqual(["a-third", "m-second"]);
    expect(secondPage.map((row) => row.id)).toEqual(["z-first"]);
    const union = [...firstPage, ...secondPage];
    expect(union.map((row) => row.id)).toEqual([
      "a-third",
      "m-second",
      "z-first",
    ]);
    expect(new Set(union.map((row) => row.id)).size).toBe(3);
    expect(union.every((row) => !("append_order" in row))).toBe(true);
  });

  it("backfills a legacy table and allocates for rolling old writers", async () => {
    const client = dbModule.getDbExec();
    await client.execute(`
      CREATE TABLE agent_audit_log (
        id TEXT PRIMARY KEY,
        created_at BIGINT NOT NULL,
        action TEXT NOT NULL,
        caller TEXT NOT NULL,
        actor_kind TEXT NOT NULL,
        actor_email TEXT,
        org_id TEXT,
        thread_id TEXT,
        turn_id TEXT,
        target_type TEXT,
        target_id TEXT,
        status TEXT NOT NULL DEFAULT 'success',
        summary TEXT,
        input TEXT,
        error_code TEXT,
        owner_email TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      )
    `);
    for (const id of ["legacy-z", "legacy-m", "legacy-a"]) {
      await client.execute({
        sql: `INSERT INTO agent_audit_log
          (id, created_at, action, caller, actor_kind, owner_email, visibility)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          700,
          "legacy",
          "tool",
          "agent",
          "alice@example.test",
          "private",
        ],
      });
    }

    store.__resetAuditInitForTests();
    await store.ensureAuditTables();

    const migrated = await client.execute(
      "SELECT id, append_order FROM agent_audit_log ORDER BY append_order",
    );
    expect(migrated.rows.map((row) => row.id)).toEqual([
      "legacy-z",
      "legacy-m",
      "legacy-a",
    ]);
    expect(migrated.rows.map((row) => Number(row.append_order))).toEqual([
      1, 2, 3,
    ]);

    // This is the pre-upgrade INSERT shape: it omits append_order entirely.
    await client.execute({
      sql: `INSERT INTO agent_audit_log
        (id, created_at, action, caller, actor_kind, owner_email, visibility)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "a-after-upgrade",
        700,
        "legacy-writer",
        "tool",
        "agent",
        "alice@example.test",
        "private",
      ],
    });
    const state = await client.execute(`
      SELECT COUNT(*)::INT AS total,
             COUNT(append_order)::INT AS non_null,
             COUNT(DISTINCT append_order)::INT AS unique_count,
             MAX(append_order)::BIGINT AS max_order
        FROM agent_audit_log
    `);
    expect(state.rows[0]).toMatchObject({
      total: 4,
      non_null: 4,
      unique_count: 4,
      max_order: "4",
    });
    const rows = await store.queryAuditEvents({
      userEmail: "alice@example.test",
    });
    expect(rows.map((row) => row.id)).toEqual([
      "a-after-upgrade",
      "legacy-a",
      "legacy-m",
      "legacy-z",
    ]);
  });
});
