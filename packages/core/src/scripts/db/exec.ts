/**
 * Core script: db-exec
 *
 * Execute write SQL statements (INSERT, UPDATE, DELETE, REPLACE)
 * against a SQLite or Postgres database.
 *
 * In production mode, temporary views scope UPDATE/DELETE to the current
 * user's data (AGENT_USER_EMAIL / AGENT_ORG_ID). For INSERT, the
 * `owner_email` and `org_id` columns are auto-injected if the target
 * table uses the ownership convention.
 *
 * Usage:
 *   pnpm action db-exec --sql "UPDATE forms SET status=? WHERE id=?" [--args '["published","abc"]'] [--db path]
 *   pnpm action db-exec --statements '[{"sql":"INSERT INTO notes (id,title) VALUES (?,?)","args":["n1","One"]},{"sql":"UPDATE counters SET value=value+1 WHERE key=?","args":["notes"]}]'
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

interface DbExecStatement {
  sql: string;
  args: unknown[];
}

interface DbExecResult {
  index: number;
  sql: string;
  changes?: number;
  lastInsertRowid?: bigint | number;
  rows?: Record<string, unknown>[];
}

function parseSqlArgs(raw: string | undefined, label = "--args"): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through to the shared error below.
  }
  fail(`${label} must be a JSON array`);
}

function parseStatements(parsed: Record<string, string>): DbExecStatement[] {
  if (parsed.statements) {
    if (parsed.sql) {
      fail("Pass either --sql or --statements, not both.");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(parsed.statements);
    } catch {
      fail(
        '--statements must be a JSON array of {"sql": string, "args"?: unknown[]} objects',
      );
    }
    if (!Array.isArray(raw) || raw.length === 0) {
      fail("--statements must be a non-empty JSON array");
    }
    return raw.map((entry, index) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof (entry as any).sql !== "string" ||
        !(entry as any).sql.trim()
      ) {
        fail(`Statement ${index + 1} must include a non-empty sql string`);
      }
      const args = (entry as any).args;
      if (args != null && !Array.isArray(args)) {
        fail(`Statement ${index + 1} args must be a JSON array`);
      }
      return { sql: (entry as any).sql, args: args ?? [] };
    });
  }

  if (!parsed.sql) {
    fail(
      '--sql is required unless --statements is provided. Example: --sql "UPDATE forms SET status=? WHERE id=?" --args \'["published","abc"]\'',
    );
  }
  return [{ sql: parsed.sql, args: parseSqlArgs(parsed.args) }];
}

function stripLeadingSqlComments(sql: string): string {
  return sql
    .replace(/^\s*--[^\n]*\n/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
}

function hasAdditionalStatement(sql: string): boolean {
  let state: "normal" | "single" | "double" | "line-comment" | "block-comment" =
    "normal";

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (state === "line-comment") {
      if (ch === "\n") state = "normal";
      continue;
    }
    if (state === "block-comment") {
      if (ch === "*" && next === "/") {
        i++;
        state = "normal";
      }
      continue;
    }
    if (state === "single") {
      if (ch === "'" && next === "'") {
        i++;
      } else if (ch === "'") {
        state = "normal";
      }
      continue;
    }
    if (state === "double") {
      if (ch === '"' && next === '"') {
        i++;
      } else if (ch === '"') {
        state = "normal";
      }
      continue;
    }

    if (ch === "-" && next === "-") {
      i++;
      state = "line-comment";
      continue;
    }
    if (ch === "/" && next === "*") {
      i++;
      state = "block-comment";
      continue;
    }
    if (ch === "'") {
      state = "single";
      continue;
    }
    if (ch === '"') {
      state = "double";
      continue;
    }
    if (ch === ";") {
      return sql.slice(i + 1).trim().length > 0;
    }
  }
  return false;
}

function normalizeUserSql(sql: string, index: number): string {
  const stripped = stripLeadingSqlComments(sql);
  if (!stripped) {
    fail(`Statement ${index} is empty`);
  }
  if (hasAdditionalStatement(stripped)) {
    fail(
      `Statement ${index} contains multiple SQL statements. Use --statements for batches so each write can be validated and run transactionally.`,
    );
  }
  return stripped.replace(/;\s*$/, "");
}

function validateWriteSql(sql: string, index: number): string {
  const normalized = normalizeUserSql(sql, index);
  const upper = normalized.toUpperCase();
  const allowed = ["INSERT", "UPDATE", "DELETE", "REPLACE"];
  const blocked = ["SELECT", "WITH", "EXPLAIN", "PRAGMA"];

  if (blocked.some((kw) => upper.startsWith(kw))) {
    fail(
      `Statement ${index}: use db-query for SELECT/read statements. db-exec is for writes only.`,
    );
  }
  if (upper.startsWith("CREATE") || upper.startsWith("ALTER")) {
    fail(
      `Statement ${index}: schema changes are not allowed through db-exec. Additive schema changes must go through reviewed migrations/startup code, not ad-hoc agent SQL.`,
    );
  }
  if (!allowed.some((kw) => upper.startsWith(kw))) {
    fail(
      `Statement ${index}: only ${allowed.join(", ")} statements are allowed. ` +
        `Dangerous operations like DROP, ATTACH, VACUUM, DETACH, CREATE, and ALTER are blocked.`,
    );
  }
  return normalized;
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

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqliteScopePredicate(
  tableName: string,
  scoping: ScopingContext,
): string | null {
  if (tableName === "tool_data" && scoping.userEmail) {
    const userClause = `(scope = 'user' AND owner_email = '${escapeSqlString(scoping.userEmail)}')`;
    const orgClause = scoping.orgId
      ? ` OR (scope = 'org' AND org_id = '${escapeSqlString(scoping.orgId)}')`
      : "";
    return `(${userClause}${orgClause})`;
  }

  const clauses: string[] = [];
  if (scoping.userEmail && scoping.ownerEmailTables.has(tableName)) {
    clauses.push(`owner_email = '${escapeSqlString(scoping.userEmail)}'`);
  }
  if (scoping.orgId && scoping.orgIdTables.has(tableName)) {
    clauses.push(`org_id = '${escapeSqlString(scoping.orgId)}'`);
  }
  return clauses.length > 0 ? clauses.join(" AND ") : null;
}

function splitReturning(sql: string): { body: string; returning: string } {
  const match = /\bRETURNING\b/i.exec(sql);
  if (!match) return { body: sql, returning: "" };
  return {
    body: sql.slice(0, match.index).trimEnd(),
    returning: sql.slice(match.index),
  };
}

function addSqliteScopeToWhere(sql: string, predicate: string): string {
  const { body, returning } = splitReturning(sql);
  const whereMatch = /\bWHERE\b/i.exec(body);
  const scoped = whereMatch
    ? `${body.slice(0, whereMatch.index)}WHERE ${predicate} AND (${body.slice(whereMatch.index + whereMatch[0].length).trim()})`
    : `${body} WHERE ${predicate}`;
  return returning ? `${scoped} ${returning}` : scoped;
}

function qualifySqliteWrite(sql: string, scoping: ScopingContext): string {
  if (!scoping.active) return sql;

  const updateMatch = sql.match(/^\s*UPDATE\s+(?:"([^"]+)"|'([^']+)'|(\w+))/i);
  if (updateMatch) {
    const tableName = updateMatch[1] ?? updateMatch[2] ?? updateMatch[3];
    const predicate = sqliteScopePredicate(tableName, scoping);
    if (!predicate) return sql;
    const qualified = sql.replace(
      /^\s*UPDATE\s+(?:"[^"]+"|'[^']+'|\w+)/i,
      `UPDATE main."${tableName.replace(/"/g, '""')}"`,
    );
    return addSqliteScopeToWhere(qualified, predicate);
  }

  const deleteMatch = sql.match(
    /^\s*DELETE\s+FROM\s+(?:"([^"]+)"|'([^']+)'|(\w+))/i,
  );
  if (deleteMatch) {
    const tableName = deleteMatch[1] ?? deleteMatch[2] ?? deleteMatch[3];
    const predicate = sqliteScopePredicate(tableName, scoping);
    if (!predicate) return sql;
    const qualified = sql.replace(
      /^\s*DELETE\s+FROM\s+(?:"[^"]+"|'[^']+'|\w+)/i,
      `DELETE FROM main."${tableName.replace(/"/g, '""')}"`,
    );
    return addSqliteScopeToWhere(qualified, predicate);
  }

  return sql.replace(
    /^\s*(INSERT\s+INTO|REPLACE\s+INTO)\s+(?:"([^"]+)"|'([^']+)'|(\w+))/i,
    (match, keyword, quotedDouble, quotedSingle, bare) => {
      const tableName = quotedDouble ?? quotedSingle ?? bare;
      if (
        !scoping.ownerEmailTables.has(tableName) &&
        !scoping.orgIdTables.has(tableName)
      ) {
        return match;
      }
      return `${keyword} main."${tableName.replace(/"/g, '""')}"`;
    },
  );
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

function printBatchResult(results: DbExecResult[], format?: string): void {
  if (results.length === 1) {
    const result = results[0];
    printResult(
      result.sql,
      {
        count: result.changes,
        rowsAffected: result.changes,
        lastInsertRowid: result.lastInsertRowid,
        rows: result.rows,
      },
      Boolean(result.rows?.length),
      format,
    );
    return;
  }

  const totalChanges = results.reduce(
    (sum, result) => sum + Number(result.changes ?? 0),
    0,
  );

  if (format === "json") {
    console.log(
      JSON.stringify(
        {
          statements: results.map((result) => ({
            index: result.index,
            sql: result.sql,
            changes: result.changes ?? 0,
            ...(result.lastInsertRowid && Number(result.changes ?? 0) > 0
              ? { lastInsertRowid: Number(result.lastInsertRowid) }
              : {}),
            ...(result.rows?.length
              ? { rows: result.rows, count: result.rows.length }
              : {}),
          })),
          changes: totalChanges,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Executed ${results.length} statements in one transaction.`);
  for (const result of results) {
    if (result.rows?.length) {
      console.log(`[${result.index}] Returned ${result.rows.length} row(s):`);
      console.log(JSON.stringify(result.rows, null, 2));
    } else {
      console.log(`[${result.index}] Changes: ${result.changes ?? 0}`);
    }
  }
  console.log(`Total changes: ${totalChanges}`);
}

function sqliteRowsToObjects(
  rows: any[],
  columns: string[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    if (!Array.isArray(row) && row && typeof row === "object") {
      return { ...row };
    }
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]] = row[i];
    }
    return obj;
  });
}

export default async function dbExec(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-exec --sql "<statement>" [options]
       pnpm action db-exec --statements '[{"sql":"UPDATE ...","args":[...]}]' [options]

Options:
  --sql <stmt>         Single INSERT / UPDATE / DELETE / REPLACE statement
  --args <json>        JSON array of positional SQL bind parameters for --sql
  --statements <json>  JSON array of {sql, args?}; runs in one transaction
  --db <path>          Path to SQLite database (default: data/app.db)
  --format json        Output as JSON
  --help               Show this help message`);
    return;
  }

  const statements = parseStatements(parsed).map((statement, index) => ({
    sql: validateWriteSql(statement.sql, index + 1),
    args: statement.args,
  }));

  // Resolve database URL: --db flag → DATABASE_URL env → default file path
  let url: string;
  if (parsed.db) {
    url = "file:" + path.resolve(parsed.db);
  } else if (getDatabaseUrl()) {
    url = getDatabaseUrl();
  } else {
    url = "file:" + path.resolve(process.cwd(), "data", "app.db");
  }

  // Postgres path
  if (isPostgresUrl(url)) {
    const { default: pg } = await import("postgres");
    const pgSql = pg(url);
    try {
      // Set up user-scoped temp views in production
      const scoping = await buildScopingPostgres(pgSql);

      const results: DbExecResult[] = [];
      await pgSql.begin(async (tx: any) => {
        try {
          // For UPDATE/DELETE: temp views scope to current user's rows.
          // Creating and dropping them inside the same transaction keeps
          // pooled Postgres backends from retaining session-local views.
          for (const stmt of scoping.setup) {
            await tx.unsafe(stmt);
          }

          for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            const hasReturning = /\bRETURNING\b/i.test(statement.sql);
            const finalSql = normalizePostgresSql(
              injectOwnership(statement.sql, scoping),
              statement.args,
            );
            try {
              const result =
                statement.args.length > 0
                  ? await tx.unsafe(finalSql, statement.args as any[])
                  : await tx.unsafe(finalSql);
              const rows: Record<string, unknown>[] =
                hasReturning && result.length > 0 ? Array.from(result) : [];
              results.push({
                index: i + 1,
                sql: finalSql,
                changes: result.count ?? 0,
                rows,
              });
            } catch (err: any) {
              throw new Error(
                `Statement ${i + 1} failed: ${err?.message ?? String(err)}`,
              );
            }
          }
        } finally {
          for (const stmt of scoping.teardown) {
            await tx.unsafe(stmt).catch(() => {});
          }
        }
      });

      printBatchResult(results, parsed.format);
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

    const results: DbExecResult[] = [];
    const shouldTransact = statements.length > 1;
    if (shouldTransact) await client.execute("BEGIN");
    try {
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        const hasReturning = /\bRETURNING\b/i.test(statement.sql);
        const finalSql = qualifySqliteWrite(
          injectOwnership(statement.sql, scoping),
          scoping,
        );
        try {
          const result =
            statement.args.length > 0
              ? await client.execute({
                  sql: finalSql,
                  args: statement.args as any[],
                })
              : await client.execute(finalSql);

          const rows: Record<string, unknown>[] =
            hasReturning && result.rows.length > 0
              ? sqliteRowsToObjects(result.rows, result.columns)
              : [];
          results.push({
            index: i + 1,
            sql: finalSql,
            changes: result.rowsAffected,
            lastInsertRowid: result.lastInsertRowid,
            rows,
          });
        } catch (err: any) {
          throw new Error(
            `Statement ${i + 1} failed: ${err?.message ?? String(err)}`,
          );
        }
      }
      if (shouldTransact) await client.execute("COMMIT");
    } catch (err) {
      if (shouldTransact) {
        await client.execute("ROLLBACK").catch(() => {});
      }
      throw err;
    }

    printBatchResult(results, parsed.format);

    for (const stmt of scoping.teardown) {
      await client.execute(stmt).catch(() => {});
    }
  } finally {
    client.close();
  }
}
