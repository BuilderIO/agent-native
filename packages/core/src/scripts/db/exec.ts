import path from "node:path";

import type { AgentPostgresStatement } from "../../agent-sql/postgres.js";
import { getDatabaseUrl } from "../../db/client.js";
import { parseArgs, fail } from "../utils.js";
import { createPostgresScriptClient } from "./postgres-client.js";
import {
  finalRawDbSql,
  rawDbInsertTarget,
  readRawDbWriteStatement,
  verifyRawDbStatement,
} from "./safety.js";
import { buildScopingPostgres, type ScopingContext } from "./scoping.js";

interface DbExecStatement {
  sql: string;
  args: unknown[];
}

interface DbExecResult {
  index: number;
  sql: string;
  changes: number;
  rows: Record<string, unknown>[];
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
    if (parsed.sql) fail("Pass either --sql or --statements, not both.");
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

const INSERT_INTO = "INSERT\\s+INTO";

function injectOwnership(
  statement: AgentPostgresStatement,
  scoping: ScopingContext,
): string {
  const sql = statement.sql;
  if (!scoping.active || statement.keyword !== "insert") return sql;

  const target = rawDbInsertTarget(statement);
  if (!target) return sql;
  const tableName = target.table;
  const listed = new Set(target.columns ?? []);
  const injections: { column: string; value: string }[] = [];
  if (
    scoping.userEmail &&
    scoping.ownerEmailTables.has(tableName) &&
    !listed.has("owner_email")
  ) {
    injections.push({
      column: "owner_email",
      value: `'${scoping.userEmail.replace(/'/g, "''")}'`,
    });
  }
  if (
    scoping.orgId &&
    scoping.orgIdTables.has(tableName) &&
    !listed.has("org_id")
  ) {
    injections.push({
      column: "org_id",
      value: `'${scoping.orgId.replace(/'/g, "''")}'`,
    });
  }
  if (injections.length === 0) return sql;

  const matchColumns = sql.match(
    new RegExp(
      `(${INSERT_INTO}\\s+["']?\\w+["']?\\s*)\\(([^)]+)\\)(\\s*VALUES\\s*)\\(([^)]+)\\)`,
      "i",
    ),
  );
  if (!matchColumns) return sql;
  const [, prefix, columns, valuesKeyword, values] = matchColumns;
  return `${prefix}(${columns}, ${injections.map((item) => item.column).join(", ")})${valuesKeyword}(${values}, ${injections.map((item) => item.value).join(", ")})`;
}

function printResult(
  sql: string,
  result: Pick<DbExecResult, "changes" | "rows">,
  format?: string,
): void {
  if (result.rows.length > 0) {
    if (format === "json") {
      console.log(JSON.stringify({ sql, rows: result.rows }, null, 2));
    } else {
      console.log(`Executed: ${sql}`);
      console.log(`Returned ${result.rows.length} row(s):`);
      console.log(JSON.stringify(result.rows, null, 2));
    }
    return;
  }

  if (format === "json") {
    console.log(JSON.stringify({ sql, changes: result.changes }, null, 2));
    return;
  }
  console.log(`Executed: ${sql}`);
  console.log(`Changes: ${result.changes}`);
  if (result.changes === 0) {
    console.log(
      "Hint: the WHERE clause matched no rows, or the row is outside the current user's scope.",
    );
  }
}

function printBatchResult(results: DbExecResult[], format?: string): void {
  if (results.length === 1) {
    printResult(results[0].sql, results[0], format);
    return;
  }
  const changes = results.reduce((sum, result) => sum + result.changes, 0);
  if (format === "json") {
    console.log(JSON.stringify({ statements: results, changes }, null, 2));
    return;
  }
  console.log(`Executed ${results.length} statements in one transaction.`);
  for (const result of results) {
    console.log(`[${result.index}] Changes: ${result.changes}`);
    if (result.rows.length > 0)
      console.log(JSON.stringify(result.rows, null, 2));
  }
  console.log(`Total changes: ${changes}`);
}

export default async function dbExec(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-exec --sql "<statement>" [options]
       pnpm action db-exec --statements '[{"sql":"UPDATE ...","args":[...]}]' [options]

Options:
  --sql <stmt>         Single INSERT / UPDATE / DELETE statement
  --args <json>        JSON array of positional SQL bind parameters
  --statements <json>  JSON array of {sql, args?}; runs in one transaction
  --db <path>          PGlite data directory (default: data/pglite)
  --format json        Output as JSON
  --help               Show this help message`);
    return;
  }

  const statements = parseStatements(parsed).map((statement, index) => ({
    statement: readRawDbWriteStatement(statement.sql, `Statement ${index + 1}`),
    args: statement.args,
  }));
  const url = parsed.db
    ? `pglite:${path.resolve(parsed.db)}`
    : getDatabaseUrl("pglite:./data/pglite");
  const client = await createPostgresScriptClient(url);

  try {
    const results: DbExecResult[] = [];
    await client.begin(async (tx) => {
      const scoping = await buildScopingPostgres(tx);
      for (const statement of scoping.setup) await tx.unsafe(statement);
      try {
        for (let index = 0; index < statements.length; index++) {
          const statement = statements[index];
          const label = `Statement ${index + 1}`;
          // Ownership injection rewrites the text, so the guards re-read the
          // final SQL and check it against this transaction's state right
          // before it runs, after any earlier statement in the batch.
          const executed = finalRawDbSql(
            injectOwnership(statement.statement, scoping),
            "write",
            label,
          );
          await verifyRawDbStatement(tx, executed.statement, {
            columnsByTable: scoping.columnsByTable,
            label,
          });
          const sql = executed.sql;
          try {
            const result = await tx.unsafe(sql, statement.args, {
              singleStatement: true,
            });
            results.push({
              index: index + 1,
              sql,
              changes: result.count ?? 0,
              rows: executed.statement.tokens.some(
                (token) => token.kind === "word" && token.value === "returning",
              )
                ? Array.from(result)
                : [],
            });
          } catch (error) {
            throw new Error(
              `Statement ${index + 1} failed: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
        }
      } finally {
        for (const statement of scoping.teardown) {
          await tx.unsafe(statement).catch(() => {});
        }
      }
    });
    printBatchResult(results, parsed.format);
  } finally {
    await client.end();
  }
}
