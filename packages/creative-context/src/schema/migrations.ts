export interface CreativeContextMigration {
  version: number;
  name: string;
  sql: string | { postgres?: string; sqlite?: string };
}

export const creativeContextMigrations: CreativeContextMigration[] = [
  {
    version: 1,
    name: "creative-context-foundation",
    sql: `
      CREATE TABLE IF NOT EXISTS creative_context_sources (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
        external_ref TEXT, connection_id TEXT, container_owner_verified_at TEXT,
        config TEXT NOT NULL DEFAULT '{}',
        upstream_access TEXT NOT NULL DEFAULT 'unknown', status TEXT NOT NULL DEFAULT 'active',
        health_status TEXT NOT NULL DEFAULT 'stale',
        sync_cursor TEXT, item_count INTEGER NOT NULL DEFAULT 0,
        restricted_item_count INTEGER NOT NULL DEFAULT 0, last_synced_at TEXT, last_error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        owner_email TEXT NOT NULL DEFAULT 'local@localhost', org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      );
      CREATE TABLE IF NOT EXISTS creative_context_source_shares (
        id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer',
        created_by TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS creative_context_source_audit (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, operation TEXT NOT NULL,
        actor_email TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_items (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, external_id TEXT NOT NULL,
        kind TEXT NOT NULL, title TEXT NOT NULL, canonical_url TEXT, mime_type TEXT,
        current_version_id TEXT NOT NULL, current_content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active', upstream_access TEXT NOT NULL DEFAULT 'unknown',
        curation_status TEXT NOT NULL DEFAULT 'review', curation_rank TEXT NOT NULL DEFAULT 'normal',
        starred INTEGER NOT NULL DEFAULT 0, inventory_state TEXT NOT NULL DEFAULT 'discovered',
        index_state TEXT NOT NULL DEFAULT 'pending', tags TEXT NOT NULL DEFAULT '[]',
        colors TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0, parent_item_id TEXT,
        provenance TEXT NOT NULL DEFAULT '{}', thumbnail_blob_ref TEXT,
        metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_item_versions (
        id TEXT PRIMARY KEY, item_id TEXT NOT NULL, version_number INTEGER NOT NULL,
        content_hash TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, summary TEXT,
        mime_type TEXT, source_modified_at TEXT, source_version TEXT, raw_snapshot_blob_ref TEXT,
        parse_status TEXT NOT NULL DEFAULT 'parsed', parse_error TEXT,
        metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_chunks (
        id TEXT PRIMARY KEY, item_id TEXT NOT NULL, item_version_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'text', text TEXT NOT NULL,
        start_offset INTEGER, end_offset INTEGER, token_count INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_media (
        id TEXT PRIMARY KEY, item_id TEXT NOT NULL, item_version_id TEXT NOT NULL,
        kind TEXT NOT NULL, mime_type TEXT, access_mode TEXT NOT NULL DEFAULT 'public',
        url TEXT, storage_key TEXT, provenance_url TEXT, alt_text TEXT, caption TEXT,
        caption_status TEXT NOT NULL DEFAULT 'pending', ocr_text TEXT,
        palette TEXT NOT NULL DEFAULT '[]', content_hash TEXT,
        width INTEGER, height INTEGER, duration_ms INTEGER, metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_edges (
        id TEXT PRIMARY KEY, from_item_id TEXT NOT NULL, from_item_version_id TEXT NOT NULL,
        to_item_id TEXT, to_item_version_id TEXT, to_external_id TEXT, relation TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_brand_profiles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, current_dna_version_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        owner_email TEXT NOT NULL DEFAULT 'local@localhost', org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      );
      CREATE TABLE IF NOT EXISTS creative_context_brand_profile_shares (
        id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer',
        created_by TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS creative_context_brand_profile_audit (
        id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, operation TEXT NOT NULL,
        actor_email TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_brand_dna_versions (
        id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, version_number INTEGER NOT NULL,
        payload TEXT NOT NULL, content_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL, owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_brand_dna_evidence (
        id TEXT PRIMARY KEY, dna_version_id TEXT NOT NULL, item_id TEXT NOT NULL,
        item_version_id TEXT NOT NULL, created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_embedding_sets (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, family TEXT NOT NULL,
        model TEXT NOT NULL, version TEXT NOT NULL,
        dimensions INTEGER NOT NULL, metric TEXT NOT NULL DEFAULT 'cosine',
        status TEXT NOT NULL DEFAULT 'active', metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_embeddings (
        id TEXT PRIMARY KEY, embedding_set_id TEXT NOT NULL, family TEXT NOT NULL,
        model TEXT NOT NULL, version TEXT NOT NULL, item_id TEXT NOT NULL,
        item_version_id TEXT NOT NULL, chunk_id TEXT, target_type TEXT NOT NULL,
        target_id TEXT NOT NULL, vector_key TEXT NOT NULL,
        dimensions INTEGER NOT NULL, checksum TEXT, created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_packs (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, derived_from_pack_id TEXT,
        brand_dna_version_id TEXT, context_mode TEXT NOT NULL DEFAULT 'manual',
        request TEXT NOT NULL DEFAULT '{}', archived_at TEXT, created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL DEFAULT 'local@localhost', org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      );
      CREATE TABLE IF NOT EXISTS creative_context_pack_shares (
        id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer',
        created_by TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS creative_context_pack_members (
        id TEXT PRIMARY KEY, pack_id TEXT NOT NULL, item_id TEXT NOT NULL,
        item_version_id TEXT NOT NULL, ordinal INTEGER NOT NULL, reason TEXT, score REAL,
        score_metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_pack_pins (
        id TEXT PRIMARY KEY, pack_id TEXT NOT NULL, created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_jobs (
        id TEXT PRIMARY KEY, source_id TEXT, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
        mode TEXT, progress_current INTEGER NOT NULL DEFAULT 0, progress_total INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_token TEXT, lease_expires_at TEXT,
        next_resume_at TEXT, budget TEXT, checkpoint TEXT, request TEXT NOT NULL DEFAULT '{}', result TEXT, error TEXT,
        created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT,
        owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_feedback (
        id TEXT PRIMARY KEY, item_id TEXT NOT NULL, item_version_id TEXT NOT NULL,
        signal TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_suggestions (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed',
        profile_id TEXT, item_id TEXT NOT NULL, item_version_id TEXT NOT NULL,
        reason TEXT, payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE TABLE IF NOT EXISTS creative_context_generation_records (
        id TEXT PRIMARY KEY, app_id TEXT NOT NULL, artifact_type TEXT NOT NULL,
        artifact_id TEXT NOT NULL, context_mode TEXT NOT NULL, context_pack_id TEXT,
        element_provenance TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL, org_id TEXT
      );
    `,
  },
  {
    version: 2,
    name: "creative-context-hot-path-indexes",
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS creative_context_items_source_external_uidx
        ON creative_context_items (source_id, external_id);
      CREATE UNIQUE INDEX IF NOT EXISTS creative_context_versions_item_number_uidx
        ON creative_context_item_versions (item_id, version_number);
      CREATE UNIQUE INDEX IF NOT EXISTS creative_context_chunks_version_ordinal_uidx
        ON creative_context_chunks (item_version_id, ordinal);
      CREATE UNIQUE INDEX IF NOT EXISTS creative_context_dna_profile_version_uidx
        ON creative_context_brand_dna_versions (profile_id, version_number);
      CREATE UNIQUE INDEX IF NOT EXISTS creative_context_pack_members_pack_item_uidx
        ON creative_context_pack_members (pack_id, item_id);
      CREATE UNIQUE INDEX IF NOT EXISTS creative_context_pack_pins_pack_owner_uidx
        ON creative_context_pack_pins (pack_id, owner_email);
      CREATE UNIQUE INDEX IF NOT EXISTS creative_context_embeddings_target_uidx
        ON creative_context_embeddings (embedding_set_id, target_type, target_id);
      CREATE INDEX IF NOT EXISTS creative_context_sources_owner_org_updated_idx
        ON creative_context_sources (owner_email, org_id, updated_at);
      CREATE INDEX IF NOT EXISTS creative_context_source_shares_lookup_idx
        ON creative_context_source_shares (resource_id, principal_type, principal_id);
      CREATE INDEX IF NOT EXISTS creative_context_items_source_state_idx
        ON creative_context_items (source_id, upstream_access, curation_status);
      CREATE INDEX IF NOT EXISTS creative_context_versions_item_created_idx
        ON creative_context_item_versions (item_id, created_at);
      CREATE INDEX IF NOT EXISTS creative_context_chunks_item_version_idx
        ON creative_context_chunks (item_id, item_version_id);
      CREATE INDEX IF NOT EXISTS creative_context_media_item_version_idx
        ON creative_context_media (item_id, item_version_id);
      CREATE INDEX IF NOT EXISTS creative_context_media_content_hash_idx
        ON creative_context_media (content_hash);
      CREATE INDEX IF NOT EXISTS creative_context_edges_from_version_idx
        ON creative_context_edges (from_item_id, from_item_version_id);
      CREATE INDEX IF NOT EXISTS creative_context_brand_profiles_owner_org_updated_idx
        ON creative_context_brand_profiles (owner_email, org_id, updated_at);
      CREATE INDEX IF NOT EXISTS creative_context_brand_profile_shares_lookup_idx
        ON creative_context_brand_profile_shares (resource_id, principal_type, principal_id);
      CREATE INDEX IF NOT EXISTS creative_context_dna_evidence_version_idx
        ON creative_context_brand_dna_evidence (dna_version_id, item_version_id);
      CREATE INDEX IF NOT EXISTS creative_context_embeddings_set_version_idx
        ON creative_context_embeddings (embedding_set_id, item_version_id);
      CREATE INDEX IF NOT EXISTS creative_context_packs_owner_org_created_idx
        ON creative_context_packs (owner_email, org_id, created_at);
      CREATE INDEX IF NOT EXISTS creative_context_pack_shares_lookup_idx
        ON creative_context_pack_shares (resource_id, principal_type, principal_id);
      CREATE INDEX IF NOT EXISTS creative_context_pack_members_pack_ordinal_idx
        ON creative_context_pack_members (pack_id, ordinal);
      CREATE INDEX IF NOT EXISTS creative_context_jobs_status_lease_idx
        ON creative_context_jobs (status, next_resume_at, lease_expires_at);
      CREATE INDEX IF NOT EXISTS creative_context_jobs_owner_created_idx
        ON creative_context_jobs (owner_email, org_id, created_at);
      CREATE INDEX IF NOT EXISTS creative_context_suggestions_owner_status_idx
        ON creative_context_suggestions (owner_email, status, created_at);
      CREATE INDEX IF NOT EXISTS creative_context_generation_artifact_idx
        ON creative_context_generation_records (app_id, artifact_type, artifact_id, created_at);
    `,
  },
  {
    version: 3,
    name: "creative-context-brand-profile-audit",
    sql: `
      CREATE TABLE IF NOT EXISTS creative_context_brand_profile_audit (
        id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, operation TEXT NOT NULL,
        actor_email TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        owner_email TEXT NOT NULL, org_id TEXT
      );
      CREATE INDEX IF NOT EXISTS creative_context_brand_profile_audit_lookup_idx
        ON creative_context_brand_profile_audit (profile_id, created_at);
    `,
  },
  {
    version: 4,
    name: "creative-context-job-deduplication",
    sql: `
      ALTER TABLE creative_context_jobs ADD COLUMN dedupe_key TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS creative_context_jobs_dedupe_uidx
        ON creative_context_jobs (dedupe_key);
    `,
  },
  {
    version: 5,
    name: "creative-context-tenant-job-deduplication",
    sql: `
      ALTER TABLE creative_context_jobs ADD COLUMN dedupe_scope TEXT;
      ALTER TABLE creative_context_jobs ADD COLUMN scoped_dedupe_key TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS creative_context_jobs_scoped_dedupe_uidx
        ON creative_context_jobs (dedupe_scope, scoped_dedupe_key);
    `,
  },
];
