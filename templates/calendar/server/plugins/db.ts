import { defineNitroPlugin } from "@agent-native/core";
import { createClient } from "@libsql/client";

const MIGRATIONS = [
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
    version: 1,
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
];

export default defineNitroPlugin(async () => {
  const url = process.env.DATABASE_URL || "file:./data/app.db";
  const client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });

  // Run versioned migrations
  await client.execute(
    `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)`,
  );
  const { rows } = await client.execute(
    `SELECT MAX(version) as v FROM _migrations`,
  );
  const current = (rows[0]?.v as number) ?? 0;

  for (const m of MIGRATIONS.filter((m) => m.version > current)) {
    await client.batch([
      { sql: m.sql, args: [] },
      {
        sql: `INSERT OR IGNORE INTO _migrations VALUES (?)`,
        args: [m.version],
      },
    ]);
  }
});
