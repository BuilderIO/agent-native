import { runMigrations } from "@agent-native/core/db";

/**
 * Workbench migrations are strictly ADDITIVE. Per CLAUDE.md:
 *  - never rename / drop tables or columns
 *  - never use `drizzle-kit push` against prod
 *  - never run destructive SQL in any build script
 *
 * Each table is created with `CREATE TABLE IF NOT EXISTS`, with the
 * standard `ownableColumns()` shape (`owner_email`, `org_id`, `visibility`)
 * so the access-filter helpers in `@agent-native/core/server` work out of
 * the box. Companion `*_shares` tables follow the
 * `createSharesTable` shape.
 */
export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS workbench_repos (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        owner_email TEXT NOT NULL DEFAULT 'local@localhost',
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      )`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS workbench_queue_state (
        id TEXT PRIMARY KEY,
        item_key TEXT NOT NULL,
        snoozed_until TEXT,
        dismissed_at TEXT,
        done_at TEXT,
        last_seen_at TEXT,
        owner_email TEXT NOT NULL DEFAULT 'local@localhost',
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      )`,
    },
    {
      version: 3,
      sql: `CREATE INDEX IF NOT EXISTS idx_workbench_queue_state_owner_item ON workbench_queue_state(owner_email, item_key)`,
    },
    {
      version: 4,
      sql: `CREATE TABLE IF NOT EXISTS workbench_pr_state (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        number INTEGER NOT NULL,
        last_reviewed_at TEXT,
        flags TEXT,
        owner_email TEXT NOT NULL DEFAULT 'local@localhost',
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      )`,
    },
    {
      version: 5,
      sql: `CREATE INDEX IF NOT EXISTS idx_workbench_pr_state_owner_pr ON workbench_pr_state(owner_email, owner, repo, number)`,
    },
    {
      version: 6,
      sql: `CREATE TABLE IF NOT EXISTS workbench_run_pr_links (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        pr_owner TEXT NOT NULL,
        pr_repo TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        linked_at TEXT NOT NULL DEFAULT (datetime('now')),
        owner_email TEXT NOT NULL DEFAULT 'local@localhost',
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      )`,
    },
    {
      version: 7,
      sql: `CREATE INDEX IF NOT EXISTS idx_workbench_run_pr_links_run ON workbench_run_pr_links(run_id)`,
    },
    {
      version: 8,
      sql: `CREATE INDEX IF NOT EXISTS idx_workbench_run_pr_links_pr ON workbench_run_pr_links(pr_owner, pr_repo, pr_number)`,
    },
    {
      version: 9,
      sql: `CREATE TABLE IF NOT EXISTS workbench_review_templates (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        owner_email TEXT NOT NULL DEFAULT 'local@localhost',
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      )`,
    },
    {
      version: 10,
      sql: `CREATE TABLE IF NOT EXISTS workbench_review_template_shares (
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
      version: 11,
      sql: `CREATE TABLE IF NOT EXISTS workbench_muted_types (
        id TEXT PRIMARY KEY,
        card_type TEXT NOT NULL,
        muted_at TEXT NOT NULL DEFAULT (datetime('now')),
        owner_email TEXT NOT NULL DEFAULT 'local@localhost',
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      )`,
    },
    {
      version: 12,
      sql: `CREATE INDEX IF NOT EXISTS idx_workbench_muted_types_owner_type ON workbench_muted_types(owner_email, card_type)`,
    },
    {
      version: 13,
      sql: `CREATE TABLE IF NOT EXISTS workbench_code_workspaces (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        path TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        owner_email TEXT NOT NULL DEFAULT 'local@localhost',
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      )`,
    },
    {
      version: 14,
      sql: `CREATE INDEX IF NOT EXISTS idx_workbench_code_workspaces_owner ON workbench_code_workspaces(owner_email)`,
    },
    {
      version: 15,
      sql: `CREATE TABLE IF NOT EXISTS workbench_open_files (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        opened_at TEXT NOT NULL DEFAULT (datetime('now')),
        is_active INTEGER NOT NULL DEFAULT 0,
        owner_email TEXT NOT NULL DEFAULT 'local@localhost',
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      )`,
    },
    {
      version: 16,
      sql: `CREATE INDEX IF NOT EXISTS idx_workbench_open_files_owner_workspace ON workbench_open_files(owner_email, workspace_id)`,
    },
  ],
  { table: "workbench_migrations" },
);
