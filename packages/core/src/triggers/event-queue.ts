import { randomUUID } from "node:crypto";

import { resolveBackgroundRunHardTimeoutMs } from "../agent/run-manager.js";
import { getDbExec } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { runMigrations, type MigrationEntry } from "../db/migrations.js";

const TABLE = "automation_trigger_event_queue";
const SWEEP_STATE_TABLE = "automation_trigger_event_queue_sweep_state";
const COMPLETED_PAYLOAD = '{"kind":"completed"}';
const UNIQUE_INDEX = "idx_automation_trigger_event_queue_dedupe";
const ORDER_INDEX = "idx_automation_trigger_event_queue_order";
const READY_INDEX = "idx_automation_trigger_event_queue_ready";
const COMPLETED_INDEX = "idx_automation_trigger_event_queue_completed";
const FAILED_INDEX = "idx_automation_trigger_event_queue_failed";
const STALE_EVENT_INDEX = "idx_automation_trigger_event_queue_stale_event";
export const AUTOMATION_TRIGGER_EVENT_DEDUPE_RETENTION_MS =
  7 * 24 * 60 * 60_000;
export const AUTOMATION_TRIGGER_EVENT_PURGE_BATCH_SIZE = 1_000;
export const AUTOMATION_TRIGGER_EVENT_EXPIRY_BATCH_SIZE = 1_000;
export const MAX_AUTOMATION_TRIGGER_EVENT_FAILURES = 8;
const CLAIM_LEASE_MS = () =>
  Math.ceil(resolveBackgroundRunHardTimeoutMs() * 1.5);

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  id TEXT PRIMARY KEY,
  sequence_id BIGSERIAL NOT NULL UNIQUE,
  trigger_id TEXT NOT NULL,
  trigger_owner TEXT NOT NULL,
  trigger_path TEXT NOT NULL,
  app_id TEXT,
  event_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  event_owner TEXT,
  emitted_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts BIGINT NOT NULL DEFAULT 0,
  failure_attempts BIGINT NOT NULL DEFAULT 0,
  available_at BIGINT NOT NULL,
  claimed_at BIGINT,
  created_at BIGINT NOT NULL,
  completed_at BIGINT,
  last_error TEXT
)`;

const CREATE_SWEEP_STATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${SWEEP_STATE_TABLE} (
  scope_key TEXT PRIMARY KEY,
  last_trigger_id TEXT,
  purge_after BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
)`;

export const AUTOMATION_TRIGGER_EVENT_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "automation-trigger-event-queue",
    sql: `${CREATE_TABLE_SQL};
      CREATE UNIQUE INDEX IF NOT EXISTS ${UNIQUE_INDEX}
        ON ${TABLE} (trigger_id, event_id);
      CREATE INDEX IF NOT EXISTS ${ORDER_INDEX}
        ON ${TABLE} (trigger_id, sequence_id, status);
      CREATE INDEX IF NOT EXISTS ${READY_INDEX}
        ON ${TABLE} (app_id, status, available_at, claimed_at);
      CREATE INDEX IF NOT EXISTS ${COMPLETED_INDEX}
        ON ${TABLE} (completed_at) WHERE status = 'completed';
      CREATE INDEX IF NOT EXISTS ${FAILED_INDEX}
        ON ${TABLE} (completed_at) WHERE status = 'failed'`,
  },
  {
    version: 2,
    name: "automation-trigger-event-failure-attempts",
    sql: `ALTER TABLE ${TABLE}
        ADD COLUMN IF NOT EXISTS failure_attempts BIGINT NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS ${FAILED_INDEX}
        ON ${TABLE} (completed_at) WHERE status = 'failed'`,
  },
  {
    version: 3,
    name: "automation-trigger-event-stale-mail-index",
    sql: `CREATE INDEX IF NOT EXISTS ${STALE_EVENT_INDEX}
      ON ${TABLE} (app_id, event_name, emitted_at)
      WHERE status = 'pending'`,
  },
  {
    version: 4,
    name: "automation-trigger-event-queue-sweep-state",
    sql: CREATE_SWEEP_STATE_TABLE_SQL,
  },
];

export async function runAutomationTriggerEventMigrations(
  nitroApp: unknown,
): Promise<void> {
  await runMigrations(AUTOMATION_TRIGGER_EVENT_MIGRATIONS, {
    table: "_automation_trigger_event_migrations",
  })(nitroApp);
}

let _initPromise: Promise<void> | undefined;

export async function ensureAutomationTriggerEventQueue(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      await ensureTableExists(TABLE, CREATE_TABLE_SQL);
      await ensureTableExists(SWEEP_STATE_TABLE, CREATE_SWEEP_STATE_TABLE_SQL);
      await ensureColumnExists(
        TABLE,
        "failure_attempts",
        `ALTER TABLE ${TABLE}
          ADD COLUMN IF NOT EXISTS failure_attempts BIGINT NOT NULL DEFAULT 0`,
      );
      await ensureIndexExists(
        UNIQUE_INDEX,
        `CREATE UNIQUE INDEX IF NOT EXISTS ${UNIQUE_INDEX}
          ON ${TABLE} (trigger_id, event_id)`,
      );
      await ensureIndexExists(
        ORDER_INDEX,
        `CREATE INDEX IF NOT EXISTS ${ORDER_INDEX}
          ON ${TABLE} (trigger_id, sequence_id, status)`,
      );
      await ensureIndexExists(
        READY_INDEX,
        `CREATE INDEX IF NOT EXISTS ${READY_INDEX}
          ON ${TABLE} (app_id, status, available_at, claimed_at)`,
      );
      await ensureIndexExists(
        FAILED_INDEX,
        `CREATE INDEX IF NOT EXISTS ${FAILED_INDEX}
          ON ${TABLE} (completed_at) WHERE status = 'failed'`,
      );
      await ensureIndexExists(
        STALE_EVENT_INDEX,
        `CREATE INDEX IF NOT EXISTS ${STALE_EVENT_INDEX}
          ON ${TABLE} (app_id, event_name, emitted_at)
          WHERE status = 'pending'`,
      );
      await ensureIndexExists(
        COMPLETED_INDEX,
        `CREATE INDEX IF NOT EXISTS ${COMPLETED_INDEX}
          ON ${TABLE} (completed_at) WHERE status = 'completed'`,
      );
    })().catch((error) => {
      _initPromise = undefined;
      throw error;
    });
  }
  return _initPromise;
}

export interface EnqueueAutomationTriggerEventInput {
  triggerId: string;
  triggerOwner: string;
  triggerPath: string;
  appId?: string | null;
  eventName: string;
  eventId: string;
  payload: unknown;
  eventOwner?: string;
  emittedAt: string;
}

export interface QueuedAutomationTriggerEvent {
  id: string;
  sequenceId: number;
  triggerId: string;
  triggerOwner: string;
  triggerPath: string;
  appId: string | null;
  eventName: string;
  eventId: string;
  payload: unknown;
  eventOwner?: string;
  emittedAt: string;
  attempts: number;
  failureAttempts: number;
  claimedAt: number;
}

function rowToEvent(
  row: Record<string, unknown>,
): QueuedAutomationTriggerEvent {
  if (row.claimed_at == null || !Number.isFinite(Number(row.claimed_at))) {
    throw new Error("Claimed automation event is missing its lease timestamp.");
  }
  let payload: unknown;
  try {
    const serialized = JSON.parse(String(row.payload)) as {
      kind?: unknown;
      value?: unknown;
    };
    if (serialized.kind === "undefined") {
      payload = undefined;
    } else if (serialized.kind === "json" && "value" in serialized) {
      payload = serialized.value;
    } else {
      throw new Error("Queued payload envelope is invalid.");
    }
  } catch (error) {
    throw new Error("Queued automation event payload is unreadable.", {
      cause: error,
    });
  }
  return {
    id: String(row.id),
    sequenceId: Number(row.sequence_id),
    triggerId: String(row.trigger_id),
    triggerOwner: String(row.trigger_owner),
    triggerPath: String(row.trigger_path),
    appId: row.app_id == null ? null : String(row.app_id),
    eventName: String(row.event_name),
    eventId: String(row.event_id),
    payload,
    ...(row.event_owner == null ? {} : { eventOwner: String(row.event_owner) }),
    emittedAt: String(row.emitted_at),
    attempts: Number(row.attempts ?? 0),
    failureAttempts: Number(row.failure_attempts ?? 0),
    claimedAt: Number(row.claimed_at),
  };
}

export async function enqueueAutomationTriggerEvent(
  input: EnqueueAutomationTriggerEventInput,
): Promise<{ id: string; inserted: boolean }> {
  await ensureAutomationTriggerEventQueue();
  const payload = JSON.stringify(
    input.payload === undefined
      ? { kind: "undefined" }
      : { kind: "json", value: input.payload },
  );
  if (payload === undefined) {
    throw new Error("Automation event payload must be JSON serializable.");
  }
  if (
    input.payload !== undefined &&
    !Object.prototype.hasOwnProperty.call(JSON.parse(payload), "value")
  ) {
    throw new Error("Automation event payload must be JSON serializable.");
  }
  const id = randomUUID();
  const now = Date.now();
  const { rows } = await getDbExec().execute({
    sql: `INSERT INTO ${TABLE}
      (id, trigger_id, trigger_owner, trigger_path, app_id, event_name, event_id,
       payload, event_owner, emitted_at, status, attempts, available_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
      ON CONFLICT (trigger_id, event_id) DO NOTHING
      RETURNING id`,
    args: [
      id,
      input.triggerId,
      input.triggerOwner,
      input.triggerPath,
      input.appId ?? null,
      input.eventName,
      input.eventId,
      payload,
      input.eventOwner ?? null,
      input.emittedAt,
      now,
      now,
    ],
  });
  return {
    id: rows[0] ? String((rows[0] as Record<string, unknown>).id) : id,
    inserted: rows.length > 0,
  };
}

function appScopePredicate(appId: string | null | undefined): {
  sql: string;
  args: unknown[];
} {
  return appId?.trim()
    ? { sql: "app_id = ?", args: [appId.trim()] }
    : { sql: "app_id IS NULL", args: [] };
}

export async function listReadyAutomationTriggerIds(
  appId?: string | null,
  limit = 100,
  cursor: { afterTriggerId?: string; throughTriggerId?: string } = {},
): Promise<string[]> {
  await ensureAutomationTriggerEventQueue();
  const now = Date.now();
  const scope = appScopePredicate(appId);
  const afterClause =
    cursor.afterTriggerId === undefined ? "" : "AND trigger_id > ?";
  const throughClause =
    cursor.throughTriggerId === undefined ? "" : "AND trigger_id <= ?";
  const args = [
    ...scope.args,
    now,
    now - CLAIM_LEASE_MS(),
    ...(cursor.afterTriggerId === undefined ? [] : [cursor.afterTriggerId]),
    ...(cursor.throughTriggerId === undefined ? [] : [cursor.throughTriggerId]),
    Math.max(1, Math.min(limit, 500)),
  ];
  const { rows } = await getDbExec().execute({
    sql: `SELECT DISTINCT trigger_id
          FROM ${TABLE}
          WHERE ${scope.sql}
            AND ((status = 'pending' AND available_at <= ?)
              OR (status = 'processing' AND
                (claimed_at IS NULL OR claimed_at <= ?)))
            ${afterClause}
            ${throughClause}
          ORDER BY trigger_id ASC
          LIMIT ?`,
    args,
  });
  return rows.map((row) => String((row as Record<string, unknown>).trigger_id));
}

export async function reserveAutomationTriggerEventPurge(
  appId?: string | null,
  now = Date.now(),
): Promise<boolean> {
  await ensureAutomationTriggerEventQueue();
  const { rows } = await getDbExec().execute({
    sql: `INSERT INTO ${SWEEP_STATE_TABLE}
            (scope_key, last_trigger_id, purge_after, updated_at)
          VALUES (?, NULL, ?, ?)
          ON CONFLICT (scope_key) DO UPDATE
            SET purge_after = excluded.purge_after,
                updated_at = excluded.updated_at
            WHERE ${SWEEP_STATE_TABLE}.purge_after <= ?
          RETURNING scope_key`,
    args: [appId?.trim() ?? "", now + 60_000, now, now],
  });
  return rows.length > 0;
}

export async function scheduleAutomationTriggerEventPurge(
  appId: string | null | undefined,
  nextAt: number,
): Promise<void> {
  await ensureAutomationTriggerEventQueue();
  await getDbExec().execute({
    sql: `UPDATE ${SWEEP_STATE_TABLE}
          SET purge_after = ?, updated_at = ?
          WHERE scope_key = ?`,
    args: [nextAt, Date.now(), appId?.trim() ?? ""],
  });
}

export async function getAutomationTriggerSweepCursor(
  appId?: string | null,
): Promise<string | null> {
  await ensureAutomationTriggerEventQueue();
  const { rows } = await getDbExec().execute({
    sql: `SELECT last_trigger_id FROM ${SWEEP_STATE_TABLE} WHERE scope_key = ?`,
    args: [appId?.trim() ?? ""],
  });
  const cursor = (rows[0] as Record<string, unknown> | undefined)
    ?.last_trigger_id;
  return cursor == null ? null : String(cursor);
}

export async function setAutomationTriggerSweepCursor(
  appId: string | null | undefined,
  triggerId: string | null,
): Promise<void> {
  await ensureAutomationTriggerEventQueue();
  const scopeKey = appId?.trim() ?? "";
  if (triggerId === null) {
    await getDbExec().execute({
      sql: `DELETE FROM ${SWEEP_STATE_TABLE} WHERE scope_key = ?`,
      args: [scopeKey],
    });
    return;
  }
  await getDbExec().execute({
    sql: `INSERT INTO ${SWEEP_STATE_TABLE}
            (scope_key, last_trigger_id, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT (scope_key) DO UPDATE
            SET last_trigger_id = excluded.last_trigger_id,
                updated_at = excluded.updated_at`,
    args: [scopeKey, triggerId, Date.now()],
  });
}

export async function claimNextAutomationTriggerEvent(
  triggerId: string,
  appId?: string | null,
): Promise<QueuedAutomationTriggerEvent | null> {
  await ensureAutomationTriggerEventQueue();
  const now = Date.now();
  const cutoff = now - CLAIM_LEASE_MS();
  const scope = appScopePredicate(appId);
  const { rows } = await getDbExec().execute({
    sql: `UPDATE ${TABLE} AS claimed
          SET status = 'processing', attempts = claimed.attempts + 1,
              failure_attempts = claimed.failure_attempts +
                CASE WHEN claimed.status = 'processing' THEN 1 ELSE 0 END,
              claimed_at = ?, last_error = NULL
          WHERE claimed.id = (
            SELECT candidate.id
            FROM ${TABLE} AS candidate
            WHERE candidate.trigger_id = ? AND candidate.${scope.sql}
              AND ((candidate.status = 'pending' AND candidate.available_at <= ?)
                OR (candidate.status = 'processing' AND
                  (candidate.claimed_at IS NULL OR candidate.claimed_at <= ?)))
              AND NOT EXISTS (
                SELECT 1 FROM ${TABLE} AS earlier
                WHERE earlier.trigger_id = candidate.trigger_id
                  AND earlier.sequence_id < candidate.sequence_id
                  AND earlier.status IN ('pending', 'processing')
              )
            ORDER BY candidate.sequence_id ASC
            LIMIT 1
          )
          AND (claimed.status = 'pending' OR
            (claimed.status = 'processing' AND
              (claimed.claimed_at IS NULL OR claimed.claimed_at <= ?)))
          RETURNING claimed.id, claimed.sequence_id, claimed.trigger_id,
            claimed.trigger_owner, claimed.trigger_path, claimed.app_id,
            claimed.event_name, claimed.event_id, claimed.payload,
            claimed.event_owner, claimed.emitted_at, claimed.attempts,
            claimed.failure_attempts, claimed.claimed_at`,
    args: [now, triggerId, ...scope.args, now, cutoff, cutoff],
  });
  return rows[0] ? rowToEvent(rows[0] as Record<string, unknown>) : null;
}

export async function completeAutomationTriggerEvent(
  id: string,
  claimedAt: number,
  attempts: number,
): Promise<void> {
  await ensureAutomationTriggerEventQueue();
  await getDbExec().execute({
    sql: `UPDATE ${TABLE}
          SET status = 'completed', payload = ?, claimed_at = NULL,
              completed_at = ?, last_error = NULL
          WHERE id = ? AND status = 'processing'
            AND claimed_at = ? AND attempts = ?`,
    args: [COMPLETED_PAYLOAD, Date.now(), id, claimedAt, attempts],
  });
}

export async function expireAutomationTriggerEvent(
  id: string,
  claimedAt: number,
  attempts: number,
  reason: string,
): Promise<void> {
  await ensureAutomationTriggerEventQueue();
  await getDbExec().execute({
    sql: `UPDATE ${TABLE}
          SET status = 'completed', payload = ?, claimed_at = NULL,
              completed_at = ?, last_error = ?
          WHERE id = ? AND status = 'processing'
            AND claimed_at = ? AND attempts = ?`,
    args: [
      COMPLETED_PAYLOAD,
      Date.now(),
      reason.slice(0, 500),
      id,
      claimedAt,
      attempts,
    ],
  });
}

export async function expireStaleAutomationTriggerEvents(input: {
  appId: string;
  eventName: string;
  emittedBefore: string;
  reason: string;
  limit?: number;
}): Promise<number> {
  await ensureAutomationTriggerEventQueue();
  const limit = Math.max(
    1,
    Math.min(input.limit ?? AUTOMATION_TRIGGER_EVENT_EXPIRY_BATCH_SIZE, 10_000),
  );
  const { rowsAffected } = await getDbExec().execute({
    sql: `WITH expired AS (
            SELECT id FROM ${TABLE}
            WHERE app_id = ? AND event_name = ? AND status = 'pending'
              AND emitted_at < ?
            ORDER BY emitted_at ASC
            LIMIT ?
            FOR UPDATE SKIP LOCKED
          )
          UPDATE ${TABLE} AS queued
          SET status = 'completed', payload = ?, claimed_at = NULL,
              completed_at = ?, last_error = ?
          FROM expired
          WHERE queued.id = expired.id`,
    args: [
      input.appId,
      input.eventName,
      input.emittedBefore,
      limit,
      COMPLETED_PAYLOAD,
      Date.now(),
      input.reason.slice(0, 500),
    ],
  });
  return rowsAffected;
}

export async function retryAutomationTriggerEvent(
  id: string,
  claimedAt: number,
  attempts: number,
  failureAttempts: number,
  error: unknown,
  options: { delayMs?: number; countFailure?: boolean } = {},
): Promise<void> {
  await ensureAutomationTriggerEventQueue();
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  const countFailure = options.countFailure ?? true;
  const nextFailureAttempts = failureAttempts + Number(countFailure);
  const backoffMs =
    options.delayMs ??
    Math.min(
      60_000,
      1_000 * 2 ** Math.min(Math.max(nextFailureAttempts - 1, 0), 6),
    );
  await getDbExec().execute({
    sql: `UPDATE ${TABLE}
          SET status = 'pending', claimed_at = NULL, available_at = ?,
              failure_attempts = failure_attempts + ?, last_error = ?
          WHERE id = ? AND status = 'processing'
            AND claimed_at = ? AND attempts = ? AND failure_attempts = ?`,
    args: [
      Date.now() + backoffMs,
      Number(countFailure),
      message.slice(0, 500),
      id,
      claimedAt,
      attempts,
      failureAttempts,
    ],
  });
}

export async function failAutomationTriggerEvent(
  id: string,
  claimedAt: number,
  attempts: number,
  failureAttempts: number,
  error: unknown,
): Promise<void> {
  await ensureAutomationTriggerEventQueue();
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  await getDbExec().execute({
    sql: `UPDATE ${TABLE}
          SET status = 'failed', payload = ?, claimed_at = NULL,
              completed_at = ?,
              failure_attempts = GREATEST(failure_attempts, ?),
              last_error = ?
          WHERE id = ? AND status = 'processing'
            AND claimed_at = ? AND attempts = ? AND failure_attempts = ?`,
    args: [
      COMPLETED_PAYLOAD,
      Date.now(),
      MAX_AUTOMATION_TRIGGER_EVENT_FAILURES,
      message.slice(0, 500),
      id,
      claimedAt,
      attempts,
      failureAttempts,
    ],
  });
}

export async function purgeExpiredAutomationTriggerEvents(
  now = Date.now(),
): Promise<number> {
  await ensureAutomationTriggerEventQueue();
  const { rowsAffected } = await getDbExec().execute({
    sql: `DELETE FROM ${TABLE}
          WHERE id IN (
            SELECT id FROM ${TABLE}
            WHERE status IN ('completed', 'failed') AND completed_at < ?
            ORDER BY completed_at ASC
            LIMIT ?
          )`,
    args: [
      now - AUTOMATION_TRIGGER_EVENT_DEDUPE_RETENTION_MS,
      AUTOMATION_TRIGGER_EVENT_PURGE_BATCH_SIZE,
    ],
  });
  return rowsAffected;
}

export const __automationTriggerEventQueue = {
  table: TABLE,
  sweepStateTable: SWEEP_STATE_TABLE,
  claimLeaseMs: CLAIM_LEASE_MS,
};
