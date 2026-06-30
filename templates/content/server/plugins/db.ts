import { runMigrations } from "@agent-native/core/db";

import { repairUnseededBlocksFields } from "../../actions/_property-utils.js";

function scheduleBlocksRepairRetry(attempt = 1): void {
  const delayMs = Math.min(30_000 * attempt, 5 * 60_000);
  const timeout = setTimeout(() => {
    repairUnseededBlocksFields().catch(() => {
      if (attempt < 5) scheduleBlocksRepairRetry(attempt + 1);
    });
  }, delayMs);
  if (typeof timeout === "object" && "unref" in timeout) {
    timeout.unref();
  }
}

const runContentMigrations = runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      parent_id TEXT,
      title TEXT NOT NULL DEFAULT 'Untitled',
      content TEXT NOT NULL DEFAULT '',
      icon TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      hide_from_search INTEGER NOT NULL DEFAULT 0,
      source_mode TEXT,
      source_kind TEXT,
      source_path TEXT,
      source_root_path TEXT,
      source_updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS document_sync_links (
      document_id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      provider TEXT NOT NULL DEFAULT 'notion',
      remote_page_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'linked',
      last_synced_at TEXT,
      last_pulled_remote_updated_at TEXT,
      last_pushed_local_updated_at TEXT,
      last_known_remote_updated_at TEXT,
      last_synced_content_hash TEXT,
      last_error TEXT,
      warnings_json TEXT,
      has_conflict INTEGER NOT NULL DEFAULT 0,
      sync_comments INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 3,
      sql: `CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      document_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 4,
      sql: `CREATE TABLE IF NOT EXISTS document_comments (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      document_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      parent_id TEXT,
      content TEXT NOT NULL,
      quoted_text TEXT,
      author_email TEXT NOT NULL,
      author_name TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      notion_comment_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    // v5-v8: add owner_email to tables that may have been created before the
    // column was part of the initial CREATE TABLE (v1-v4 now include it, but
    // databases created with older schema versions still need the ALTER).
    {
      version: 5,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
    },
    {
      version: 6,
      sql: `ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
    },
    {
      version: 7,
      sql: `ALTER TABLE document_sync_links ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
    },
    {
      version: 8,
      sql: `ALTER TABLE document_comments ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
    },
    {
      version: 9,
      // guard:allow-localhost-fallback — one-time migration backfilling the dev-mode owner on legacy rows that pre-date ownableColumns; runs once at boot, not per-request
      sql: `UPDATE documents SET owner_email = 'local@localhost' WHERE owner_email IS NULL OR owner_email = ''`,
    },
    {
      version: 10,
      // guard:allow-localhost-fallback — one-time migration backfilling legacy null owner_email values for dev-mode upgrade path
      sql: `UPDATE document_versions SET owner_email = 'local@localhost' WHERE owner_email IS NULL OR owner_email = ''`,
    },
    {
      version: 11,
      // guard:allow-localhost-fallback — one-time migration backfilling legacy null owner_email values for dev-mode upgrade path
      sql: `UPDATE document_sync_links SET owner_email = 'local@localhost' WHERE owner_email IS NULL OR owner_email = ''`,
    },
    {
      version: 12,
      // guard:allow-localhost-fallback — one-time migration backfilling legacy null owner_email values for dev-mode upgrade path
      sql: `UPDATE document_comments SET owner_email = 'local@localhost' WHERE owner_email IS NULL OR owner_email = ''`,
    },
    // v13-v14: add sharing columns (org_id, visibility) to documents.
    {
      version: 13,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS org_id TEXT`,
    },
    {
      version: 14,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`,
    },
    // v15: companion shares table for per-principal grants.
    {
      version: 15,
      sql: `CREATE TABLE IF NOT EXISTS document_shares (
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
      version: 16,
      sql: `ALTER TABLE document_sync_links ADD COLUMN IF NOT EXISTS sync_comments INTEGER NOT NULL DEFAULT 0`,
    },
    {
      version: 17,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS hide_from_search INTEGER NOT NULL DEFAULT 0`,
    },
    // v18: content-hash baseline for drift-free conflict detection.
    {
      version: 18,
      sql: `ALTER TABLE document_sync_links ADD COLUMN IF NOT EXISTS last_synced_content_hash TEXT`,
    },
    {
      version: 19,
      sql: `CREATE TABLE IF NOT EXISTS document_property_definitions (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      database_id TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'always_show',
      options_json TEXT NOT NULL DEFAULT '{}',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 20,
      sql: `CREATE TABLE IF NOT EXISTS document_property_values (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      document_id TEXT NOT NULL,
      property_id TEXT NOT NULL,
      value_json TEXT NOT NULL DEFAULT 'null',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 21,
      sql: `ALTER TABLE document_property_definitions ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'always_show'`,
    },
    {
      version: 22,
      sql: `ALTER TABLE document_property_definitions ADD COLUMN IF NOT EXISTS database_id TEXT`,
    },
    {
      version: 23,
      sql: `CREATE TABLE IF NOT EXISTS content_databases (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      document_id TEXT NOT NULL,
      owner_document_id TEXT,
      owner_block_id TEXT,
      title TEXT NOT NULL DEFAULT 'Untitled database',
      view_config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 24,
      sql: `CREATE TABLE IF NOT EXISTS content_database_items (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      database_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 25,
      sql: `ALTER TABLE content_databases ADD COLUMN IF NOT EXISTS view_config_json TEXT NOT NULL DEFAULT '{}'`,
    },
    // v26 repeats v18 idempotently for databases that previously ran this
    // feature branch's old v18 property migration before merging main.
    {
      version: 26,
      sql: `ALTER TABLE document_sync_links ADD COLUMN IF NOT EXISTS last_synced_content_hash TEXT`,
    },
    // v27: performance indexes. The list/tree path filters documents by owner +
    // org and orders by position/updated_at, walks the tree via parent_id, and
    // resolves per-principal grants from document_shares — none of which had any
    // index. Plain CREATE INDEX IF NOT EXISTS so the same DDL applies on both
    // SQLite/libsql and Postgres (no DESC, partial, or PG-only syntax).
    {
      version: 27,
      sql: `CREATE INDEX IF NOT EXISTS documents_owner_org_updated_idx ON documents (owner_email, org_id, updated_at);
        CREATE INDEX IF NOT EXISTS documents_parent_idx ON documents (parent_id);
        CREATE INDEX IF NOT EXISTS document_shares_resource_idx ON document_shares (resource_id, principal_type, principal_id)`,
    },
    // v28-v31: robust text-anchor + @mention metadata for document comments.
    {
      version: 28,
      sql: `ALTER TABLE document_comments ADD COLUMN IF NOT EXISTS anchor_prefix TEXT`,
    },
    {
      version: 29,
      sql: `ALTER TABLE document_comments ADD COLUMN IF NOT EXISTS anchor_suffix TEXT`,
    },
    {
      version: 30,
      sql: `ALTER TABLE document_comments ADD COLUMN IF NOT EXISTS anchor_start_offset INTEGER`,
    },
    {
      version: 31,
      sql: `ALTER TABLE document_comments ADD COLUMN IF NOT EXISTS mentions_json TEXT`,
    },
    // v32-v36: source metadata for database-mode local Markdown imports.
    {
      version: 32,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_mode TEXT`,
    },
    {
      version: 33,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_kind TEXT`,
    },
    {
      version: 34,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_path TEXT`,
    },
    {
      version: 35,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_root_path TEXT`,
    },
    {
      version: 36,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_updated_at TEXT`,
    },
    // v37-v45: source-aware Builder database foundation tables (additive).
    {
      version: 37,
      sql: `CREATE TABLE IF NOT EXISTS content_database_sources (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      database_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_table TEXT NOT NULL,
      sync_state TEXT NOT NULL DEFAULT 'linked',
      freshness TEXT NOT NULL DEFAULT 'unknown',
      capabilities_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      last_refreshed_at TEXT,
      last_source_updated_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 38,
      sql: `CREATE TABLE IF NOT EXISTS content_database_source_fields (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      source_id TEXT NOT NULL,
      property_id TEXT,
      local_field_key TEXT NOT NULL,
      source_field_key TEXT NOT NULL,
      source_field_label TEXT NOT NULL,
      source_field_type TEXT NOT NULL,
      mapping_type TEXT NOT NULL DEFAULT 'property',
      write_owner TEXT NOT NULL DEFAULT 'local',
      read_only INTEGER NOT NULL DEFAULT 0,
      provenance TEXT NOT NULL DEFAULT 'local',
      freshness TEXT NOT NULL DEFAULT 'unknown',
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 39,
      sql: `CREATE TABLE IF NOT EXISTS content_database_source_rows (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      source_id TEXT NOT NULL,
      database_item_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      source_row_id TEXT NOT NULL,
      source_qualified_id TEXT NOT NULL,
      source_display_key TEXT NOT NULL,
      source_values_json TEXT NOT NULL DEFAULT '{}',
      provenance TEXT NOT NULL DEFAULT 'source',
      sync_state TEXT NOT NULL DEFAULT 'linked',
      freshness TEXT NOT NULL DEFAULT 'unknown',
      last_synced_at TEXT,
      last_source_updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 40,
      sql: `CREATE TABLE IF NOT EXISTS content_database_source_change_sets (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      source_id TEXT NOT NULL,
      database_item_id TEXT,
      document_id TEXT,
      kind TEXT NOT NULL DEFAULT 'field_update',
      direction TEXT NOT NULL DEFAULT 'incoming',
      state TEXT NOT NULL DEFAULT 'proposed',
      push_mode TEXT,
      local_only INTEGER NOT NULL DEFAULT 1,
      summary TEXT NOT NULL,
      field_changes_json TEXT NOT NULL DEFAULT '[]',
      body_change_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 41,
      sql: `ALTER TABLE content_database_source_change_sets ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'incoming'`,
    },
    {
      version: 42,
      sql: `ALTER TABLE content_database_source_change_sets ADD COLUMN IF NOT EXISTS push_mode TEXT`,
    },
    {
      version: 43,
      sql: `ALTER TABLE content_database_source_change_sets ADD COLUMN IF NOT EXISTS local_only INTEGER NOT NULL DEFAULT 1`,
    },
    {
      version: 44,
      sql: `CREATE TABLE IF NOT EXISTS content_database_source_change_reviews (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      source_id TEXT NOT NULL,
      change_set_id TEXT NOT NULL,
      reviewer_email TEXT NOT NULL,
      decision TEXT NOT NULL,
      state_from TEXT NOT NULL,
      state_to TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 45,
      sql: `CREATE TABLE IF NOT EXISTS content_database_source_executions (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      source_id TEXT NOT NULL,
      change_set_id TEXT NOT NULL,
      adapter TEXT NOT NULL,
      push_mode TEXT NOT NULL,
      state TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 46,
      sql: `ALTER TABLE content_database_source_rows ADD COLUMN IF NOT EXISTS source_values_json TEXT NOT NULL DEFAULT '{}'`,
    },
    {
      version: 47,
      sql: `CREATE INDEX IF NOT EXISTS content_database_sources_database_idx ON content_database_sources (database_id);
        CREATE INDEX IF NOT EXISTS content_database_sources_owner_idx ON content_database_sources (owner_email);
        CREATE INDEX IF NOT EXISTS content_database_source_fields_source_idx ON content_database_source_fields (source_id);
        CREATE INDEX IF NOT EXISTS content_database_source_fields_property_idx ON content_database_source_fields (property_id);
        CREATE INDEX IF NOT EXISTS content_database_source_rows_source_idx ON content_database_source_rows (source_id);
        CREATE INDEX IF NOT EXISTS content_database_source_rows_item_idx ON content_database_source_rows (database_item_id);
        CREATE INDEX IF NOT EXISTS content_database_source_rows_document_idx ON content_database_source_rows (document_id);
        CREATE INDEX IF NOT EXISTS content_database_source_change_sets_source_idx ON content_database_source_change_sets (source_id);
        CREATE INDEX IF NOT EXISTS content_database_source_change_sets_item_idx ON content_database_source_change_sets (database_item_id);
        CREATE INDEX IF NOT EXISTS content_database_source_change_reviews_source_idx ON content_database_source_change_reviews (source_id);
        CREATE INDEX IF NOT EXISTS content_database_source_change_reviews_change_set_idx ON content_database_source_change_reviews (change_set_id);
        CREATE INDEX IF NOT EXISTS content_database_source_executions_source_idx ON content_database_source_executions (source_id);
        CREATE INDEX IF NOT EXISTS content_database_source_executions_change_set_idx ON content_database_source_executions (change_set_id);
        CREATE INDEX IF NOT EXISTS content_database_source_executions_idempotency_idx ON content_database_source_executions (idempotency_key)`,
    },
    {
      // Independent backing store for ADDITIONAL "Blocks" property fields. The
      // primary "Content" Blocks field is backed by documents.content; every
      // other Blocks field on a row stores its own content here, keyed by
      // (document_id, property_id), so no two Blocks fields ever share content.
      version: 48,
      sql: `CREATE TABLE IF NOT EXISTS document_block_field_contents (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      document_id TEXT NOT NULL,
      property_id TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 49,
      sql: `CREATE INDEX IF NOT EXISTS document_block_field_contents_document_idx ON document_block_field_contents (document_id);
        CREATE UNIQUE INDEX IF NOT EXISTS document_block_field_contents_doc_prop_idx ON document_block_field_contents (document_id, property_id)`,
    },
    // v50-v52: DB-enforced single-primary Blocks invariant. `primary_blocks_property_id`
    // is the one source of truth for which property backs `documents.content`;
    // `blocks_seeded` records that a database was seeded once, so an intentionally
    // deleted primary is never silently recreated. Both are additive and safe on
    // existing data.
    {
      version: 50,
      sql: `ALTER TABLE content_databases ADD COLUMN IF NOT EXISTS primary_blocks_property_id TEXT`,
    },
    {
      version: 51,
      sql: `ALTER TABLE content_databases ADD COLUMN IF NOT EXISTS blocks_seeded INTEGER NOT NULL DEFAULT 0`,
    },
    // v52: one-time backfill for LEGACY databases that already had a primary
    // "Content" Blocks definition (seeded by the previous read-path safety net)
    // before these columns existed. Point primary_blocks_property_id at that
    // definition and mark the database seeded. Idempotent: only fills rows that
    // are still NULL, and re-running is a no-op. Databases with NO primary
    // definition are intentionally left unseeded — the startup repair seeds them
    // exactly once via the authenticated path. The correlated subquery picks the
    // primary definition by its options JSON marker (`"primary":true`); the
    // simple `%...%` LIKE is portable across SQLite and Postgres.
    {
      version: 52,
      sql: `UPDATE content_databases
        SET primary_blocks_property_id = (
              SELECT d.id FROM document_property_definitions d
              WHERE d.database_id = content_databases.id
                AND d.type = 'blocks'
                AND d.options_json LIKE '%"primary":true%'
              LIMIT 1
            ),
            blocks_seeded = 1
        WHERE primary_blocks_property_id IS NULL
          AND EXISTS (
              SELECT 1 FROM document_property_definitions d
              WHERE d.database_id = content_databases.id
                AND d.type = 'blocks'
                AND d.options_json LIKE '%"primary":true%'
            )`,
    },
    // v53-v54: ownership metadata for inline databases. Nullable by design:
    // full-page databases and non-owning references leave these empty.
    {
      version: 53,
      sql: `ALTER TABLE content_databases ADD COLUMN IF NOT EXISTS owner_document_id TEXT`,
    },
    {
      version: 54,
      sql: `ALTER TABLE content_databases ADD COLUMN IF NOT EXISTS owner_block_id TEXT`,
    },
    // v55: soft-delete marker for inline database lifecycle. Nullable keeps
    // existing databases active; cleanup remains a later explicit path.
    {
      version: 55,
      sql: `ALTER TABLE content_databases ADD COLUMN IF NOT EXISTS deleted_at TEXT`,
    },
    // v56-v57: DB-backed Builder MDX documents keep their raw sidecar files in a
    // document-scoped cache. Local-file Builder MDX still uses in-repo sidecars
    // as the portable source of truth; these rows only make pulled SQL documents
    // round-trip through the visual editor and push validator.
    {
      version: 56,
      sql: `CREATE TABLE IF NOT EXISTS builder_doc_sidecars (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      document_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 57,
      sql: `CREATE INDEX IF NOT EXISTS builder_doc_sidecars_document_idx ON builder_doc_sidecars (document_id);
        CREATE UNIQUE INDEX IF NOT EXISTS builder_doc_sidecars_doc_path_idx ON builder_doc_sidecars (document_id, path)`,
    },
    {
      version: 58,
      sql: `ALTER TABLE content_database_items ADD COLUMN IF NOT EXISTS body_hydration_status TEXT NOT NULL DEFAULT 'hydrated';
        ALTER TABLE content_database_items ADD COLUMN IF NOT EXISTS body_hydration_attempted_at TEXT;
        ALTER TABLE content_database_items ADD COLUMN IF NOT EXISTS body_hydration_error TEXT;
        ALTER TABLE content_database_items ADD COLUMN IF NOT EXISTS body_hydration_version TEXT`,
    },
    {
      version: 59,
      sql: `CREATE TABLE IF NOT EXISTS content_database_body_hydration_queue (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      source_id TEXT NOT NULL,
      database_item_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      source_row_id TEXT NOT NULL,
      source_table TEXT NOT NULL,
      source_entry_json TEXT NOT NULL DEFAULT '{}',
      priority INTEGER NOT NULL DEFAULT 10,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempted_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 60,
      sql: `CREATE INDEX IF NOT EXISTS content_database_body_hydration_queue_source_idx ON content_database_body_hydration_queue (source_id, priority, created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS content_database_body_hydration_queue_item_idx ON content_database_body_hydration_queue (database_item_id);
        CREATE INDEX IF NOT EXISTS content_database_items_body_hydration_idx ON content_database_items (database_id, body_hydration_status)`,
    },
  ],
  { table: "content_migrations" },
);

const runContentSourceMigrations = runMigrations(
  [
    {
      version: 1,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_mode TEXT`,
    },
    {
      version: 2,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_kind TEXT`,
    },
    {
      version: 3,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_path TEXT`,
    },
    {
      version: 4,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_root_path TEXT`,
    },
    {
      version: 5,
      sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_updated_at TEXT`,
    },
  ],
  { table: "content_source_migrations" },
);

export default async function contentDatabasePlugin(
  nitroApp: Parameters<typeof runContentMigrations>[0],
) {
  await runContentMigrations(nitroApp);
  await runContentSourceMigrations(nitroApp);
  // One-time, boot-time repair: seed the primary "Content" Blocks field for any
  // legacy database that has never been seeded (blocks_seeded = 0). Idempotent —
  // the atomic claim in seedDefaultBlocksField makes re-runs no-ops, and it
  // never runs from a read path, so opening a shared/legacy row stays a pure
  // read. Failures here must not crash boot; migrations themselves succeeded.
  try {
    await repairUnseededBlocksFields();
  } catch {
    // Retry in-process so a transient boot-time repair failure does not leave
    // legacy databases without their primary Blocks field until a full reboot.
    scheduleBlocksRepairRetry();
  }
}
