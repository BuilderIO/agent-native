import {
  getDbExec,
  isPostgres,
  intType,
  retryOnDdlRace,
} from "../db/client.js";
import { ensureTableExists, ensureIndexExists } from "../db/ddl-guard.js";
import type { RemoteRunEvent } from "./remote-types.js";

let _initPromise: Promise<void> | undefined;

// Build the CREATE SQL lazily (not at module scope) so intType() runs at
// RUNTIME, not import time — a module-scope call breaks any consumer whose
// db/client mock doesn't stub intType (e.g. db-admin specs).
function buildCreateSql(): string {
  return `
  CREATE TABLE IF NOT EXISTS integration_remote_run_events (
    device_id TEXT NOT NULL,
    remote_run_id TEXT NOT NULL,
    seq ${intType()} NOT NULL,
    event_json TEXT NOT NULL,
    created_at ${intType()} NOT NULL
  )
`;
}

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createSql = buildCreateSql();
      if (isPostgres()) {
        // PG guard: probe via information_schema, only issue DDL if missing, bounded lock_timeout
        await ensureTableExists("integration_remote_run_events", createSql);
        await ensureIndexExists(
          "idx_remote_run_events_unique",
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_run_events_unique ON integration_remote_run_events(device_id, remote_run_id, seq)`,
        );
        await ensureIndexExists(
          "idx_remote_run_events_run",
          `CREATE INDEX IF NOT EXISTS idx_remote_run_events_run ON integration_remote_run_events(device_id, remote_run_id, seq)`,
        );
        return;
      }
      // SQLite (local dev): keep existing behavior
      await retryOnDdlRace(() => client.execute(createSql));
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_run_events_unique ON integration_remote_run_events(device_id, remote_run_id, seq)`,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_remote_run_events_run ON integration_remote_run_events(device_id, remote_run_id, seq)`,
        ),
      );
    })().catch((err) => {
      // Retry init on the next call after a failed startup.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

function rowToRunEvent(row: Record<string, unknown>): RemoteRunEvent {
  return {
    deviceId: row.device_id as string,
    remoteRunId: row.remote_run_id as string,
    seq: Number(row.seq ?? 0),
    event: parseJson(row.event_json, null),
    createdAt: Number(row.created_at ?? 0),
  };
}

export async function insertRemoteRunEvents(input: {
  deviceId: string;
  remoteRunId: string;
  events: Array<{ seq: number; event: unknown }>;
}): Promise<{ inserted: number }> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  let inserted = 0;

  for (const event of input.events) {
    const result = await client.execute({
      sql: `INSERT INTO integration_remote_run_events
              (device_id, remote_run_id, seq, event_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(device_id, remote_run_id, seq) DO NOTHING`,
      args: [
        input.deviceId,
        input.remoteRunId,
        event.seq,
        JSON.stringify(event.event ?? null),
        now,
      ],
    });
    inserted += result.rowsAffected ?? (result as any).rowCount ?? 0;
  }

  return { inserted };
}

export async function listRemoteRunEvents(input: {
  deviceId: string;
  remoteRunId: string;
  afterSeq?: number;
  limit?: number;
}): Promise<RemoteRunEvent[]> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM integration_remote_run_events
          WHERE device_id = ?
            AND remote_run_id = ?
            AND seq > ?
          ORDER BY seq ASC
          LIMIT ?`,
    args: [
      input.deviceId,
      input.remoteRunId,
      input.afterSeq ?? -1,
      input.limit ?? 500,
    ],
  });
  return rows.map((row) => rowToRunEvent(row as Record<string, unknown>));
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (value == null) return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}
