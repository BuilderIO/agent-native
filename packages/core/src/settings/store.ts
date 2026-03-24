import { createClient, type Client } from "@libsql/client";
import fs from "fs";
import path from "path";
import { EventEmitter } from "events";

/** Minimal DB interface used by the settings store */
interface DbExec {
  execute(
    sql: string | { sql: string; args: any[] },
  ): Promise<{ rows: any[]; rowsAffected: number }>;
}

let _client: DbExec | undefined;
let _initialized = false;

const _emitter = new EventEmitter();

export function getSettingsEmitter(): EventEmitter {
  return _emitter;
}

function getClient(): DbExec {
  if (!_client) {
    // Check for Cloudflare D1 binding
    const d1 = (globalThis as any).__cf_env?.DB;
    if (d1) {
      _client = {
        async execute(sql) {
          if (typeof sql === "string") {
            const r = await d1.prepare(sql).all();
            return {
              rows: r.results || [],
              rowsAffected: r.meta?.changes ?? 0,
            };
          }
          const r = await d1
            .prepare(sql.sql)
            .bind(...sql.args)
            .all();
          return { rows: r.results || [], rowsAffected: r.meta?.changes ?? 0 };
        },
      };
      return _client;
    }

    // Fall back to libsql
    const url = process.env.DATABASE_URL || "file:./data/app.db";
    if (url.startsWith("file:")) {
      try {
        fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
      } catch {
        // Edge runtime — no filesystem
      }
    }
    _client = createClient({
      url,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
  }
  return _client;
}

async function ensureTable(): Promise<void> {
  if (_initialized) return;
  const client = getClient();
  await client.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  _initialized = true;
}

export async function getSetting(
  key: string,
): Promise<Record<string, unknown> | null> {
  await ensureTable();
  const client = getClient();
  const { rows } = await client.execute({
    sql: `SELECT value FROM settings WHERE key = ?`,
    args: [key],
  });
  if (rows.length === 0) return null;
  return JSON.parse(rows[0].value as string);
}

export async function putSetting(
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  await ensureTable();
  const client = getClient();
  await client.execute({
    sql: `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
    args: [key, JSON.stringify(value), Date.now()],
  });
  _emitter.emit("settings", {
    source: "settings",
    type: "change",
    key,
  });
}

export async function deleteSetting(key: string): Promise<boolean> {
  await ensureTable();
  const client = getClient();
  const result = await client.execute({
    sql: `DELETE FROM settings WHERE key = ?`,
    args: [key],
  });
  if (result.rowsAffected > 0) {
    _emitter.emit("settings", {
      source: "settings",
      type: "delete",
      key,
    });
    return true;
  }
  return false;
}

export async function getAllSettings(): Promise<
  Record<string, Record<string, unknown>>
> {
  await ensureTable();
  const client = getClient();
  const { rows } = await client.execute(`SELECT key, value FROM settings`);
  const result: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    result[row.key as string] = JSON.parse(row.value as string);
  }
  return result;
}
