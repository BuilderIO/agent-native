/**
 * Core script: db-query
 *
 * Run a read-only SQL query against a SQLite or Postgres database.
 *
 * In production mode, temporary views are created to scope data to the
 * current user (AGENT_USER_EMAIL). Tables with an `owner_email` column
 * and core tables (settings, application_state, etc.) are automatically
 * filtered so queries only return the current user's data.
 *
 * Usage:
 *   pnpm action db-query --sql "SELECT * FROM forms WHERE id = ?" [--args '["abc"]'] [--db path] [--format json] [--limit N]
 */

import path from "path";
import { createClient } from "@libsql/client";
import { getDatabaseUrl, getDatabaseAuthToken } from "../../db/client.js";
import { parseArgs, fail } from "../utils.js";
import { assertNoSensitiveFrameworkTables } from "./safety.js";
import { buildScopingPostgres, buildScopingSqlite } from "./scoping.js";

function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

function parseSqlArgs(raw: string | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through to the shared error below.
  }
  fail("--args must be a JSON array");
}

function convertQuestionMarksToPostgresParams(sql: string): string {
  let index = 0;
  let out = "";
  let state: "normal" | "single" | "double" | "line-comment" | "block-comment" =
    "normal";

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (state === "line-comment") {
      out += ch;
      if (ch === "\n") state = "normal";
      continue;
    }

    if (state === "block-comment") {
      out += ch;
      if (ch === "*" && next === "/") {
        out += next;
        i++;
        state = "normal";
      }
      continue;
    }

    if (state === "single") {
      out += ch;
      if (ch === "'" && next === "'") {
        out += next;
        i++;
      } else if (ch === "'") {
        state = "normal";
      }
      continue;
    }

    if (state === "double") {
      out += ch;
      if (ch === '"' && next === '"') {
        out += next;
        i++;
      } else if (ch === '"') {
        state = "normal";
      }
      continue;
    }

    if (ch === "-" && next === "-") {
      out += ch + next;
      i++;
      state = "line-comment";
      continue;
    }
    if (ch === "/" && next === "*") {
      out += ch + next;
      i++;
      state = "block-comment";
      continue;
    }
    if (ch === "'") {
      out += ch;
      state = "single";
      continue;
    }
    if (ch === '"') {
      out += ch;
      state = "double";
      continue;
    }
    if (ch === "?") {
      index++;
      out += `$${index}`;
      continue;
    }
    out += ch;
  }

  return out;
}

function normalizePostgresSql(sql: string, args: unknown[]): string {
  if (args.length === 0 || /\$\d+\b/.test(sql)) return sql;
  return convertQuestionMarksToPostgresParams(sql);
}

function printTable(
  rows: Record<string, unknown>[],
  finalSql: string,
  format?: string,
) {
  if (format === "json") {
    console.log(
      JSON.stringify({ query: finalSql, rows, count: rows.length }, null, 2),
    );
    return;
  }

  console.log(`Query: ${finalSql}`);
  console.log(`Rows: ${rows.length}\n`);

  if (rows.length === 0) {
    console.log("(no results)");
    return;
  }

  const keys = Object.keys(rows[0]);
  const widths = keys.map((k) => {
    const maxVal = Math.max(...rows.map((r) => String(r[k] ?? "NULL").length));
    return Math.max(k.length, Math.min(maxVal, 60));
  });

  const header = keys.map((k, i) => k.padEnd(widths[i])).join(" | ");
  console.log(header);
  console.log(widths.map((w) => "-".repeat(w)).join("-+-"));

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
}

export default async function dbQuery(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-query --sql "<query>" [options]

Options:
  --sql <query>   SQL SELECT query to run (required)
  --args <json>   JSON array of positional SQL bind parameters
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
  const sqlArgs = parseSqlArgs(parsed.args);

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
  assertNoSensitiveFrameworkTables(stripped, "read");

  // Resolve database URL: --db flag → DATABASE_URL env → default file path
  let url: string;
  if (parsed.db) {
    url = "file:" + path.resolve(parsed.db);
  } else if (getDatabaseUrl()) {
    url = getDatabaseUrl();
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
    const { default: pg } = await import("postgres");
    const pgSql = pg(url);
    try {
      const pgSqlText = normalizePostgresSql(finalSql, sqlArgs);
      let rows: Record<string, unknown>[] = [];
      await pgSql.begin(async (tx: any) => {
        // Temp views are session state. Keep setup/query/teardown on one
        // transaction-bound backend so pooled Postgres never retains them.
        const scoping = await buildScopingPostgres(tx);
        try {
          for (const stmt of scoping.setup) {
            await tx.unsafe(stmt);
          }

          const result =
            sqlArgs.length > 0
              ? await tx.unsafe(pgSqlText, sqlArgs as any[])
              : await tx.unsafe(pgSqlText);
          rows = Array.from(result);
        } finally {
          for (const stmt of scoping.teardown) {
            await tx.unsafe(stmt).catch(() => {});
          }
        }
      });
      const keys = rows.length > 0 ? Object.keys(rows[0]) : [];

      printTable(
        rows.length > 0 ? rows : keys.length > 0 ? rows : [],
        pgSqlText,
        parsed.format,
      );
    } finally {
      await pgSql.end();
    }
    return;
  }

  // libsql / SQLite path
  const client = createClient({
    url,
    authToken: getDatabaseAuthToken(),
  });

  try {
    // Set up user-scoped temp views in production
    const scoping = await buildScopingSqlite(client);
    for (const stmt of scoping.setup) {
      await client.execute(stmt);
    }

    const result =
      sqlArgs.length > 0
        ? await client.execute({ sql: finalSql, args: sqlArgs as any[] })
        : await client.execute(finalSql);
    const rows: Record<string, unknown>[] = result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < result.columns.length; i++) {
        obj[result.columns[i]] = row[i];
      }
      return obj;
    });

    printTable(rows, finalSql, parsed.format);

    // Tear down temp views
    for (const stmt of scoping.teardown) {
      await client.execute(stmt).catch(() => {});
    }
  } finally {
    client.close();
  }
}
