/**
 * Boot-time convergence for columns Drizzle's schema declares but a
 * pre-existing table is missing.
 *
 * Lives in its own module (like `./widen-columns.js`) so stores/plugins can
 * import it without every `vi.mock("../db/client.js")` test needing to stub
 * it: the helper works directly against Postgres information_schema.
 *
 * ## Why
 *
 * `CREATE TABLE IF NOT EXISTS` only runs the CREATE the first time a table is
 * created — once it exists, adding a column to the Drizzle schema (e.g.
 * `schema.ts`) does nothing to already-existing rows unless a hand-written
 * `ALTER TABLE ... ADD COLUMN` migration ships alongside it. Fresh dev
 * databases mask this because the CREATE always includes every declared
 * column; only long-lived, pre-existing production tables are missing the
 * new column. Forgetting the migration turns every query that references the
 * column into a Postgres `42703 (undefined_column)` — e.g.
 * `session_recordings.network_error_count`, which 500'd every
 * `list-session-recordings` call.
 *
 * `ensureAdditiveColumns()` is belt-and-braces for that failure mode: after
 * the authoritative hand-written migrations run, diff each Drizzle table's
 * declared columns against the live table and additively patch any gap. It
 * is NOT a replacement for migrations — it never touches indexes, data
 * transforms, or existing columns, and a hand-written migration should still
 * ship for every schema change. This is a safety net for the case where one
 * doesn't.
 *
 * ## Safety rules (hard)
 *
 * - Additive only: never drops, renames, retypes, or otherwise touches a
 *   column that already exists on the live table.
 * - A `NOT NULL` column is only ever added when it has a renderable default
 *   (so existing rows get a valid value in the same statement). If it has no
 *   renderable default, it is added as nullable when the Drizzle declaration
 *   allows null, else the column is SKIPPED entirely with a loud log line
 *   naming the column and the reason.
 * - Only simple literal defaults are rendered: numbers, strings, booleans,
 *   and `sql` template defaults that stringify to one of a small allow-listed
 *   set of safe constants (see `renderDefaultLiteral`). Any other `sql`
 *   default is NOT rendered — the column is added without a `DEFAULT` (and
 *   without `NOT NULL`, per the rule above) rather than risk interpolating
 *   unsafe SQL.
 * - All identifiers (table/column names) are validated against a strict
 *   `[A-Za-z_][A-Za-z0-9_]*` pattern and double-quoted; no value from a row or
 *   from user data is ever interpolated into the generated SQL.
 * - If the table itself does not exist yet, this is a no-op — table creation
 *   owns bringing every declared column into existence for a brand-new table.
 * - Idempotent and best-effort: a failure on one column is logged and does
 *   not abort the rest, and a total failure (e.g. `information_schema`
 *   unreadable) must never crash boot — the caller decides whether/how to
 *   surface `errors` in the returned summary.
 */

import {
  isProductionServerlessFunctionRuntime,
  type DbExec,
} from "./client.js";

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface EnsureAdditiveColumnsLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

const defaultLogger: EnsureAdditiveColumnsLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

interface DeclaredColumnLike {
  name: string;
  notNull: boolean;
  hasDefault: boolean;
  default: unknown;
  getSQLType(): string;
}

interface DeclaredTableLike {
  columns: DeclaredColumnLike[];
  name: string;
  schema?: string;
}

export interface EnsureAdditiveColumnsOptions {
  db: DbExec;
  tables: unknown[];
  logger?: EnsureAdditiveColumnsLogger;
}

export interface EnsureAdditiveColumnsResult {
  mode: "checked" | "skipped-serverless";
  applied: string[];
  skipped: Array<{ column: string; reason: string }>;
  errors: Array<{ column: string; error: string }>;
}

function emptyResult(): EnsureAdditiveColumnsResult {
  return { mode: "checked", applied: [], skipped: [], errors: [] };
}

async function loadGetTableConfig(): Promise<
  (table: unknown) => DeclaredTableLike
> {
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  return getTableConfig as unknown as (table: unknown) => DeclaredTableLike;
}

async function introspectPostgresColumns(
  db: DbExec,
  tables: DeclaredTableLike[],
): Promise<Map<string, Set<string>> | null> {
  if (tables.length === 0) return new Map();
  const pairs = [
    ...new Map(
      tables.map((table) => {
        const schema = table.schema || "public";
        return [`${schema}.${table.name}`, { schema, table: table.name }];
      }),
    ).values(),
  ];
  const args: unknown[] = [];
  const predicates = pairs.map(({ schema, table }) => {
    args.push(schema, table);
    return `(table_schema = ? AND table_name = ?)`;
  });
  const { rows } = await db.execute({
    sql: `SELECT table_schema, table_name, column_name
          FROM information_schema.columns
          WHERE ${predicates.join(" OR ")}`,
    args,
  });
  const columns = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = `${String(row.table_schema)}.${String(row.table_name)}`;
    const tableColumns = columns.get(key) ?? new Set<string>();
    tableColumns.add(String(row.column_name));
    columns.set(key, tableColumns);
  }
  return columns;
}

function quoteIdent(name: string): string {
  return `"${name}"`;
}

function renderDefaultLiteral(column: DeclaredColumnLike): string | undefined {
  if (!column.hasDefault) return undefined;
  const value = column.default;
  if (value == null) return undefined;

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return `'${value.replace(/'/g, "''")}'`;
  }

  const raw = sqlDefaultText(value);
  if (raw == null) return undefined;
  const normalized = raw.trim().toLowerCase();
  const SAFE_SQL_DEFAULTS = new Set([
    "now()",
    "current_timestamp",
    "current_date",
    "current_time",
  ]);
  if (SAFE_SQL_DEFAULTS.has(normalized)) {
    return raw.trim();
  }
  return undefined;
}

function sqlDefaultText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const chunks = (value as { queryChunks?: unknown } | null)?.queryChunks;
  if (!Array.isArray(chunks)) return undefined;
  const parts: string[] = [];
  for (const chunk of chunks) {
    const stringValues = (chunk as { value?: unknown } | null)?.value;
    if (
      !Array.isArray(stringValues) ||
      !stringValues.every((v) => typeof v === "string")
    ) {
      return undefined;
    }
    parts.push(...(stringValues as string[]));
  }
  const text = parts.join("");
  return text || undefined;
}

function isDuplicateColumnError(err: unknown): boolean {
  const msg = (err as { message?: string } | undefined)?.message ?? "";
  return (
    /column .* already exists/i.test(msg) ||
    (err as { code?: string } | undefined)?.code === "42701"
  );
}

function describeSchemaDriftError(err: unknown): string {
  const code = (err as { code?: string } | undefined)?.code;
  const message =
    (err as { message?: string } | undefined)?.message ?? String(err);
  if (code === "42703") {
    return `schema drift (42703 undefined_column): ${message}`;
  }
  if (code === "42P01") {
    return `schema drift (42P01 undefined_table): ${message}`;
  }
  return message;
}

export async function ensureAdditiveColumns(
  options: EnsureAdditiveColumnsOptions,
): Promise<EnsureAdditiveColumnsResult> {
  const { db, tables, logger = defaultLogger } = options;
  if (isProductionServerlessFunctionRuntime()) {
    return { ...emptyResult(), mode: "skipped-serverless" };
  }
  const result = emptyResult();

  let getTableConfig: (table: unknown) => DeclaredTableLike;
  try {
    getTableConfig = await loadGetTableConfig();
  } catch (err) {
    result.errors.push({
      column: "*",
      error: `failed to load drizzle-orm table config helper: ${err instanceof Error ? err.message : String(err)}`,
    });
    return result;
  }

  const declaredTables: DeclaredTableLike[] = [];
  for (const tableObj of tables) {
    try {
      const config = getTableConfig(tableObj);
      if (config.name && PLAIN_IDENTIFIER.test(config.name)) {
        declaredTables.push(config);
      }
    } catch (err) {
      logger.warn(
        `[ensure-additive-columns] skipping non-table export: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let postgresColumns: Map<string, Set<string>> | null = null;
  try {
    postgresColumns = await introspectPostgresColumns(db, declaredTables);
  } catch (err) {
    result.errors.push({
      column: "*",
      error: describeSchemaDriftError(err),
    });
    return result;
  }

  for (const config of declaredTables) {
    const tableName = config.name;
    let liveColumns: Set<string> | null;
    try {
      liveColumns =
        postgresColumns?.get(`${config.schema || "public"}.${tableName}`) ??
        null;
    } catch (err) {
      result.errors.push({
        column: `${tableName}.*`,
        error: describeSchemaDriftError(err),
      });
      continue;
    }

    if (liveColumns == null) continue;

    for (const column of config.columns) {
      const columnName = column.name;
      if (!columnName || !PLAIN_IDENTIFIER.test(columnName)) continue;
      if (liveColumns.has(columnName)) continue;

      const label = `${tableName}.${columnName}`;
      const sqlType = safeSQLType(column, label, logger);
      if (!sqlType) {
        result.skipped.push({
          column: label,
          reason: "could not determine a safe SQL type for the column",
        });
        continue;
      }

      const defaultLiteral = renderDefaultLiteral(column);
      let notNullClause = "";
      if (column.notNull) {
        if (defaultLiteral != null) {
          notNullClause = " NOT NULL";
        } else {
          result.skipped.push({
            column: label,
            reason:
              "declared NOT NULL with no renderable default — cannot backfill existing rows safely",
          });
          logger.warn(
            `[ensure-additive-columns] SKIPPING ${label}: declared NOT NULL with no renderable default (existing rows have no safe backfill value)`,
          );
          continue;
        }
      }

      const defaultClause =
        defaultLiteral != null ? ` DEFAULT ${defaultLiteral}` : "";
      const ddl = `ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN ${quoteIdent(columnName)} ${sqlType}${defaultClause}${notNullClause}`;

      try {
        await db.execute(ddl);
        result.applied.push(label);
        logger.info(`[ensure-additive-columns] added ${label}`);
      } catch (err) {
        if (isDuplicateColumnError(err)) {
          result.applied.push(label);
          continue;
        }
        const message = describeSchemaDriftError(err);
        result.errors.push({ column: label, error: message });
        logger.error(
          `[ensure-additive-columns] failed to add ${label}: ${message}`,
        );
        // Continue with the remaining columns/tables — one failure must not
        // abort the rest.
      }
    }
  }

  return result;
}

function safeSQLType(
  column: DeclaredColumnLike,
  label: string,
  logger: EnsureAdditiveColumnsLogger,
): string | undefined {
  try {
    const sqlType = column.getSQLType();
    if (typeof sqlType === "string" && sqlType.trim()) return sqlType.trim();
  } catch (err) {
    logger.warn(
      `[ensure-additive-columns] getSQLType() threw for ${label}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return undefined;
}
