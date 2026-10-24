import { getDbExec } from "../db/client.js";
import { ensureColumnExists, ensureTableExists } from "../db/ddl-guard.js";
import { defineStore } from "../db/store-registry.js";
import {
  MAX_AWARENESS_CLIENT_SEQUENCE,
  MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE,
  MAX_LEGACY_AWARENESS_CLOCK_SKEW_MS,
} from "./awareness-sequence.js";
import type { AwarenessRow } from "./awareness.js";

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
    {
      name: "client-sequence",
      run: async () => {
        await ensureColumnExists(
          "_collab_awareness",
          "client_sequence",
          "ALTER TABLE _collab_awareness ADD COLUMN IF NOT EXISTS client_sequence BIGINT NOT NULL DEFAULT 0",
        );
        await ensureColumnExists(
          "_collab_awareness",
          "cleared",
          "ALTER TABLE _collab_awareness ADD COLUMN IF NOT EXISTS cleared BOOLEAN NOT NULL DEFAULT FALSE",
        );
      },
    },
    {
      name: "client-sequence-raw",
      run: async () => {
        await ensureColumnExists(
          "_collab_awareness",
          "client_sequence_raw",
          "ALTER TABLE _collab_awareness ADD COLUMN IF NOT EXISTS client_sequence_raw BIGINT NOT NULL DEFAULT 0",
        );
      },
    },
  ],
});

export function ensureTable(): Promise<void> {
  return collabAwarenessStore.ready();
}

const _lastWrites = new Map<string, { state: string; writtenAt: number }>();
let _lastPurgeAt = 0;
let _purgeInFlight: Promise<void> | undefined;

function writeKey(docId: string, clientId: number): string {
  return `${docId}\0${clientId}`;
}

export async function upsertAwarenessRow(
  docId: string,
  clientId: number,
  state: string,
  lastSeen: number,
): Promise<void> {
  const key = writeKey(docId, clientId);
  const prev = _lastWrites.get(key);
  if (
    prev &&
    prev.state === state &&
    lastSeen - prev.writtenAt < WRITE_THROTTLE_MS
  ) {
    return;
  }

  const applied = await writeAwarenessRow(
    docId,
    clientId,
    state,
    lastSeen,
    0,
    false,
  );
  if (applied) _lastWrites.set(key, { state, writtenAt: lastSeen });
}

export async function writeAwarenessRow(
  docId: string,
  clientId: number,
  state: string,
  lastSeen: number,
  clientSequence: number,
  cleared: boolean,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const isLegacyClockSequence = clientSequence > MAX_AWARENESS_CLIENT_SEQUENCE;
  if (
    isLegacyClockSequence &&
    clientSequence > (lastSeen + MAX_LEGACY_AWARENESS_CLOCK_SKEW_MS) * 1_000
  ) {
    return false;
  }
  if (
    !isLegacyClockSequence &&
    clientSequence > MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE
  ) {
    const { rows } = await client.execute({
      sql: `SELECT client_sequence, client_sequence_raw
            FROM _collab_awareness
            WHERE doc_id = ? AND client_id = ?`,
      args: [docId, clientId],
    });
    if (rows.length === 0) return false;
  }
  const storedSequence = isLegacyClockSequence ? 1 : clientSequence;
  const { rows } = await client.execute({
    sql: `INSERT INTO _collab_awareness
            (doc_id, client_id, state, last_seen, client_sequence, cleared,
             client_sequence_raw)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (doc_id, client_id)
          DO UPDATE SET
            state = EXCLUDED.state,
            last_seen = EXCLUDED.last_seen,
            client_sequence = CASE
              WHEN EXCLUDED.client_sequence_raw > 0 THEN
                CASE
                  WHEN _collab_awareness.client_sequence >= ${MAX_AWARENESS_CLIENT_SEQUENCE}
                    THEN 1
                  ELSE _collab_awareness.client_sequence + 1
                END
              ELSE EXCLUDED.client_sequence
            END,
            client_sequence_raw = EXCLUDED.client_sequence_raw,
            cleared = EXCLUDED.cleared
          WHERE (EXCLUDED.client_sequence_raw > 0
                 AND (( _collab_awareness.client_sequence_raw > 0
                        AND EXCLUDED.client_sequence_raw > _collab_awareness.client_sequence_raw)
                   OR (_collab_awareness.client_sequence_raw = 0
                       AND _collab_awareness.client_sequence > ${MAX_AWARENESS_CLIENT_SEQUENCE}
                       AND EXCLUDED.client_sequence_raw > _collab_awareness.client_sequence)
                   OR (_collab_awareness.client_sequence_raw = 0
                       AND _collab_awareness.client_sequence = 0
                       AND _collab_awareness.cleared = FALSE)))
             OR (EXCLUDED.client_sequence_raw = 0
                 AND EXCLUDED.client_sequence > 0
                 AND _collab_awareness.cleared = FALSE
                 AND (((_collab_awareness.client_sequence_raw > 0
                        OR _collab_awareness.client_sequence > ${MAX_AWARENESS_CLIENT_SEQUENCE})
                       AND EXCLUDED.client_sequence <= ${MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE})
                   OR (_collab_awareness.client_sequence_raw = 0
                       AND _collab_awareness.client_sequence <= ${MAX_AWARENESS_CLIENT_SEQUENCE}
                       AND EXCLUDED.client_sequence > _collab_awareness.client_sequence
                       AND EXCLUDED.client_sequence <= _collab_awareness.client_sequence + ${MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE})))
             OR (EXCLUDED.client_sequence_raw = 0
                 AND EXCLUDED.client_sequence = 0
                 AND _collab_awareness.client_sequence = 0
                 AND _collab_awareness.cleared = FALSE)
          RETURNING client_id`,
    args: [
      docId,
      clientId,
      state,
      lastSeen,
      storedSequence,
      cleared,
      isLegacyClockSequence ? clientSequence : 0,
    ],
  });
  const applied = rows.length > 0;
  if (applied) {
    _lastWrites.delete(writeKey(docId, clientId));
    await maybePurgeBestEffort(lastSeen);
  }
  return applied;
}

export async function deleteAwarenessRow(
  docId: string,
  clientId: number,
  maxLastSeen?: number,
): Promise<void> {
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
}

export async function loadAwarenessRows(
  docId: string,
  now: number = Date.now(),
): Promise<AwarenessRow[]> {
  return loadAwarenessRowsStrict(docId, now);
}

export async function loadAwarenessRowsStrict(
  docId: string,
  now: number = Date.now(),
): Promise<AwarenessRow[]> {
  await ensureTable();
  await maybePurgeBestEffort(now);
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT client_id, state, last_seen, client_sequence, cleared
          FROM _collab_awareness
          WHERE doc_id = ?
            AND ((cleared = FALSE AND last_seen >= ?)
              OR (cleared = TRUE AND last_seen >= ?))`,
    args: [docId, now - ROW_TTL_MS, now - ROW_TTL_MS * 2],
  });
  return rows.map((row: any) => ({
    clientId: Number(row.client_id),
    state: String(row.state),
    lastSeen: Number(row.last_seen),
    clientSequence: Number(row.client_sequence ?? 0),
    cleared: row.cleared === true,
  }));
}

export async function loadAwarenessClientSequence(
  docId: string,
  clientId: number,
): Promise<{ clientSequence: number; cleared: boolean } | undefined> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT client_sequence, cleared
          FROM _collab_awareness
          WHERE doc_id = ? AND client_id = ?`,
    args: [docId, clientId],
  });
  const row = rows[0] as
    | { client_sequence?: unknown; cleared?: unknown }
    | undefined;
  if (!row) return undefined;
  return {
    clientSequence: Number(row.client_sequence ?? 0),
    cleared: row.cleared === true,
  };
}

async function maybePurge(now: number): Promise<void> {
  if (now - _lastPurgeAt < PURGE_INTERVAL_MS) return;
  if (_purgeInFlight) return _purgeInFlight;
  const client = getDbExec();
  _purgeInFlight = client
    .execute({
      sql: `DELETE FROM _collab_awareness WHERE last_seen < ?`,
      args: [now - ROW_TTL_MS * 2],
    })
    .then(() => {
      _lastPurgeAt = now;
    })
    .finally(() => {
      _purgeInFlight = undefined;
    });
  await _purgeInFlight;
}

async function maybePurgeBestEffort(now: number): Promise<void> {
  try {
    await maybePurge(now);
  } catch (error) {
    console.error(
      "Failed to purge expired collaboration awareness rows",
      error,
    );
  }
}

export function _resetAwarenessStoreForTests(): void {
  _lastWrites.clear();
  _lastPurgeAt = 0;
  _purgeInFlight = undefined;
  collabAwarenessStore.reset();
}
