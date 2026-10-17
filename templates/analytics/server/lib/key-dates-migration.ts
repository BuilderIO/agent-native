// Kept apart from the store so the database plugin can import it without
// loading the Drizzle schema at boot.
export const KEY_DATES_MIGRATION_SQL = [
  `CREATE TABLE IF NOT EXISTS analytics_key_date_sets (
    id TEXT PRIMARY KEY,
    org_id TEXT,
    owner_email TEXT NOT NULL,
    name VARCHAR(80) NOT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  )`,
  `CREATE INDEX IF NOT EXISTS analytics_key_date_sets_org_idx
    ON analytics_key_date_sets (org_id)`,
  `CREATE TABLE IF NOT EXISTS analytics_key_dates (
    id TEXT PRIMARY KEY,
    set_id TEXT NOT NULL,
    org_id TEXT,
    owner_email TEXT NOT NULL,
    date VARCHAR(10) NOT NULL,
    time VARCHAR(5),
    time_zone VARCHAR(64),
    label VARCHAR(120) NOT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  )`,
  `CREATE INDEX IF NOT EXISTS analytics_key_dates_set_idx
    ON analytics_key_dates (set_id, date)`,
  `CREATE INDEX IF NOT EXISTS analytics_key_dates_org_idx
    ON analytics_key_dates (org_id)`,
];
