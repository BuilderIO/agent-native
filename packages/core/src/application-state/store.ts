import {
  observeNavigationCommand,
  withoutWriteObservation,
} from "../action-frame.js";
import { getAppConfig } from "../app-config/index.js";
import { getDbExec, isLocalDatabase, type DbExec } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import {
  holdsLease,
  leaseHeldSql,
  LeaseLostError,
  type Lease,
} from "../db/leases.js";
import { sql, type SqlFragment } from "../db/sql.js";
import { defineStore } from "../db/store-registry.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import type { StoreWriteOptions } from "../settings/store.js";
import { assertNoInlineImageBytes } from "../shared/inline-bytes.js";
import { emitAppStateChange, emitAppStateDelete } from "./emitter.js";
import {
  AgentNavigationRefusedError,
  evaluateNavigateWrite,
  navigationKeyForCommandKey,
} from "./navigate-write-guard.js";

const MAX_HOSTED_APP_STATE_VALUE_BYTES = 1024 * 1024;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function escapeLike(s: string): string {
  return s.replace(/[!%_]/g, (match) => `!${match}`);
}

export const applicationStateStore = defineStore({
  id: "application_state",
  migrations: [
    {
      name: "baseline",
      run: async () => {
        const createSql = `
          CREATE TABLE IF NOT EXISTS application_state (
            session_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at BIGINT NOT NULL,
            PRIMARY KEY (session_id, key)
          )
        `;
        await ensureTableExists("application_state", createSql);
      },
    },
    {
      name: "widen-bigint",
      run: async () => {
        await widenIntColumnsToBigInt("application_state", ["updated_at"]);
      },
    },
    {
      name: "indexes",
      run: async () => {
        await ensureIndexExists(
          "app_state_updated_at_idx",
          `CREATE INDEX IF NOT EXISTS app_state_updated_at_idx ON application_state (updated_at)`,
        );
        await ensureIndexExists(
          "app_state_key_updated_idx",
          `CREATE INDEX IF NOT EXISTS app_state_key_updated_idx ON application_state (key, updated_at)`,
        );
      },
    },
    {
      // The page and number of the last ordered write applied to a row (see
      // AppStateWriteOrder). Both stay null on rows nothing ordered wrote.
      name: "write-order",
      run: async () => {
        await ensureColumnExists(
          "application_state",
          "writer",
          `ALTER TABLE application_state ADD COLUMN IF NOT EXISTS writer TEXT`,
        );
        await ensureColumnExists(
          "application_state",
          "writer_seq",
          `ALTER TABLE application_state ADD COLUMN IF NOT EXISTS writer_seq BIGINT`,
        );
      },
    },
  ],
});

/**
 * Where a write sits in its writer's order. A browser page numbers its writes
 * in the order it makes them; a write numbered at or below the last one the
 * store applied to its row from the same writer is skipped, so a request that
 * lands late can't undo a newer write from that page. Writes from another
 * writer, or with no order (agents, scripts, older clients), always apply,
 * and unordered writes leave the row's last order in place.
 */
export interface AppStateWriteOrder {
  writer: string;
  seq: number;
}

export interface AppStateWriteOptions {
  requestSource?: string | undefined;
  order?: AppStateWriteOrder | undefined;
}

export function ensureTable(): Promise<void> {
  return applicationStateStore.ready();
}

export async function appStateGet(
  sessionId: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT value FROM application_state WHERE session_id = ? AND key = ?`,
    args: [sessionId, key],
  });
  if (rows.length === 0) return null;
  return JSON.parse(rows[0].value as string);
}

export async function appStateGetManyEntries(
  sessionId: string,
  keys: readonly string[],
): Promise<Array<{ key: string; value: Record<string, unknown> | null }>> {
  const uniqueKeys = [...new Set(keys)];
  if (uniqueKeys.length === 0) return [];
  await ensureTable();
  const client = getDbExec();
  const placeholders = uniqueKeys.map(() => "?").join(", ");
  const { rows } = await client.execute({
    sql: `SELECT key, value FROM application_state WHERE session_id = ? AND key IN (${placeholders})`,
    args: [sessionId, ...uniqueKeys],
  });
  return rows.map((row) => ({
    key: row.key as string,
    value: JSON.parse(row.value as string),
  }));
}

export async function appStateGetMany(
  sessionId: string,
  keys: readonly string[],
): Promise<Record<string, Record<string, unknown> | null>> {
  const values: Record<string, Record<string, unknown> | null> = {};
  for (const key of new Set(keys)) values[key] = null;

  for (const entry of await appStateGetManyEntries(sessionId, keys)) {
    values[entry.key] = entry.value;
  }
  return values;
}

async function assertNavigateWriteAllowedForSession(
  sessionId: string,
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  const refusal = evaluateNavigateWrite(key, value);
  if (!refusal) return;
  let currentView: Record<string, unknown> | null = null;
  if (refusal.reason !== "read-only-action") {
    const navKey = navigationKeyForCommandKey(key);
    if (navKey) {
      currentView = await withoutWriteObservation(() =>
        appStateGet(sessionId, navKey),
      );
    }
  }
  throw new AgentNavigationRefusedError(refusal.message, {
    reason: refusal.reason,
    currentView,
  });
}

/**
 * Stores `value` under `key`. With an `order`, a write older than the last one
 * applied to the row from the same writer is skipped (see AppStateWriteOrder):
 * nothing changes and no change event fires.
 */
export async function appStatePut(
  sessionId: string,
  key: string,
  value: Record<string, unknown>,
  options?: AppStateWriteOptions,
): Promise<void> {
  await assertNavigateWriteAllowedForSession(sessionId, key, value);
  const serialized = serializeAppStateValue(key, value);
  await ensureTable();
  const client = getDbExec();
  const order = options?.order;
  if (!order) {
    await client.execute({
      sql: `INSERT INTO application_state (session_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (session_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`,
      args: [sessionId, key, serialized, Date.now()],
    });
  } else {
    // Postgres rechecks the WHERE against the locked row, so two writes
    // racing on one row still end on the newer.
    const result = await client.execute({
      sql: `INSERT INTO application_state (session_id, key, value, updated_at, writer, writer_seq) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (session_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at, writer=EXCLUDED.writer, writer_seq=EXCLUDED.writer_seq WHERE application_state.writer IS NULL OR application_state.writer <> EXCLUDED.writer OR application_state.writer_seq < EXCLUDED.writer_seq`,
      args: [sessionId, key, serialized, Date.now(), order.writer, order.seq],
    });
    if (result.rowsAffected === 0) return;
  }
  observeNavigationCommand(key);
  emitAppStateChange(key, options?.requestSource, sessionId);
}

/**
 * Deletes `key`. With an `order`, a delete older than the last write applied
 * to the row from the same writer is skipped. Deleting leaves no record, so
 * an older ordered write that lands after a delete writes the row again.
 */
export async function appStateDelete(
  sessionId: string,
  key: string,
  options?: AppStateWriteOptions,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const order = options?.order;
  const result = order
    ? await client.execute({
        // Rows with no ordered write yet, another writer's, or an older one.
        sql: `DELETE FROM application_state WHERE session_id = ? AND key = ? AND (writer IS NULL OR writer <> ? OR writer_seq < ?)`,
        args: [sessionId, key, order.writer, order.seq],
      })
    : await client.execute({
        sql: `DELETE FROM application_state WHERE session_id = ? AND key = ?`,
        args: [sessionId, key],
      });
  const deleted = result.rowsAffected > 0;
  if (deleted) emitAppStateDelete(key, options?.requestSource, sessionId);
  return deleted;
}

export interface AppStateCompareAndSetOptions extends StoreWriteOptions {
  /**
   * Writes only while this lease is still held, and throws `LeaseLostError`
   * when the write changed nothing because it ran out.
   */
  lease?: Lease;
}

export async function appStateCompareAndSet(
  sessionId: string,
  key: string,
  expectedValue: Record<string, unknown> | null,
  nextValue: Record<string, unknown> | null,
  options?: AppStateCompareAndSetOptions,
): Promise<boolean> {
  if (nextValue) {
    await assertNavigateWriteAllowedForSession(sessionId, key, nextValue);
  }
  if (nextValue !== null) serializeAppStateValue(key, nextValue);
  await ensureTable();
  const client = getDbExec();
  const lease = options?.lease;
  const changed = await executeAppStateCompareAndSet(
    client,
    sessionId,
    key,
    expectedValue,
    nextValue,
    lease ? leaseHeldSql(lease) : undefined,
  );
  if (!changed && lease && !(await holdsLease(lease))) {
    throw new LeaseLostError(lease);
  }
  if (changed) {
    if (nextValue === null) {
      emitAppStateDelete(key, options?.requestSource, sessionId);
    } else {
      observeNavigationCommand(key);
      emitAppStateChange(key, options?.requestSource, sessionId);
    }
  }
  return changed;
}

export interface AppStateCompareAndSetOperation {
  key: string;
  expectedValue: Record<string, unknown> | null;
  nextValue: Record<string, unknown> | null;
}

const APP_STATE_CAS_MISMATCH = Symbol("app-state-cas-mismatch");

async function executeAppStateCompareAndSet(
  client: DbExec,
  sessionId: string,
  key: string,
  expectedValue: Record<string, unknown> | null,
  nextValue: Record<string, unknown> | null,
  guard?: SqlFragment,
): Promise<boolean> {
  const statement = buildAppStateCompareAndSetStatement(
    sessionId,
    key,
    expectedValue,
    nextValue,
    guard ?? sql`TRUE`,
  );
  const result = await client.execute(statement);
  return result.rowsAffected > 0;
}

function buildAppStateCompareAndSetStatement(
  sessionId: string,
  key: string,
  expectedValue: Record<string, unknown> | null,
  nextValue: Record<string, unknown> | null,
  guard: SqlFragment,
): SqlFragment {
  const session = sql.value(sessionId);
  const stateKey = sql.value(key);
  if (expectedValue === null) {
    if (nextValue === null) {
      throw new Error(
        "Application state CAS cannot replace absence with absence.",
      );
    }
    const next = sql.value(serializeAppStateValue(key, nextValue));
    return sql`INSERT INTO application_state (session_id, key, value, updated_at) SELECT ${session}, ${stateKey}, ${next}, ${sql.value(Date.now())} WHERE NOT EXISTS (SELECT 1 FROM application_state WHERE session_id = ${session} AND key = ${stateKey}) AND ${guard} ON CONFLICT (session_id, key) DO NOTHING`;
  }

  const expected = sql.value(JSON.stringify(expectedValue));
  if (nextValue === null) {
    return sql`DELETE FROM application_state WHERE session_id = ${session} AND key = ${stateKey} AND value = ${expected} AND ${guard}`;
  }

  const next = sql.value(serializeAppStateValue(key, nextValue));
  return sql`UPDATE application_state SET value = ${next}, updated_at = ${sql.value(Date.now())} WHERE session_id = ${session} AND key = ${stateKey} AND value = ${expected} AND ${guard}`;
}

function serializeAppStateValue(
  key: string,
  value: Record<string, unknown>,
): string {
  assertNoInlineImageBytes(value, `application_state value "${key}"`);
  const serialized = JSON.stringify(value);
  if (
    !isLocalDatabase() &&
    utf8ByteLength(serialized) > MAX_HOSTED_APP_STATE_VALUE_BYTES
  ) {
    throw new Error(
      `application_state value "${key}" is too large for hosted SQL storage. Store large files, base64, or blobs in file storage and write only a URL or handle.`,
    );
  }
  return serialized;
}

export async function appStateCompareAndSetMany(
  sessionId: string,
  operations: readonly AppStateCompareAndSetOperation[],
  options?: StoreWriteOptions,
): Promise<boolean> {
  for (const { key, nextValue } of operations) {
    if (nextValue) {
      await assertNavigateWriteAllowedForSession(sessionId, key, nextValue);
    }
  }
  if (operations.length === 0) return true;
  const keys = new Set(operations.map(({ key }) => key));
  if (keys.size !== operations.length) {
    throw new Error("Application state multi-key CAS requires unique keys.");
  }
  for (const { key, nextValue } of operations) {
    if (nextValue) serializeAppStateValue(key, nextValue);
  }
  const orderedOperations = [...operations].sort((a, b) =>
    a.key.localeCompare(b.key),
  );

  await ensureTable();
  const client = getDbExec();
  if (!client.transaction) {
    throw new Error("Application state multi-key CAS requires transactions.");
  }
  try {
    await client.transaction(async (tx) => {
      for (const operation of orderedOperations) {
        const changed = await executeAppStateCompareAndSet(
          tx,
          sessionId,
          operation.key,
          operation.expectedValue,
          operation.nextValue,
        );
        if (!changed) throw APP_STATE_CAS_MISMATCH;
      }
    });
  } catch (error) {
    if (error === APP_STATE_CAS_MISMATCH) return false;
    throw error;
  }

  for (const { key, nextValue } of operations) {
    if (nextValue === null) {
      emitAppStateDelete(key, options?.requestSource, sessionId);
    } else {
      observeNavigationCommand(key);
      emitAppStateChange(key, options?.requestSource, sessionId);
    }
  }
  return true;
}

export async function appStateList(
  sessionId: string,
  keyPrefix: string,
): Promise<Array<{ key: string; value: Record<string, unknown> }>> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT key, value FROM application_state WHERE session_id = ? AND key LIKE ? ESCAPE '!'`,
    args: [sessionId, escapeLike(keyPrefix) + "%"],
  });
  return rows.map((row) => ({
    key: row.key as string,
    value: JSON.parse(row.value as string),
  }));
}

/**
 * Lists the keys under `keyPrefix` with when the server last wrote each,
 * leaving out any written before `writtenSince`.
 */
export async function appStateListUpdatedAt(
  sessionId: string,
  keyPrefix: string,
  writtenSince = 0,
): Promise<Array<{ key: string; updatedAt: number }>> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT key, updated_at FROM application_state WHERE session_id = ? AND key LIKE ? ESCAPE '!' AND updated_at >= ?`,
    args: [sessionId, escapeLike(keyPrefix) + "%", writtenSince],
  });
  return rows.map((row) => ({
    key: row.key as string,
    updatedAt: Number(row.updated_at),
  }));
}

export async function appStateListByKeyPrefix(
  keyPrefix: string,
  limit = 100,
): Promise<
  Array<{ sessionId: string; key: string; value: Record<string, unknown> }>
> {
  await ensureTable();
  const client = getDbExec();
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 2_048));
  const { rows } = await client.execute({
    sql: `SELECT session_id, key, value FROM application_state WHERE key LIKE ? ESCAPE '!' ORDER BY updated_at ASC LIMIT ?`,
    args: [escapeLike(keyPrefix) + "%", boundedLimit],
  });
  return rows.map((row) => ({
    sessionId: row.session_id as string,
    key: row.key as string,
    value: JSON.parse(row.value as string),
  }));
}

/** Lists metadata for maintenance keys within the current app namespace. */
export async function appStateListKeysByKeySuffixPrefix(
  suffixPrefix: string,
  limit = 100,
): Promise<Array<{ sessionId: string; key: string }>> {
  if (!suffixPrefix || suffixPrefix.startsWith(":")) {
    throw new Error(
      "Cross-session application-state scans require a non-empty key suffix prefix.",
    );
  }
  const keyPrefix = `${getAppStateMaintenanceNamespacePrefix()}${suffixPrefix}`;
  await ensureTable();
  const client = getDbExec();
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 2_048));
  const { rows } = await client.execute({
    sql: `SELECT session_id, key FROM application_state WHERE key LIKE ? ESCAPE '!' ORDER BY updated_at ASC LIMIT ?`,
    args: [escapeLike(keyPrefix) + "%", boundedLimit],
  });
  return rows.map((row) => ({
    sessionId: row.session_id as string,
    key: row.key as string,
  }));
}

function getAppStateMaintenanceNamespacePrefix(): string {
  const namespace = getAppConfig().app.slug;
  if (!namespace || namespace !== namespace.trim() || namespace.includes(":")) {
    throw new Error(
      "Application-state maintenance requires a configured app namespace.",
    );
  }
  return `${namespace}:`;
}

export async function appStateDeleteByPrefix(
  sessionId: string,
  keyPrefix: string,
  options?: StoreWriteOptions,
): Promise<number> {
  await ensureTable();
  const client = getDbExec();

  const { rows } = await client.execute({
    sql: `SELECT key FROM application_state WHERE session_id = ? AND key LIKE ? ESCAPE '!'`,
    args: [sessionId, escapeLike(keyPrefix) + "%"],
  });

  if (rows.length === 0) return 0;

  const result = await client.execute({
    sql: `DELETE FROM application_state WHERE session_id = ? AND key LIKE ? ESCAPE '!'`,
    args: [sessionId, escapeLike(keyPrefix) + "%"],
  });

  for (const row of rows) {
    emitAppStateDelete(row.key as string, options?.requestSource, sessionId);
  }

  return result.rowsAffected;
}
