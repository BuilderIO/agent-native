import type { MigrationEntry } from "../db/migrations.js";

export const CHAT_THREAD_SCHEMA_MIGRATIONS_TABLE =
  "_chat_thread_schema_migrations";

export const CHAT_THREAD_SCHEMA_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "chat-threads-base-tables",
    sql: `
      CREATE TABLE IF NOT EXISTS chat_threads (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        preview TEXT NOT NULL DEFAULT '',
        thread_data TEXT NOT NULL DEFAULT '{}',
        message_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_thread_shares (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS chat_thread_shares_resource_idx
        ON chat_thread_shares (resource_id)
    `,
  },
  {
    version: 2,
    name: "chat-threads-scope-and-sharing-columns",
    sql: `
      ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS scope_type TEXT;
      -- guard:allow-identity-column — opaque resource reference, not an account identity
      ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS scope_id TEXT;
      ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS scope_label TEXT;
      ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS pinned_at INTEGER;
      ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS archived_at INTEGER;
      ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS share_token_hash TEXT;
      ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS source_platform TEXT;
      ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS source_app_id TEXT;
      ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS source_url TEXT;
      ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS org_id TEXT;
      ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';
      CREATE INDEX IF NOT EXISTS chat_threads_owner_updated_idx
        ON chat_threads (owner_email, updated_at);
      CREATE INDEX IF NOT EXISTS chat_threads_scope_updated_idx
        ON chat_threads (scope_type, scope_id, updated_at);
      CREATE INDEX IF NOT EXISTS chat_threads_source_updated_idx
        ON chat_threads (owner_email, source_app_id, updated_at);
      CREATE INDEX IF NOT EXISTS chat_threads_share_token_idx
        ON chat_threads (share_token_hash)
    `,
  },
  {
    version: 3,
    name: "chat-threads-source-backfill",
    // guard:allow-unscoped — migration marks pre-existing integration threads from their own stored message data
    sql: `
      UPDATE chat_threads
        SET source_platform = 'integration'
        WHERE source_platform IS NULL
          AND thread_data LIKE '%"integrationDeliveryAttempted":true%'
    `,
  },
  {
    version: 4,
    name: "chat-thread-shares-notified-at",
    sql: `
      ALTER TABLE IF EXISTS chat_thread_shares ADD COLUMN IF NOT EXISTS notified_at TEXT
    `,
  },
  {
    version: 5,
    name: "chat-thread-durable-submission-inbox",
    sql: `
      CREATE TABLE IF NOT EXISTS agent_chat_submission_inbox (
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
      );
      CREATE INDEX IF NOT EXISTS agent_chat_submission_inbox_pending_idx
        ON agent_chat_submission_inbox (state, retry_after, interrupt_active_run DESC, move_to_top_at DESC, queue_order ASC)
    `,
  },
  {
    version: 6,
    name: "chat-thread-inbox-interrupt-replay",
    sql: `
      ALTER TABLE agent_chat_submission_inbox
        ADD COLUMN IF NOT EXISTS interrupt_run_id TEXT
    `,
  },
];
