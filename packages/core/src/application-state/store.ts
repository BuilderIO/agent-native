import {
  getDbExec,
  isLocalDatabase,
  isConnectionError,
  isPostgres,
  intType,
  type DbExec,
} from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import type { StoreWriteOptions } from "../settings/store.js";
import { emitAppStateChange, emitAppStateDelete } from "./emitter.js";

let _initPromise: Promise<void> | undefined;
const MAX_HOSTED_APP_STATE_VALUE_BYTES = 1024 * 1024;

// Escapes LIKE wildcards (`%`, `_`) and the escape char itself so a caller's
// literal prefix is matched verbatim. Used with `ESCAPE '!'` in prefix queries
// below; without this, a prefix such as `user_settings` would treat `_` as a
// single-char wildcard and over-match (e.g. delete `userXsettings`).
function escapeLike(s: string): string {
  return s.replace(/[!%_]/g, (match) => `!${match}`);
}

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createSql = `
        CREATE TABLE IF NOT EXISTS application_state (
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at ${intType()} NOT NULL,
          PRIMARY KEY (session_id, key)
        )
      `;

      if (isPostgres()) {
        // Hot path: the `application_state` table and its poll indexes are
        // virtually always already present in production. Issuing `CREATE
        // TABLE`/ `CREATE INDEX` still takes a lock that, in a fresh
        // background-worker process behind a concurrent connection on the
        // shared Neon DB, can block ~indefinitely (ACCESS EXCLUSIVE for CREATE
        // TABLE; a write-blocking SHARE lock for CREATE INDEX). The ensure*
        // wrappers probe `information_schema`/`pg_indexes` first (plain reads,
        // no lock) and run DDL ONLY for what is actually missing, bounded by a
        // transaction-scoped `lock_timeout`. If a swallowed lock-timeout leaves
        // the schema still missing they RE-PROBE and THROW rather than letting
        // init memoize success against absent schema.
        await ensureTableExists("application_state", createSql);
        // Older deployments created `updated_at` as 32-bit `INTEGER`; on Postgres
        // the `Date.now()` written by appStatePut() on every turn overflows int4.
        // Widen it in place (no-op once done / on fresh BIGINT databases).
        await widenIntColumnsToBigInt("application_state", ["updated_at"]);
        // Indexes for the two hot poll paths. Probe pg_indexes first (no lock)
        // and skip the SHARE-locking CREATE INDEX when already present.
        await ensureIndexExists(
          "app_state_updated_at_idx",
          `CREATE INDEX IF NOT EXISTS app_state_updated_at_idx ON application_state (updated_at)`,
        );
        await ensureIndexExists(
          "app_state_key_updated_idx",
          `CREATE INDEX IF NOT EXISTS app_state_key_updated_idx ON application_state (key, updated_at)`,
        );
        return;
      }

      // SQLite (local dev): no lock problem — keep the original behaviour.
      await client.execute(createSql);
      // Older deployments created `updated_at` as 32-bit `INTEGER`; on Postgres
      // the `Date.now()` written by appStatePut() on every turn overflows int4.
      // Widen it in place (no-op once done / on fresh BIGINT databases).
      await widenIntColumnsToBigInt("application_state", ["updated_at"]);
      // Indexes for the two hot poll paths:
      //  - `SELECT … WHERE updated_at > ?` (watermark scan, every poll cycle)
      //  - `SELECT … WHERE key = ? … ORDER BY updated_at ASC` (marker lookups)
      // Both are dialect-agnostic (no DESC/partial/PG-only syntax) so they
      // apply identically on SQLite and Postgres. IF NOT EXISTS makes them
      // idempotent across restarts on existing databases.
      for (const ddl of [
        `CREATE INDEX IF NOT EXISTS app_state_updated_at_idx ON application_state (updated_at)`,
        `CREATE INDEX IF NOT EXISTS app_state_key_updated_idx ON application_state (key, updated_at)`,
      ]) {
        try {
          await client.execute(ddl);
        } catch {
          // Index already exists or the dialect rejected a duplicate.
        }
      }
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
  try {
    await ensureTable();
    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT value FROM application_state WHERE session_id = ? AND key = ?`,
      args: [sessionId, key],
    });
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].value as string);
  } catch (err) {
    // Transient WS / connection drops (Neon serverless) — caller polls every
    // 2s and will see the value on the next tick. Swallow rather than 500.
    if (isConnectionError(err)) return null;
    throw err;
  }
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
  const uniqueKeys = [...new Set(keys)];
  const values: Record<string, Record<string, unknown> | null> = {};
  for (const key of uniqueKeys) values[key] = null;
  if (uniqueKeys.length === 0) return values;

  try {
    await ensureTable();
    const client = getDbExec();
    const placeholders = uniqueKeys.map(() => "?").join(", ");
    const { rows } = await client.execute({
      sql: `SELECT key, value FROM application_state WHERE session_id = ? AND key IN (${placeholders})`,
      args: [sessionId, ...uniqueKeys],
    });
    for (const row of rows) {
      values[row.key as string] = JSON.parse(row.value as string);
    }
    return values;
  } catch (err) {
    if (isConnectionError(err)) return values;
    throw err;
  }
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
    Buffer.byteLength(serialized, "utf8") > MAX_HOSTED_APP_STATE_VALUE_BYTES
  ) {
    throw new Error(
      `application_state value "${key}" is too large for hosted SQL storage. Store large files, base64, or blobs in file storage and write only a URL or handle.`,
    );
  }
  await client.execute({
    sql: isPostgres()
      ? `INSERT INTO application_state (session_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (session_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`
      : `INSERT OR REPLACE INTO application_state (session_id, key, value, updated_at) VALUES (?, ?, ?, ?)`,
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
  if (expectedValue === null) {
    if (nextValue === null) {
      throw new Error(
        "Application state CAS cannot replace absence with absence.",
      );
    }
    const next = serializeAppStateValue(key, nextValue);
    const result = await client.execute({
      sql: isPostgres()
        ? `INSERT INTO application_state (session_id, key, value, updated_at) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM application_state WHERE session_id = ? AND key = ?) ON CONFLICT (session_id, key) DO NOTHING`
        : `INSERT OR IGNORE INTO application_state (session_id, key, value, updated_at) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM application_state WHERE session_id = ? AND key = ?)`,
      args: [sessionId, key, next, Date.now(), sessionId, key],
    });
    return result.rowsAffected > 0;
  }

  const expected = JSON.stringify(expectedValue);
  if (nextValue === null) {
    const result = await client.execute({
      sql: `DELETE FROM application_state WHERE session_id = ? AND key = ? AND value = ?`,
      args: [sessionId, key, expected],
    });
    return result.rowsAffected > 0;
  }

  const next = serializeAppStateValue(key, nextValue);
  const result = await client.execute({
    sql: `UPDATE application_state SET value = ?, updated_at = ? WHERE session_id = ? AND key = ? AND value = ?`,
    args: [next, Date.now(), sessionId, key, expected],
  });
  return result.rowsAffected > 0;
}

function serializeAppStateValue(
  key: string,
  value: Record<string, unknown>,
): string {
  const serialized = JSON.stringify(value);
  if (
    !isLocalDatabase() &&
    Buffer.byteLength(serialized, "utf8") > MAX_HOSTED_APP_STATE_VALUE_BYTES
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
