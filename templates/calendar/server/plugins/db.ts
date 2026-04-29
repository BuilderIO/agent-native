import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    slug TEXT NOT NULL,
    event_title TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'cancelled')),
    created_at TEXT NOT NULL
  )`,
  },
  {
    version: 2,
    sql: `CREATE TABLE IF NOT EXISTS booking_links (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    duration INTEGER NOT NULL DEFAULT 30,
    color TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  },
  {
    version: 3,
    sql: `ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS durations TEXT`,
  },
  {
    version: 4,
    sql: `ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS custom_fields TEXT`,
  },
  {
    version: 5,
    sql: `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS field_responses TEXT`,
  },
  {
    version: 6,
    sql: `ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS conferencing TEXT`,
  },
  {
    version: 7,
    sql: `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS meeting_link TEXT`,
  },
  {
    version: 8,
    sql: `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancel_token TEXT`,
  },
  {
    version: 9,
    sql: `CREATE TABLE IF NOT EXISTS booking_slug_redirects (
    old_slug TEXT PRIMARY KEY,
    new_slug TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  },
  // v10-v12: sharing columns for booking_links.
  {
    version: 10,
    sql: `ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
  },
  {
    version: 11,
    sql: `ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS org_id TEXT`,
  },
  {
    version: 12,
    sql: `ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`,
  },
  // v13: companion shares table for per-principal grants.
  {
    version: 13,
    sql: `CREATE TABLE IF NOT EXISTS booking_link_shares (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  },
  // v14: on Postgres, `is_active` was originally created as INTEGER (v2's
  // `INTEGER NOT NULL DEFAULT 1` got adapted to BIGINT). The Drizzle schema
  // maps `integer({mode: "boolean"})` to BOOLEAN on Postgres, so inserts pass
  // `true`/`false`, which BIGINT rejects. Coerce to BOOLEAN on Postgres only;
  // SQLite keeps is_active as INTEGER 0/1 and needs no migration.
  {
    version: 14,
    sql: {
      postgres: `
        ALTER TABLE booking_links ALTER COLUMN is_active DROP DEFAULT;
        ALTER TABLE booking_links ALTER COLUMN is_active TYPE boolean USING (is_active::int != 0);
        ALTER TABLE booking_links ALTER COLUMN is_active SET DEFAULT true;
      `,
    },
  },
], { table: "calendar_migrations" });
