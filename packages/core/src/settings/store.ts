import { EventEmitter } from "events";

import { getDbExec, isPostgres, intType } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import { getRequestContext } from "../server/request-context.js";

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

const _emitter = new EventEmitter();

export function getSettingsEmitter(): EventEmitter {
  return _emitter;
}

function settingsTable(): string {
  return isPostgres() ? "public.settings" : "settings";
}

async function ensureTable(): Promise<void> {
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
  const table = settingsTable();
  const result = await client.execute({
    sql: `DELETE FROM ${table} WHERE key = ?`,
    args: [key],
  });
  requestSettingsCache()?.set(key, null);
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
  const table = settingsTable();
  const { rows } = await client.execute(`SELECT key, value FROM ${table}`);
  const result: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    result[row.key as string] = JSON.parse(row.value as string);
  }
  return result;
}
