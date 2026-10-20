// Created by a migration in server/plugins/db.ts. Hosted request paths never
// run DDL, so the statements live here and the migration list pastes them.
export const CONTENT_METRICS_MIGRATION_SQL = [
  `CREATE TABLE IF NOT EXISTS analytics_content_collections (
    tenant_key TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    enabled BOOLEAN NOT NULL DEFAULT false,
    config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT now(),
    updated_at TEXT NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS analytics_content_items (
    id TEXT PRIMARY KEY,
    tenant_key TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    url TEXT,
    title TEXT,
    author TEXT,
    authors TEXT NOT NULL DEFAULT '[]',
    published_at TEXT,
    relevance TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    first_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS analytics_content_items_key_idx ON analytics_content_items (tenant_key, source, external_id)`,
  `CREATE INDEX IF NOT EXISTS analytics_content_items_published_idx ON analytics_content_items (tenant_key, published_at)`,
  `CREATE TABLE IF NOT EXISTS analytics_content_metric_snapshots (
    id TEXT PRIMARY KEY,
    tenant_key TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    item_id TEXT NOT NULL,
    metric_date TEXT NOT NULL,
    metric TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    source TEXT NOT NULL,
    run_id TEXT NOT NULL,
    collected_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS analytics_content_metric_snapshots_key_idx ON analytics_content_metric_snapshots (tenant_key, item_id, metric_date, metric)`,
  `CREATE INDEX IF NOT EXISTS analytics_content_metric_snapshots_date_idx ON analytics_content_metric_snapshots (tenant_key, metric_date)`,
  `CREATE TABLE IF NOT EXISTS analytics_content_collection_runs (
    id TEXT PRIMARY KEY,
    tenant_key TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    step TEXT NOT NULL,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    window_start TEXT,
    window_end TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    row_count INTEGER,
    bytes_processed BIGINT,
    bytes_cap BIGINT,
    cost_usd DOUBLE PRECISION,
    error_code TEXT,
    error_message TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS analytics_content_collection_runs_step_idx ON analytics_content_collection_runs (tenant_key, step, started_at)`,
];

export const CONTENT_COVERAGE_CONFIG_MIGRATION_SQL = `ALTER TABLE analytics_content_collection_runs ADD COLUMN IF NOT EXISTS config_fingerprint TEXT`;
