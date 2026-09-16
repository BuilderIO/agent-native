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
        normalized_name TEXT,
        member_emails_json TEXT NOT NULL DEFAULT '[]',
        created_by_email TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL DEFAULT 0
      )`,
    },
  },
  {
    version: 9,
    sql: `CREATE INDEX IF NOT EXISTS idx_workspace_user_groups_org_updated
      ON workspace_user_groups (org_id, updated_at)`,
  },
  {
    version: 10,
    sql: `ALTER TABLE workspace_user_groups
      ADD COLUMN IF NOT EXISTS normalized_name TEXT`,
  },
  {
    version: 11,
    // Install the guard before the backfill. The migration runner executes
    // each statement separately, so an older writer could otherwise create a
    // NULL normalized key between this migration and the unique index.
    sql: `CREATE OR REPLACE FUNCTION public.workspace_user_groups_set_normalized_name()
      RETURNS trigger
      LANGUAGE plpgsql
      AS 'BEGIN
        NEW.normalized_name := LOWER(BTRIM(NEW.name));
        RETURN NEW;
      END;';
      DO 'BEGIN
        BEGIN
          CREATE TRIGGER trg_workspace_user_groups_normalized_name
            BEFORE INSERT OR UPDATE OF name ON public.workspace_user_groups
            FOR EACH ROW
            EXECUTE FUNCTION public.workspace_user_groups_set_normalized_name();
        EXCEPTION WHEN duplicate_object THEN
          NULL;
        END;
      END';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_user_groups_org_normalized_name
      ON workspace_user_groups (org_id, normalized_name)
      WHERE normalized_name IS NOT NULL;
      UPDATE workspace_user_groups AS group_row
      SET normalized_name = LOWER(BTRIM(group_row.name))
      WHERE group_row.normalized_name IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM workspace_user_groups AS duplicate
          WHERE duplicate.org_id = group_row.org_id
            AND LOWER(BTRIM(duplicate.name)) = LOWER(BTRIM(group_row.name))
            AND duplicate.id <> group_row.id
        )`,
  },
  {
    version: 12,
    // Repair databases that recorded the backfill-only v11 before the guard
    // was added, then keep the operation idempotent for newer databases.
    sql: `CREATE OR REPLACE FUNCTION public.workspace_user_groups_set_normalized_name()
      RETURNS trigger
      LANGUAGE plpgsql
      AS 'BEGIN
        NEW.normalized_name := LOWER(BTRIM(NEW.name));
        RETURN NEW;
      END;';
      DO 'BEGIN
        BEGIN
          CREATE TRIGGER trg_workspace_user_groups_normalized_name
            BEFORE INSERT OR UPDATE OF name ON public.workspace_user_groups
            FOR EACH ROW
            EXECUTE FUNCTION public.workspace_user_groups_set_normalized_name();
        EXCEPTION WHEN duplicate_object THEN
          NULL;
        END;
      END';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_user_groups_org_normalized_name
      ON workspace_user_groups (org_id, normalized_name)
      WHERE normalized_name IS NOT NULL;
      UPDATE workspace_user_groups AS group_row
      SET normalized_name = LOWER(BTRIM(group_row.name))
      WHERE group_row.normalized_name IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM workspace_user_groups AS duplicate
          WHERE duplicate.org_id = group_row.org_id
            AND LOWER(BTRIM(duplicate.name)) = LOWER(BTRIM(group_row.name))
            AND duplicate.id <> group_row.id
        )`,
  },
  {
    version: 13,
    // Reapply the compatibility trigger for databases that already recorded
    // v12 before the trigger was added.
    sql: `CREATE OR REPLACE FUNCTION public.workspace_user_groups_set_normalized_name()
      RETURNS trigger
      LANGUAGE plpgsql
      AS 'BEGIN
        NEW.normalized_name := LOWER(BTRIM(NEW.name));
        RETURN NEW;
      END;';
      DO 'BEGIN
        BEGIN
          CREATE TRIGGER trg_workspace_user_groups_normalized_name
            BEFORE INSERT OR UPDATE OF name ON public.workspace_user_groups
            FOR EACH ROW
            EXECUTE FUNCTION public.workspace_user_groups_set_normalized_name();
        EXCEPTION WHEN duplicate_object THEN
          NULL;
        END;
      END'`,
  },
  {
    version: 14,
    // Repair NULL keys left by databases that recorded the pre-trigger v11/v12
    // migrations before the compatibility trigger was installed.
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_user_groups_org_normalized_name
      ON workspace_user_groups (org_id, normalized_name)
      WHERE normalized_name IS NOT NULL;
      UPDATE workspace_user_groups AS group_row
      SET normalized_name = LOWER(BTRIM(group_row.name))
      WHERE group_row.normalized_name IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM workspace_user_groups AS duplicate
          WHERE duplicate.org_id = group_row.org_id
            AND LOWER(BTRIM(duplicate.name)) = LOWER(BTRIM(group_row.name))
            AND duplicate.id <> group_row.id
        )`,
  },
];
