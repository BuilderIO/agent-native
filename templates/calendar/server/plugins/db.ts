import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
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
    sql: `ALTER TABLE booking_links ADD COLUMN durations TEXT`,
  },
]);
