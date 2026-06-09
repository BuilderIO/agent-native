import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS compositions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
    },
    // v2-v4: sharing columns for compositions.
    {
      version: 2,
      sql: `ALTER TABLE compositions ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
    },
    {
      version: 3,
      sql: `ALTER TABLE compositions ADD COLUMN IF NOT EXISTS org_id TEXT`,
    },
    {
      version: 4,
      sql: `ALTER TABLE compositions ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`,
    },
    // v5: companion shares table for per-principal grants.
    {
      version: 5,
      sql: `CREATE TABLE IF NOT EXISTS composition_shares (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    },
    // v6: design systems table
    {
      version: 6,
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
    // v7: companion shares table for design systems
    {
      version: 7,
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
    // v8: link compositions to design systems
    {
      version: 8,
      sql: `ALTER TABLE compositions ADD COLUMN IF NOT EXISTS design_system_id TEXT`,
    },
    // v9-v11: fix boolean columns on Postgres only.
    {
      version: 9,
      sql: {
        postgres: `ALTER TABLE design_systems ALTER COLUMN is_default DROP DEFAULT`,
      },
    },
    {
      version: 10,
      sql: {
        postgres: `ALTER TABLE design_systems ALTER COLUMN is_default TYPE boolean USING is_default::int::boolean`,
      },
    },
    {
      version: 11,
      sql: {
        postgres: `ALTER TABLE design_systems ALTER COLUMN is_default SET DEFAULT false`,
      },
    },
    // v12: library folders for organizing compositions in the sidebar.
    {
      version: 12,
      sql: `CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
    },
    // v13: companion shares table for folders.
    {
      version: 13,
      sql: `CREATE TABLE IF NOT EXISTS folder_shares (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    },
    // v14: composition <-> folder memberships. One canonical placement per
    // composition; access governed by folder sharing.
    {
      version: 14,
      sql: `CREATE TABLE IF NOT EXISTS folder_memberships (
    id TEXT PRIMARY KEY,
    folder_id TEXT NOT NULL,
    composition_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
    },
    {
      version: 15,
      sql: `ALTER TABLE design_systems ADD COLUMN IF NOT EXISTS custom_instructions TEXT NOT NULL DEFAULT ''`,
    },
    // v16: performance indexes for ownable list/read access paths and the
    // folder-membership join. Strictly additive; plain
    // `CREATE INDEX IF NOT EXISTS` works on both SQLite and Postgres.
    // - ownable tables: scoped reads filter on (owner_email, org_id) and sort
    //   by the list column (compositions/design_systems list by updated_at,
    //   folders list by created_at).
    // - *_shares tables: the accessFilter EXISTS subquery looks up grants by
    //   (resource_id, principal_type, principal_id).
    // - folder_memberships is traversed by both FK columns (joined/filtered by
    //   folder_id in list-folders; deleted/moved by composition_id).
    {
      version: 16,
      sql: `CREATE INDEX IF NOT EXISTS compositions_owner_org_updated_idx ON compositions (owner_email, org_id, updated_at);
CREATE INDEX IF NOT EXISTS design_systems_owner_org_updated_idx ON design_systems (owner_email, org_id, updated_at);
CREATE INDEX IF NOT EXISTS folders_owner_org_created_idx ON folders (owner_email, org_id, created_at);
CREATE INDEX IF NOT EXISTS composition_shares_resource_principal_idx ON composition_shares (resource_id, principal_type, principal_id);
CREATE INDEX IF NOT EXISTS design_system_shares_resource_principal_idx ON design_system_shares (resource_id, principal_type, principal_id);
CREATE INDEX IF NOT EXISTS folder_shares_resource_principal_idx ON folder_shares (resource_id, principal_type, principal_id);
CREATE INDEX IF NOT EXISTS folder_memberships_folder_id_idx ON folder_memberships (folder_id);
CREATE INDEX IF NOT EXISTS folder_memberships_composition_id_idx ON folder_memberships (composition_id)`,
    },
  ],
  { table: "videos_migrations" },
);
