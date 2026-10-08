import path from "node:path";

import {
  assertHostedRuntimeDatabase,
  getLocalDatabaseUrl,
} from "../../db/client.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { parseArgs, fail } from "../utils.js";
import { tryForwardDbQueryToDevServer } from "./dev-query-proxy.js";
import { createPostgresScriptClient } from "./postgres-client.js";
import {
  finalRawDbSql,
  readRawDbReadStatement,
  verifyRawDbStatement,
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

// Thrown to end db-query's transaction with a rollback. The per-user views
// are created inside it, and the read-only switch blocks dropping them.
const READ_ONLY_ROLLBACK = Symbol("db-query rollback");

export async function runDbQuery(
  options: RunDbQueryOptions,
): Promise<RunDbQueryResult> {
  const sqlArgs = options.sqlArgs ?? [];
  const statement = readRawDbReadStatement(options.sql);

  let query = statement.sql;
  if (
    options.limit &&
    (statement.keyword === "select" || statement.keyword === "with") &&
    !statement.tokens.some(
      (token) => token.kind === "word" && token.value === "limit",
    )
  ) {
    query = `${statement.sql}\nLIMIT ${options.limit}`;
  }
  const executed = finalRawDbSql(query, "read");

  if (!options.databaseUrl) assertHostedRuntimeDatabase();

  const url =
    options.databaseUrl ?? getLocalDatabaseUrl("pglite:./data/pglite");
  const client = await createPostgresScriptClient(url);
  try {
    let rows: Record<string, unknown>[] = [];
    try {
      await client.begin(async (tx) => {
        const scoping = await buildScopingPostgres(tx);
        for (const setup of scoping.setup) await tx.unsafe(setup);
        // From here on the transaction cannot write, so a data-modifying CTE,
        // SELECT INTO, or EXPLAIN ANALYZE of a write fails instead of running.
        await tx.unsafe("SET TRANSACTION READ ONLY");
        await verifyRawDbStatement(tx, executed.statement);
        const result = await tx.unsafe(executed.sql, sqlArgs, {
          singleStatement: true,
        });
        rows = Array.from(result);
        throw READ_ONLY_ROLLBACK;
      });
    } catch (error) {
      if (error !== READ_ONLY_ROLLBACK) throw error;
    }
    return { rows, sql: executed.sql };
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

  if (!parsed.db) {
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
