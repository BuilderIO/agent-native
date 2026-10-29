import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import { closeDbExec, getDbExec } from "../db/client.js";
import { ensureChatThreadTables } from "./store.js";

const previousUrl = process.env.DATABASE_URL;

beforeEach(async () => {
  await closeDbExec();
  process.env.DATABASE_URL = "pglite:memory";
});

afterEach(() => {
  resetAppConfigForTests();
});

afterAll(async () => {
  await closeDbExec();
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});

describe("chat threads local schema readiness", () => {
  it("repairs a snapshot database recorded before the inbox interrupt and retry columns existed", async () => {
    const exec = getDbExec();
    // The shape a database installed by the previous release's snapshot has:
    // the submission inbox as legacy v5 created it, without the v6/v8
    // columns and the v7 index the skipped legacy entries add, and a ledger
    // that records every migration of that release.
    await exec.execute(`CREATE TABLE chat_threads (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      preview TEXT NOT NULL DEFAULT '',
      thread_data TEXT NOT NULL DEFAULT '{}',
      message_count BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      scope_type TEXT,
      scope_id TEXT,
      scope_label TEXT,
      pinned_at BIGINT,
      archived_at BIGINT,
      share_token_hash TEXT,
      source_platform TEXT,
      source_app_id TEXT,
      source_url TEXT,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`);
    await exec.execute(`CREATE TABLE chat_thread_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notified_at TEXT
    )`);
    await exec.execute(`CREATE TABLE agent_chat_submission_inbox (
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      state TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      actor_auth_user_id TEXT,
      actor_identity_authenticated_at_ms BIGINT,
      actor_name TEXT,
      actor_org_id TEXT,
      actor_org_scope TEXT,
      actor_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
      payload_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      interrupt_active_run BOOLEAN NOT NULL DEFAULT FALSE,
      submitted_run_id TEXT,
      queue_order BIGSERIAL NOT NULL,
      move_to_top_at BIGINT,
      retry_after BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (thread_id, message_id)
    )`);
    await exec.execute(`CREATE INDEX agent_chat_submission_inbox_pending_idx
      ON agent_chat_submission_inbox (state, retry_after, interrupt_active_run DESC, move_to_top_at DESC, queue_order ASC)`);
    await exec.execute(`CREATE TABLE chat_thread_viewer_state (
      thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      pinned_at BIGINT,
      hidden_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (thread_id, user_email)
    )`);
    await exec.execute(`CREATE TABLE _an_store_migrations (
      store_id TEXT NOT NULL,
      name TEXT NOT NULL,
      applied_at BIGINT NOT NULL,
      checksum TEXT,
      kind TEXT,
      source TEXT,
      core_version TEXT,
      PRIMARY KEY (store_id, name)
    )`);
    const recordedBySnapshot = [
      "baseline",
      "widen-bigint",
      "indexes",
      "chat-threads-base-tables",
      "chat-threads-scope-and-sharing-columns",
      "chat-threads-source-backfill",
      "chat-thread-shares-notified-at",
      "chat-thread-durable-submission-inbox",
      "chat-thread-inbox-interrupt-replay",
      "chat-thread-inbox-thread-order-index",
      "chat-thread-inbox-retry-count",
      "viewer-state",
    ];
    for (const name of recordedBySnapshot) {
      await exec.execute({
        sql: `INSERT INTO _an_store_migrations
          (store_id, name, applied_at, checksum, kind, source)
          VALUES ('chat_threads', ?, 1, NULL, 'schema', 'snapshot')`,
        args: [name],
      });
    }

    await ensureChatThreadTables();

    expect(
      (
        await exec.execute(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'agent_chat_submission_inbox'
             AND column_name IN ('interrupt_run_id', 'retry_count')
           ORDER BY column_name`,
        )
      ).rows.map((row) => row.column_name),
    ).toEqual(["interrupt_run_id", "retry_count"]);
    expect(
      (
        await exec.execute(
          `SELECT indexname FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'agent_chat_submission_inbox_thread_pending_idx'`,
        )
      ).rows,
    ).toHaveLength(1);
    // The queued-submission reads select both columns.
    await exec.execute(
      `SELECT interrupt_run_id, retry_count FROM agent_chat_submission_inbox`,
    );
  });
});
