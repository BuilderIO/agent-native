/** One row per pre-built-in copy the deploy pass checked, hidden or kept. */
export const BUILTIN_DASHBOARD_CHECKS_MIGRATION_SQL = [
  `CREATE TABLE IF NOT EXISTS analytics_builtin_dashboard_checks (
    dashboard_id TEXT PRIMARY KEY,
    builtin_id TEXT NOT NULL,
    outcome VARCHAR(8) NOT NULL,
    reasons TEXT NOT NULL DEFAULT '[]',
    owner_email TEXT NOT NULL,
    org_id TEXT,
    row_updated_at TEXT NOT NULL,
    checked_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    restored_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS analytics_builtin_dashboard_checks_outcome_idx
    ON analytics_builtin_dashboard_checks (outcome)`,
];
