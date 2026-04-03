import { EventEmitter } from "events";
import { getDbExec, isPostgres, intType, type DbExec } from "../db/client.js";

let _initPromise: Promise<void> | undefined;

const _emitter = new EventEmitter();

export function getSettingsEmitter(): EventEmitter {
  return _emitter;
}

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      await client.execute(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at ${intType()} NOT NULL
        )
      `);
    })();
  }
  return _initPromise;
}

export async function getSetting(
  key: string,
): Promise<Record<string, unknown> | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT value FROM settings WHERE key = ?`,
    args: [key],
  });
  if (rows.length === 0) return null;
  return JSON.parse(rows[0].value as string);
}

export interface StoreWriteOptions {
  /** Tag identifying who initiated this write (e.g. a tab ID). */
  requestSource?: string;
}

export async function putSetting(
  key: string,
  value: Record<string, unknown>,
  options?: StoreWriteOptions,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  await client.execute({
    sql: isPostgres()
      ? `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`
      : `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
    args: [key, JSON.stringify(value), Date.now()],
  });
  _emitter.emit("settings", {
    source: "settings",
    type: "change",
    key,
    ...(options?.requestSource && { requestSource: options.requestSource }),
  });
}

export async function deleteSetting(
  key: string,
  options?: StoreWriteOptions,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `DELETE FROM settings WHERE key = ?`,
    args: [key],
  });
  if (result.rowsAffected > 0) {
    _emitter.emit("settings", {
      source: "settings",
      type: "delete",
      key,
      ...(options?.requestSource && { requestSource: options.requestSource }),
    });
    return true;
  }
  return false;
}

export async function getAllSettings(): Promise<
  Record<string, Record<string, unknown>>
> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute(`SELECT key, value FROM settings`);
  const result: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    result[row.key as string] = JSON.parse(row.value as string);
  }
  return result;
}
