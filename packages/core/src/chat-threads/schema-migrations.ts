import type { MigrationEntry } from "../db/migrations.js";

export const CHAT_THREAD_SCHEMA_MIGRATIONS_TABLE =
  "_chat_thread_schema_migrations";

/**
 * Authoritative release-time schema for the framework chat thread store.
 * Request functions skip the store's fallback DDL in production, so a chat
 * deployment must create this schema before it starts serving requests.
 */
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
];
