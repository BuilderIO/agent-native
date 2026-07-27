import {
  getDbExec,
  isPostgres,
  intType,
  retryOnDdlRace,
} from "../db/client.js";
import { ensureTableExists, ensureIndexExists } from "../db/ddl-guard.js";
import { serializeBoundedRemoteJson } from "./remote-json-safety.js";
import type { RemoteLiveViewEvent, RemoteRunEvent } from "./remote-types.js";

const MAX_EVENT_JSON_BYTES = 256_000;
const MAX_EVENT_BATCH_JSON_BYTES = 1_000_000;

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
  if (input.events.length === 0) return { inserted: 0 };
  if (input.events.length > 1_000) {
    throw new Error("A remote run event batch cannot exceed 1,000 events");
  }
  const client = getDbExec();
  const now = Date.now();
  const values = input.events.map(() => "(?, ?, ?, ?, ?)").join(", ");
  let batchBytes = 0;
  const args = input.events.flatMap((event) => {
    const value = isLiveViewEvent(event.event)
      ? normalizeLiveViewEvent(event.event)
      : (event.event ?? null);
    const eventJson = serializeBoundedRemoteJson(value, {
      label: "Remote run event",
      maxBytes: MAX_EVENT_JSON_BYTES,
    });
    batchBytes += new TextEncoder().encode(eventJson).byteLength;
    if (batchBytes > MAX_EVENT_BATCH_JSON_BYTES) {
      throw new Error(
        `Remote run event batch exceeds ${MAX_EVENT_BATCH_JSON_BYTES} JSON bytes`,
      );
    }
    return [input.deviceId, input.remoteRunId, event.seq, eventJson, now];
  });
  const result = await client.execute({
    sql: `INSERT INTO integration_remote_run_events
            (device_id, remote_run_id, seq, event_json, created_at)
          VALUES ${values}
          ON CONFLICT(device_id, remote_run_id, seq) DO NOTHING`,
    args,
  });
  return {
    inserted:
      result.rowsAffected ??
      Number((result as { rowCount?: unknown }).rowCount ?? 0),
  };
}

export async function insertRemoteLiveViewEvents(input: {
  deviceId: string;
  remoteRunId: string;
  events: Array<{ seq: number; event: RemoteLiveViewEvent }>;
}): Promise<{ inserted: number }> {
  return insertRemoteRunEvents({
    ...input,
    events: input.events.map(({ seq, event }) => ({
      seq,
      event: normalizeLiveViewEvent(event),
    })),
  });
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

function normalizeLiveViewEvent(
  event: RemoteLiveViewEvent,
): RemoteLiveViewEvent {
  if (!event || event.type !== "computer.live-view") {
    throw new Error("Invalid computer live-view event");
  }
  const frameHandle = sanitizeString(event.frameHandle, 240);
  if (/^data:/i.test(frameHandle) || looksLikeLargeBase64(frameHandle)) {
    throw new Error(
      "Live-view frames must use ephemeral handles, not image data",
    );
  }
  if (!Number.isSafeInteger(event.capturedAt) || event.capturedAt < 0) {
    throw new Error("Live-view capturedAt must be an epoch timestamp");
  }
  return {
    type: "computer.live-view",
    frameHandle,
    capturedAt: event.capturedAt,
    width: boundedDimension(event.width),
    height: boundedDimension(event.height),
    targetLabel:
      event.targetLabel == null ? null : sanitizeString(event.targetLabel, 240),
  };
}

function isLiveViewEvent(value: unknown): value is RemoteLiveViewEvent {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "computer.live-view"
  );
}

function boundedDimension(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 1 || value > 100_000) {
    throw new Error("Live-view dimensions must be positive integers");
  }
  return value;
}

function sanitizeString(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`Expected a non-empty string of at most ${max} chars`);
  }
  return value.trim();
}

function looksLikeLargeBase64(value: string): boolean {
  return value.length > 512 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
