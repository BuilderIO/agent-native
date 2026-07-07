/**
 * Boot-time convergence for columns Drizzle's schema declares but a
 * pre-existing table is missing.
 *
 * Lives in its own module (like `./widen-columns.js`) so stores/plugins can
 * import it without every `vi.mock("../db/client.js")` test needing to stub
 * it: the helper resolves `isPostgres()` / `getDbExec()` through `client.js`,
 * so a test that mocks the client to SQLite makes the Postgres introspection
 * path a no-op automatically.
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

import { isPostgres, type DbExec } from "./client.js";

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

/**
 * Minimal shape this module needs from a Drizzle column — matches both
 * `drizzle-orm/pg-core` and `drizzle-orm/sqlite-core` column instances (and
 * the dialect-agnostic wrappers in `./schema.js`, which delegate to one or
 * the other at runtime).
 */
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
  /** Drizzle table objects (from `pgTable`/`sqliteTable`, or the dialect-agnostic `table()` helper). */
  tables: unknown[];
  logger?: EnsureAdditiveColumnsLogger;
}

export interface EnsureAdditiveColumnsResult {
  /** `"table.column"` entries that were successfully added. */
  applied: string[];
  /** Declared columns that were intentionally left unpatched, with why. */
  skipped: Array<{ column: string; reason: string }>;
  /** `"table.column"` entries whose ALTER failed unexpectedly (logged, non-fatal). */
  errors: Array<{ column: string; error: string }>;
}

function emptyResult(): EnsureAdditiveColumnsResult {
  return { applied: [], skipped: [], errors: [] };
}

/**
 * Resolve `getTableConfig` for the dialect currently in effect. Both
 * `drizzle-orm/pg-core` and `drizzle-orm/sqlite-core` export a function with
 * this name and a compatible-enough shape (`{ columns, name, schema? }`), but
 * each only understands its own table class — calling the wrong one throws.
 * `table()` from `./schema.js` builds a `pgTable` on Postgres and a
 * `sqliteTable` everywhere else, so the same dialect switch used there
 * decides which `getTableConfig` to load here.
 */
async function loadGetTableConfig(): Promise<
  (table: unknown) => DeclaredTableLike
> {
  if (isPostgres()) {
    const { getTableConfig } = await import("drizzle-orm/pg-core");
    return getTableConfig as unknown as (table: unknown) => DeclaredTableLike;
  }
  const { getTableConfig } = await import("drizzle-orm/sqlite-core");
  return getTableConfig as unknown as (table: unknown) => DeclaredTableLike;
}

/**
 * Live columns already present on `table`, keyed by column name.
 * Postgres: `information_schema.columns` scoped to the table's schema
 * (default `public`). SQLite: `PRAGMA table_info(table)`.
 *
 * Returns `null` when the table itself does not exist (caller no-ops —
 * table creation owns that path) or when introspection fails outright.
 */
async function introspectLiveColumns(
  db: DbExec,
  table: string,
  schema: string | undefined,
): Promise<Set<string> | null> {
  if (isPostgres()) {
    try {
      const tableSchema = schema || "public";
      const { rows: existsRows } = await db.execute({
        sql: `SELECT 1 FROM information_schema.tables
              WHERE table_schema = ? AND table_name = ? LIMIT 1`,
        args: [tableSchema, table],
      });
      if (existsRows.length === 0) return null;
      const { rows } = await db.execute({
        sql: `SELECT column_name FROM information_schema.columns
              WHERE table_schema = ? AND table_name = ?`,
        args: [tableSchema, table],
      });
      return new Set(rows.map((r) => String(r.column_name)));
    } catch {
      return null;
    }
  }

  // SQLite: PRAGMA table_info returns zero rows for a non-existent table
  // (no error), so we can't distinguish "missing table" from "no columns"
  // that way — probe sqlite_master first.
  try {
    const { rows: existsRows } = await db.execute({
      sql: `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
      args: [table],
    });
    if (existsRows.length === 0) return null;
    // PRAGMA doesn't support bound parameters; the table name is already
    // validated against PLAIN_IDENTIFIER by the caller before we get here.
    const { rows } = await db.execute(`PRAGMA table_info("${table}")`);
    return new Set(rows.map((r) => String(r.name)));
  } catch {
    return null;
  }
}

/** Quote a validated identifier for use in generated SQL. */
function quoteIdent(name: string): string {
  return `"${name}"`;
}

/**
 * Render a column's declared default as a SQL literal, or `undefined` if it
 * can't be rendered safely. Only numbers, strings, booleans, and a small
 * allow-list of `sql` template defaults that stringify to a known-safe
 * constant are supported — anything else is deliberately left unrendered so
 * we never interpolate arbitrary SQL.
 */
function renderDefaultLiteral(column: DeclaredColumnLike): string | undefined {
  if (!column.hasDefault) return undefined;
  const value = column.default;
  if (value == null) return undefined;

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return isPostgres() ? (value ? "true" : "false") : value ? "1" : "0";
  }
  if (typeof value === "string") {
    // Escape single quotes for a plain string literal.
    return `'${value.replace(/'/g, "''")}'`;
  }

  // Drizzle `sql` template defaults (e.g. `now()`, `(datetime('now'))`) carry
  // a `queryChunks`/`toQuery`-style object rather than a plain scalar. Only
  // render the handful of known-safe constants used by this codebase's
  // `now()` helper (see ./schema.ts) — never stringify arbitrary SQL.
  const raw = sqlDefaultText(value);
  if (raw == null) return undefined;
  const normalized = raw.trim().toLowerCase();
  const SAFE_SQL_DEFAULTS = new Set([
    "now()",
    "(datetime('now'))",
    "current_timestamp",
    "current_date",
    "current_time",
  ]);
  if (SAFE_SQL_DEFAULTS.has(normalized)) {
    return raw.trim();
  }
  return undefined;
}

/**
 * Best-effort extraction of the raw SQL text from a drizzle `SQL` default
 * object (e.g. the value produced by `` sql`now()` ``). Drizzle's `SQL`
 * class publicly exposes `readonly queryChunks: SQLChunk[]`, where a plain
 * literal chunk is a `StringChunk` with a `.value: string[]`. Only accept the
 * text when EVERY chunk is a plain string literal — if the default embeds any
 * dynamic piece (a bound param, column reference, nested table, etc.) we
 * refuse to stringify it, since that could contain unsafe or unbounded SQL.
 */
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

/** True when an ALTER ... ADD COLUMN failure indicates the column already exists (race with a concurrent boot). */
function isDuplicateColumnError(err: unknown): boolean {
  const msg = (err as { message?: string } | undefined)?.message ?? "";
  return (
    /duplicate column name/i.test(msg) ||
    /column .* already exists/i.test(msg) ||
    (err as { code?: string } | undefined)?.code === "42701"
  );
}

/** Annotate a schema-drift-shaped Postgres error (42703/42P01) so logs read plainly. */
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

/**
 * Diff each declared Drizzle table's columns against the live database and
 * additively `ALTER TABLE ... ADD COLUMN` any that are missing. See the
 * module docstring for the full safety-rule contract.
 *
 * Call this once at boot, immediately after the authoritative hand-written
 * migrations have run. Never throws — every failure path is captured in the
 * returned summary instead so a boot-time caller can log-and-continue.
 */
export async function ensureAdditiveColumns(
  options: EnsureAdditiveColumnsOptions,
): Promise<EnsureAdditiveColumnsResult> {
  const { db, tables, logger = defaultLogger } = options;
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

  for (const tableObj of tables) {
    let config: DeclaredTableLike;
    try {
      config = getTableConfig(tableObj);
    } catch (err) {
      // Not a table this dialect's getTableConfig understands (e.g. a stray
      // export that isn't a Drizzle table) — skip quietly rather than
      // erroring the whole run over one bad entry.
      logger.warn(
        `[ensure-additive-columns] skipping non-table export: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const tableName = config.name;
    if (!tableName || !PLAIN_IDENTIFIER.test(tableName)) continue;

    let liveColumns: Set<string> | null;
    try {
      liveColumns = await introspectLiveColumns(db, tableName, config.schema);
    } catch (err) {
      result.errors.push({
        column: `${tableName}.*`,
        error: describeSchemaDriftError(err),
      });
      continue;
    }

    // Table doesn't exist yet — the creation path (CREATE TABLE IF NOT
    // EXISTS / a real migration) owns bringing every declared column into
    // existence. Nothing to do here.
    if (liveColumns == null) continue;

    for (const column of config.columns) {
      const columnName = column.name;
      if (!columnName || !PLAIN_IDENTIFIER.test(columnName)) continue;
      if (liveColumns.has(columnName)) continue; // untouched — already present

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
          // Can't safely backfill existing rows — adding NOT NULL without a
          // default would fail immediately on any existing row. Skip the
          // whole column rather than add a nullable column that silently
          // disagrees with the Drizzle declaration's NOT NULL contract in
          // a way that could surprise a future safe-default addition.
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
          // A concurrent boot already added it — treat as success.
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

/**
 * Resolve the SQL type to use for a new column. Prefers the column's own
 * `getSQLType()` (the exact type Drizzle would have used in a fresh CREATE
 * TABLE); falls back to skipping (returns `undefined`) if it throws or
 * returns something empty.
 */
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
