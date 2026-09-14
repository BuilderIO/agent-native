/**
 * Core script: db-query
 *
 * Run a read-only SQL query against the configured PostgreSQL database. Local
 * execution uses PGlite and hosted execution uses PostgreSQL.
 */

import path from "node:path";

import { getDatabaseUrl, toPostgresParams } from "../../db/client.js";
import { parseArgs, fail } from "../utils.js";
import { createPostgresScriptClient } from "./postgres-client.js";
import {
  assertNoSchemaQualifiedTables,
  assertNoSensitiveFrameworkTables,
} from "./safety.js";
import { buildScopingPostgres } from "./scoping.js";

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

function printTable(
  rows: Record<string, unknown>[],
  sql: string,
  format?: string,
): void {
  if (format === "json") {
    console.log(
      JSON.stringify({ query: sql, rows, count: rows.length }, null, 2),
    );
    return;
  }
  console.log(`Query: ${sql}`);
  console.log(`Rows: ${rows.length}\n`);
  if (rows.length === 0) {
    console.log("(no results)");
    return;
  }

  const keys = Object.keys(rows[0]);
  const widths = keys.map((key) => {
    const max = Math.max(
      ...rows.map((row) => String(row[key] ?? "NULL").length),
    );
    return Math.max(key.length, Math.min(max, 60));
  });
  console.log(keys.map((key, index) => key.padEnd(widths[index])).join(" | "));
  console.log(widths.map((width) => "-".repeat(width)).join("-+-"));
  for (const row of rows) {
    console.log(
      keys
        .map((key, index) => {
          const value = String(row[key] ?? "NULL");
          return (
            value.length > 60 ? `${value.slice(0, 57)}...` : value
          ).padEnd(widths[index]);
        })
        .join(" | "),
    );
  }
}

export default async function dbQuery(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-query --sql "<query>" [options]

Options:
  --sql <query>   SQL SELECT query to run (required)
  --args <json>   JSON array of positional SQL bind parameters
  --db <path>     PGlite data directory (default: data/pglite)
  --format json   Output as JSON instead of a table
  --limit N       Append LIMIT N if not already present
  --help          Show this help message`);
    return;
  }

  const sql = parsed.sql;
  if (!sql) fail('--sql is required. Example: --sql "SELECT * FROM forms"');
  const sqlArgs = parseSqlArgs(parsed.args);
  const stripped = sql
    .replace(/^\s*--[^\n]*\n/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
  const upper = stripped.toUpperCase();
  if (
    !upper.startsWith("SELECT") &&
    !upper.startsWith("WITH") &&
    !upper.startsWith("EXPLAIN")
  ) {
    fail(
      "Only SELECT, WITH, and EXPLAIN queries are allowed. Use db-exec for writes.",
    );
  }
  assertNoSensitiveFrameworkTables(stripped, "read");
  assertNoSchemaQualifiedTables(stripped, "read");

  let query = sql;
  if (
    parsed.limit &&
    (upper.startsWith("SELECT") || upper.startsWith("WITH")) &&
    !/\bLIMIT\b/i.test(stripped)
  ) {
    const limit = Number.parseInt(parsed.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) {
      fail("--limit must be a positive integer");
    }
    query = `${sql} LIMIT ${limit}`;
  }

  const url = parsed.db
    ? `pglite:${path.resolve(parsed.db)}`
    : getDatabaseUrl("pglite:./data/pglite");
  const client = await createPostgresScriptClient(url);
  try {
    let rows: Record<string, unknown>[] = [];
    const finalSql = toPostgresParams(query);
    await client.begin(async (tx) => {
      const scoping = await buildScopingPostgres(tx);
      for (const statement of scoping.setup) await tx.unsafe(statement);
      try {
        const result = await tx.unsafe(finalSql, sqlArgs);
        rows = Array.from(result);
      } finally {
        for (const statement of scoping.teardown) {
          await tx.unsafe(statement).catch(() => {});
        }
      }
    });
    printTable(rows, finalSql, parsed.format);
  } finally {
    await client.end();
  }
}
