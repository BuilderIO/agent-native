function stringifyValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  return value == null ? "" : (JSON.stringify(value) ?? "");
}

import { withoutWriteObservation } from "../action-frame.js";
import {
  getDbExec,
  isProductionServerlessFunctionRuntime,
  type DbExec,
  type DbExecStatement,
} from "./client.js";
import {
  appMigratesAtRelease,
  schemaEnsureSkipRequested,
} from "./migration-policy.js";
import {
  isHostedFunctionInvocationRuntime,
  isMigrationExecutingRuntime,
  isMigrationAuthorizedRuntime,
  withMigrationExecutionRuntime,
} from "./migration-runtime.js";
import { retainRequestDbPoolScope } from "./request-pool-context.js";
import { dbClientGeneration, isPgCatalogRace } from "./runtime-facts.js";

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const PROBE_DIAGNOSTIC_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "28000",
  "28P01",
  "42501",
  "53300",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "CONNECT_TIMEOUT",
  "DB_CONNECT_COOLDOWN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

function probeDiagnosticCode(error: unknown): string | undefined {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  const property = (value: object, key: "code" | "cause" | "sourceError") => {
    try {
      return (value as Record<string, unknown>)[key];
      // coercion-ok: unreadable error properties mean an unknown diagnostic, not a successful probe.
    } catch {
      return undefined;
    }
  };
  while (pending.length > 0 && seen.size < 8) {
    const current = pending.shift();
    if (typeof current !== "object" || current === null || seen.has(current))
      continue;
    seen.add(current);
    const code = property(current, "code");
    if (typeof code === "string" && PROBE_DIAGNOSTIC_CODES.has(code))
      return code;
    pending.push(property(current, "cause"), property(current, "sourceError"));
  }
  return undefined;
}

function schemaEnsureDisabled(): boolean {
  if (isMigrationExecutingRuntime() || isMigrationAuthorizedRuntime())
    return false;
  if (
    appMigratesAtRelease() &&
    (isHostedFunctionInvocationRuntime() ||
      isProductionServerlessFunctionRuntime())
  ) {
    return true;
  }
  return schemaEnsureSkipRequested();
}

// The ensure* helpers run their DDL through here. It is idempotent setup the
// first action to need it happens to run, so it never counts as that action's
// write.
async function withLegacyServerlessSchemaDdl<T>(
  run: () => Promise<T>,
): Promise<T> {
  const exempt = () => withoutWriteObservation(run);
  if (
    !isMigrationExecutingRuntime() &&
    !appMigratesAtRelease() &&
    (isHostedFunctionInvocationRuntime() ||
      isProductionServerlessFunctionRuntime())
  ) {
    return withMigrationExecutionRuntime(exempt);
  }
  return exempt();
}

type SchemaSnapshot = {
  tables: Set<string>;
  columns: Set<string>;
  indexes: Set<string>;
};

const injectedSnapshots = new WeakMap<DbExec, Promise<SchemaSnapshot | null>>();
let globalSnapshot: Promise<SchemaSnapshot | null> | undefined;
let globalSnapshotGeneration: number | undefined;

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
  } catch {
    warnOnce(
      "introspection-unavailable",
      "[db] batched schema introspection unavailable; falling back to one probe " +
        "per table/column/index (slower cold starts, same behaviour)",
    );
    return null;
  }
}

const warnedOnce = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(message);
}

function schemaSnapshot(client: DbExec, injected: boolean) {
  if (injected) {
    let pending = injectedSnapshots.get(client);
    if (!pending) {
      pending = retainRequestDbPoolScope(loadSchemaSnapshot(client));
      injectedSnapshots.set(client, pending);
    }
    return pending;
  }
  // The snapshot describes one database; closing the clients may reconnect
  // this process to another.
  const generation = dbClientGeneration();
  if (globalSnapshotGeneration !== generation) {
    globalSnapshot = undefined;
    globalSnapshotGeneration = generation;
  }
  if (!globalSnapshot) {
    globalSnapshot = retainRequestDbPoolScope(loadSchemaSnapshot(client));
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
  } catch (err) {
    const code = probeDiagnosticCode(err) ?? "unknown";
    warnOnce(
      `probe-unreadable:${table}:${code}`,
      `[db] schema probe unreadable for table "${table}" (code: ${code})`,
    );
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
  timeoutMs?: number;
  injectedClient?: DbExec;
}): Promise<boolean> {
  const { probe, ddl, label, lockTimeout, timeoutMs, injectedClient } = options;
  const initiallyExists = await probe();
  if (initiallyExists === true) return false;
  if (initiallyExists === undefined) {
    throw new Error(
      `ensureSchemaObject: could not probe required schema "${label}"; refusing to issue DDL`,
    );
  }
  const isDuplicateSchemaError = (err: unknown): boolean => {
    let current = err;
    let codedError: { code?: unknown; cause?: unknown } | undefined;
    const seen = new Set<object>();
    for (let depth = 0; depth < 8; depth += 1) {
      if (typeof current !== "object" || current === null) break;
      if (current instanceof AggregateError || seen.has(current)) return false;
      seen.add(current);
      const error = current as { code?: unknown; cause?: unknown };
      if (typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)) {
        codedError = error;
      }
      if (error.cause == null) break;
      if (depth === 7) return false;
      current = error.cause;
    }
    return codedError?.code === "42701" || isPgCatalogRace(codedError);
  };
  const attempts = lockTimeout === undefined ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let ran: boolean;
    try {
      try {
        ran = await withLegacyServerlessSchemaDdl(() =>
          runGuardedDdl(ddl, {
            lockTimeout: lockTimeout ?? "1s",
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
            ...(injectedClient === undefined ? {} : { injectedClient }),
          }),
        );
      } finally {
        invalidateSchemaSnapshot(injectedClient);
      }
    } catch (err) {
      if (!isDuplicateSchemaError(err)) throw err;
      let existsAfterDuplicate: boolean | undefined;
      try {
        existsAfterDuplicate = await probe();
      } catch (probeError) {
        throw new AggregateError(
          [err, probeError],
          `ensureSchemaObject: could not re-probe required schema "${label}" after duplicate DDL`,
        );
      }
      if (existsAfterDuplicate === true) return true;
      if (existsAfterDuplicate === undefined) {
        throw new Error(
          `ensureSchemaObject: could not re-probe required schema "${label}" after duplicate DDL`,
          { cause: err },
        );
      }
      throw err;
    }
    if (ran) return true;
    const existsAfterTimeout = await probe();
    if (existsAfterTimeout === true) return true;
    if (existsAfterTimeout === undefined) {
      throw new Error(
        `ensureSchemaObject: could not re-probe required schema "${label}" after a lock-timed-out DDL`,
      );
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
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
    ...options,
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
    ...options,
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
    timeoutMs?: number;
    injectedClient?: DbExec;
  } = {},
): Promise<boolean> {
  if (!schemaEnsureDisabled()) {
    const client = options.injectedClient ?? getDbExec();
    await withLegacyServerlessSchemaDdl(() =>
      dropInvalidIndex(indexName, client),
    );
  }
  return ensureSchemaObject({
    probe: () => pgIndexExists(indexName, options.injectedClient),
    ddl: createIndexSql,
    label: `index ${indexName}`,
    ...options,
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
  if (schemaEnsureDisabled()) return false;
  const client = options.injectedClient ?? getDbExec();
  const initiallyExists = await pgIndexExists(indexName, client);
  if (initiallyExists === true) return false;
  if (initiallyExists === undefined) {
    throw new Error(
      `ensureIndexExistsConcurrently: could not probe required index "${indexName}"; refusing to issue DDL`,
    );
  }

  await withLegacyServerlessSchemaDdl(() =>
    dropInvalidIndex(indexName, client),
  );

  await withLegacyServerlessSchemaDdl(() => client.execute(createIndexSql));
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
  let current = err;
  let message: unknown;
  let hasCode = false;
  const seen = new Set<object>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) {
      if (current != null) message = current;
      break;
    }
    if (seen.has(current)) return false;
    seen.add(current);
    const error = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (error.code === "55P03") return true;
    if (typeof error.code === "string" && error.code) hasCode = true;
    message = error.message;
    if (error.cause == null) break;
    if (depth === 7) return false;
    current = error.cause;
  }
  if (hasCode || typeof message !== "string") return false;
  return /^(?:cancel(?:l)?ing statement due to lock timeout|lock timeout(?: exceeded)?)(?:[.:;!]|$)/i.test(
    message.trim(),
  );
}

export async function runGuardedDdl(
  ddl: string,
  options: {
    lockTimeout?: string;
    idleInTransactionTimeout?: string;
    /** Per-statement budget for the DDL itself, in place of the default. */
    timeoutMs?: number;
    injectedClient?: DbExec;
  } = {},
): Promise<boolean> {
  const client = options.injectedClient ?? getDbExec();

  const lockTimeout = options.lockTimeout ?? "3s";
  const idleInTransactionTimeout = options.idleInTransactionTimeout ?? "30s";
  const statement: DbExecStatement =
    options.timeoutMs === undefined
      ? ddl
      : { sql: ddl, timeoutMs: options.timeoutMs };
  if (typeof client.transaction === "function") {
    try {
      await client.transaction(async (tx) => {
        await tx.execute(`SET LOCAL lock_timeout = '${lockTimeout}'`);
        await tx.execute(
          `SET LOCAL idle_in_transaction_session_timeout = '${idleInTransactionTimeout}'`,
        );
        await tx.execute(statement);
      });
      return true;
    } catch (err) {
      if (isLockTimeoutError(err)) return false;
      throw err;
    }
  }

  try {
    await client.execute(`SET lock_timeout = '${lockTimeout}'`);
    await client.execute(statement);
  } catch (err) {
    try {
      await client.execute(`RESET lock_timeout`);
    } catch (resetError) {
      throw new AggregateError(
        [err, resetError],
        "Guarded DDL and session cleanup both failed",
      );
    }
    if (isLockTimeoutError(err)) return false;
    throw err;
  }
  try {
    await client.execute(`RESET lock_timeout`);
  } catch (resetError) {
    throw new AggregateError(
      [resetError],
      "Guarded DDL session cleanup failed",
    );
  }
  return true;
}
