import { describe, expect, it } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { CHAT_THREAD_SCHEMA_MIGRATIONS } from "../chat-threads/schema-migrations.js";
import type { MigrationEntry } from "../db/migrations.js";
import { OBSERVABILITY_MIGRATIONS } from "./migrations.js";

async function applyMigrations(
  db: Awaited<ReturnType<typeof createTestPglite>>,
  migrations: MigrationEntry[],
) {
  for (const migration of migrations) {
    const sql =
      typeof migration.sql === "string"
        ? migration.sql
        : (migration.sql.postgres ?? "");
    if (sql) await db.exec(sql);
  }
}

describe("observability release migrations", () => {
  it("backfills trace orgs only through matching thread owners", async () => {
    const db = await createTestPglite();
    await applyMigrations(db, CHAT_THREAD_SCHEMA_MIGRATIONS);
    await db.exec(`
      CREATE TABLE agent_trace_summaries (
        run_id TEXT PRIMARY KEY, thread_id TEXT, user_id TEXT, org_id TEXT
      );
      CREATE TABLE agent_trace_spans (
        id TEXT PRIMARY KEY, run_id TEXT, thread_id TEXT, user_id TEXT,
        org_id TEXT, span_type TEXT, name TEXT, status TEXT, created_at BIGINT
      );
      INSERT INTO chat_threads (id, owner_email, org_id, created_at, updated_at)
        VALUES ('thread-a', 'alice@example.com', 'org-a', 1, 1),
               ('thread-b', 'bob@example.com', 'org-b', 1, 1);
      INSERT INTO agent_trace_summaries (run_id, thread_id, user_id)
        VALUES ('run-a', 'thread-a', 'ALICE@example.com'),
               ('run-b', 'thread-b', 'bob@example.com'),
               ('run-mismatch', 'thread-a', 'mallory@example.com');
      INSERT INTO agent_trace_spans (id, run_id, thread_id, user_id, span_type, name, status, created_at)
        VALUES ('span-a', 'run-a', 'thread-a', 'alice@example.com', 'tool_call', 'create_design', 'success', 1),
               ('span-mismatch', 'run-a', 'thread-a', 'mallory@example.com', 'tool_call', 'create_design', 'success', 1),
               ('span-b', 'run-b', 'thread-b', 'bob@example.com', 'tool_call', 'create_design', 'success', 1);
    `);

    await applyMigrations(db, OBSERVABILITY_MIGRATIONS);
    await applyMigrations(db, OBSERVABILITY_MIGRATIONS);

    const summaries = await db
      .prepare(
        "SELECT run_id, org_id FROM agent_trace_summaries ORDER BY run_id",
      )
      .all();
    expect(summaries).toEqual([
      { run_id: "run-a", org_id: "org-a" },
      { run_id: "run-b", org_id: "org-b" },
      { run_id: "run-mismatch", org_id: null },
    ]);

    const spans = await db
      .prepare("SELECT id, org_id FROM agent_trace_spans ORDER BY id")
      .all();
    expect(spans).toEqual([
      { id: "span-a", org_id: "org-a" },
      { id: "span-b", org_id: "org-b" },
      { id: "span-mismatch", org_id: null },
    ]);

    const indexes = await db
      .prepare(
        "SELECT indexname FROM pg_indexes WHERE tablename = 'agent_trace_spans'",
      )
      .all();
    expect(indexes.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "idx_trace_spans_org_type_name_run_id",
        "idx_trace_spans_org_run_type_status_created",
      ]),
    );
    await db.close();
  });
});
