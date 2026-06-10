import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  brief TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  source TEXT NOT NULL DEFAULT 'manual',
  repo_path TEXT,
  current_focus TEXT,
  html TEXT,
  markdown TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS plan_sections (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  type TEXT NOT NULL DEFAULT 'custom',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  html TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
    },
    {
      version: 3,
      sql: `CREATE TABLE IF NOT EXISTS plan_comments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  section_id TEXT REFERENCES plan_sections(id),
  kind TEXT NOT NULL DEFAULT 'comment',
  status TEXT NOT NULL DEFAULT 'open',
  anchor TEXT,
  message TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'human',
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
    },
    {
      version: 4,
      sql: `CREATE TABLE IF NOT EXISTS plan_events (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload TEXT,
  created_by TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL
)`,
    },
    {
      version: 5,
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS plan_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now())
)`,
        sqlite: `CREATE TABLE IF NOT EXISTS plan_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
      },
    },
    {
      version: 6,
      sql: `CREATE INDEX IF NOT EXISTS plans_owner_status_idx ON plans(owner_email, org_id, status, updated_at)`,
    },
    {
      version: 7,
      sql: `CREATE INDEX IF NOT EXISTS plan_sections_plan_idx ON plan_sections(plan_id, sort_order)`,
    },
    {
      version: 8,
      sql: `CREATE INDEX IF NOT EXISTS plan_comments_plan_status_idx ON plan_comments(plan_id, status, consumed_at)`,
    },
    {
      version: 9,
      sql: {
        postgres: `ALTER TABLE plans ADD COLUMN IF NOT EXISTS content TEXT`,
        sqlite: `ALTER TABLE plans ADD COLUMN content TEXT`,
      },
    },
    {
      version: 10,
      sql: {
        postgres: `ALTER TABLE plans ADD COLUMN IF NOT EXISTS hosted_plan_id TEXT`,
        sqlite: `ALTER TABLE plans ADD COLUMN hosted_plan_id TEXT`,
      },
    },
    {
      version: 11,
      sql: {
        postgres: `ALTER TABLE plans ADD COLUMN IF NOT EXISTS hosted_plan_url TEXT`,
        sqlite: `ALTER TABLE plans ADD COLUMN hosted_plan_url TEXT`,
      },
    },
    {
      version: 12,
      sql: `CREATE TABLE IF NOT EXISTS plan_guest_mints (
  id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
)`,
    },
    {
      version: 13,
      sql: `CREATE INDEX IF NOT EXISTS plan_guest_mints_ip_created_idx ON plan_guest_mints(ip_hash, created_at)`,
    },
    {
      version: 14,
      sql: `CREATE INDEX IF NOT EXISTS plans_owner_created_idx ON plans(owner_email, created_at)`,
    },
    {
      version: 15,
      sql: `ALTER TABLE plan_comments ADD COLUMN IF NOT EXISTS author_email TEXT;
ALTER TABLE plan_comments ADD COLUMN IF NOT EXISTS author_name TEXT`,
    },
    {
      version: 16,
      sql: `ALTER TABLE plan_comments ADD COLUMN IF NOT EXISTS parent_comment_id TEXT REFERENCES plan_comments(id);
CREATE INDEX IF NOT EXISTS plan_comments_parent_idx ON plan_comments(parent_comment_id)`,
    },
    {
      version: 17,
      sql: `ALTER TABLE plan_comments ADD COLUMN IF NOT EXISTS resolution_target TEXT;
ALTER TABLE plan_comments ADD COLUMN IF NOT EXISTS mentions_json TEXT;
ALTER TABLE plan_comments ADD COLUMN IF NOT EXISTS resolved_by TEXT;
ALTER TABLE plan_comments ADD COLUMN IF NOT EXISTS resolved_at TEXT;
CREATE INDEX IF NOT EXISTS plan_comments_resolution_idx ON plan_comments(plan_id, resolution_target, status, consumed_at)`,
    },
    {
      version: 18,
      sql: `CREATE TABLE IF NOT EXISTS plan_versions (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  plan_id TEXT NOT NULL REFERENCES plans(id),
  title TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  change_label TEXT,
  created_by TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_versions_plan_owner_created_idx ON plan_versions(plan_id, owner_email, created_at)`,
    },
    {
      // `kind` distinguishes read-only visual recaps from editable plans. Add it
      // with a 'plan' default, then backfill existing recaps (identified by the
      // recap-review focus the create-visual-recap action sets).
      version: 19,
      sql: {
        postgres: `ALTER TABLE plans ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'plan';
UPDATE plans SET kind = 'recap' WHERE kind = 'plan' AND current_focus = 'visual recap review'`,
        sqlite: `ALTER TABLE plans ADD COLUMN kind TEXT NOT NULL DEFAULT 'plan';
UPDATE plans SET kind = 'recap' WHERE kind = 'plan' AND current_focus = 'visual recap review'`,
      },
    },
    {
      // plan_events is an append-only log shared across every plan. loadPlanBundle
      // reads `WHERE plan_id = ? ORDER BY created_at` on each plan open, which
      // seq-scanned the whole growing table (plan_sections.plan_id and
      // plan_comments.plan_id are already covered by v7/v8/v17 composites; this
      // was the one hot-path lookup left unindexed).
      version: 20,
      sql: `CREATE INDEX IF NOT EXISTS plan_events_plan_created_idx ON plan_events(plan_id, created_at)`,
    },
    {
      // Token usage + derived cost for the LLM run that produced a recap. All
      // nullable and additive — only populated for kind="recap" rows by the PR
      // Visual Recap workflow. Cost is centicents (1/100¢), matching core's
      // token_usage.cost_cents_x100 so the two surfaces are directly comparable.
      version: 21,
      sql: {
        postgres: `ALTER TABLE plans ADD COLUMN IF NOT EXISTS usage_agent TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS usage_model TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS usage_input_tokens INTEGER;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS usage_output_tokens INTEGER;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS usage_cache_read_tokens INTEGER;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS usage_cache_write_tokens INTEGER;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS usage_cost_cents_x100 INTEGER;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS usage_cost_source TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS usage_recorded_at TEXT`,
        // SQLite has no ADD COLUMN IF NOT EXISTS; runMigrations only runs this
        // once (tracked in plans_migrations), so a plain ALTER per column is safe.
        sqlite: `ALTER TABLE plans ADD COLUMN usage_agent TEXT;
ALTER TABLE plans ADD COLUMN usage_model TEXT;
ALTER TABLE plans ADD COLUMN usage_input_tokens INTEGER;
ALTER TABLE plans ADD COLUMN usage_output_tokens INTEGER;
ALTER TABLE plans ADD COLUMN usage_cache_read_tokens INTEGER;
ALTER TABLE plans ADD COLUMN usage_cache_write_tokens INTEGER;
ALTER TABLE plans ADD COLUMN usage_cost_cents_x100 INTEGER;
ALTER TABLE plans ADD COLUMN usage_cost_source TEXT;
ALTER TABLE plans ADD COLUMN usage_recorded_at TEXT`,
      },
    },
    {
      version: 22,
      sql: `CREATE TABLE IF NOT EXISTS plan_assets (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  data TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_assets_plan_idx ON plan_assets(plan_id, created_at)`,
    },
    {
      version: 23,
      sql: `ALTER TABLE plans ADD COLUMN IF NOT EXISTS source_url TEXT`,
    },
  ],
  { table: "plans_migrations" },
);
