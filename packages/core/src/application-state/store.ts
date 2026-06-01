import {
  getDbExec,
  isConnectionError,
  isPostgres,
  intType,
} from "../db/client.js";
import { emitAppStateChange, emitAppStateDelete } from "./emitter.js";
import type { StoreWriteOptions } from "../settings/store.js";

let _initPromise: Promise<void> | undefined;

// Escapes LIKE wildcards (`%`, `_`) and the escape char itself so a caller's
// literal prefix is matched verbatim. Used with `ESCAPE '\'` in prefix queries
// below; without this, a prefix such as `user_settings` would treat `_` as a
// single-char wildcard and over-match (e.g. delete `userXsettings`).
function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      await client.execute(`
        CREATE TABLE IF NOT EXISTS application_state (
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at ${intType()} NOT NULL,
          PRIMARY KEY (session_id, key)
        )
      `);
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

export async function appStatePut(
  sessionId: string,
  key: string,
  value: Record<string, unknown>,
  options?: StoreWriteOptions,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  await client.execute({
    sql: isPostgres()
      ? `INSERT INTO application_state (session_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (session_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`
      : `INSERT OR REPLACE INTO application_state (session_id, key, value, updated_at) VALUES (?, ?, ?, ?)`,
    args: [sessionId, key, JSON.stringify(value), Date.now()],
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

export async function appStateList(
  sessionId: string,
  keyPrefix: string,
): Promise<Array<{ key: string; value: Record<string, unknown> }>> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT key, value FROM application_state WHERE session_id = ? AND key LIKE ? ESCAPE '\\'`,
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
    sql: `SELECT key FROM application_state WHERE session_id = ? AND key LIKE ? ESCAPE '\\'`,
    args: [sessionId, escapeLike(keyPrefix) + "%"],
  });

  if (rows.length === 0) return 0;

  const result = await client.execute({
    sql: `DELETE FROM application_state WHERE session_id = ? AND key LIKE ? ESCAPE '\\'`,
    args: [sessionId, escapeLike(keyPrefix) + "%"],
  });

  for (const row of rows) {
    emitAppStateDelete(row.key as string, options?.requestSource, sessionId);
  }

  return result.rowsAffected;
}
