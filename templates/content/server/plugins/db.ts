import { defineNitroPlugin } from "@agent-native/core";
import { createClient } from "@libsql/client";

const MIGRATIONS = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    workspace TEXT NOT NULL,
    project TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    published_at TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  },
];

export default defineNitroPlugin(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) return; // No DB configured - content works file-only by default

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
