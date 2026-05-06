import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS image_libraries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    style_brief TEXT NOT NULL DEFAULT '{}',
    settings TEXT NOT NULL DEFAULT '{}',
    canonical_logo_asset_id TEXT,
    cover_asset_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS image_library_shares (
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
      sql: `CREATE TABLE IF NOT EXISTS image_collections (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'style-only',
    style_brief TEXT NOT NULL DEFAULT '{}',
    prompt_template TEXT,
    default_aspect_ratio TEXT NOT NULL DEFAULT '16:9',
    default_image_size TEXT NOT NULL DEFAULT '2K',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    },
    {
      version: 4,
      sql: `CREATE TABLE IF NOT EXISTS image_assets (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    collection_id TEXT,
    role TEXT NOT NULL DEFAULT 'generated',
    status TEXT NOT NULL DEFAULT 'candidate',
    title TEXT,
    alt_text TEXT,
    prompt TEXT,
    model TEXT,
    aspect_ratio TEXT,
    image_size TEXT,
    mime_type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    size_bytes INTEGER,
    object_key TEXT NOT NULL,
    thumbnail_object_key TEXT,
    source_url TEXT,
    generation_run_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    },
    {
      version: 5,
      sql: `CREATE TABLE IF NOT EXISTS image_generation_runs (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    collection_id TEXT,
    prompt TEXT NOT NULL,
    compiled_prompt TEXT NOT NULL,
    model TEXT NOT NULL,
    aspect_ratio TEXT NOT NULL DEFAULT '16:9',
    image_size TEXT NOT NULL DEFAULT '2K',
    grounding_mode TEXT NOT NULL DEFAULT 'auto',
    reference_asset_ids TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  )`,
    },
    // v6-v9: audit-log columns on image_generation_runs.
    // Strictly additive — never rename, never drop. Each column carries
    // identity / provenance metadata the audit-log surface filters on.
    {
      version: 6,
      sql: `ALTER TABLE image_generation_runs
            ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'chat'`,
    },
    {
      version: 7,
      sql: `ALTER TABLE image_generation_runs
            ADD COLUMN IF NOT EXISTS caller_app_id TEXT`,
    },
    {
      version: 8,
      sql: `ALTER TABLE image_generation_runs
            ADD COLUMN IF NOT EXISTS owner_email TEXT`,
    },
    {
      version: 9,
      sql: `ALTER TABLE image_generation_runs
            ADD COLUMN IF NOT EXISTS org_id TEXT`,
    },
    // v10-v12: indexes that back the audit-log queries.
    // `CREATE INDEX IF NOT EXISTS` is safe to re-run on fresh installs and
    // on existing prod DBs that already have the rows but not the indexes.
    {
      version: 10,
      sql: `CREATE INDEX IF NOT EXISTS image_generation_runs_created_at_idx
            ON image_generation_runs (created_at)`,
    },
    {
      version: 11,
      sql: `CREATE INDEX IF NOT EXISTS image_generation_runs_library_created_idx
            ON image_generation_runs (library_id, created_at)`,
    },
    {
      version: 12,
      sql: `CREATE INDEX IF NOT EXISTS image_generation_runs_caller_created_idx
            ON image_generation_runs (caller_app_id, created_at)`,
    },
  ],
  { table: "images_migrations" },
);
