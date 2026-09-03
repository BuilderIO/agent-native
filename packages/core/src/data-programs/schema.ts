/**
 * Drizzle schema for the data-programs primitive.
 *
 * A "data program" is a named, stored, agent-authored JS script executed
 * server-side through the existing run-code sandbox (`executeSandboxCode`).
 * Its result (rows + schema) is cached in `data_program_runs` and rendered by
 * the analytics dashboard panel components via a `"program"` panel source.
 *
 * `dataPrograms` follows the standard ownable-resource shape (see
 * `../extensions/schema.ts`) so it can be registered with the framework
 * sharing registry. `data_program_runs` is a run-result CACHE, not a
 * shareable/ownable resource — it is created via raw portable DDL exactly
 * like `../provider-api/staged-datasets-store.ts` (JSON-as-TEXT, no
 * dialect-specific column types, so the schema stays Postgres/SQLite
 * portable).
 */

import { table, text, integer, now } from "../db/schema.js";
import { ownableColumns, createSharesTable } from "../sharing/schema.js";

/**
 * `refreshMode`: `'manual'` (cached until an explicit refresh) or `'ttl'`
 * (re-run automatically once `refreshTtlMs` has elapsed). Validated in TS
 * (see `execute.ts` / `actions.ts`) — stored as plain text for portability.
 */
export const dataPrograms = table("data_programs", {
  id: text("id").primaryKey(), // "dp_" + random id
  appId: text("app_id").notNull(),
  // Slug, unique per (appId, ownerEmail) — enforced in store.ts, not the DB,
  // to stay dialect-portable (no partial/expression unique indexes needed).
  name: text("name").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  code: text("code").notNull(),
  paramsSchema: text("params_schema"), // JSON text, optional
  defaultParams: text("default_params"), // JSON text, optional
  outputColumns: text("output_columns"), // JSON text {name,type}[] from last dry-run
  refreshMode: text("refresh_mode").notNull().default("ttl"), // 'manual' | 'ttl'
  refreshTtlMs: integer("refresh_ttl_ms").notNull().default(300_000), // 5 min default
  background: integer("background").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  archivedAt: text("archived_at"),
  ...ownableColumns(),
});

export const dataProgramShares = createSharesTable("data_program_shares");

export const DATA_PROGRAMS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS data_programs (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL,
  params_schema TEXT,
  default_params TEXT,
  output_columns TEXT,
  refresh_mode TEXT NOT NULL DEFAULT 'ttl',
  refresh_ttl_ms INTEGER NOT NULL DEFAULT 300000,
  background INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`;

export const DATA_PROGRAMS_CREATE_SQL_PG = `CREATE TABLE IF NOT EXISTS data_programs (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL,
  params_schema TEXT,
  default_params TEXT,
  output_columns TEXT,
  refresh_mode TEXT NOT NULL DEFAULT 'ttl',
  refresh_ttl_ms INTEGER NOT NULL DEFAULT 300000,
  background INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now(),
  archived_at TEXT,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`;

export const DATA_PROGRAM_SHARES_CREATE_SQL = `CREATE TABLE IF NOT EXISTS data_program_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

export const DATA_PROGRAM_SHARES_CREATE_SQL_PG = `CREATE TABLE IF NOT EXISTS data_program_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now()
)`;

export const DATA_PROGRAMS_APP_OWNER_INDEX_SQL = `CREATE INDEX IF NOT EXISTS data_programs_app_owner_idx ON data_programs (app_id, owner_email)`;
export const DATA_PROGRAMS_APP_NAME_INDEX_SQL = `CREATE INDEX IF NOT EXISTS data_programs_app_name_idx ON data_programs (app_id, name)`;
export const DATA_PROGRAM_SHARES_RESOURCE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS data_program_shares_resource_idx ON data_program_shares (resource_id)`;

// ---------------------------------------------------------------------------
// data_program_runs — run-result cache. Not shareable/ownable; scoped only by
// program_id (access to the run cache is governed by access to the parent
// program). Raw portable DDL (no Drizzle table) mirroring
// ../provider-api/staged-datasets-store.ts — rows/schema stored as JSON TEXT,
// row_count/byte_size/timestamps use `intType()` (INTEGER on SQLite, BIGINT
// on Postgres) so the schema stays dialect-portable.
// ---------------------------------------------------------------------------

export function dataProgramRunsCreateSql(integerType: string): string {
  return `CREATE TABLE IF NOT EXISTS data_program_runs (
    id TEXT PRIMARY KEY,
    program_id TEXT NOT NULL,
    params_hash TEXT NOT NULL,
    params_json TEXT NOT NULL,
    status TEXT NOT NULL,
    rows_json TEXT,
    schema_json TEXT,
    truncated INTEGER NOT NULL DEFAULT 0,
    row_count ${integerType} NOT NULL DEFAULT 0,
    byte_size ${integerType} NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    logs_tail TEXT,
    execution_id TEXT,
    triggered_by TEXT NOT NULL,
    started_at ${integerType} NOT NULL,
    finished_at ${integerType},
    duration_ms ${integerType}
  )`;
}

export const DATA_PROGRAM_RUNS_TRUNCATED_COLUMN_SQL = `ALTER TABLE data_program_runs ADD COLUMN IF NOT EXISTS truncated INTEGER NOT NULL DEFAULT 0`;
export const DATA_PROGRAM_RUNS_LOOKUP_INDEX_SQL = `CREATE INDEX IF NOT EXISTS data_program_runs_lookup_idx ON data_program_runs (program_id, params_hash, finished_at)`;
