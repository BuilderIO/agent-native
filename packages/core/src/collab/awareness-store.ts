import { getDbExec } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { defineStore } from "../db/store-registry.js";
import {
  MAX_AWARENESS_CLIENT_SEQUENCE,
  MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE,
  MAX_LEGACY_AWARENESS_CLOCK_SKEW_MS,
} from "./awareness-sequence.js";
import type { AwarenessRow } from "./awareness.js";

const ROW_TTL_MS = 30_000;

const ACTOR_RESERVATION_TTL_MS = ROW_TTL_MS * 2;

const WRITE_THROTTLE_MS = 2_000;

const PURGE_INTERVAL_MS = 30_000;

const PURGE_WAIT_TIMEOUT_MS = 250;

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
    {
      name: "actor-email",
      run: async () => {
        await ensureColumnExists(
          "_collab_awareness",
          "actor_email",
          "ALTER TABLE _collab_awareness ADD COLUMN IF NOT EXISTS actor_email TEXT",
        );
      },
    },
    {
      name: "clear-token-hash",
      run: async () => {
        await ensureColumnExists(
          "_collab_awareness",
          "clear_token_hash",
          "ALTER TABLE _collab_awareness ADD COLUMN IF NOT EXISTS clear_token_hash TEXT",
        );
      },
    },
    {
      name: "actor-reservation-expiry",
      run: async () => {
        await ensureColumnExists(
          "_collab_awareness",
          "actor_email_expires_at",
          "ALTER TABLE _collab_awareness ADD COLUMN IF NOT EXISTS actor_email_expires_at BIGINT",
        );
      },
    },
    {
      name: "expiry-indexes",
      run: async () => {
        await ensureIndexExists(
          "_collab_awareness_active_actor_expiry_idx",
          `CREATE INDEX IF NOT EXISTS _collab_awareness_active_actor_expiry_idx
           ON _collab_awareness (last_seen)
           WHERE actor_email IS NOT NULL AND state <> ''`,
        );
        await ensureIndexExists(
          "_collab_awareness_actor_reservation_expiry_idx",
          `CREATE INDEX IF NOT EXISTS _collab_awareness_actor_reservation_expiry_idx
           ON _collab_awareness (
             (COALESCE(actor_email_expires_at, last_seen + ${ACTOR_RESERVATION_TTL_MS}))
           )
           WHERE actor_email IS NOT NULL`,
        );
        await ensureIndexExists(
          "_collab_awareness_anonymous_expiry_idx",
          `CREATE INDEX IF NOT EXISTS _collab_awareness_anonymous_expiry_idx
           ON _collab_awareness (last_seen)
           WHERE actor_email IS NULL`,
        );
      },
    },
  ],
});

export function ensureTable(): Promise<void> {
  return collabAwarenessStore.ready();
}

const _lastWrites = new Map<string, { state: string; writtenAt: number }>();
// Throttle failed attempts too, or each awareness request retries the purge.
let _lastPurgeAttemptAt = 0;
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
  actorEmail?: string | null,
  clearTokenHash?: string | null,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const normalizedActorEmail = actorEmail?.trim().toLowerCase() || null;
  const normalizedClearTokenHash = clearTokenHash?.trim() || null;
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
  if (cleared) {
    // Keep ownership, sequence validation, and clearing in one conflict update.
    const sequencePredicate = isLegacyClockSequence
      ? `(_collab_awareness.client_sequence_raw > 0
           AND ? > _collab_awareness.client_sequence_raw)
         OR (_collab_awareness.client_sequence_raw = 0
             AND _collab_awareness.client_sequence > ${MAX_AWARENESS_CLIENT_SEQUENCE}
             AND ? > _collab_awareness.client_sequence)
         OR (_collab_awareness.client_sequence_raw = 0
             AND _collab_awareness.client_sequence = 0)`
      : clientSequence > 0
        ? `((_collab_awareness.client_sequence_raw > 0
             OR _collab_awareness.client_sequence > ${MAX_AWARENESS_CLIENT_SEQUENCE})
            AND ? <= ${MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE})
           OR (_collab_awareness.client_sequence_raw = 0
               AND _collab_awareness.client_sequence <= ${MAX_AWARENESS_CLIENT_SEQUENCE}
               AND ? > _collab_awareness.client_sequence
               AND ? <= _collab_awareness.client_sequence + ${MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE})`
        : `(_collab_awareness.client_sequence_raw = 0
            AND _collab_awareness.client_sequence = 0)`;
    const nextClientSequence = isLegacyClockSequence
      ? `CASE
          WHEN _collab_awareness.client_sequence >= ${MAX_AWARENESS_CLIENT_SEQUENCE}
            THEN 1
          ELSE _collab_awareness.client_sequence + 1
        END`
      : "EXCLUDED.client_sequence";
    const nextRawSequence = isLegacyClockSequence ? "?" : "0";
    const sequenceArguments = isLegacyClockSequence
      ? [clientSequence, clientSequence]
      : clientSequence > 0
        ? [clientSequence, clientSequence, clientSequence]
        : [];
    const { rows } = await client.execute({
      sql: `INSERT INTO _collab_awareness
              (doc_id, client_id, state, last_seen, client_sequence, cleared,
               client_sequence_raw, actor_email, clear_token_hash,
               actor_email_expires_at)
            VALUES (?, ?, '', ?, ?, TRUE, ?, ?, NULL, ?)
            ON CONFLICT (doc_id, client_id)
            DO UPDATE SET
              state = '',
              last_seen = GREATEST(
                _collab_awareness.last_seen,
                EXCLUDED.last_seen
              ),
              client_sequence = CASE
                WHEN _collab_awareness.actor_email IS NOT DISTINCT FROM EXCLUDED.actor_email
                  THEN ${nextClientSequence}
                ELSE _collab_awareness.client_sequence
              END,
              client_sequence_raw = CASE
                WHEN _collab_awareness.actor_email IS NOT DISTINCT FROM EXCLUDED.actor_email
                  THEN ${nextRawSequence}
                ELSE _collab_awareness.client_sequence_raw
              END,
              cleared = TRUE,
              clear_token_hash = NULL,
              actor_email_expires_at = CASE
                WHEN _collab_awareness.actor_email IS NOT NULL
                  THEN GREATEST(
                    _collab_awareness.last_seen,
                    EXCLUDED.last_seen
                  ) + ${ACTOR_RESERVATION_TTL_MS}
                ELSE NULL
              END
            WHERE _collab_awareness.cleared = FALSE
              AND (
                _collab_awareness.actor_email IS NOT DISTINCT FROM EXCLUDED.actor_email
                OR (? <> '' AND ? <> ''
                    AND _collab_awareness.actor_email IS NOT NULL
                    AND _collab_awareness.clear_token_hash = ?
                    AND _collab_awareness.last_seen >= EXCLUDED.last_seen - ${ROW_TTL_MS * 2})
              )
              AND (
                _collab_awareness.actor_email IS DISTINCT FROM EXCLUDED.actor_email
                OR (${sequencePredicate})
              )
            RETURNING client_id`,
      args: [
        docId,
        clientId,
        lastSeen,
        storedSequence,
        isLegacyClockSequence ? clientSequence : 0,
        normalizedActorEmail,
        normalizedActorEmail ? lastSeen + ACTOR_RESERVATION_TTL_MS : null,
        ...(isLegacyClockSequence ? [clientSequence] : []),
        normalizedActorEmail,
        normalizedClearTokenHash,
        normalizedClearTokenHash,
        ...sequenceArguments,
      ],
    });
    const applied = rows.length > 0;
    if (applied) {
      _lastWrites.delete(writeKey(docId, clientId));
      await maybePurgeBestEffort(lastSeen);
    }
    return applied;
  }
  const { rows } = await client.execute({
    sql: `INSERT INTO _collab_awareness
            (doc_id, client_id, state, last_seen, client_sequence, cleared,
             client_sequence_raw, actor_email, clear_token_hash,
             actor_email_expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (doc_id, client_id)
          DO UPDATE SET
            state = EXCLUDED.state,
            last_seen = EXCLUDED.last_seen,
            client_sequence = CASE
              WHEN _collab_awareness.actor_email
                   IS DISTINCT FROM EXCLUDED.actor_email
                THEN EXCLUDED.client_sequence
              WHEN EXCLUDED.client_sequence_raw > 0 THEN
                CASE
                  WHEN _collab_awareness.client_sequence >= ${MAX_AWARENESS_CLIENT_SEQUENCE}
                    THEN 1
                  ELSE _collab_awareness.client_sequence + 1
                END
              ELSE EXCLUDED.client_sequence
            END,
            client_sequence_raw = EXCLUDED.client_sequence_raw,
            cleared = EXCLUDED.cleared,
            actor_email = EXCLUDED.actor_email,
            clear_token_hash = EXCLUDED.clear_token_hash,
            actor_email_expires_at = EXCLUDED.actor_email_expires_at
            WHERE (
                 _collab_awareness.actor_email IS NOT DISTINCT FROM EXCLUDED.actor_email
                 OR (_collab_awareness.actor_email IS NULL
                   AND _collab_awareness.last_seen <
                   EXCLUDED.last_seen - CASE
                     WHEN _collab_awareness.cleared THEN ${ROW_TTL_MS * 2}
                     ELSE ${ROW_TTL_MS}
                   END)
                 OR (_collab_awareness.actor_email IS NOT NULL
                   AND COALESCE(
                     _collab_awareness.actor_email_expires_at,
                     _collab_awareness.last_seen + ${ACTOR_RESERVATION_TTL_MS}
                   ) <= EXCLUDED.last_seen)
               )
            AND (
              (_collab_awareness.actor_email IS NOT NULL
               AND _collab_awareness.actor_email IS DISTINCT FROM EXCLUDED.actor_email
               AND COALESCE(
                 _collab_awareness.actor_email_expires_at,
                 _collab_awareness.last_seen + ${ACTOR_RESERVATION_TTL_MS}
               ) <= EXCLUDED.last_seen)
             OR ((EXCLUDED.client_sequence_raw > 0
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
                 AND _collab_awareness.cleared = FALSE)))
          RETURNING client_id`,
    args: [
      docId,
      clientId,
      state,
      lastSeen,
      storedSequence,
      cleared,
      isLegacyClockSequence ? clientSequence : 0,
      normalizedActorEmail,
      normalizedClearTokenHash,
      normalizedActorEmail ? lastSeen + ACTOR_RESERVATION_TTL_MS : null,
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
    sql: `SELECT client_id, state, last_seen, client_sequence,
                 client_sequence_raw, actor_email, clear_token_hash, cleared
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
    clientSequenceRaw: Number(row.client_sequence_raw ?? 0),
    actorEmail:
      typeof row.actor_email === "string"
        ? row.actor_email.trim().toLowerCase()
        : null,
    clearTokenHash:
      typeof row.clear_token_hash === "string" ? row.clear_token_hash : null,
    cleared: row.cleared === true,
  }));
}

export async function loadAwarenessClientSequence(
  docId: string,
  clientId: number,
): Promise<
  | {
      clientSequence: number;
      clientSequenceRaw: number;
      cleared: boolean;
      actorEmail: string | null;
      lastSeen: number;
      clearTokenHash: string | null;
    }
  | undefined
> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT client_sequence, client_sequence_raw, cleared, actor_email,
                 last_seen, clear_token_hash
          FROM _collab_awareness
          WHERE doc_id = ? AND client_id = ?`,
    args: [docId, clientId],
  });
  const row = rows[0] as
    | {
        client_sequence?: unknown;
        client_sequence_raw?: unknown;
        cleared?: unknown;
        actor_email?: unknown;
        last_seen?: unknown;
        clear_token_hash?: unknown;
      }
    | undefined;
  if (!row) return undefined;
  return {
    clientSequence: Number(row.client_sequence ?? 0),
    clientSequenceRaw: Number(row.client_sequence_raw ?? 0),
    cleared: row.cleared === true,
    actorEmail:
      typeof row.actor_email === "string"
        ? row.actor_email.trim().toLowerCase()
        : null,
    lastSeen: Number(row.last_seen ?? 0),
    clearTokenHash:
      typeof row.clear_token_hash === "string" ? row.clear_token_hash : null,
  };
}

async function waitForPurge(purge: Promise<void>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      purge,
      new Promise<void>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                `Collaboration awareness purge exceeded ${PURGE_WAIT_TIMEOUT_MS}ms`,
              ),
            ),
          PURGE_WAIT_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function maybePurge(now: number): Promise<void> {
  if (now - _lastPurgeAttemptAt < PURGE_INTERVAL_MS) return;
  if (_purgeInFlight) return waitForPurge(_purgeInFlight);
  _lastPurgeAttemptAt = now;
  const client = getDbExec();
  const expiredBefore = now - ROW_TTL_MS * 2;
  // Keep actor-bound IDs reserved after their transient presence state expires.
  const purge = client
    .execute({
      sql: `UPDATE _collab_awareness
            SET state = '', clear_token_hash = NULL
            WHERE actor_email IS NOT NULL
              AND state <> ''
              AND last_seen < ?`,
      args: [now - ROW_TTL_MS],
    })
    .then(() =>
      client.execute({
        sql: `DELETE FROM _collab_awareness
              WHERE (actor_email IS NOT NULL
                     AND COALESCE(
                       actor_email_expires_at,
                       last_seen + ${ACTOR_RESERVATION_TTL_MS}
                     ) <= ?)
                 OR (actor_email IS NULL AND last_seen < ?)`,
        args: [now, expiredBefore],
      }),
    )
    .then(() => undefined);
  _purgeInFlight = purge;
  void purge.then(
    () => {
      if (_purgeInFlight === purge) _purgeInFlight = undefined;
    },
    () => {
      if (_purgeInFlight === purge) _purgeInFlight = undefined;
    },
  );
  await waitForPurge(purge);
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
  _lastPurgeAttemptAt = 0;
  _purgeInFlight = undefined;
  collabAwarenessStore.reset();
}
