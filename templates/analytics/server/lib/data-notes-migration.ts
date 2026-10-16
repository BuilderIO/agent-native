// Kept apart from the store so the database plugin can import it without
// loading the Drizzle schema at boot.
export const DATA_NOTES_MIGRATION_SQL = [
  `CREATE TABLE IF NOT EXISTS analytics_data_notes (
    id TEXT PRIMARY KEY,
    org_id TEXT,
    owner_email TEXT NOT NULL,
    kind VARCHAR(16) NOT NULL,
    title VARCHAR(120) NOT NULL,
    note VARCHAR(1000) NOT NULL,
    start_date VARCHAR(10),
    end_date VARCHAR(10),
    status VARCHAR(8) NOT NULL DEFAULT 'open',
    fix VARCHAR(500),
    match_events TEXT NOT NULL DEFAULT '[]',
    unless_events TEXT NOT NULL DEFAULT '[]',
    panels TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  )`,
  `CREATE INDEX IF NOT EXISTS analytics_data_notes_org_idx
    ON analytics_data_notes (org_id)`,
];
