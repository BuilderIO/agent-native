// guard:allow-unreleased-schema — adds columns to app-owned share tables discovered at release time; not owned by one store
import { getDbExec, type DbExec } from "../db/client.js";
import { ensureColumnExists } from "../db/ddl-guard.js";

/**
 * Columns `createSharesTable()` added after its first release. Core's sharing
 * actions read and write all of them on every table built with that helper,
 * app-owned ones included, and core only migrates its own tables. Append here
 * when `createSharesTable()` gains a column, so existing app share tables
 * converge at release instead of failing their first query.
 */
export const SHARES_TABLE_ADDED_COLUMNS = [
  { name: "notified_at", type: "TEXT" },
] as const;

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SHARES_TABLE_COLUMNS = [
  "resource_id",
  "principal_type",
  "principal_id",
  "role",
  "created_by",
];

/**
 * Statements that bring an app-owned shares table up to date. Add them to the
 * app's own migration list so a database built from migrations alone works:
 *
 *   { version: 7, sql: sharesTableMigrationSql("project_shares") }
 */
export function sharesTableMigrationSql(tableName: string): string[] {
  if (!PLAIN_IDENTIFIER.test(tableName)) {
    throw new Error(
      `sharesTableMigrationSql: "${tableName}" is not a plain identifier`,
    );
  }
  return SHARES_TABLE_ADDED_COLUMNS.map(
    (column) =>
      `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${column.name}" ${column.type}`,
  );
}

/**
 * Release-time pass: adds the columns above to every share-shaped base table
 * that lacks them. Returns the number of columns this call added.
 */
export async function ensureSharesTableColumns(
  options: { injectedClient?: DbExec } = {},
): Promise<number> {
  const client = options.injectedClient ?? getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT columns.table_name, columns.column_name
       FROM information_schema.columns AS columns
       JOIN information_schema.tables AS tables
         ON tables.table_schema = columns.table_schema
        AND tables.table_name = columns.table_name
      WHERE columns.table_schema = 'public'
        AND tables.table_type = 'BASE TABLE'
        AND columns.column_name IN ('resource_id', 'principal_type', 'principal_id', 'role', 'created_by')`,
  });
  const columnsByTable = new Map<string, Set<string>>();
  for (const row of rows) {
    const table = String(row.table_name);
    const columns = columnsByTable.get(table) ?? new Set<string>();
    columns.add(String(row.column_name));
    columnsByTable.set(table, columns);
  }
  let added = 0;
  for (const [table, columns] of columnsByTable) {
    if (!SHARES_TABLE_COLUMNS.every((column) => columns.has(column))) continue;
    if (!PLAIN_IDENTIFIER.test(table)) continue;
    for (const column of SHARES_TABLE_ADDED_COLUMNS) {
      const ddl = `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column.name}" ${column.type}`;
      if (
        await ensureColumnExists(table, column.name, ddl, {
          injectedClient: client,
        })
      ) {
        added++;
      }
    }
  }
  return added;
}
