import type { EventEmitter } from "node:events";

import { getDbExec, isPostgres, intType } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import { getRequestContext } from "../server/request-context.js";
import { createEventEmitter } from "../shared/optional-node-builtins.js";

let _initPromise: Promise<void> | undefined;

// Per-request memoization of settings reads, keyed on the active
// AsyncLocalStorage RequestContext (WeakMap → freed with the request). One
// action request can read the same setting several times (org resolution,
// guards, the action body), and each read is a network round trip on
// serverless Postgres. Mirrors the per-request session/org caches on
// event.context. The cache holds the raw JSON string and re-parses per hit
// so callers can't mutate a shared object; writes in the same request are
// written through, while other in-flight requests keep their snapshot for
// their own (short) lifetime.
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

/**
 * Per-request memo of the WHOLE settings table for `getAllSettings`.
 *
 * The single-key path above was already request-cached; the full-table read was
 * not, and production showed 98,479 of them — an entire `SELECT key, value FROM
 * settings` per call, several times per request via the MCP client routes and
 * org settings.
 *
 * Holds raw JSON strings, like the single-key cache, so callers can't mutate a
 * shared parsed object. Dropped by every write path, because a request that
 * writes a setting and then re-reads all of them must see its own write.
 */
const _requestAllSettingsCache = new WeakMap<
  object,
  Promise<Map<string, string>>
>();

function invalidateRequestAllSettings(): void {
  const ctx = getRequestContext();
  if (ctx && typeof ctx === "object") _requestAllSettingsCache.delete(ctx);
}

// Created lazily so this module can be evaluated in the browser dev graph
// without a top-level `new EventEmitter()` tripping Vite's externalized
// `node:events` stub. The emitter drives server-side SSE fan-out only.
let _emitter: EventEmitter | undefined;

function settingsEmitter(): EventEmitter {
  if (!_emitter) _emitter = createEventEmitter();
  return _emitter;
}

export function getSettingsEmitter(): EventEmitter {
  return settingsEmitter();
}

function settingsTable(): string {
  return isPostgres() ? "public.settings" : "settings";
}

export async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const table = settingsTable();
      const createSql = `
        CREATE TABLE IF NOT EXISTS ${table} (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at ${intType()} NOT NULL
        )
      `;

      if (isPostgres()) {
        // Hot path: the `settings` table and its poll index are virtually
        // always already present in production. Issuing `CREATE TABLE`/
        // `CREATE INDEX` still takes a lock that, in a fresh background-worker
        // process behind a concurrent connection on the shared Neon DB, can
        // block ~indefinitely (ACCESS EXCLUSIVE for CREATE TABLE; a write-
        // blocking SHARE lock for CREATE INDEX). `ensureTableExists` /
        // `ensureIndexExists` probe `information_schema`/`pg_indexes` first
        // (plain reads, no lock) and run DDL ONLY for what is actually missing,
        // bounding any DDL with a transaction-scoped `lock_timeout`. They also
        // re-probe after a swallowed lock-timeout and THROW if the schema is
        // still missing, so a timed-out DDL never poisons this init memo with
        // missing schema. `settingsTable()` is `public.settings` on Postgres;
        // the existence checks use the unqualified table name.
        await ensureTableExists("settings", createSql);
        // Older deployments (pre BIGINT-compat) have a 32-bit `updated_at`; on
        // Postgres the `Date.now()` written on every setSetting overflows int4.
        // widenIntColumnsToBigInt already probes information_schema and only
        // ALTERs columns that are still int4 — a no-op on fresh/widened DBs.
        await widenIntColumnsToBigInt("settings", ["updated_at"]);
        // Index for the poll watermark query: `SELECT MAX(updated_at)`.
        await ensureIndexExists(
          "settings_updated_at_idx",
          `CREATE INDEX IF NOT EXISTS settings_updated_at_idx ON ${table} (updated_at)`,
        );
        return;
      }

      // SQLite (local dev): no lock problem — keep the original behaviour.
      await client.execute(createSql);
      // No-op on SQLite (INTEGER is already 64-bit).
      await widenIntColumnsToBigInt("settings", ["updated_at"]);
      // Index for the poll watermark query: `SELECT MAX(updated_at) FROM settings`.
      // MAX on an indexed column avoids a full-table scan on every poll cycle.
      // IF NOT EXISTS makes it idempotent on existing databases.
      try {
        await client.execute(
          `CREATE INDEX IF NOT EXISTS settings_updated_at_idx ON ${table} (updated_at)`,
        );
      } catch {
        // Index already exists or the dialect rejected a duplicate.
      }
    })().catch((err) => {
      // Retry init on the next call after a failed startup.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

export async function getSetting(
  key: string,
): Promise<Record<string, unknown> | null> {
  const cache = requestSettingsCache();
  if (cache?.has(key)) {
    const cached = cache.get(key);
    return cached == null ? null : JSON.parse(cached);
  }
  await ensureTable();
  const client = getDbExec();
  const table = settingsTable();
  const { rows } = await client.execute({
    sql: `SELECT value FROM ${table} WHERE key = ?`,
    args: [key],
  });
  const raw = rows.length === 0 ? null : (rows[0].value as string);
  cache?.set(key, raw);
  return raw == null ? null : JSON.parse(raw);
}

export interface StoreWriteOptions {
  /** Tag identifying who initiated this write (e.g. a tab ID). */
  requestSource?: string;
}

const SETTINGS_MUTATION_ATTEMPTS = 25;

/**
 * Atomically derive and persist one setting with an optimistic raw-value CAS.
 * This works across SQLite/libSQL and Postgres and remains safe across
 * horizontally scaled processes where an in-memory mutex would not.
 * The updater may run more than once after contention and must not perform
 * external side effects.
 */
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
    // Deliberately bypass the request cache: a failed CAS means another
    // request committed a newer value and the next attempt must reread it.
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
            sql: isPostgres()
              ? `INSERT INTO ${table} (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING`
              : `INSERT OR IGNORE INTO ${table} (key, value, updated_at) VALUES (?, ?, ?)`,
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
    sql: isPostgres()
      ? `INSERT INTO ${table} (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`
      : `INSERT OR REPLACE INTO ${table} (key, value, updated_at) VALUES (?, ?, ?)`,
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

/**
 * Delete every setting whose key starts with `prefix`. Returns the number of
 * rows removed. Used when an owning entity is deleted (e.g. an organization
 * takes its `o:<orgId>:*` keys with it).
 */
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

/**
 * Read every setting whose key starts with `prefix`. Callers that only need
 * one namespace must not use {@link getAllSettings} — that loads the whole
 * table.
 */
export async function listSettingsByPrefix(
  prefix: string,
): Promise<Array<{ key: string; value: Record<string, unknown> }>> {
  await ensureTable();
  const client = getDbExec();
  const table = settingsTable();
  const escaped = prefix.replace(/[!%_]/g, (c) => `!${c}`);
  const { rows } = await client.execute({
    sql: `SELECT key, value FROM ${table} WHERE key LIKE ? ESCAPE '!'`,
    args: [`${escaped}%`],
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
    // Seed the single-key cache so a `getSetting` after `getAllSettings` in the
    // same request is free rather than another round trip. Only fills keys it
    // does not already hold: a value written earlier in this request is already
    // written through there and must win over this snapshot.
    const perKey = requestSettingsCache();
    if (perKey) {
      for (const [key, value] of raw) {
        if (!perKey.has(key)) perKey.set(key, value);
      }
    }
    return raw;
  })();

  if (ctx && typeof ctx === "object") {
    // Evicted on failure so one transient error is not memoized as the answer
    // for the rest of the request.
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
