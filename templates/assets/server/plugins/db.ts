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
    {
      version: 13,
      sql: `ALTER TABLE image_libraries
            ADD COLUMN IF NOT EXISTS custom_instructions TEXT NOT NULL DEFAULT ''`,
    },
    {
      version: 14,
      sql: `CREATE TABLE IF NOT EXISTS asset_folders (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    parent_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    },
    {
      version: 15,
      sql: `ALTER TABLE image_assets
            ADD COLUMN IF NOT EXISTS folder_id TEXT`,
    },
    {
      version: 16,
      sql: `ALTER TABLE image_assets
            ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image'`,
    },
    {
      version: 17,
      sql: `ALTER TABLE image_assets
            ADD COLUMN IF NOT EXISTS duration_seconds INTEGER`,
    },
    {
      version: 18,
      sql: `ALTER TABLE image_assets
            ADD COLUMN IF NOT EXISTS description TEXT`,
    },
    {
      version: 19,
      sql: `ALTER TABLE image_generation_runs
            ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image'`,
    },
    {
      version: 20,
      sql: `ALTER TABLE image_generation_runs
            ADD COLUMN IF NOT EXISTS duration_seconds INTEGER`,
    },
    {
      version: 21,
      sql: `ALTER TABLE image_generation_runs
            ADD COLUMN IF NOT EXISTS resolution TEXT`,
    },
    {
      version: 22,
      sql: `CREATE INDEX IF NOT EXISTS image_assets_library_folder_idx
            ON image_assets (library_id, folder_id)`,
    },
    {
      version: 23,
      sql: `CREATE INDEX IF NOT EXISTS image_assets_library_media_idx
            ON image_assets (library_id, media_type)`,
    },
    {
      version: 24,
      sql: `ALTER TABLE image_libraries
            ADD COLUMN IF NOT EXISTS archived_at TEXT`,
    },
    {
      version: 25,
      sql: `CREATE TABLE IF NOT EXISTS image_generation_presets (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    collection_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'style-only',
    media_type TEXT NOT NULL DEFAULT 'image',
    prompt_template TEXT,
    aspect_ratio TEXT NOT NULL DEFAULT '16:9',
    image_size TEXT NOT NULL DEFAULT '2K',
    model TEXT NOT NULL DEFAULT 'gemini-3.1-flash-image',
    text_policy TEXT NOT NULL DEFAULT '',
    reference_policy TEXT NOT NULL DEFAULT 'auto',
    settings TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    },
    {
      version: 26,
      sql: `CREATE TABLE IF NOT EXISTS image_generation_sessions (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    collection_id TEXT,
    preset_id TEXT,
    title TEXT NOT NULL,
    brief TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    active_asset_id TEXT,
    feedback_summary TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    },
    {
      version: 27,
      sql: `CREATE TABLE IF NOT EXISTS image_generation_session_items (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    asset_id TEXT,
    generation_run_id TEXT,
    role TEXT NOT NULL DEFAULT 'candidate',
    note TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    },
    {
      version: 28,
      sql: `CREATE INDEX IF NOT EXISTS image_generation_presets_library_idx
            ON image_generation_presets (library_id, sort_order, updated_at)`,
    },
    {
      version: 29,
      sql: `CREATE INDEX IF NOT EXISTS image_generation_sessions_library_idx
            ON image_generation_sessions (library_id, updated_at)`,
    },
    {
      version: 30,
      sql: `CREATE INDEX IF NOT EXISTS image_generation_session_items_session_idx
            ON image_generation_session_items (session_id, sort_order, created_at)`,
    },
    {
      version: 31,
      sql: `ALTER TABLE image_generation_runs
            ADD COLUMN IF NOT EXISTS preset_id TEXT`,
    },
    {
      version: 32,
      sql: `ALTER TABLE image_generation_runs
            ADD COLUMN IF NOT EXISTS session_id TEXT`,
    },
    // v33: indexes that back access-scoped library reads.
    // - `image_library_shares` had no index; the shares lookup in
    //   `accessFilter` probes (resource_id, principal_type, principal_id).
    // - `image_libraries` list (`list-libraries`) filters by owner/org via
    //   `accessFilter` and orders by `updated_at`; the matching composite
    //   index avoids a full table scan + sort on large accounts.
    // Plain `CREATE INDEX IF NOT EXISTS` (no DESC/partial/PG-only syntax) so it
    // runs on both Postgres and SQLite and is safe to re-run.
    {
      version: 33,
      sql: `CREATE INDEX IF NOT EXISTS image_library_shares_resource_principal_idx
            ON image_library_shares (resource_id, principal_type, principal_id);
            CREATE INDEX IF NOT EXISTS image_libraries_owner_org_updated_idx
            ON image_libraries (owner_email, org_id, updated_at)`,
    },
  ],
  // Preserve the legacy migration table name so existing Images deployments do
  // not rerun historical additive migrations after the app slug becomes Assets.
  { table: "images_migrations" },
);
