import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS designs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    data TEXT NOT NULL,
    project_type TEXT NOT NULL DEFAULT 'prototype',
    design_system_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
  },
  {
    version: 2,
    sql: `CREATE TABLE IF NOT EXISTS design_shares (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  },
  {
    version: 3,
    sql: `CREATE TABLE IF NOT EXISTS design_systems (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    data TEXT NOT NULL,
    assets TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
  },
  {
    version: 4,
    sql: `CREATE TABLE IF NOT EXISTS design_system_shares (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  },
  {
    version: 5,
    sql: `CREATE TABLE IF NOT EXISTS design_files (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    content TEXT NOT NULL,
    file_type TEXT NOT NULL DEFAULT 'html',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  },
  {
    version: 6,
    sql: `CREATE TABLE IF NOT EXISTS design_versions (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    label TEXT,
    snapshot TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  },
  // v7-v9: fix boolean columns on Postgres only. The adaptSqlForPostgres
  // rewriter turns INTEGER -> BIGINT, so migration v3 created is_default
  // as bigint. Drizzle's integer({ mode: "boolean" }) maps to pg boolean,
  // so inserts send a JS boolean that Postgres rejects. Convert to boolean.
  {
    version: 7,
    sql: {
      postgres: `ALTER TABLE design_systems ALTER COLUMN is_default DROP DEFAULT`,
    },
  },
  {
    version: 8,
    sql: {
      postgres: `ALTER TABLE design_systems ALTER COLUMN is_default TYPE boolean USING is_default::int::boolean`,
    },
  },
  {
    version: 9,
    sql: {
      postgres: `ALTER TABLE design_systems ALTER COLUMN is_default SET DEFAULT false`,
    },
  },
]);
