import { getDbExec, isLocalDatabase, type DbExec } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import type { StoreWriteOptions } from "../settings/store.js";
import { emitAppStateChange, emitAppStateDelete } from "./emitter.js";

let _initPromise: Promise<void> | undefined;
const MAX_HOSTED_APP_STATE_VALUE_BYTES = 1024 * 1024;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

// Escapes LIKE wildcards (`%`, `_`) and the escape char itself so a caller's
// literal prefix is matched verbatim. Used with `ESCAPE '!'` in prefix queries
// below; without this, a prefix such as `user_settings` would treat `_` as a
// single-char wildcard and over-match (e.g. delete `userXsettings`).
function escapeLike(s: string): string {
  return s.replace(/[!%_]/g, (match) => `!${match}`);
}

export async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
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
      await widenIntColumnsToBigInt("application_state", ["updated_at"]);
      await ensureIndexExists(
        "app_state_updated_at_idx",
        `CREATE INDEX IF NOT EXISTS app_state_updated_at_idx ON application_state (updated_at)`,
      );
      await ensureIndexExists(
        "app_state_key_updated_idx",
        `CREATE INDEX IF NOT EXISTS app_state_key_updated_idx ON application_state (key, updated_at)`,
      );
    })().catch((err) => {
      // Retry init on the next call after a failed startup.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
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

/**
 * Read several application-state keys for one session in a single SQL query,
 * returning ONLY the rows that exist. A key absent from the result has no row;
 * a key present with a `null` value has a row that stores `null`. Callers that
 * must not conflate the two (the batched HTTP read) depend on that difference,
 * so this deliberately does not pad missing keys.
 */
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

/**
 * Read several application-state keys for one session in a single SQL query.
 * Missing keys are returned as `null` so callers can preserve the requested
 * shape without issuing one fallback query per key.
 */
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

export async function appStatePut(
  sessionId: string,
  key: string,
  value: Record<string, unknown>,
  options?: StoreWriteOptions,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const serialized = JSON.stringify(value);
  if (
    !isLocalDatabase() &&
    utf8ByteLength(serialized) > MAX_HOSTED_APP_STATE_VALUE_BYTES
  ) {
    throw new Error(
      `application_state value "${key}" is too large for hosted SQL storage. Store large files, base64, or blobs in file storage and write only a URL or handle.`,
    );
  }
  await client.execute({
    sql: `INSERT INTO application_state (session_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (session_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`,
    args: [sessionId, key, serialized, Date.now()],
  });
  emitAppStateChange(key, options?.requestSource, sessionId);
}

export async function appStateDelete(
  sessionId: string,
  key: string,
  options?: StoreWriteOptions,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `DELETE FROM application_state WHERE session_id = ? AND key = ?`,
    args: [sessionId, key],
  });
  const deleted = result.rowsAffected > 0;
  if (deleted) emitAppStateDelete(key, options?.requestSource, sessionId);
  return deleted;
}

export async function appStateCompareAndSet(
  sessionId: string,
  key: string,
  expectedValue: Record<string, unknown> | null,
  nextValue: Record<string, unknown> | null,
  options?: StoreWriteOptions,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const changed = await executeAppStateCompareAndSet(
    client,
    sessionId,
    key,
    expectedValue,
    nextValue,
  );
  if (changed) {
    if (nextValue === null) {
      emitAppStateDelete(key, options?.requestSource, sessionId);
    } else {
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
): Promise<boolean> {
  const statement = buildAppStateCompareAndSetStatement(
    sessionId,
    key,
    expectedValue,
    nextValue,
  );
  const result = await client.execute(statement);
  return result.rowsAffected > 0;
}

function buildAppStateCompareAndSetStatement(
  sessionId: string,
  key: string,
  expectedValue: Record<string, unknown> | null,
  nextValue: Record<string, unknown> | null,
): { sql: string; args: unknown[] } {
  if (expectedValue === null) {
    if (nextValue === null) {
      throw new Error(
        "Application state CAS cannot replace absence with absence.",
      );
    }
    const next = serializeAppStateValue(key, nextValue);
    return {
      sql: `INSERT INTO application_state (session_id, key, value, updated_at) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM application_state WHERE session_id = ? AND key = ?) ON CONFLICT (session_id, key) DO NOTHING`,
      args: [sessionId, key, next, Date.now(), sessionId, key],
    };
  }

  const expected = JSON.stringify(expectedValue);
  if (nextValue === null) {
    return {
      sql: `DELETE FROM application_state WHERE session_id = ? AND key = ? AND value = ?`,
      args: [sessionId, key, expected],
    };
  }

  const next = serializeAppStateValue(key, nextValue);
  return {
    sql: `UPDATE application_state SET value = ?, updated_at = ? WHERE session_id = ? AND key = ? AND value = ?`,
    args: [next, Date.now(), sessionId, key, expected],
  };
}

function serializeAppStateValue(
  key: string,
  value: Record<string, unknown>,
): string {
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

export async function appStateDeleteByPrefix(
  sessionId: string,
  keyPrefix: string,
  options?: StoreWriteOptions,
): Promise<number> {
  await ensureTable();
  const client = getDbExec();

  // Get keys first so we can emit events
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
