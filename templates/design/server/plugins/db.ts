import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
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
    {
      version: 10,
      sql: `ALTER TABLE design_systems ADD COLUMN IF NOT EXISTS custom_instructions TEXT NOT NULL DEFAULT ''`,
    },
    // v11: performance indexes. The ownable tables had no indexes, so every
    // accessFilter() scan (owner_email / org_id / visibility predicates plus
    // correlated EXISTS against the shares table) and every list ORDER BY
    // updated_at was a full table scan. Composite indexes match accessFilter's
    // ownership predicate + the list sort, and the shares indexes cover the
    // EXISTS subquery's resource_id / principal_type / principal_id lookup.
    // Additive only; portable across Postgres and SQLite (no DESC / partial /
    // PG-only syntax).
    {
      version: 11,
      sql: `CREATE INDEX IF NOT EXISTS designs_owner_org_updated_idx ON designs (owner_email, org_id, updated_at);
CREATE INDEX IF NOT EXISTS design_systems_owner_org_updated_idx ON design_systems (owner_email, org_id, updated_at);
CREATE INDEX IF NOT EXISTS design_shares_resource_principal_idx ON design_shares (resource_id, principal_type, principal_id);
CREATE INDEX IF NOT EXISTS design_system_shares_resource_principal_idx ON design_system_shares (resource_id, principal_type, principal_id)`,
    },
    // v12: component_index — real-app component metadata (name, file path,
    // export name, parsed prop types, cva/tailwind-variants variants, Storybook
    // stories, runtime selectors). Ownable; access-checked via accessFilter /
    // assertAccess.
    {
      version: 12,
      sql: `CREATE TABLE IF NOT EXISTS component_index (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    source_ref TEXT,
    name TEXT NOT NULL,
    file_path TEXT,
    export_name TEXT,
    props TEXT,
    variants TEXT,
    stories TEXT,
    runtime_selectors TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
    },
    // v13: motion_timeline — CSS-first keyframe animation tracks scoped to one
    // design + source + screen/file. tracks JSON is the editing representation;
    // the compiled CSS block (managed <style data-agent-native-motion>) is the
    // runtime truth. compiled_hash guards drift between the two. Ownable.
    {
      version: 13,
      sql: `CREATE TABLE IF NOT EXISTS motion_timeline (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    source_ref TEXT,
    file_path TEXT,
    tracks TEXT NOT NULL DEFAULT '[]',
    duration_ms INTEGER NOT NULL DEFAULT 300,
    default_ease TEXT NOT NULL DEFAULT 'ease',
    compiled_hash TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
    },
    // v14: design_state — design states (alternate x-data/DOM snapshots for
    // Default / Loading / Empty / Error), static data fixtures, and live
    // captures of running-app route + props + API data. Ownable.
    {
      version: 14,
      sql: `CREATE TABLE IF NOT EXISTS design_state (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    source_ref TEXT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'state',
    breakpoint TEXT NOT NULL DEFAULT 'auto',
    route TEXT,
    fixture_data TEXT,
    capture_data TEXT,
    preview_ref TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
    },
    // v15: design_review_snapshot — cached a11y audit results and visual diff
    // data keyed by design + optional base/compare design_versions pair.
    // status: 'pending' | 'ready' | 'error'. Ownable.
    {
      version: 15,
      sql: `CREATE TABLE IF NOT EXISTS design_review_snapshot (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    base_version_id TEXT,
    compare_version_id TEXT,
    source_ref TEXT,
    a11y_findings TEXT,
    visual_diff TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
    },
    // v16: localhost source connections and write-consent grants. The schema
    // existed before this migration in source, but fresh/existing DBs still
    // need the concrete tables and the bridge_token column used by localhost
    // write-back.
    {
      version: 16,
      sql: `CREATE TABLE IF NOT EXISTS design_localhost_connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'localhost',
    dev_server_url TEXT NOT NULL,
    bridge_url TEXT,
    root_path TEXT,
    route_manifest TEXT NOT NULL DEFAULT '{}',
    capabilities TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'connected',
    last_seen_at TEXT,
    bridge_token TEXT,
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
ALTER TABLE design_localhost_connections ADD COLUMN IF NOT EXISTS bridge_token TEXT;
CREATE TABLE IF NOT EXISTS design_localhost_write_grants (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    root_path TEXT NOT NULL,
    bridge_token TEXT NOT NULL,
    granted_until TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  );
CREATE INDEX IF NOT EXISTS design_localhost_connections_owner_idx ON design_localhost_connections (owner_email, org_id, updated_at);
CREATE INDEX IF NOT EXISTS design_localhost_write_grants_lookup_idx ON design_localhost_write_grants (design_id, connection_id, owner_email)`,
    },
    // v17: older local databases may already have motion_timeline from the
    // pre-ownable prototype. Backfill the ownable columns additively so the
    // first "Add track" insert can persist through the current Drizzle schema.
    {
      version: 17,
      sql: `ALTER TABLE motion_timeline ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost';
ALTER TABLE motion_timeline ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE motion_timeline ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';
CREATE INDEX IF NOT EXISTS motion_timeline_owner_org_updated_idx ON motion_timeline (owner_email, org_id, updated_at)`,
    },
    // v18: intentionally no-op. New org-scoped designs now default to
    // org-visible at creation time, but existing private org rows may have
    // been intentionally private. There is no durable marker that separates
    // old default-private rows from explicit private rows, so do not widen
    // historical access in a migration.
    {
      version: 18,
      sql: {},
    },
  ],
  { table: "design_migrations" },
);
