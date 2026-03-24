import { createClient, type Client } from "@libsql/client";
import { emitAppStateChange, emitAppStateDelete } from "./emitter.js";

interface DbExec {
  execute(
    sql: string | { sql: string; args: any[] },
  ): Promise<{ rows: any[]; rowsAffected: number }>;
}

let _client: DbExec | undefined;

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

    const url = process.env.DATABASE_URL || "file:./data/app.db";
    _client = createClient({
      url,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
  }
  return _client;
}

let _initialized = false;

async function ensureTable(): Promise<void> {
  if (_initialized) return;
  const client = getClient();
  await client.execute(`
    CREATE TABLE IF NOT EXISTS application_state (
      session_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, key)
    )
  `);
  _initialized = true;
}

export async function appStateGet(
  sessionId: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  await ensureTable();
  const client = getClient();
  const { rows } = await client.execute({
    sql: `SELECT value FROM application_state WHERE session_id = ? AND key = ?`,
    args: [sessionId, key],
  });
  if (rows.length === 0) return null;
  return JSON.parse(rows[0].value as string);
}

export async function appStatePut(
  sessionId: string,
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  await ensureTable();
  const client = getClient();
  await client.execute({
    sql: `INSERT OR REPLACE INTO application_state (session_id, key, value, updated_at) VALUES (?, ?, ?, ?)`,
    args: [sessionId, key, JSON.stringify(value), Date.now()],
  });
  emitAppStateChange(key);
}

export async function appStateDelete(
  sessionId: string,
  key: string,
): Promise<boolean> {
  await ensureTable();
  const client = getClient();
  const result = await client.execute({
    sql: `DELETE FROM application_state WHERE session_id = ? AND key = ?`,
    args: [sessionId, key],
  });
  const deleted = result.rowsAffected > 0;
  if (deleted) emitAppStateDelete(key);
  return deleted;
}

export async function appStateList(
  sessionId: string,
  keyPrefix: string,
): Promise<Array<{ key: string; value: Record<string, unknown> }>> {
  await ensureTable();
  const client = getClient();
  const { rows } = await client.execute({
    sql: `SELECT key, value FROM application_state WHERE session_id = ? AND key LIKE ?`,
    args: [sessionId, keyPrefix + "%"],
  });
  return rows.map((row) => ({
    key: row.key as string,
    value: JSON.parse(row.value as string),
  }));
}

export async function appStateDeleteByPrefix(
  sessionId: string,
  keyPrefix: string,
): Promise<number> {
  await ensureTable();
  const client = getClient();

  // Get keys first so we can emit events
  const { rows } = await client.execute({
    sql: `SELECT key FROM application_state WHERE session_id = ? AND key LIKE ?`,
    args: [sessionId, keyPrefix + "%"],
  });

  if (rows.length === 0) return 0;

  const result = await client.execute({
    sql: `DELETE FROM application_state WHERE session_id = ? AND key LIKE ?`,
    args: [sessionId, keyPrefix + "%"],
  });

  for (const row of rows) {
    emitAppStateDelete(row.key as string);
  }

  return result.rowsAffected;
}
