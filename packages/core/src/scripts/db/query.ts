/**
 * Core script: db-query
 *
 * Run a read-only SQL query against the configured PostgreSQL database. Local
 * execution uses PGlite and hosted execution uses PostgreSQL.
 */

import path from "node:path";

import {
  assertHostedRuntimeDatabase,
  getRuntimeDatabaseUrl,
  toPostgresParams,
} from "../../db/client.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { parseArgs, fail } from "../utils.js";
import { tryForwardDbQueryToDevServer } from "./dev-query-proxy.js";
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

export interface RunDbQueryOptions {
  sql: string;
  sqlArgs?: unknown[];
  limit?: number;
  databaseUrl?: string;
}

export interface RunDbQueryResult {
  rows: Record<string, unknown>[];
  sql: string;
}

/**
 * Validate, scope, and execute a read-only query. Shared by the CLI's
 * in-process path and the dev-server forward route (`dev-action-bridge.ts`)
 * so a forwarded read goes through the exact same checks and row scoping as
 * running `pnpm action db-query` locally, not a separate, unscoped path.
 */
export async function runDbQuery(
  options: RunDbQueryOptions,
): Promise<RunDbQueryResult> {
  const sqlArgs = options.sqlArgs ?? [];
  const stripped = options.sql
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

  let query = options.sql;
  if (
    options.limit &&
    (upper.startsWith("SELECT") || upper.startsWith("WITH")) &&
    !/\bLIMIT\b/i.test(stripped)
  ) {
    query = `${options.sql} LIMIT ${options.limit}`;
  }

  // Only guarded when falling back to the ambient resolution: an explicit
  // options.databaseUrl (e.g. --db pointing at a snapshot directory) is a
  // deliberate operator choice, not the silent fallback this guards against.
  if (!options.databaseUrl) assertHostedRuntimeDatabase();

  // Must match the resolver `tryForwardDbQueryToDevServer` hashes for its
  // forward-eligibility check (dev-query-proxy.ts) — otherwise the same
  // command reads a different database depending on whether forwarding
  // happened to succeed.
  const url =
    options.databaseUrl ?? getRuntimeDatabaseUrl("pglite:./data/pglite");
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
    return { rows, sql: finalSql };
  } finally {
    await client.end();
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

  let limit: number | undefined;
  if (parsed.limit) {
    limit = Number.parseInt(parsed.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) {
      fail("--limit must be a positive integer");
    }
  }

  // A custom --db points at a specific PGlite directory (e.g. a snapshot),
  // which the running dev server almost never matches — never forward that
  // case, or a query could silently run against the wrong database.
  if (!parsed.db) {
    // Runner.ts's dispatch already wraps this call in `runWithRequestContext`
    // before falling back to a core script, so the CLI's own resolved
    // identity is available here — forward it so the server applies the
    // same row scoping the local path would, instead of running unscoped.
    const forwarded = await tryForwardDbQueryToDevServer({
      sql,
      params: sqlArgs,
      limit,
      format: parsed.format,
      userEmail: getRequestUserEmail(),
      orgId: getRequestOrgId() ?? undefined,
      print: printTable,
    });
    if (forwarded) return;
  }

  const databaseUrl = parsed.db
    ? `pglite:${path.resolve(parsed.db)}`
    : undefined;
  const { rows, sql: finalSql } = await runDbQuery({
    sql,
    sqlArgs,
    limit,
    databaseUrl,
  });
  printTable(rows, finalSql, parsed.format);
}
