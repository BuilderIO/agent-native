/**
 * SQL-backed awareness store — makes presence work across serverless
 * instances.
 *
 * The in-memory awareness map in `awareness.ts` is per-process: on a
 * multi-instance/serverless deployment, a cursor published to instance A is
 * invisible to a client polling instance B, and an agent action running in
 * its own invocation can't reach the SSE instance's memory at all. This
 * store mirrors awareness rows into a `_collab_awareness` table (SQLite +
 * Postgres portable) so every instance serves the same participant set.
 *
 * Everything here is best-effort: presence must never fail or slow down an
 * edit. Writes are throttled per (docId, clientId) and skipped when the
 * state hasn't changed; expired rows are purged opportunistically.
 */

import { getDbExec, isPostgres } from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";
import type { AwarenessEntry } from "./awareness.js";

/** Rows older than this are treated as expired (matches AWARENESS_TIMEOUT). */
const ROW_TTL_MS = 30_000;

/** Minimum interval between DB writes for an unchanged (docId, clientId). */
const WRITE_THROTTLE_MS = 2_000;

/** Minimum interval between opportunistic purges per document. */
const PURGE_INTERVAL_MS = 30_000;

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      // client_id is a Yjs uint32 (can exceed int32 max) and last_seen is
      // epoch milliseconds — both need BIGINT-range columns.
      const createSql = `
        CREATE TABLE IF NOT EXISTS _collab_awareness (
          doc_id TEXT NOT NULL,
          client_id BIGINT NOT NULL,
          state TEXT NOT NULL,
          last_seen BIGINT NOT NULL,
          PRIMARY KEY (doc_id, client_id)
        )
      `;
      if (isPostgres()) {
        await ensureTableExists("_collab_awareness", createSql);
        return;
      }
      await client.execute(createSql);
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

// (docId\0clientId) → { state, writtenAt } for write throttling.
const _lastWrites = new Map<string, { state: string; writtenAt: number }>();
// docId → last purge time.
const _lastPurges = new Map<string, number>();

function writeKey(docId: string, clientId: number): string {
  return `${docId}\0${clientId}`;
}

/**
 * Mirror a client's awareness state to SQL. Throttled: unchanged state is
 * rewritten at most every {@link WRITE_THROTTLE_MS} (to refresh last_seen).
 * Never throws.
 */
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
    if (isPostgres()) {
      await client.execute({
        sql: `INSERT INTO _collab_awareness (doc_id, client_id, state, last_seen)
              VALUES (?, ?, ?, ?)
              ON CONFLICT (doc_id, client_id)
              DO UPDATE SET state = EXCLUDED.state, last_seen = EXCLUDED.last_seen`,
        args: [docId, clientId, state, lastSeen],
      });
    } else {
      await client.execute({
        sql: `INSERT OR REPLACE INTO _collab_awareness (doc_id, client_id, state, last_seen)
              VALUES (?, ?, ?, ?)`,
        args: [docId, clientId, state, lastSeen],
      });
    }
    _lastWrites.set(key, { state, writtenAt: lastSeen });

    await maybePurge(docId, lastSeen);
  } catch {
    // Best-effort — presence never fails a request.
  }
}

/** Remove a client's row (participant left). Never throws. */
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
 * Load non-expired awareness rows for a document. Returns [] on any
 * failure (memory-only degradation).
 */
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

/**
 * Strict awareness read for safety-critical callers that must distinguish
 * "no active participants" from "presence storage could not be read."
 */
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

/** Test hook: reset module-level throttles. */
export function _resetAwarenessStoreForTests(): void {
  _lastWrites.clear();
  _lastPurges.clear();
  _initPromise = undefined;
}
