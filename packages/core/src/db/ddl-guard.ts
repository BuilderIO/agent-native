function stringifyValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  return value == null ? "" : (JSON.stringify(value) ?? "");
}

import {
  getDbExec,
  isProductionServerlessFunctionRuntime,
  type DbExec,
} from "./client.js";
import { isMigrationAuthorizedRuntime } from "./migration-runtime.js";

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function schemaEnsureDisabled(): boolean {
  if (isMigrationAuthorizedRuntime()) return false;
  if (isProductionServerlessFunctionRuntime()) return true;
  const raw = process.env.AGENT_NATIVE_SKIP_ENSURE_TABLES?.trim();
  return !!raw && ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

type SchemaSnapshot = {
  tables: Set<string>;
  columns: Set<string>;
  indexes: Set<string>;
};

const injectedSnapshots = new WeakMap<DbExec, Promise<SchemaSnapshot | null>>();
let globalSnapshot: Promise<SchemaSnapshot | null> | undefined;

export function invalidateSchemaSnapshot(injectedClient?: DbExec): void {
  globalSnapshot = undefined;
  if (injectedClient) injectedSnapshots.delete(injectedClient);
}

export function __resetSchemaSnapshotForTests(): void {
  globalSnapshot = undefined;
}

async function loadSchemaSnapshot(
  client: DbExec,
): Promise<SchemaSnapshot | null> {
  try {
    const [columnRows, indexRows] = await Promise.all([
      client.execute(
        `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
      ),
      client.execute(
        `SELECT indexes.indexname
         FROM pg_indexes AS indexes
         JOIN pg_class AS index_class ON index_class.relname = indexes.indexname
         JOIN pg_namespace AS index_namespace
           ON index_namespace.oid = index_class.relnamespace
          AND index_namespace.nspname = indexes.schemaname
         JOIN pg_index AS index_state ON index_state.indexrelid = index_class.oid
         WHERE indexes.schemaname = 'public'
           AND index_state.indisvalid
           AND index_state.indisready`,
      ),
    ]);
    const columnData = columnRows.rows as Record<string, unknown>[];
    const indexData = indexRows.rows as Record<string, unknown>[];
    if (columnData.length > 0 && !("table_name" in columnData[0])) return null;
    if (indexData.length > 0 && !("indexname" in indexData[0])) return null;

    const tables = new Set<string>();
    const columns = new Set<string>();
    for (const row of columnData) {
      const table = stringifyValue(row.table_name ?? "").toLowerCase();
      const column = stringifyValue(row.column_name ?? "").toLowerCase();
      if (!table) continue;
      tables.add(table);
      if (column) columns.add(`${table}.${column}`);
    }
    const indexes = new Set<string>();
    for (const row of indexData) {
      const name = stringifyValue(row.indexname ?? "").toLowerCase();
      if (name) indexes.add(name);
    }
    return { tables, columns, indexes };
  } catch (err) {
    warnIntrospectionUnavailableOnce(err);
    return null;
  }
}

let _warnedIntrospectionUnavailable = false;

function warnIntrospectionUnavailableOnce(err: unknown): void {
  if (_warnedIntrospectionUnavailable) return;
  _warnedIntrospectionUnavailable = true;
  console.warn(
    "[db] batched schema introspection unavailable; falling back to one probe " +
      "per table/column/index (slower cold starts, same behaviour): " +
      ((err as Error)?.message ?? err),
  );
}

function schemaSnapshot(client: DbExec, injected: boolean) {
  if (injected) {
    let pending = injectedSnapshots.get(client);
    if (!pending) {
      pending = loadSchemaSnapshot(client);
      injectedSnapshots.set(client, pending);
    }
    return pending;
  }
  if (!globalSnapshot) {
    globalSnapshot = loadSchemaSnapshot(client);
  }
  return globalSnapshot;
}

async function snapshotHas(
  kind: "table" | "column" | "index",
  key: string,
  client: DbExec,
  injected: boolean,
): Promise<boolean | undefined> {
  const snapshot = await schemaSnapshot(client, injected);
  if (!snapshot) return undefined;
  const set =
    kind === "table"
      ? snapshot.tables
      : kind === "column"
        ? snapshot.columns
        : snapshot.indexes;
  return set.has(key.toLowerCase());
}

export async function pgTableExists(
  table: string,
  injectedClient?: DbExec,
): Promise<boolean | undefined> {
  if (!PLAIN_IDENTIFIER.test(table)) {
    return false;
  }
  if (schemaEnsureDisabled()) return true;
  const client = injectedClient ?? getDbExec();
  const cached = await snapshotHas("table", table, client, !!injectedClient);
  if (cached !== undefined) return cached;
  try {
    const { rows } = await client.execute({
      sql: `SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = ? LIMIT 1`,
      args: [table],
    });
    return rows.length > 0;
  } catch {
    // coercion-ok: undefined is a typed unreadable state; callers throw rather
    // than issuing DDL against an unverified schema.
    // A failed probe is not evidence that the table is absent. Let the caller
    // fail loudly rather than issuing DDL against a database it cannot read.
    return undefined;
  }
}

export async function pgColumnExists(
  table: string,
  column: string,
  injectedClient?: DbExec,
): Promise<boolean | undefined> {
  if (!PLAIN_IDENTIFIER.test(table) || !PLAIN_IDENTIFIER.test(column)) {
    return false;
  }
  if (schemaEnsureDisabled()) return true;
  const client = injectedClient ?? getDbExec();
  const cached = await snapshotHas(
    "column",
    `${table}.${column}`,
    client,
    !!injectedClient,
  );
  if (cached !== undefined) return cached;
  try {
    const { rows } = await client.execute({
      sql: `SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ? AND column_name = ?
            LIMIT 1`,
      args: [table, column],
    });
    return rows.length > 0;
  } catch {
    // coercion-ok: undefined distinguishes an unreadable schema probe from an
    // absent column, and ensureSchemaObject fails closed on it.
    return undefined;
  }
}

export async function pgIndexExists(
  indexName: string,
  injectedClient?: DbExec,
): Promise<boolean | undefined> {
  if (!PLAIN_IDENTIFIER.test(indexName)) {
    return false;
  }
  if (schemaEnsureDisabled()) return true;
  const client = injectedClient ?? getDbExec();
  const cached = await snapshotHas(
    "index",
    indexName,
    client,
    !!injectedClient,
  );
  if (cached !== undefined) return cached;
  try {
    const { rows } = await client.execute({
      sql: `SELECT 1
            FROM pg_indexes AS indexes
            JOIN pg_class AS index_class
              ON index_class.relname = indexes.indexname
            JOIN pg_namespace AS index_namespace
              ON index_namespace.oid = index_class.relnamespace
             AND index_namespace.nspname = indexes.schemaname
            JOIN pg_index AS index_state
              ON index_state.indexrelid = index_class.oid
            WHERE indexes.schemaname = 'public'
              AND indexes.indexname = ?
              AND index_state.indisvalid
              AND index_state.indisready
            LIMIT 1`,
      args: [indexName],
    });
    return rows.length > 0;
  } catch {
    // coercion-ok: undefined distinguishes an unreadable schema probe from an
    // absent index, and ensureSchemaObject fails closed on it.
    return undefined;
  }
}

export async function ensureSchemaObject(options: {
  probe: () => Promise<boolean | undefined>;
  ddl: string;
  label: string;
  lockTimeout?: string;
  injectedClient?: DbExec;
}): Promise<boolean> {
  const { probe, ddl, label, lockTimeout, injectedClient } = options;
  const initiallyExists = await probe();
  if (initiallyExists === true) return false;
  if (initiallyExists === undefined) {
    throw new Error(
      `ensureSchemaObject: could not probe required schema "${label}"; refusing to issue DDL`,
    );
  }
  const ran = await runGuardedDdl(ddl, {
    lockTimeout,
    injectedClient,
  });
  invalidateSchemaSnapshot(injectedClient);
  if (ran) return true;
  const existsAfterTimeout = await probe();
  if (existsAfterTimeout === true) return true;
  if (existsAfterTimeout === undefined) {
    throw new Error(
      `ensureSchemaObject: could not re-probe required schema "${label}" after a lock-timed-out DDL`,
    );
  }
  throw new Error(
    `ensureSchemaObject: required schema "${label}" is still missing after a ` +
      `lock-timed-out DDL; refusing to memoize init success. The next call will retry.`,
  );
}

export async function ensureTableExists(
  table: string,
  createSql: string,
  options: {
    lockTimeout?: string;
    injectedClient?: DbExec;
  } = {},
): Promise<boolean> {
  return ensureSchemaObject({
    probe: () => pgTableExists(table, options.injectedClient),
    ddl: createSql,
    label: `table ${table}`,
    lockTimeout: options.lockTimeout,
    injectedClient: options.injectedClient,
  });
}

export async function ensureColumnExists(
  table: string,
  column: string,
  addColumnSql: string,
  options: { lockTimeout?: string; injectedClient?: DbExec } = {},
): Promise<boolean> {
  return ensureSchemaObject({
    probe: () => pgColumnExists(table, column, options.injectedClient),
    ddl: addColumnSql,
    label: `column ${table}.${column}`,
    lockTimeout: options.lockTimeout,
    injectedClient: options.injectedClient,
  });
}

async function dropInvalidIndex(
  indexName: string,
  client: DbExec,
): Promise<void> {
  if (!PLAIN_IDENTIFIER.test(indexName)) return;
  const { rows } = await client.execute({
    sql: `SELECT 1
          FROM pg_class AS index_class
          JOIN pg_namespace AS index_namespace
            ON index_namespace.oid = index_class.relnamespace
           AND index_namespace.nspname = 'public'
          JOIN pg_index AS index_state
            ON index_state.indexrelid = index_class.oid
          WHERE index_class.relname = ?
            AND NOT index_state.indisvalid
          LIMIT 1`,
    args: [indexName],
  });
  if (rows.length === 0) return;
  console.warn(
    `[db] dropping INVALID index "${indexName}" so it can be rebuilt; ` +
      `a previous CREATE INDEX left it unusable.`,
  );
  await client.execute(`DROP INDEX IF EXISTS "${indexName}"`);
  invalidateSchemaSnapshot(client);
}

export async function ensureIndexExists(
  indexName: string,
  createIndexSql: string,
  options: {
    lockTimeout?: string;
    injectedClient?: DbExec;
  } = {},
): Promise<boolean> {
  if (!schemaEnsureDisabled()) {
    await dropInvalidIndex(indexName, options.injectedClient ?? getDbExec());
  }
  return ensureSchemaObject({
    probe: () => pgIndexExists(indexName, options.injectedClient),
    ddl: createIndexSql,
    label: `index ${indexName}`,
    lockTimeout: options.lockTimeout,
    injectedClient: options.injectedClient,
  });
}

/**
 * Ensure an additive Postgres index with `CREATE INDEX CONCURRENTLY`.
 *
 * This is deliberately separate from `ensureIndexExists`: the normal helper
 * wraps DDL in a transaction so it can scope `lock_timeout`, but PostgreSQL
 * forbids `CREATE INDEX CONCURRENTLY` inside a transaction. The caller must
 * supply the concurrent form of the statement; direct execution keeps the
 * build outside a transaction and avoids blocking writes on a large table.
 */
export async function ensureIndexExistsConcurrently(
  indexName: string,
  createIndexSql: string,
  options: {
    injectedClient?: DbExec;
  } = {},
): Promise<boolean> {
  const client = options.injectedClient ?? getDbExec();
  const initiallyExists = await pgIndexExists(indexName, client);
  if (initiallyExists === true) return false;
  if (initiallyExists === undefined) {
    throw new Error(
      `ensureIndexExistsConcurrently: could not probe required index "${indexName}"; refusing to issue DDL`,
    );
  }

  await dropInvalidIndex(indexName, client);

  await client.execute(createIndexSql);
  invalidateSchemaSnapshot(client);
  const existsAfterCreate = await pgIndexExists(indexName, client);
  if (existsAfterCreate !== true) {
    throw new Error(
      `ensureIndexExistsConcurrently: index "${indexName}" is still missing after CREATE INDEX CONCURRENTLY`,
    );
  }
  return true;
}

export function isLockTimeoutError(err: unknown): boolean {
  const anyErr = err as { code?: unknown; message?: unknown } | null;
  if (anyErr?.code === "55P03") return true;
  const msg = stringifyValue(anyErr?.message ?? anyErr ?? "");
  return /lock[_ ]?timeout|canceling statement due to lock timeout/i.test(msg);
}

export async function runGuardedDdl(
  ddl: string,
  options: {
    lockTimeout?: string;
    idleInTransactionTimeout?: string;
    injectedClient?: DbExec;
  } = {},
): Promise<boolean> {
  const client = options.injectedClient ?? getDbExec();

  const lockTimeout = options.lockTimeout ?? "3s";
  const idleInTransactionTimeout = options.idleInTransactionTimeout ?? "30s";
  try {
    if (typeof client.transaction === "function") {
      await client.transaction(async (tx) => {
        await tx.execute(`SET LOCAL lock_timeout = '${lockTimeout}'`);
        await tx.execute(
          `SET LOCAL idle_in_transaction_session_timeout = '${idleInTransactionTimeout}'`,
        );
        await tx.execute(ddl);
      });
    } else {
      try {
        await client.execute(`SET lock_timeout = '${lockTimeout}'`);
        await client.execute(ddl);
      } finally {
        await client.execute(`RESET lock_timeout`).catch(() => {});
      }
    }
    return true;
  } catch (err) {
    if (isLockTimeoutError(err)) {
      return false;
    }
    throw err;
  }
}
