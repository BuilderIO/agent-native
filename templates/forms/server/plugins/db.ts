import { defineNitroPlugin } from "@agent-native/core";
import { createClient } from "@libsql/client";

const MIGRATIONS = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS forms (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    slug TEXT NOT NULL UNIQUE,
    fields TEXT NOT NULL,
    settings TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  },
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS responses (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL REFERENCES forms(id),
    data TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    ip TEXT
  )`,
  },
];

export default defineNitroPlugin(async () => {
  const url = process.env.DATABASE_URL || "file:./data/app.db";
  const client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });

  // Ensure data directory exists for local file DBs
  if (url.startsWith("file:")) {
    const fs = await import("fs");
    const path = await import("path");
    fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
  }

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
