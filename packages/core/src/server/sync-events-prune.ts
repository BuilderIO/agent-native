import { randomUUID } from "node:crypto";

import type { DbExec } from "../db/client.js";

export const SYNC_EVENTS_RETENTION_MS = 24 * 60 * 60 * 1000;
export const SYNC_EVENTS_PRUNE_STATE_TABLE = "sync_events_prune_state";

const STATE_ID = 1;
const BATCH_SIZE = 2_000;
const MAX_BATCHES = 100;
const BUDGET_MS = 10_000;
const STATEMENT_TIMEOUT_MS = 4_000;
const MIN_BATCH_WINDOW_MS = 1_000;
const IDLE_RECHECK_MS = 5 * 60_000;
const LEASE_GRACE_MS = 15_000;
const LOG_FAILURES_UP_TO = 3;
const LOG_FAILURES_EVERY = 10;

// Failures that could not reach the state row (for example the table is
// missing), counted per process so the error log stays throttled.
let unrecordedFailures = 0;

export interface SyncEventsPruneOptions {
  now?: number;
  retentionMs?: number;
  batchSize?: number;
  maxBatches?: number;
  budgetMs?: number;
  statementTimeoutMs?: number;
  /** Absolute wall-clock deadline of the caller (a recurring sweep tick). */
  deadlineAt?: number;
  signal?: AbortSignal;
  /** Probe even if a recent run found nothing to prune. */
  force?: boolean;
}

/**
 * `idle` means the head of the table is newer than the retention cutoff. A
 * run that could not prune is `failed` and is recorded on the state row; it
 * never degrades into `idle`.
 */
export type SyncEventsPruneResult =
  | {
      status: "pruned";
      deleted: number;
      batches: number;
      drained: boolean;
      cursorVersion: number;
    }
  | { status: "idle" }
  | { status: "lease-held" }
  | {
      status: "failed";
      error: string;
      deleted: number;
      consecutiveFailures: number;
    };

export interface SyncEventsPruneState {
  cursorVersion: number;
  leaseExpiresAt: number;
  lastRunAt: number | null;
  lastCheckedAt: number | null;
  lastSuccessAt: number | null;
  lastDeleted: number;
  totalDeleted: number;
  backlog: boolean;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorAt: number | null;
}

// Keyed on `version` (indexed, monotonic across the table) rather than
// `created_at`: the retention scan must not depend on the created_at index
// existing or on the dead-tuple head of a bloated table. The window is read
// from the persisted cursor, so each statement touches at most `batchSize`
// rows no matter how large the backlog is.
const HEAD_SQL = `SELECT version, created_at FROM sync_events
  WHERE version > ? ORDER BY version LIMIT 1`;
const BATCH_SQL = `WITH win AS MATERIALIZED (
    SELECT id, version, created_at FROM sync_events
    WHERE version > ? ORDER BY version LIMIT ?
  ), del AS (
    DELETE FROM sync_events s USING win w
    WHERE s.id = w.id AND w.created_at < ?
    RETURNING s.version
  )
  SELECT (SELECT COUNT(*) FROM win) AS scanned,
         (SELECT COUNT(*) FROM del) AS deleted,
         (SELECT MAX(version) FROM win) AS window_max,
         (SELECT MIN(version) FROM win WHERE created_at >= ?) AS first_kept`;

function requireInt(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (value == null || !Number.isFinite(parsed)) {
    throw new Error(`sync_events prune read an unusable ${label}: ${value}`);
  }
  return parsed;
}

function optionalInt(value: unknown): number | null {
  return value == null ? null : requireInt(value, "timestamp");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readSyncEventsPruneState(
  client: DbExec,
): Promise<SyncEventsPruneState> {
  const read = () =>
    client.execute({
      sql: `SELECT cursor_version, lease_expires_at, last_run_at, last_checked_at,
              last_success_at, last_deleted, total_deleted, backlog,
              consecutive_failures, last_error, last_error_at
            FROM ${SYNC_EVENTS_PRUNE_STATE_TABLE} WHERE id = ?`,
      args: [STATE_ID],
    });
  let { rows } = await read();
  if (rows.length === 0) {
    await client.execute({
      sql: `INSERT INTO ${SYNC_EVENTS_PRUNE_STATE_TABLE} (id) VALUES (?)
            ON CONFLICT (id) DO NOTHING`,
      args: [STATE_ID],
    });
    ({ rows } = await read());
  }
  const row = rows[0];
  if (!row) throw new Error("sync_events_prune_state row could not be created");
  return {
    cursorVersion: requireInt(row.cursor_version, "cursor_version"),
    leaseExpiresAt: optionalInt(row.lease_expires_at) ?? 0,
    lastRunAt: optionalInt(row.last_run_at),
    lastCheckedAt: optionalInt(row.last_checked_at),
    lastSuccessAt: optionalInt(row.last_success_at),
    lastDeleted: requireInt(row.last_deleted, "last_deleted"),
    totalDeleted: requireInt(row.total_deleted, "total_deleted"),
    backlog: row.backlog === true || row.backlog === "t" || row.backlog === 1,
    consecutiveFailures: requireInt(
      row.consecutive_failures,
      "consecutive_failures",
    ),
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    lastErrorAt: optionalInt(row.last_error_at),
  };
}

function reportFailure(consecutiveFailures: number, message: string): void {
  if (
    consecutiveFailures > LOG_FAILURES_UP_TO &&
    consecutiveFailures % LOG_FAILURES_EVERY !== 0
  ) {
    return;
  }
  console.error(
    `[agent-native] sync_events prune FAILED (${consecutiveFailures} consecutive); the table keeps growing until it succeeds. State: ${SYNC_EVENTS_PRUNE_STATE_TABLE}.last_error. ${message}`,
  );
}

/**
 * Delete sync events older than the retention window in bounded batches.
 *
 * Progress is a persisted version cursor and the lease lives on the same row,
 * so a cold instance resumes where the last one stopped and concurrent
 * instances skip instead of piling up. Every failure is counted on the row and
 * logged at error level, and is returned as `failed` rather than `idle`.
 */
export async function pruneSyncEvents(
  client: DbExec,
  options: SyncEventsPruneOptions = {},
): Promise<SyncEventsPruneResult> {
  const startedAt = Date.now();
  const cutoff =
    (options.now ?? startedAt) -
    (options.retentionMs ?? SYNC_EVENTS_RETENTION_MS);
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const maxBatches = options.maxBatches ?? MAX_BATCHES;
  const statementTimeoutMs = options.statementTimeoutMs ?? STATEMENT_TIMEOUT_MS;
  const budgetMs = options.budgetMs ?? BUDGET_MS;
  const deadline = Math.min(
    startedAt + budgetMs,
    options.deadlineAt === undefined
      ? Number.POSITIVE_INFINITY
      : options.deadlineAt - MIN_BATCH_WINDOW_MS,
  );
  const owner = randomUUID();
  const bounded = (sql: string, args: unknown[]) =>
    client.execute({
      sql,
      args,
      timeoutMs: Math.min(
        statementTimeoutMs,
        Math.max(MIN_BATCH_WINDOW_MS, deadline - Date.now()),
      ),
      maxAttempts: 1,
    });

  let cursor = 0;
  let deleted = 0;
  let batches = 0;
  let drained = false;
  let leased = false;
  try {
    const state = await readSyncEventsPruneState(client);
    cursor = state.cursorVersion;
    if (state.leaseExpiresAt > startedAt) return { status: "lease-held" };
    if (
      !options.force &&
      !state.backlog &&
      state.lastCheckedAt !== null &&
      startedAt - state.lastCheckedAt < IDLE_RECHECK_MS
    ) {
      return { status: "idle" };
    }

    const head = await bounded(HEAD_SQL, [cursor]);
    if (
      head.rows.length === 0 ||
      requireInt(head.rows[0].created_at, "created_at") >= cutoff
    ) {
      await client.execute({
        sql: `UPDATE ${SYNC_EVENTS_PRUNE_STATE_TABLE}
              SET last_checked_at = ?, backlog = FALSE WHERE id = ?`,
        args: [startedAt, STATE_ID],
      });
      return { status: "idle" };
    }

    const claim = await client.execute({
      sql: `UPDATE ${SYNC_EVENTS_PRUNE_STATE_TABLE}
            SET lease_owner = ?, lease_expires_at = ?, last_run_at = ?
            WHERE id = ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
      args: [owner, deadline + LEASE_GRACE_MS, startedAt, STATE_ID, startedAt],
    });
    if (claim.rowsAffected === 0) return { status: "lease-held" };
    leased = true;

    while (
      batches < maxBatches &&
      deadline - Date.now() >= MIN_BATCH_WINDOW_MS
    ) {
      if (options.signal?.aborted) break;
      const result = await bounded(BATCH_SQL, [
        cursor,
        batchSize,
        cutoff,
        cutoff,
      ]);
      batches++;
      const row = result.rows[0];
      if (!row) throw new Error("sync_events prune batch returned no result");
      const scanned = requireInt(row.scanned, "scanned");
      deleted += requireInt(row.deleted, "deleted");
      if (scanned === 0) {
        drained = true;
        break;
      }
      const windowMax = requireInt(row.window_max, "window_max");
      const firstKept =
        row.first_kept == null
          ? null
          : requireInt(row.first_kept, "first_kept");
      // Versions can tie across a LIMIT boundary, so a full window only
      // advances to just below its last version; a survivor pins the cursor
      // below itself so it is revisited once it ages out.
      cursor = Math.max(
        cursor,
        firstKept !== null
          ? firstKept - 1
          : scanned < batchSize
            ? windowMax
            : windowMax - 1,
      );
      if (firstKept !== null || scanned < batchSize) {
        drained = true;
        break;
      }
    }

    const finishedAt = Date.now();
    await client.execute({
      sql: `UPDATE ${SYNC_EVENTS_PRUNE_STATE_TABLE} SET
              cursor_version = GREATEST(cursor_version, ?),
              lease_owner = NULL, lease_expires_at = 0,
              last_run_at = ?, last_checked_at = ?, last_success_at = ?,
              last_deleted = ?, total_deleted = total_deleted + ?,
              backlog = ?, consecutive_failures = 0, last_error = NULL
            WHERE id = ? AND lease_owner = ?`,
      args: [
        cursor,
        startedAt,
        finishedAt,
        finishedAt,
        deleted,
        deleted,
        !drained,
        STATE_ID,
        owner,
      ],
    });
    unrecordedFailures = 0;
    if (deleted === 0) return { status: "idle" };
    console.info(
      `[agent-native] sync_events prune deleted ${deleted} row(s) in ${batches} batch(es)${drained ? "" : "; more remain and will be pruned on the next tick"}`,
    );
    return {
      status: "pruned",
      deleted,
      batches,
      drained,
      cursorVersion: cursor,
    };
  } catch (error) {
    const message = errorMessage(error).slice(0, 500);
    let consecutiveFailures = 1;
    try {
      await client.execute({
        sql: `UPDATE ${SYNC_EVENTS_PRUNE_STATE_TABLE} SET
                cursor_version = GREATEST(cursor_version, ?),
                lease_expires_at = CASE WHEN lease_owner = ? THEN 0 ELSE lease_expires_at END,
                lease_owner = CASE WHEN lease_owner = ? THEN NULL ELSE lease_owner END,
                last_run_at = ?, last_deleted = ?, total_deleted = total_deleted + ?,
                backlog = TRUE, consecutive_failures = consecutive_failures + 1,
                last_error = ?, last_error_at = ?
              WHERE id = ?`,
        args: [
          cursor,
          leased ? owner : "",
          leased ? owner : "",
          startedAt,
          deleted,
          deleted,
          message,
          Date.now(),
          STATE_ID,
        ],
      });
      consecutiveFailures = (await readSyncEventsPruneState(client))
        .consecutiveFailures;
    } catch (recordError) {
      console.error(
        `[agent-native] sync_events prune failure could not be recorded on ${SYNC_EVENTS_PRUNE_STATE_TABLE}: ${errorMessage(recordError)}`,
      );
      consecutiveFailures = ++unrecordedFailures;
    }
    reportFailure(consecutiveFailures, message);
    return { status: "failed", error: message, deleted, consecutiveFailures };
  }
}
