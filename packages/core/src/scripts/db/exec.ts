/**
 * Core script: db-exec
 *
 * Execute a write SQL statement (INSERT, UPDATE, DELETE, etc.)
 * against a SQLite or Postgres database.
 *
 * In production mode, temporary views scope UPDATE/DELETE to the current
 * user's data (AGENT_USER_EMAIL / AGENT_ORG_ID). For INSERT, the
 * `owner_email` and `org_id` columns are auto-injected if the target
 * table uses the ownership convention.
 *
 * Usage:
 *   pnpm action db-exec --sql "UPDATE forms SET status='published' WHERE id='abc'" [--db path]
 */

import path from "path";
import { createClient } from "@libsql/client";
import { getDatabaseUrl, getDatabaseAuthToken } from "../../db/client.js";
import { parseArgs, fail } from "../utils.js";
import {
  buildScopingPostgres,
  buildScopingSqlite,
  type ScopingContext,
} from "./scoping.js";

function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

/**
 * For INSERT statements targeting a table with owner_email / org_id columns,
 * auto-inject the current user's email and org ID if not already present.
 *
 * Handles the explicit column list form:
 *   INSERT INTO table (col1, col2) VALUES (val1, val2)
 */
function injectOwnership(sql: string, scoping: ScopingContext): string {
  if (!scoping.active) return sql;

  const upper = sql
    .replace(/^\s*--[^\n]*\n/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
    .toUpperCase();
  if (!upper.startsWith("INSERT")) return sql;

  // Extract table name: INSERT INTO <table> ...
  const match = sql.match(/INSERT\s+INTO\s+["']?(\w+)["']?/i);
  if (!match) return sql;

  const tableName = match[1];

  // Determine which columns to inject
  const injections: { col: string; value: string }[] = [];

  if (
    scoping.userEmail &&
    scoping.ownerEmailTables.has(tableName) &&
    !/owner_email/i.test(sql)
  ) {
    injections.push({
      col: "owner_email",
      value: `'${scoping.userEmail.replace(/'/g, "''")}'`,
    });
  }

  if (
    scoping.orgId &&
    scoping.orgIdTables.has(tableName) &&
    !/org_id/i.test(sql)
  ) {
    injections.push({
      col: "org_id",
      value: `'${scoping.orgId.replace(/'/g, "''")}'`,
    });
  }

  if (injections.length === 0) return sql;

  // Try to inject into explicit column list: INSERT INTO t (cols) VALUES (vals)
  const colListMatch = sql.match(
    /(INSERT\s+INTO\s+["']?\w+["']?\s*)\(([^)]+)\)(\s*VALUES\s*)\(([^)]+)\)/i,
  );
  if (colListMatch) {
    const [, prefix, cols, valueKeyword, vals] = colListMatch;
    const extraCols = injections.map((i) => i.col).join(", ");
    const extraVals = injections.map((i) => i.value).join(", ");
    return `${prefix}(${cols}, ${extraCols})${valueKeyword}(${vals}, ${extraVals})`;
  }

  return sql;
}

function printResult(
  sql: string,
  result: {
    count?: number;
    rowsAffected?: number;
    lastInsertRowid?: bigint | number;
    rows?: Record<string, unknown>[];
  },
  hasReturning: boolean,
  format?: string,
) {
  if (hasReturning && result.rows && result.rows.length > 0) {
    if (format === "json") {
      console.log(
        JSON.stringify(
          { sql, rows: result.rows, count: result.rows.length },
          null,
          2,
        ),
      );
      return;
    }
    console.log(`Executed: ${sql}`);
    console.log(`Returned ${result.rows.length} row(s):`);
    console.log(JSON.stringify(result.rows, null, 2));
  } else {
    const changes = result.count ?? result.rowsAffected ?? 0;
    if (format === "json") {
      console.log(
        JSON.stringify(
          {
            sql,
            changes,
            ...(result.lastInsertRowid && changes > 0
              ? { lastInsertRowid: Number(result.lastInsertRowid) }
              : {}),
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(`Executed: ${sql}`);
    console.log(`Changes: ${changes}`);
    if (result.lastInsertRowid && changes > 0) {
      console.log(`Last Insert Row ID: ${result.lastInsertRowid}`);
    }
  }
}

export default async function dbExec(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-exec --sql "<statement>" [options]

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
  } else if (getDatabaseUrl()) {
    url = getDatabaseUrl();
  } else {
    url = "file:" + path.resolve(process.cwd(), "data", "app.db");
  }

  const hasReturning = /\bRETURNING\b/i.test(stripped);

  // Postgres path
  if (isPostgresUrl(url)) {
    const { default: pg } = await import("postgres");
    const pgSql = pg(url);
    try {
      // Set up user-scoped temp views in production
      const scoping = await buildScopingPostgres(pgSql);

      // For UPDATE/DELETE: temp views scope to current user's rows
      for (const stmt of scoping.setup) {
        await pgSql.unsafe(stmt);
      }

      // For INSERT: auto-inject owner_email / org_id
      const finalSql = injectOwnership(sql, scoping);

      const result = await pgSql.unsafe(finalSql);
      const rows: Record<string, unknown>[] =
        hasReturning && result.length > 0 ? Array.from(result) : [];

      printResult(
        finalSql,
        { count: result.count ?? 0, rows },
        hasReturning,
        parsed.format,
      );

      for (const stmt of scoping.teardown) {
        await pgSql.unsafe(stmt).catch(() => {});
      }
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

    // For INSERT: auto-inject owner_email / org_id
    const finalSql = injectOwnership(sql, scoping);

    const result = await client.execute(finalSql);

    const rows: Record<string, unknown>[] =
      hasReturning && result.rows.length > 0
        ? result.rows.map((row) => {
            const obj: Record<string, unknown> = {};
            for (let i = 0; i < result.columns.length; i++) {
              obj[result.columns[i]] = row[i];
            }
            return obj;
          })
        : [];

    printResult(
      finalSql,
      {
        rowsAffected: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid,
        rows,
      },
      hasReturning,
      parsed.format,
    );

    for (const stmt of scoping.teardown) {
      await client.execute(stmt).catch(() => {});
    }
  } finally {
    client.close();
  }
}
