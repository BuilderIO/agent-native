import type { MigrationEntry } from "../db/migrations.js";

export const WORKSPACE_CONNECTIONS_MIGRATIONS_TABLE =
  "_workspace_connections_migrations";

/**
 * Deploy-time schema for workspace connections, grants, and user groups.
 *
 * These three tables were shipped with only their runtime `ensureTable`
 * helpers in `store.ts` / `groups.ts`. That is enough locally and on a
 * long-lived server, but `schemaEnsureDisabled()` makes every probe report
 * "present" on a production serverless runtime, so the ensure path issues no
 * DDL there at all. A table with no entry here therefore never gets created in
 * production, and the first read fails with `relation ... does not exist` —
 * which is exactly what `workspace_user_groups` did from the day after it
 * shipped. Runtime ensure covers dev; this list is the production contract.
 *
 * `created_at` / `updated_at` must be BIGINT on Postgres: they store epoch
 * milliseconds, which overflow int4.
 */
export const WORKSPACE_CONNECTIONS_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    sql: {
      postgres: `CREATE TABLE IF NOT EXISTS workspace_connections (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT '',
        account_id TEXT,
        account_label TEXT,
        status TEXT NOT NULL DEFAULT 'connected',
        scopes_json TEXT NOT NULL DEFAULT '[]',
        config_json TEXT NOT NULL DEFAULT '{}',
        allowed_apps_json TEXT NOT NULL DEFAULT '[]',
        allowed_users_json TEXT NOT NULL DEFAULT '[]',
        allowed_user_groups_json TEXT NOT NULL DEFAULT '[]',
        credential_refs_json TEXT NOT NULL DEFAULT '[]',
        owner_email TEXT NOT NULL DEFAULT '',
        org_id TEXT,
        created_at BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL DEFAULT 0,
        last_used_at BIGINT,
        last_checked_at BIGINT,
        last_error TEXT
      )`,
      sqlite: `CREATE TABLE IF NOT EXISTS workspace_connections (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT '',
        account_id TEXT,
        account_label TEXT,
        status TEXT NOT NULL DEFAULT 'connected',
        scopes_json TEXT NOT NULL DEFAULT '[]',
        config_json TEXT NOT NULL DEFAULT '{}',
        allowed_apps_json TEXT NOT NULL DEFAULT '[]',
        allowed_users_json TEXT NOT NULL DEFAULT '[]',
        allowed_user_groups_json TEXT NOT NULL DEFAULT '[]',
        credential_refs_json TEXT NOT NULL DEFAULT '[]',
        owner_email TEXT NOT NULL DEFAULT '',
        org_id TEXT,
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER,
        last_checked_at INTEGER,
        last_error TEXT
      )`,
    },
  },
  {
    version: 2,
    sql: `CREATE INDEX IF NOT EXISTS idx_workspace_connections_scope_provider
      ON workspace_connections (org_id, owner_email, provider)`,
  },
  {
    version: 3,
    sql: `CREATE INDEX IF NOT EXISTS idx_workspace_connections_updated_at
      ON workspace_connections (updated_at)`,
  },
  {
    version: 4,
    sql: {
      postgres: `CREATE TABLE IF NOT EXISTS workspace_connection_grants (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT '',
        app_id TEXT NOT NULL DEFAULT '',
        scopes_json TEXT NOT NULL DEFAULT '[]',
        config_json TEXT NOT NULL DEFAULT '{}',
        credential_refs_json TEXT NOT NULL DEFAULT '[]',
        granted_by_email TEXT NOT NULL DEFAULT '',
        owner_email TEXT NOT NULL DEFAULT '',
        org_id TEXT,
        created_at BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL DEFAULT 0,
        last_used_at BIGINT
      )`,
      sqlite: `CREATE TABLE IF NOT EXISTS workspace_connection_grants (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT '',
        app_id TEXT NOT NULL DEFAULT '',
        scopes_json TEXT NOT NULL DEFAULT '[]',
        config_json TEXT NOT NULL DEFAULT '{}',
        credential_refs_json TEXT NOT NULL DEFAULT '[]',
        granted_by_email TEXT NOT NULL DEFAULT '',
        owner_email TEXT NOT NULL DEFAULT '',
        org_id TEXT,
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER
      )`,
    },
  },
  {
    version: 5,
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_connection_grants_connection_app
      ON workspace_connection_grants (connection_id, app_id)`,
  },
  {
    version: 6,
    sql: `CREATE INDEX IF NOT EXISTS idx_workspace_connection_grants_scope_app
      ON workspace_connection_grants (org_id, owner_email, app_id)`,
  },
  {
    version: 7,
    sql: `CREATE INDEX IF NOT EXISTS idx_workspace_connection_grants_updated_at
      ON workspace_connection_grants (updated_at)`,
  },
  {
    version: 8,
    sql: {
      postgres: `CREATE TABLE IF NOT EXISTS workspace_user_groups (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        member_emails_json TEXT NOT NULL DEFAULT '[]',
        created_by_email TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL DEFAULT 0
      )`,
      sqlite: `CREATE TABLE IF NOT EXISTS workspace_user_groups (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        member_emails_json TEXT NOT NULL DEFAULT '[]',
        created_by_email TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      )`,
    },
  },
  {
    version: 9,
    sql: `CREATE INDEX IF NOT EXISTS idx_workspace_user_groups_org_updated
      ON workspace_user_groups (org_id, updated_at)`,
  },
];
