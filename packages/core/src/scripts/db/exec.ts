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
import { createClient } from "@libsql/client";
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

  // Allowlist: only permit DML statements the agent should run
  const stripped = sql
    .replace(/^\s*--[^\n]*\n/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
  const upper = stripped.toUpperCase();
  const allowed = ["INSERT", "UPDATE", "DELETE", "REPLACE", "CREATE", "ALTER"];
  const blocked = ["SELECT", "WITH", "EXPLAIN", "PRAGMA"];

  if (blocked.some((kw) => upper.startsWith(kw))) {
    fail(
      "Use db-query for SELECT/read statements. db-exec is for writes only.",
    );
  }
  if (!allowed.some((kw) => upper.startsWith(kw))) {
    fail(
      `Only ${allowed.join(", ")} statements are allowed. ` +
        `Dangerous operations like DROP, ATTACH, VACUUM, and DETACH are blocked.`,
    );
  }

  // Resolve database URL: --db flag → DATABASE_URL env → default file path
  let url: string;
  if (parsed.db) {
    url = "file:" + path.resolve(parsed.db);
  } else if (process.env.DATABASE_URL) {
    url = process.env.DATABASE_URL;
  } else {
    url = "file:" + path.resolve(process.cwd(), "data", "app.db");
  }

  const client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });

  try {
    // Detect if the SQL has a RETURNING clause — those produce rows
    const hasReturning = /\bRETURNING\b/i.test(stripped);

    const result = await client.execute(sql);

    if (hasReturning && result.rows.length > 0) {
      const rows: Record<string, unknown>[] = result.rows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < result.columns.length; i++) {
          obj[result.columns[i]] = row[i];
        }
        return obj;
      });

      if (parsed.format === "json") {
        console.log(JSON.stringify({ sql, rows, count: rows.length }, null, 2));
        return;
      }
      console.log(`Executed: ${sql}`);
      console.log(`Returned ${rows.length} row(s):`);
      if (rows.length > 0) {
        console.log(JSON.stringify(rows, null, 2));
      }
    } else {
      if (parsed.format === "json") {
        console.log(
          JSON.stringify(
            {
              sql,
              changes: result.rowsAffected,
              lastInsertRowid: Number(result.lastInsertRowid ?? 0),
            },
            null,
            2,
          ),
        );
        return;
      }
      console.log(`Executed: ${sql}`);
      console.log(`Changes: ${result.rowsAffected}`);
      if (result.lastInsertRowid && result.rowsAffected > 0) {
        console.log(`Last Insert Row ID: ${result.lastInsertRowid}`);
      }
    }
  } finally {
    client.close();
  }
}
