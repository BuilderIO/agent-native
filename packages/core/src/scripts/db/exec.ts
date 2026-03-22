/**
 * Core script: db-exec
 *
 * Execute a write SQL statement (INSERT, UPDATE, DELETE, etc.)
 * against a SQLite database.
 *
 * Usage:
 *   pnpm script db-exec --sql "UPDATE forms SET status='published' WHERE id='abc'" [--db path]
 */

import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { parseArgs, fail } from "../utils.js";

export default async function dbExec(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm script db-exec --sql "<statement>" [options]

Options:
  --sql <stmt>    SQL statement to execute (required)
  --db <path>     Path to SQLite database (default: data/app.db)
  --format json   Output as JSON
  --help          Show this help message`);
    return;
  }

  const sql = parsed.sql;
  if (!sql) {
    fail(
      "--sql is required. Example: --sql \"UPDATE forms SET status='published' WHERE id='abc'\"",
    );
  }

  // Block SELECT — use db-query for reads
  const trimmed = sql.trim().toUpperCase();
  if (trimmed.startsWith("SELECT") || trimmed.startsWith("WITH")) {
    fail("Use db-query for SELECT statements. db-exec is for writes only.");
  }

  const dbPath = parsed.db || path.join(process.cwd(), "data", "app.db");

  if (!fs.existsSync(dbPath)) {
    fail(`Database not found at ${dbPath}`);
  }

  const db = new Database(dbPath);

  try {
    const result = db.prepare(sql).run();

    if (parsed.format === "json") {
      console.log(
        JSON.stringify(
          {
            sql,
            changes: result.changes,
            lastInsertRowid: Number(result.lastInsertRowid),
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(`Executed: ${sql}`);
    console.log(`Changes: ${result.changes}`);
    if (result.lastInsertRowid && result.changes > 0) {
      console.log(`Last Insert Row ID: ${result.lastInsertRowid}`);
    }
  } finally {
    db.close();
  }
}
