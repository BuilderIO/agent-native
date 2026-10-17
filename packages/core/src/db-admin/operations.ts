import { getDbExec, type DbExec } from "../db/client.js";
import { notifyActionChange } from "../server/action-change.js";
import type {
  DbAdminColumn,
  DbAdminFilter,
  DbAdminForeignKey,
  DbAdminIndex,
  DbAdminMutation,
  DbAdminMutationResult,
  DbAdminQueryResult,
  DbAdminRowsRequest,
  DbAdminRowsResult,
  DbAdminTableSchema,
  DbAdminTableSummary,
} from "./types.js";

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LARGE_CELL_PREVIEW_CHARS = 16 * 1024;
const LARGE_CELL_SUFFIX =
  "\n...[db-admin truncated large cell; request includeLargeCells=true for the full value]";

export interface DbAdminRuntime {
  db?: DbExec;
  notifyChange?: () => Promise<void>;
}

function assertIdent(name: string, kind = "identifier"): string {
  if (typeof name !== "string" || !IDENT_RE.test(name)) {
    throw new Error(`Invalid ${kind}: ${JSON.stringify(name)}`);
  }
  return name;
}

function quoteIdent(name: string): string {
  return `"${assertIdent(name)}"`;
}

function db(runtime?: DbAdminRuntime): DbExec {
  return runtime?.db ?? getDbExec();
}

function isPreviewableLargeColumn(column: DbAdminColumn): boolean {
  const type = column.type.toLowerCase();
  return /\b(text|char|varchar|character|jsonb?|xml|clob)\b/.test(type);
}

function markLargeValuePreviewColumns(
  columns: DbAdminColumn[],
  includeLargeCells: boolean,
): DbAdminColumn[] {
  if (includeLargeCells) return columns;
  return columns.map((column) =>
    isPreviewableLargeColumn(column)
      ? { ...column, largeValuePreview: true }
      : column,
  );
}

function buildRowsSelectList(
  columns: DbAdminColumn[],
  includeLargeCells: boolean,
): string {
  if (includeLargeCells) {
    return columns.map((column) => quoteIdent(column.name)).join(", ");
  }

  return columns
    .map((column) => {
      const quoted = quoteIdent(column.name);
      if (!isPreviewableLargeColumn(column)) return quoted;
      const textValue = `CAST(${quoted} AS TEXT)`;
      return `CASE WHEN length(${textValue}) > ${LARGE_CELL_PREVIEW_CHARS} THEN substr(${textValue}, 1, ${LARGE_CELL_PREVIEW_CHARS}) || '${LARGE_CELL_SUFFIX.replace(/'/g, "''")}' ELSE ${textValue} END AS ${quoted}`;
    })
    .join(", ");
}

function truncateLargeResultCells(rows: Record<string, unknown>[]): {
  rows: Record<string, unknown>[];
  truncatedCells: number;
} {
  let truncatedCells = 0;
  const mapped = rows.map((row) => {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (
        typeof value === "string" &&
        value.length > LARGE_CELL_PREVIEW_CHARS
      ) {
        next[key] =
          `${value.slice(0, LARGE_CELL_PREVIEW_CHARS)}${LARGE_CELL_SUFFIX}`;
        truncatedCells += 1;
        changed = true;
      } else {
        next[key] = value;
      }
    }
    return changed ? next : row;
  });
  return { rows: mapped, truncatedCells };
}

function countTruncatedResultCells(rows: Record<string, unknown>[]): number {
  let truncatedCells = 0;
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (typeof value === "string" && value.endsWith(LARGE_CELL_SUFFIX)) {
        truncatedCells += 1;
      }
    }
  }
  return truncatedCells;
}

function containsLargeCellPreview(value: unknown): boolean {
  if (typeof value === "string") return value.endsWith(LARGE_CELL_SUFFIX);
  if (Array.isArray(value)) return value.some(containsLargeCellPreview);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(
      containsLargeCellPreview,
    );
  }
  return false;
}

function assertNoLargeCellPreviewMutation(
  row: Record<string, unknown>,
  context: string,
): void {
  for (const [column, value] of Object.entries(row)) {
    if (containsLargeCellPreview(value)) {
      throw new Error(
        `Refusing to ${context} with previewed large-cell value in column "${column}". Reload the row with includeLargeCells=true before saving.`,
      );
    }
  }
}

async function notifyDbAdminChange(runtime?: DbAdminRuntime): Promise<void> {
  if (runtime?.notifyChange) {
    await runtime.notifyChange();
    return;
  }
  await notifyActionChange({ actionName: "db-admin" }).catch(() => {});
}

export async function listTables(
  runtime?: DbAdminRuntime,
  options: { maxRowCounts?: number } = {},
): Promise<{ tables: DbAdminTableSummary[] }> {
  const client = db(runtime);
  const summaries: DbAdminTableSummary[] = [];
  const maxRowCounts = Number.isFinite(options.maxRowCounts)
    ? Math.max(0, Math.floor(options.maxRowCounts!))
    : Number.POSITIVE_INFINITY;
  let rowCountQueries = 0;
  const rowCount = async (
    name: string,
    type: "table" | "view",
  ): Promise<number | null> => {
    if (type === "view" || rowCountQueries >= maxRowCounts) return null;
    rowCountQueries += 1;
    return safeRowCount(name, runtime);
  };

  const res = await client.execute(
    `SELECT table_name AS name, table_type AS type
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type IN ('BASE TABLE', 'VIEW')
     ORDER BY table_name`,
  );
  for (const row of res.rows) {
    const name = String((row as any).name);
    const type = (row as any).type === "VIEW" ? "view" : "table";
    summaries.push({
      name,
      type,
      rowCount: await rowCount(name, type),
    });
  }

  return { tables: summaries };
}

async function safeRowCount(
  table: string,
  runtime?: DbAdminRuntime,
): Promise<number | null> {
  try {
    const client = db(runtime);
    const res = await client.execute(
      `SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`,
    );
    const c = (res.rows[0] as any)?.c;
    const n = Number(c);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function getTableSchema(
  table: string,
  runtime?: DbAdminRuntime,
): Promise<DbAdminTableSchema> {
  assertIdent(table, "table name");
  return getTableSchemaPostgres(table, runtime);
}

async function getTableSchemaPostgres(
  table: string,
  runtime?: DbAdminRuntime,
): Promise<DbAdminTableSchema> {
  const client = db(runtime);

  const typeRes = await client.execute({
    sql: `SELECT table_type AS type FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ?`,
    args: [table],
  });
  const type = (typeRes.rows[0] as any)?.type === "VIEW" ? "view" : "table";

  const colRes = await client.execute({
    sql: `SELECT
            column_name AS name,
            data_type AS type,
            CASE WHEN is_nullable = 'NO' THEN 0 ELSE 1 END AS nullable,
            column_default AS dflt
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ?
          ORDER BY ordinal_position`,
    args: [table],
  });

  const pkRes = await client.execute({
    sql: `SELECT kcu.column_name AS col
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.table_name = ?
            AND tc.table_schema = 'public'
            AND tc.constraint_type = 'PRIMARY KEY'
          ORDER BY kcu.ordinal_position`,
    args: [table],
  });
  const primaryKey = pkRes.rows.map((r) => String((r as any).col));
  const pkSet = new Set(primaryKey);

  const fkRes = await client.execute({
    sql: `SELECT
            kcu.column_name AS col,
            ccu.table_name AS ref_table,
            ccu.column_name AS ref_col
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
            AND tc.table_schema = ccu.table_schema
          WHERE tc.table_name = ?
            AND tc.table_schema = 'public'
            AND tc.constraint_type = 'FOREIGN KEY'`,
    args: [table],
  });
  const foreignKeys: DbAdminForeignKey[] = fkRes.rows.map((r) => ({
    column: String((r as any).col),
    refTable: String((r as any).ref_table),
    refColumn: String((r as any).ref_col),
  }));

  const idxRes = await client.execute({
    sql: `SELECT indexname AS name, indexdef AS def
          FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = ?`,
    args: [table],
  });
  const indexes: DbAdminIndex[] = idxRes.rows.map((r) => {
    const def = String((r as any).def ?? "");
    const colMatch = def.match(/\(([^)]+)\)/);
    const columns = colMatch
      ? colMatch[1]
          .split(",")
          .map((c) => c.trim().replace(/^"|"$/g, ""))
          .filter(Boolean)
      : [];
    return {
      name: String((r as any).name),
      unique: /\bUNIQUE\b/i.test(def),
      columns,
    };
  });

  const columns: DbAdminColumn[] = colRes.rows.map((r) => {
    const name = String((r as any).name);
    const dflt = (r as any).dflt;
    const defaultValue = dflt == null ? null : String(dflt);
    return {
      name,
      type: String((r as any).type ?? "ANY"),
      nullable: Number((r as any).nullable) === 1,
      pk: pkSet.has(name),
      defaultValue,
      autoIncrement:
        defaultValue != null &&
        (/nextval\(/i.test(defaultValue) || /identity/i.test(defaultValue)),
    };
  });

  return {
    name: table,
    type,
    columns,
    primaryKey,
    foreignKeys,
    indexes,
    rowCount: type === "view" ? null : await safeRowCount(table, runtime),
  };
}

const SAFE_OPS = new Set([
  "eq",
  "neq",
  "lt",
  "lte",
  "gt",
  "gte",
  "like",
  "ilike",
  "in",
  "is_null",
  "not_null",
]);

const OP_SQL: Record<string, string> = {
  eq: "=",
  neq: "<>",
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
  like: "LIKE",
};

function buildWhere(filters: DbAdminFilter[] | undefined): {
  clause: string;
  args: unknown[];
} {
  if (!filters || filters.length === 0) return { clause: "", args: [] };
  const parts: string[] = [];
  const args: unknown[] = [];
  for (const f of filters) {
    const col = quoteIdent(f.column);
    if (!SAFE_OPS.has(f.op)) {
      throw new Error(`Invalid filter op: ${JSON.stringify(f.op)}`);
    }
    switch (f.op) {
      case "is_null":
        parts.push(`${col} IS NULL`);
        break;
      case "not_null":
        parts.push(`${col} IS NOT NULL`);
        break;
      case "in": {
        const values = Array.isArray(f.value) ? f.value : [f.value];
        if (values.length === 0) {
          parts.push(`1 = 0`);
          break;
        }
        parts.push(`${col} IN (${values.map(() => "?").join(", ")})`);
        args.push(...values);
        break;
      }
      case "ilike": {
        parts.push(`${col} ILIKE ?`);
        args.push(f.value);
        break;
      }
      default: {
        parts.push(`${col} ${OP_SQL[f.op]} ?`);
        args.push(f.value);
        break;
      }
    }
  }
  return { clause: parts.length ? ` WHERE ${parts.join(" AND ")}` : "", args };
}

function buildOrderBy(sort: DbAdminRowsRequest["sort"]): string {
  if (!sort || sort.length === 0) return "";
  const parts = sort.map((s) => {
    const dir = s.dir === "desc" ? "DESC" : "ASC";
    return `${quoteIdent(s.column)} ${dir}`;
  });
  return ` ORDER BY ${parts.join(", ")}`;
}

export async function getRows(
  table: string,
  req: DbAdminRowsRequest,
  runtime?: DbAdminRuntime,
): Promise<DbAdminRowsResult> {
  assertIdent(table, "table name");
  const client = db(runtime);
  const schema = await getTableSchema(table, runtime);

  const page = Math.max(1, Math.floor(req.page) || 1);
  const pageSize = Math.min(1000, Math.max(1, Math.floor(req.pageSize) || 50));
  const offset = (page - 1) * pageSize;

  const where = buildWhere(req.filters);
  const orderBy = buildOrderBy(req.sort);
  const quoted = quoteIdent(table);
  const includeLargeCells = req.includeLargeCells === true;
  const selectList = buildRowsSelectList(schema.columns, includeLargeCells);

  const countRes = await client.execute({
    sql: `SELECT COUNT(*) AS c FROM ${quoted}${where.clause}`,
    args: where.args,
  });
  const total = Number((countRes.rows[0] as any)?.c ?? 0) || 0;

  const rowsRes = await client.execute({
    sql: `SELECT ${selectList} FROM ${quoted}${where.clause}${orderBy} LIMIT ? OFFSET ?`,
    args: [...where.args, pageSize, offset],
  });
  const rows = rowsRes.rows as Record<string, unknown>[];

  return {
    columns: markLargeValuePreviewColumns(schema.columns, includeLargeCells),
    rows,
    total,
    page,
    pageSize,
    truncatedCells: includeLargeCells ? 0 : countTruncatedResultCells(rows),
  };
}

function buildInsert(
  table: string,
  row: Record<string, unknown>,
): { sql: string; args: unknown[] } {
  const cols = Object.keys(row);
  if (cols.length === 0) {
    throw new Error("Cannot insert an empty row");
  }
  assertNoLargeCellPreviewMutation(row, "insert");
  cols.forEach((c) => assertIdent(c, "column name"));
  const sql = `INSERT INTO ${quoteIdent(table)} (${cols
    .map(quoteIdent)
    .join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  return { sql, args: cols.map((c) => row[c]) };
}

function buildUpdate(
  table: string,
  set: Record<string, unknown>,
  where: Record<string, unknown>,
): { sql: string; args: unknown[] } {
  const setCols = Object.keys(set);
  const whereCols = Object.keys(where);
  if (setCols.length === 0) throw new Error("Update requires a non-empty set");
  if (whereCols.length === 0) {
    throw new Error("Update requires a non-empty where clause");
  }
  assertNoLargeCellPreviewMutation(set, "update");
  assertNoLargeCellPreviewMutation(where, "match rows");
  setCols.forEach((c) => assertIdent(c, "column name"));
  whereCols.forEach((c) => assertIdent(c, "column name"));
  const setSql = setCols.map((c) => `${quoteIdent(c)} = ?`).join(", ");
  const whereSql = whereCols.map((c) => `${quoteIdent(c)} = ?`).join(" AND ");
  const sql = `UPDATE ${quoteIdent(table)} SET ${setSql} WHERE ${whereSql}`;
  return {
    sql,
    args: [...setCols.map((c) => set[c]), ...whereCols.map((c) => where[c])],
  };
}

function buildDelete(
  table: string,
  where: Record<string, unknown>,
): { sql: string; args: unknown[] } {
  const whereCols = Object.keys(where);
  if (whereCols.length === 0) {
    throw new Error("Delete requires a non-empty where clause");
  }
  assertNoLargeCellPreviewMutation(where, "delete");
  whereCols.forEach((c) => assertIdent(c, "column name"));
  const whereSql = whereCols.map((c) => `${quoteIdent(c)} = ?`).join(" AND ");
  const sql = `DELETE FROM ${quoteIdent(table)} WHERE ${whereSql}`;
  return { sql, args: whereCols.map((c) => where[c]) };
}

export async function applyMutations(
  table: string,
  m: DbAdminMutation,
  runtime?: DbAdminRuntime,
): Promise<DbAdminMutationResult> {
  assertIdent(table, "table name");

  const statements: { sql: string; args: unknown[] }[] = [];
  for (const row of m.inserts ?? []) statements.push(buildInsert(table, row));
  for (const u of m.updates ?? []) {
    statements.push(buildUpdate(table, u.set, u.where));
  }
  for (const where of m.deletes ?? []) {
    statements.push(buildDelete(table, where));
  }

  const result: DbAdminMutationResult = {
    sql: statements.map((s) => s.sql),
    inserted: 0,
    updated: 0,
    deleted: 0,
  };

  if (m.dryRun) {
    return result;
  }

  const client = db(runtime);
  const insertCount = m.inserts?.length ?? 0;
  const updateCount = m.updates?.length ?? 0;

  let executed = 0;
  for (const stmt of statements) {
    const res = await client.execute({ sql: stmt.sql, args: stmt.args });
    if (executed < insertCount) {
      result.inserted += 1;
    } else if (executed < insertCount + updateCount) {
      result.updated += res.rowsAffected || 0;
    } else {
      result.deleted += res.rowsAffected || 0;
    }
    executed += 1;
  }

  if (statements.length > 0) await notifyDbAdminChange(runtime);
  return result;
}

export class DbAdminConfirmRequiredError extends Error {
  readonly needsConfirm = true;
  constructor(message: string) {
    super(message);
    this.name = "DbAdminConfirmRequiredError";
  }
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n\r]*/g, " ");
}

function isMutatingSql(sql: string): boolean {
  const head = stripComments(sql).trim().toLowerCase();
  return /^(insert|update|delete|create|alter|drop|truncate|merge)/.test(head);
}

function isDestructiveSql(sql: string): boolean {
  const cleaned = stripComments(sql).trim();
  const lower = cleaned.toLowerCase();
  if (/^drop\b/.test(lower)) return true;
  if (/^truncate\b/.test(lower)) return true;
  if (/^delete\b/.test(lower) && !/\bwhere\b/.test(lower)) return true;
  if (/^update\b/.test(lower) && !/\bwhere\b/.test(lower)) return true;
  return false;
}

function isBareSelectWithoutLimit(sql: string): boolean {
  const cleaned = stripComments(sql).trim();
  const lower = cleaned.toLowerCase();
  const isSelect = /^(select|with)\b/.test(lower);
  if (!isSelect) return false;
  if (/\blimit\b/.test(lower)) return false;
  return true;
}

export async function runSql(
  sql: string,
  params: unknown[] | undefined,
  opts: { confirmDestructive?: boolean } = {},
  runtime?: DbAdminRuntime,
): Promise<DbAdminQueryResult> {
  if (typeof sql !== "string" || !sql.trim()) {
    throw new Error("SQL is required");
  }

  if (isDestructiveSql(sql) && !opts.confirmDestructive) {
    throw new DbAdminConfirmRequiredError(
      "This statement is destructive (DROP / TRUNCATE / unscoped DELETE or UPDATE). Re-run with confirmDestructive: true to proceed.",
    );
  }

  let finalSql = sql.trim().replace(/;\s*$/, "");
  if (isBareSelectWithoutLimit(finalSql)) {
    finalSql = `${finalSql} LIMIT 100`;
  }

  const client = db(runtime);
  const started = Date.now();
  const res = await client.execute(
    params && params.length > 0 ? { sql: finalSql, args: params } : finalSql,
  );
  const durationMs = Date.now() - started;

  const truncation = truncateLargeResultCells(
    (res.rows ?? []) as Record<string, unknown>[],
  );
  const rows = truncation.rows;
  const columns =
    rows.length > 0 && rows[0] && typeof rows[0] === "object"
      ? Object.keys(rows[0])
      : [];

  if (isMutatingSql(finalSql)) await notifyDbAdminChange(runtime);

  return {
    columns,
    rows,
    rowsAffected: res.rowsAffected ?? 0,
    durationMs,
    truncatedCells: truncation.truncatedCells,
  };
}
