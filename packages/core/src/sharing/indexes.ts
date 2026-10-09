import { createHash } from "node:crypto";

import { getDbExec, type DbExec } from "../db/client.js";
import { ensureIndexExists } from "../db/ddl-guard.js";

/**
 * Release-time indexes for the sharing access filters.
 *
 * They are created here rather than declared on `ownableColumns()` or
 * `createSharesTable()`: those run at module load, and index DDL must not run
 * at startup. Tables are matched by column shape, so every app's ownable and
 * share tables are covered without registering them. The framework release step
 * runs before the app's own migrations, so a table created by the same release
 * gets its indexes on the next release.
 */

const OWNABLE_COLUMNS = ["owner_email", "org_id", "visibility"];
const SHARE_COLUMNS = ["resource_id", "principal_type", "principal_id"];
const POSTGRES_IDENTIFIER_MAX_BYTES = 63;
// Plain CREATE INDEX, not CONCURRENTLY: a transaction-pooled connection
// returns from CONCURRENTLY without building the index, and the release then
// fails its probe (see chat-threads/store.ts). The build holds a SHARE lock for
// its duration. The default 3s lock_timeout would abort it on a busy table, so
// only this step waits longer for that lock.
const INDEX_LOCK_TIMEOUT = "60s";
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface IndexSpec {
  name: string;
  sql: string;
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function indexName(table: string, suffix: string): string {
  const name = `${table}_access_${suffix}`;
  if (name.length <= POSTGRES_IDENTIFIER_MAX_BYTES) return name;
  // Postgres truncates an over-long identifier, and IF NOT EXISTS would then
  // skip a second table whose name truncates the same way. The hash of the full
  // name keeps the truncated names distinct, and it is stable across releases.
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
  const tail = `_${hash}_access_${suffix}`;
  return `${table.slice(0, POSTGRES_IDENTIFIER_MAX_BYTES - tail.length)}${tail}`;
}

function indexSpec(table: string, suffix: string, columns: string): IndexSpec {
  if (!PLAIN_IDENTIFIER.test(table)) {
    throw new Error(
      `sharing indexes: table "${table}" is not a plain identifier; rename it`,
    );
  }
  const name = indexName(table, suffix);
  if (new TextEncoder().encode(name).length > POSTGRES_IDENTIFIER_MAX_BYTES) {
    throw new Error(
      `sharing indexes: "${name}" exceeds ${POSTGRES_IDENTIFIER_MAX_BYTES} bytes`,
    );
  }
  return {
    name,
    sql: `CREATE INDEX IF NOT EXISTS "${name}" ON ${quoteIdentifier(table)} (${columns})`,
  };
}

function specsFor(table: string, columns: ReadonlySet<string>): IndexSpec[] {
  const specs: IndexSpec[] = [];
  if (OWNABLE_COLUMNS.every((column) => columns.has(column))) {
    specs.push(indexSpec(table, "owner_lower_idx", "lower(owner_email)"));
  }
  if (SHARE_COLUMNS.every((column) => columns.has(column))) {
    // principal_type leads the principal indexes because both access branches
    // filter on it first; a leading principal_id would never match them.
    specs.push(
      indexSpec(table, "resource_idx", "resource_id"),
      indexSpec(table, "principal_idx", "principal_type, principal_id"),
      indexSpec(
        table,
        "principal_lower_idx",
        "principal_type, lower(principal_id)",
      ),
    );
  }
  return specs;
}

/** Returns the number of indexes this call created. */
export async function ensureSharingAccessIndexes(
  options: { injectedClient?: DbExec } = {},
): Promise<number> {
  const client = options.injectedClient ?? getDbExec();
  // Base tables only: a view can carry the same columns, and CREATE INDEX on a
  // view fails the whole release.
  const { rows } = await client.execute(
    `SELECT columns.table_name, columns.column_name
       FROM information_schema.columns AS columns
       JOIN information_schema.tables AS tables
         ON tables.table_schema = columns.table_schema
        AND tables.table_name = columns.table_name
      WHERE columns.table_schema = 'public'
        AND tables.table_type = 'BASE TABLE'
        AND columns.column_name IN ('owner_email', 'org_id', 'visibility', 'resource_id', 'principal_type', 'principal_id')`,
  );
  const columnsByTable = new Map<string, Set<string>>();
  for (const row of rows) {
    const table = String(row.table_name);
    const columns = columnsByTable.get(table) ?? new Set<string>();
    columns.add(String(row.column_name));
    columnsByTable.set(table, columns);
  }

  let created = 0;
  for (const [table, columns] of columnsByTable) {
    for (const spec of specsFor(table, columns)) {
      if (
        await ensureIndexExists(spec.name, spec.sql, {
          lockTimeout: INDEX_LOCK_TIMEOUT,
          injectedClient: client,
        })
      ) {
        created++;
      }
    }
  }
  return created;
}
