import { getDbExec } from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";
import { defineStore } from "../db/store-registry.js";
import type { AwarenessEntry } from "./awareness.js";

const ROW_TTL_MS = 30_000;

const WRITE_THROTTLE_MS = 2_000;

const PURGE_INTERVAL_MS = 30_000;

export const collabAwarenessStore = defineStore({
  id: "collab_awareness",
  migrations: [
    {
      name: "baseline",
      run: async () => {
        const createSql = `
        CREATE TABLE IF NOT EXISTS _collab_awareness (
          doc_id TEXT NOT NULL,
          client_id BIGINT NOT NULL,
          state TEXT NOT NULL,
          last_seen BIGINT NOT NULL,
          PRIMARY KEY (doc_id, client_id)
        )
      `;
        await ensureTableExists("_collab_awareness", createSql);
      },
    },
  ],
});

export function ensureTable(): Promise<void> {
  return collabAwarenessStore.ready();
}

const _lastWrites = new Map<string, { state: string; writtenAt: number }>();
const _lastPurges = new Map<string, number>();

function writeKey(docId: string, clientId: number): string {
  return `${docId}\0${clientId}`;
}

export async function upsertAwarenessRow(
  docId: string,
  clientId: number,
  state: string,
  lastSeen: number,
): Promise<void> {
  try {
    const key = writeKey(docId, clientId);
    const prev = _lastWrites.get(key);
    if (
      prev &&
      prev.state === state &&
      lastSeen - prev.writtenAt < WRITE_THROTTLE_MS
    ) {
      return;
    }

    await ensureTable();
    const client = getDbExec();
    {
      await client.execute({
        sql: `INSERT INTO _collab_awareness (doc_id, client_id, state, last_seen)
              VALUES (?, ?, ?, ?)
              ON CONFLICT (doc_id, client_id)
              DO UPDATE SET state = EXCLUDED.state, last_seen = EXCLUDED.last_seen`,
        args: [docId, clientId, state, lastSeen],
      });
    }
    _lastWrites.set(key, { state, writtenAt: lastSeen });

    await maybePurge(docId, lastSeen);
  } catch {
    // Best-effort — presence never fails a request.
  }
}

export async function deleteAwarenessRow(
  docId: string,
  clientId: number,
  maxLastSeen?: number,
): Promise<void> {
  try {
    await ensureTable();
    const client = getDbExec();
    if (maxLastSeen == null) {
      await client.execute({
        sql: `DELETE FROM _collab_awareness WHERE doc_id = ? AND client_id = ?`,
        args: [docId, clientId],
      });
    } else {
      await client.execute({
        sql: `DELETE FROM _collab_awareness
              WHERE doc_id = ? AND client_id = ? AND last_seen <= ?`,
        args: [docId, clientId, maxLastSeen],
      });
    }
    _lastWrites.delete(writeKey(docId, clientId));
  } catch {
    // Best-effort.
  }
}

/**
 * Writes a reader's row, or clears it when `next` is null, only while the row
 * is still what the reader's read at `seen.readAt` found: `seen.row`, or none
 * live. False when a write since got there first, as a writer's on another
 * server can; a store that cannot be reached throws instead.
 */
export async function replaceReaderAwarenessRow(
  docId: string,
  clientId: number,
  next: { state: string; lastSeen: number } | null,
  seen: { row: AwarenessEntry | null; readAt: number },
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const key = writeKey(docId, clientId);
  const expiredBefore = seen.readAt - ROW_TTL_MS;
  let query: { sql: string; args: unknown[] };
  if (seen.row && next) {
    query = {
      sql: `UPDATE _collab_awareness SET state = ?, last_seen = ?
            WHERE doc_id = ? AND client_id = ? AND state = ? AND last_seen = ?`,
      args: [
        next.state,
        next.lastSeen,
        docId,
        clientId,
        seen.row.state,
        seen.row.lastSeen,
      ],
    };
  } else if (seen.row) {
    query = {
      sql: `DELETE FROM _collab_awareness
            WHERE doc_id = ? AND client_id = ? AND state = ? AND last_seen = ?`,
      args: [docId, clientId, seen.row.state, seen.row.lastSeen],
    };
  } else if (next) {
    query = {
      sql: `INSERT INTO _collab_awareness (doc_id, client_id, state, last_seen)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (doc_id, client_id)
            DO UPDATE SET state = EXCLUDED.state, last_seen = EXCLUDED.last_seen
            WHERE _collab_awareness.last_seen < ?`,
      args: [docId, clientId, next.state, next.lastSeen, expiredBefore],
    };
  } else {
    // Nothing live to clear. An expired row may go; one written since stays.
    await client.execute({
      sql: `DELETE FROM _collab_awareness
            WHERE doc_id = ? AND client_id = ? AND last_seen < ?`,
      args: [docId, clientId, expiredBefore],
    });
    _lastWrites.delete(key);
    return true;
  }
  const { rowsAffected } = await client.execute(query);
  if (rowsAffected === 0) return false;
  if (next)
    _lastWrites.set(key, { state: next.state, writtenAt: next.lastSeen });
  else _lastWrites.delete(key);
  return true;
}

export async function loadAwarenessRows(
  docId: string,
  now: number = Date.now(),
): Promise<AwarenessEntry[]> {
  try {
    return await loadAwarenessRowsStrict(docId, now);
  } catch {
    return [];
  }
}

export async function loadAwarenessRowsStrict(
  docId: string,
  now: number = Date.now(),
): Promise<AwarenessEntry[]> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT client_id, state, last_seen FROM _collab_awareness
          WHERE doc_id = ? AND last_seen >= ?`,
    args: [docId, now - ROW_TTL_MS],
  });
  return rows.map((row: any) => ({
    clientId: Number(row.client_id),
    state: String(row.state),
    lastSeen: Number(row.last_seen),
  }));
}

async function maybePurge(docId: string, now: number): Promise<void> {
  const last = _lastPurges.get(docId) ?? 0;
  if (now - last < PURGE_INTERVAL_MS) return;
  _lastPurges.set(docId, now);
  const client = getDbExec();
  await client.execute({
    sql: `DELETE FROM _collab_awareness WHERE doc_id = ? AND last_seen < ?`,
    args: [docId, now - ROW_TTL_MS * 2],
  });
}

export function _resetAwarenessStoreForTests(): void {
  _lastWrites.clear();
  _lastPurges.clear();
  collabAwarenessStore.reset();
}
