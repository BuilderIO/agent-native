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
  it("backfills legacy feedback within its matching org without replacing assigned orgs", async () => {
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
      CREATE TABLE agent_feedback (
        id TEXT PRIMARY KEY, run_id TEXT, thread_id TEXT, user_id TEXT, org_id TEXT
      );
      CREATE TABLE agent_instruction_updates (
        id TEXT PRIMARY KEY, run_id TEXT, thread_id TEXT, user_id TEXT, org_id TEXT
      );
      INSERT INTO chat_threads (id, owner_email, org_id, created_at, updated_at)
        VALUES ('thread-a', 'alice@example.com', 'org-a', 1, 1),
               ('thread-b', 'bob@example.com', 'org-b', 1, 1);
      INSERT INTO agent_trace_summaries (run_id, thread_id, user_id)
        VALUES ('run-a', 'thread-a', 'ALICE@example.com'),
               ('run-b', 'thread-b', 'bob@example.com'),
               ('run-mismatch', 'thread-a', 'mallory@example.com');
      INSERT INTO agent_trace_summaries (run_id, thread_id, user_id, org_id)
        VALUES ('run-null-thread', NULL, 'alice@example.com', 'org-a');
      INSERT INTO agent_trace_spans (id, run_id, thread_id, user_id, span_type, name, status, created_at)
        VALUES ('span-a', 'run-a', 'thread-a', 'alice@example.com', 'tool_call', 'create_design', 'success', 1),
               ('span-mismatch', 'run-a', 'thread-a', 'mallory@example.com', 'tool_call', 'create_design', 'success', 1),
               ('span-b', 'run-b', 'thread-b', 'bob@example.com', 'tool_call', 'create_design', 'success', 1);
      INSERT INTO agent_feedback (id, run_id, thread_id, user_id)
        VALUES ('feedback-a', 'run-a', 'thread-a', 'ALICE@example.com'),
               ('feedback-b', 'run-b', 'thread-b', 'bob@example.com'),
               ('feedback-mismatch', 'run-a', 'thread-a', 'mallory@example.com'),
               ('feedback-null-thread', 'run-null-thread', NULL, 'alice@example.com'),
               ('feedback-unlinked', NULL, 'thread-a', 'alice@example.com');
      INSERT INTO agent_feedback (id, run_id, thread_id, user_id, org_id)
        VALUES ('feedback-assigned', 'run-a', 'thread-a', 'alice@example.com', 'org-existing');
      INSERT INTO agent_instruction_updates (id, run_id, thread_id, user_id)
        VALUES ('instruction-a', 'run-a', 'thread-a', 'alice@example.com'),
               ('instruction-b', 'run-b', 'thread-b', 'bob@example.com'),
               ('instruction-mismatch', 'run-a', 'thread-a', 'mallory@example.com');
      INSERT INTO agent_instruction_updates (id, run_id, thread_id, user_id)
        VALUES ('instruction-null-thread', 'run-null-thread', NULL, 'alice@example.com');
      INSERT INTO agent_instruction_updates (id, run_id, thread_id, user_id, org_id)
        VALUES ('instruction-assigned', 'run-a', 'thread-a', 'alice@example.com', 'org-existing');
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
      { run_id: "run-null-thread", org_id: "org-a" },
    ]);

    const spans = await db
      .prepare("SELECT id, org_id FROM agent_trace_spans ORDER BY id")
      .all();
    expect(spans).toEqual([
      { id: "span-a", org_id: "org-a" },
      { id: "span-b", org_id: "org-b" },
      { id: "span-mismatch", org_id: null },
    ]);

    const feedback = await db
      .prepare("SELECT id, org_id FROM agent_feedback ORDER BY id")
      .all();
    expect(feedback).toEqual([
      { id: "feedback-a", org_id: "org-a" },
      { id: "feedback-assigned", org_id: "org-existing" },
      { id: "feedback-b", org_id: "org-b" },
      { id: "feedback-mismatch", org_id: null },
      { id: "feedback-null-thread", org_id: "org-a" },
      { id: "feedback-unlinked", org_id: null },
    ]);

    const updates = await db
      .prepare("SELECT id, org_id FROM agent_instruction_updates ORDER BY id")
      .all();
    expect(updates).toEqual([
      { id: "instruction-a", org_id: "org-a" },
      { id: "instruction-assigned", org_id: "org-existing" },
      { id: "instruction-b", org_id: "org-b" },
      { id: "instruction-mismatch", org_id: null },
      { id: "instruction-null-thread", org_id: "org-a" },
    ]);

    const orgAFeedback = await db
      .prepare("SELECT id FROM agent_feedback WHERE org_id = ? ORDER BY id")
      .all("org-a");
    expect(orgAFeedback).toEqual([
      { id: "feedback-a" },
      { id: "feedback-null-thread" },
    ]);
    const orgBFeedback = await db
      .prepare("SELECT id FROM agent_feedback WHERE org_id = ? ORDER BY id")
      .all("org-b");
    expect(orgBFeedback).toEqual([{ id: "feedback-b" }]);

    const orgAUpdates = await db
      .prepare(
        "SELECT id FROM agent_instruction_updates WHERE org_id = ? ORDER BY id",
      )
      .all("org-a");
    expect(orgAUpdates).toEqual([
      { id: "instruction-a" },
      { id: "instruction-null-thread" },
    ]);
    const orgBUpdates = await db
      .prepare(
        "SELECT id FROM agent_instruction_updates WHERE org_id = ? ORDER BY id",
      )
      .all("org-b");
    expect(orgBUpdates).toEqual([{ id: "instruction-b" }]);

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
