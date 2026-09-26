import type { EventEmitter } from "node:events";

import { getDbExec, type DbExec } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import { captureError } from "../server/capture-error.js";
import { getRequestContext } from "../server/request-context.js";
import { createEventEmitter } from "../shared/optional-node-builtins.js";

let _initPromise: Promise<void> | undefined;

const _requestSettingsCache = new WeakMap<object, Map<string, string | null>>();

function requestSettingsCache(): Map<string, string | null> | null {
  const ctx = getRequestContext();
  if (!ctx || typeof ctx !== "object") return null;
  let cache = _requestSettingsCache.get(ctx);
  if (!cache) {
    cache = new Map();
    _requestSettingsCache.set(ctx, cache);
  }
  return cache;
}

const _requestAllSettingsCache = new WeakMap<
  object,
  Promise<Map<string, string>>
>();

function invalidateRequestAllSettings(): void {
  const ctx = getRequestContext();
  if (ctx && typeof ctx === "object") _requestAllSettingsCache.delete(ctx);
}

let _emitter: EventEmitter | undefined;

function settingsEmitter(): EventEmitter {
  if (!_emitter) _emitter = createEventEmitter();
  return _emitter;
}

export function getSettingsEmitter(): EventEmitter {
  return settingsEmitter();
}

function settingsTable(): string {
  return "public.settings";
}

export async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const table = settingsTable();
      const createSql = `
        CREATE TABLE IF NOT EXISTS ${table} (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `;

      await ensureTableExists("settings", createSql);
      await widenIntColumnsToBigInt("settings", ["updated_at"]);
      await ensureIndexExists(
        "settings_updated_at_idx",
        `CREATE INDEX IF NOT EXISTS settings_updated_at_idx ON ${table} (updated_at)`,
      );
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

export interface StoreReadOptions {
  /** Skip the per-request snapshot when a cross-request race must be checked. */
  bypassCache?: boolean;
  transaction?: DbExec;
}

export async function getSetting(
  key: string,
  options?: StoreReadOptions,
): Promise<Record<string, unknown> | null> {
  const cache = options?.transaction ? null : requestSettingsCache();
  if (!options?.bypassCache && cache?.has(key)) {
    const cached = cache.get(key);
    return cached == null ? null : JSON.parse(cached);
  }
  if (!options?.transaction) await ensureTable();
  const client = options?.transaction ?? getDbExec();
  const table = settingsTable();
  const { rows } = await client.execute({
    sql: `SELECT value FROM ${table} WHERE key = ?`,
    args: [key],
  });
  const raw = rows.length === 0 ? null : (rows[0].value as string);
  if (!options?.bypassCache) cache?.set(key, raw);
  return raw == null ? null : JSON.parse(raw);
}

const SETTINGS_IN_LIST_CHUNK_SIZE = 500;

function parseSettingValue(
  key: string,
  raw: string,
): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch (error) {
    captureError(error, {
      tags: { source: "settings", op: "getSettings" },
      extra: { key },
    });
    return null;
  }
}

export async function getSettings(
  keys: readonly string[],
  options?: StoreReadOptions,
): Promise<Map<string, Record<string, unknown> | null>> {
  const uniqueKeys = [...new Set(keys)];
  const result = new Map<string, Record<string, unknown> | null>();
  if (uniqueKeys.length === 0) return result;

  const cache = options?.transaction ? null : requestSettingsCache();
  const misses: string[] = [];
  for (const key of uniqueKeys) {
    if (!options?.bypassCache && cache?.has(key)) {
      const cached = cache.get(key);
      result.set(key, cached == null ? null : parseSettingValue(key, cached));
    } else {
      misses.push(key);
    }
  }
  if (misses.length === 0) return result;

  if (!options?.transaction) await ensureTable();
  const client = options?.transaction ?? getDbExec();
  const table = settingsTable();
  const rawByKey = new Map<string, string>();
  for (let i = 0; i < misses.length; i += SETTINGS_IN_LIST_CHUNK_SIZE) {
    const chunk = misses.slice(i, i + SETTINGS_IN_LIST_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const { rows } = await client.execute({
      sql: `SELECT key, value FROM ${table} WHERE key IN (${placeholders})`,
      args: chunk,
    });
    for (const row of rows) {
      rawByKey.set(row.key as string, row.value as string);
    }
  }
  for (const key of misses) {
    const raw = rawByKey.get(key) ?? null;
    if (!options?.bypassCache) cache?.set(key, raw);
    result.set(key, raw == null ? null : parseSettingValue(key, raw));
  }
  return result;
}

export interface StoreWriteOptions {
  requestSource?: string;
}

const SETTINGS_MUTATION_ATTEMPTS = 25;

export async function mutateSetting(
  key: string,
  updater: (
    current: Record<string, unknown> | null,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  options?: StoreWriteOptions,
): Promise<Record<string, unknown>> {
  await ensureTable();
  const client = getDbExec();
  const table = settingsTable();
  for (let attempt = 0; attempt < SETTINGS_MUTATION_ATTEMPTS; attempt += 1) {
    const snapshot = await client.execute({
      sql: `SELECT value FROM ${table} WHERE key = ?`,
      args: [key],
    });
    const raw =
      snapshot.rows.length === 0 ? null : (snapshot.rows[0]?.value as string);
    const current = raw == null ? null : JSON.parse(raw);
    const next = await updater(current);
    const nextRaw = JSON.stringify(next);
    const timestamp = Date.now();
    const result =
      raw == null
        ? await client.execute({
            sql: `INSERT INTO ${table} (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING`,
            args: [key, nextRaw, timestamp],
          })
        : await client.execute({
            sql: `UPDATE ${table} SET value = ?, updated_at = ? WHERE key = ? AND value = ?`,
            args: [nextRaw, timestamp, key, raw],
          });
    if (result.rowsAffected === 0) continue;
    requestSettingsCache()?.set(key, nextRaw);
    invalidateRequestAllSettings();
    settingsEmitter().emit("settings", {
      source: "settings",
      type: "change",
      key,
      ...(options?.requestSource && { requestSource: options.requestSource }),
    });
    return JSON.parse(nextRaw);
  }
  throw new Error(`Setting ${key} changed too many times; retry the mutation.`);
}

export async function putSetting(
  key: string,
  value: Record<string, unknown>,
  options?: StoreWriteOptions,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const table = settingsTable();
  await client.execute({
    sql: `INSERT INTO ${table} (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`,
    args: [key, JSON.stringify(value), Date.now()],
  });
  requestSettingsCache()?.set(key, JSON.stringify(value));
  invalidateRequestAllSettings();
  settingsEmitter().emit("settings", {
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
  const table = settingsTable();
  const result = await client.execute({
    sql: `DELETE FROM ${table} WHERE key = ?`,
    args: [key],
  });
  requestSettingsCache()?.set(key, null);
  invalidateRequestAllSettings();
  if (result.rowsAffected > 0) {
    settingsEmitter().emit("settings", {
      source: "settings",
      type: "delete",
      key,
      ...(options?.requestSource && { requestSource: options.requestSource }),
    });
    return true;
  }
  return false;
}

export async function deleteSettingIfValue(
  key: string,
  expected: Record<string, unknown>,
  options?: StoreWriteOptions,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const table = settingsTable();
  const result = await client.execute({
    sql: `DELETE FROM ${table} WHERE key = ? AND value = ?`,
    args: [key, JSON.stringify(expected)],
  });
  if (result.rowsAffected === 0) return false;

  requestSettingsCache()?.set(key, null);
  invalidateRequestAllSettings();
  settingsEmitter().emit("settings", {
    source: "settings",
    type: "delete",
    key,
    ...(options?.requestSource && { requestSource: options.requestSource }),
  });
  return true;
}

export async function deleteSettingsByPrefix(
  prefix: string,
  options?: StoreWriteOptions,
): Promise<number> {
  await ensureTable();
  const client = getDbExec();
  const table = settingsTable();
  const escaped = prefix.replace(/[!%_]/g, (c) => `!${c}`);
  const result = await client.execute({
    sql: `DELETE FROM ${table} WHERE key LIKE ? ESCAPE '!'`,
    args: [`${escaped}%`],
  });
  requestSettingsCache()?.clear();
  invalidateRequestAllSettings();
  if (result.rowsAffected > 0) {
    settingsEmitter().emit("settings", {
      source: "settings",
      type: "delete",
      key: prefix,
      ...(options?.requestSource && { requestSource: options.requestSource }),
    });
  }
  return result.rowsAffected;
}

export async function listSettingsByPrefix(
  prefix: string,
  options?: { limit?: number },
): Promise<Array<{ key: string; value: Record<string, unknown> }>> {
  await ensureTable();
  const client = getDbExec();
  const table = settingsTable();
  const escaped = prefix.replace(/[!%_]/g, (c) => `!${c}`);
  const limit = options?.limit;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
    throw new RangeError(
      "Settings prefix limit must be a non-negative integer.",
    );
  }
  const { rows } = await client.execute({
    sql: `SELECT key, value FROM ${table} WHERE key LIKE ? ESCAPE '!'
      ${limit === undefined ? "" : "ORDER BY key ASC LIMIT ?"}`,
    args: limit === undefined ? [`${escaped}%`] : [`${escaped}%`, limit],
  });
  return rows.map((row) => ({
    key: String(row.key),
    value: JSON.parse(String(row.value)) as Record<string, unknown>,
  }));
}

export async function getAllSettings(): Promise<
  Record<string, Record<string, unknown>>
> {
  const raw = await loadAllSettingsRaw();
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of raw) result[key] = JSON.parse(value);
  return result;
}

async function loadAllSettingsRaw(): Promise<Map<string, string>> {
  const ctx = getRequestContext();
  const cached =
    ctx && typeof ctx === "object"
      ? _requestAllSettingsCache.get(ctx)
      : undefined;
  if (cached) return cached;

  const load = (async () => {
    await ensureTable();
    const client = getDbExec();
    const table = settingsTable();
    const { rows } = await client.execute(`SELECT key, value FROM ${table}`);
    const raw = new Map<string, string>();
    for (const row of rows) raw.set(row.key as string, row.value as string);
    const perKey = requestSettingsCache();
    if (perKey) {
      for (const [key, value] of raw) {
        if (!perKey.has(key)) perKey.set(key, value);
      }
    }
    return raw;
  })();

  if (ctx && typeof ctx === "object") {
    _requestAllSettingsCache.set(
      ctx,
      load.catch((err) => {
        _requestAllSettingsCache.delete(ctx);
        throw err;
      }),
    );
  }
  return load;
}
