import type { MigrationEntry } from "../db/migrations.js";

export const WORKSPACE_CONNECTIONS_MIGRATIONS_TABLE =
  "_workspace_connections_migrations";

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
