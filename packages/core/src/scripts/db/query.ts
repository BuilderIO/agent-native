/**
 * Core script: db-query
 *
 * Run a read-only SQL query against a SQLite or Postgres database.
 *
 * Usage:
 *   pnpm script db-query --sql "SELECT * FROM forms" [--db path] [--format json] [--limit N]
 */

import path from "path";
import { createClient } from "@libsql/client";
import pg from "postgres";
import { parseArgs, fail } from "../utils.js";

function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

export default async function dbQuery(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm script db-query --sql "<query>" [options]

Options:
  --sql <query>   SQL SELECT query to run (required)
  --db <path>     Path to SQLite database (default: data/app.db)
  --format json   Output as JSON instead of a table
  --limit N       Append LIMIT N if not already present
  --help          Show this help message`);
    return;
  }

  const sql = parsed.sql;
  if (!sql) {
    fail('--sql is required. Example: --sql "SELECT * FROM forms"');
  }

  // Safety: only allow read-only statements.
  // Strip leading SQL comments before checking the prefix.
  const stripped = sql
    .replace(/^\s*--[^\n]*\n/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
  const upper = stripped.toUpperCase();
  if (
    !upper.startsWith("SELECT") &&
    !upper.startsWith("WITH") &&
    !upper.startsWith("EXPLAIN") &&
    !upper.startsWith("PRAGMA")
  ) {
    fail(
      "Only SELECT, WITH, EXPLAIN, and PRAGMA queries are allowed. Use db-exec for writes.",
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

  let finalSql = sql;
  if (
    parsed.limit &&
    (upper.startsWith("SELECT") || upper.startsWith("WITH")) &&
    !/\bLIMIT\b/i.test(stripped)
  ) {
    const limitVal = parseInt(parsed.limit, 10);
    if (isNaN(limitVal) || limitVal < 1)
      fail("--limit must be a positive integer");
    finalSql = `${sql} LIMIT ${limitVal}`;
  }

  // Postgres path
  if (isPostgresUrl(url)) {
    const pgSql = pg(url);
    try {
      const result = await pgSql.unsafe(finalSql);
      const rows: Record<string, unknown>[] = Array.from(result);
      const keys = rows.length > 0 ? Object.keys(rows[0]) : [];

      if (parsed.format === "json") {
        console.log(
          JSON.stringify(
            { query: finalSql, rows, count: rows.length },
            null,
            2,
          ),
        );
        return;
      }

      // Human-readable table output
      console.log(`Query: ${finalSql}`);
      console.log(`Rows: ${rows.length}\n`);

      if (rows.length === 0) {
        console.log("(no results)");
        return;
      }

      const widths = keys.map((k) => {
        const maxVal = Math.max(
          ...rows.map((r) => String(r[k] ?? "NULL").length),
        );
        return Math.max(k.length, Math.min(maxVal, 60));
      });

      // Header
      const header = keys.map((k, i) => k.padEnd(widths[i])).join(" | ");
      console.log(header);
      console.log(widths.map((w) => "-".repeat(w)).join("-+-"));

      // Rows
      for (const row of rows) {
        const line = keys
          .map((k, i) => {
            const val = String(row[k] ?? "NULL");
            return val.length > 60
              ? val.slice(0, 57) + "..."
              : val.padEnd(widths[i]);
          })
          .join(" | ");
        console.log(line);
      }
    } finally {
      await pgSql.end();
    }
    return;
  }

  // libsql / SQLite path
  const client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });

  try {
    const result = await client.execute(finalSql);
    const rows: Record<string, unknown>[] = result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < result.columns.length; i++) {
        obj[result.columns[i]] = row[i];
      }
      return obj;
    });

    if (parsed.format === "json") {
      console.log(
        JSON.stringify({ query: finalSql, rows, count: rows.length }, null, 2),
      );
      return;
    }

    // Human-readable table output
    console.log(`Query: ${finalSql}`);
    console.log(`Rows: ${rows.length}\n`);

    if (rows.length === 0) {
      console.log("(no results)");
      return;
    }

    const keys = Object.keys(rows[0]);
    const widths = keys.map((k) => {
      const maxVal = Math.max(
        ...rows.map((r) => String(r[k] ?? "NULL").length),
      );
      return Math.max(k.length, Math.min(maxVal, 60));
    });

    // Header
    const header = keys.map((k, i) => k.padEnd(widths[i])).join(" | ");
    console.log(header);
    console.log(widths.map((w) => "-".repeat(w)).join("-+-"));

    // Rows
    for (const row of rows) {
      const line = keys
        .map((k, i) => {
          const val = String(row[k] ?? "NULL");
          return val.length > 60
            ? val.slice(0, 57) + "..."
            : val.padEnd(widths[i]);
        })
        .join(" | ");
      console.log(line);
    }
  } finally {
    client.close();
  }
}
