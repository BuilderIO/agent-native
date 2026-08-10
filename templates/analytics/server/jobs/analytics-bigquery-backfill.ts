import { randomUUID } from "node:crypto";

import { getDbExec, isPostgres } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";

import {
  backfillFirstPartyAnalyticsBatch,
  type FirstPartyAnalyticsScope,
} from "../lib/first-party-analytics-backend.js";

const JOB_TABLE = "analytics_bigquery_backfill_jobs";
const LEASE_MS = 5 * 60 * 1000;
const DEDICATED_LEASE_MS = 24 * 60 * 60 * 1000;
const ERROR_RETRY_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 750;
const DEFAULT_MAX_BATCHES_PER_SWEEP = 2;
const MAX_BATCHES_PER_SWEEP = 4;
const DEFAULT_MAX_ACTIVE_SESSIONS = 80;
const DEFAULT_MAX_TOTAL_SESSIONS = 250;
const BATCH_SIZE_ENV = "ANALYTICS_BIGQUERY_BACKFILL_BATCH_SIZE";

type Query =
  | string
  | {
      sql: string;
      args?: unknown[];
      timeoutMs?: number;
      maxAttempts?: number;
    };

interface QueryResult {
  rows?: unknown[];
  rowsAffected?: number;
}

interface Executor {
  execute(query: Query): Promise<QueryResult>;
  transaction?<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
}

export type BigQueryBackfillJobStatus = "pending" | "running" | "completed";

export interface BigQueryBackfillJob {
  id: string;
  orgId: string;
  ownerEmail: string;
  table: string;
  batchSize: number;
  cursor: string | null;
  status: BigQueryBackfillJobStatus;
  copied: number;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  nextRunAt: string;
  lastError: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface BigQueryBackfillSweepResult {
  status:
    | "disabled"
    | "idle"
    | "paused-pressure"
    | "progress"
    | "completed"
    | "retry-scheduled";
  batches: number;
  copied: number;
  remaining: number;
  reason?: string;
  error?: string;
}

function executor(): Executor {
  return getDbExec() as unknown as Executor;
}

function jobId(orgId: string): string {
  return `first-party-analytics:${orgId}`;
}

function boundedBatchSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_BATCH_SIZE;
  return Math.min(Math.max(Math.floor(value as number), 1), MAX_BATCH_SIZE);
}

function runtimeBatchSize(job: BigQueryBackfillJob): number {
  const raw = process.env[BATCH_SIZE_ENV]?.trim();
  if (!raw) return job.batchSize;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return job.batchSize;
  // Keep the override bounded so operators can lower throughput without
  // rewriting the cursor-bearing job row.
  return boundedBatchSize(parsed);
}

function maxBatchesPerSweep(): number {
  const raw = process.env.ANALYTICS_BIGQUERY_BACKFILL_SWEEP_LIMIT?.trim();
  if (!raw) return DEFAULT_MAX_BATCHES_PER_SWEEP;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, MAX_BATCHES_PER_SWEEP)
    : DEFAULT_MAX_BATCHES_PER_SWEEP;
}

function positiveEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringValue(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function nullableStringValue(
  row: Record<string, unknown>,
  ...keys: string[]
): string | null {
  const value = stringValue(row, ...keys);
  return value || null;
}

function numberValue(row: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = row[key];
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function rowToJob(row: Record<string, unknown>): BigQueryBackfillJob {
  const status = stringValue(row, "status");
  if (status !== "pending" && status !== "running" && status !== "completed") {
    throw new Error(
      `Unknown BigQuery backfill job status: ${status || "empty"}`,
    );
  }
  return {
    id: stringValue(row, "id"),
    orgId: stringValue(row, "org_id", "orgId"),
    ownerEmail: stringValue(row, "owner_email", "ownerEmail"),
    table: stringValue(row, "table_ref", "tableRef"),
    batchSize: boundedBatchSize(numberValue(row, "batch_size", "batchSize")),
    cursor: nullableStringValue(row, "backfill_cursor", "backfillCursor"),
    status,
    copied: numberValue(row, "copied_count", "copiedCount"),
    leaseToken: nullableStringValue(row, "lease_token", "leaseToken"),
    leaseExpiresAt: nullableStringValue(
      row,
      "lease_expires_at",
      "leaseExpiresAt",
    ),
    nextRunAt: stringValue(row, "next_run_at", "nextRunAt"),
    lastError: nullableStringValue(row, "last_error", "lastError"),
    completedAt: nullableStringValue(row, "completed_at", "completedAt"),
    updatedAt: stringValue(row, "updated_at", "updatedAt"),
  };
}

function rowFromResult(result: QueryResult): Record<string, unknown> | null {
  const row = result.rows?.[0];
  return row && typeof row === "object"
    ? (row as Record<string, unknown>)
    : null;
}

export async function getFirstPartyAnalyticsBigQueryBackfillJob(
  scope: FirstPartyAnalyticsScope,
): Promise<BigQueryBackfillJob | null> {
  const result = await executor().execute({
    sql: `SELECT id, org_id, owner_email, table_ref, batch_size,
                 backfill_cursor, status, copied_count, lease_token,
                 lease_expires_at, next_run_at, last_error, completed_at,
                 updated_at
            FROM ${JOB_TABLE}
           WHERE id = ?
           LIMIT 1`,
    args: [jobId(scope.orgId ?? "")],
    timeoutMs: 3_000,
    maxAttempts: 1,
  });
  const row = rowFromResult(result);
  return row ? rowToJob(row) : null;
}

export async function acquireDedicatedFirstPartyAnalyticsBackfillLease(
  scope: FirstPartyAnalyticsScope,
  table: string,
): Promise<() => Promise<void>> {
  if (!scope.orgId) {
    throw new Error("Dedicated BigQuery backfill requires an organization");
  }
  const id = jobId(scope.orgId);
  const token = randomUUID();
  const now = new Date().toISOString();
  const leaseExpiresAt = new Date(
    Date.now() + DEDICATED_LEASE_MS,
  ).toISOString();
  const claimed = await executor().execute({
    sql: `UPDATE ${JOB_TABLE}
             SET status = 'running', lease_token = ?, lease_expires_at = ?,
                 updated_at = ?
           WHERE id = ? AND table_ref = ?
             AND (status = 'pending'
                  OR (status = 'running' AND lease_expires_at IS NOT NULL
                      AND lease_expires_at <= ?))`,
    args: [token, leaseExpiresAt, now, id, table, now],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
  if (claimed.rowsAffected !== 1) {
    const job = await getFirstPartyAnalyticsBigQueryBackfillJob(scope);
    if (!job) {
      throw new Error(
        "Prepare the organization before starting the dedicated BigQuery backfill",
      );
    }
    if (job.table !== table) {
      throw new Error(
        `BigQuery backfill already targets ${job.table}; the dedicated worker requested ${table}`,
      );
    }
    if (job.status === "completed") {
      throw new Error(
        "The durable BigQuery backfill is already completed; do not run the dedicated worker again",
      );
    }
    throw new Error(
      "Another BigQuery backfill worker owns the durable lease; wait for it to stop before retrying",
    );
  }

  let released = false;
  return async () => {
    if (released) return;
    const releasedAt = new Date().toISOString();
    const result = await executor().execute({
      sql: `UPDATE ${JOB_TABLE}
               SET status = 'pending', lease_token = NULL,
                   lease_expires_at = NULL, next_run_at = ?, updated_at = ?
             WHERE id = ? AND lease_token = ?`,
      args: [releasedAt, releasedAt, id, token],
      timeoutMs: 5_000,
      maxAttempts: 1,
    });
    if (result.rowsAffected !== 1) {
      throw new Error(
        "The dedicated BigQuery backfill lost its durable lease before release",
      );
    }
    released = true;
  };
}

export async function queueFirstPartyAnalyticsBigQueryBackfill(
  scope: FirstPartyAnalyticsScope,
  table: string,
  requestedBatchSize?: number,
  initialCursor?: string | null,
): Promise<BigQueryBackfillJob> {
  const now = new Date().toISOString();
  const id = jobId(scope.orgId ?? "");
  if (!scope.orgId)
    throw new Error("BigQuery backfill requires an organization");
  await executor().execute({
    sql: `INSERT INTO ${JOB_TABLE} (
            id, org_id, owner_email, table_ref, batch_size, backfill_cursor,
              status, copied_count, lease_token, lease_expires_at, next_run_at,
              last_error, completed_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, NULL, NULL, ?)
            ON CONFLICT (id) DO NOTHING`,
    args: [
      id,
      scope.orgId,
      scope.userEmail,
      table,
      boundedBatchSize(requestedBatchSize),
      initialCursor ?? null,
      now,
      now,
    ],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
  if (requestedBatchSize !== undefined) {
    const batchSize = boundedBatchSize(requestedBatchSize);
    await executor().execute({
      sql: `UPDATE ${JOB_TABLE}
               SET batch_size = ?
             WHERE id = ?
               AND batch_size < ?`,
      args: [batchSize, id, batchSize],
      timeoutMs: 5_000,
      maxAttempts: 1,
    });
  }
  const job = await getFirstPartyAnalyticsBigQueryBackfillJob(scope);
  if (!job) throw new Error("BigQuery backfill job was not persisted");
  if (job.table !== table) {
    throw new Error(
      `BigQuery backfill already targets ${job.table}; prepare the existing migration before changing tables`,
    );
  }
  return job;
}

async function claimNextJob(
  db: Executor,
  now: string,
): Promise<BigQueryBackfillJob | null> {
  if (!db.transaction) {
    throw new Error("BigQuery backfill requires a database transaction");
  }
  const token = randomUUID();
  const leaseExpiresAt = new Date(Date.now() + LEASE_MS).toISOString();
  return db.transaction(async (tx) => {
    const candidateResult = await tx.execute({
      sql: `SELECT id, org_id, owner_email, table_ref, batch_size,
                   backfill_cursor, status, copied_count, lease_token,
                   lease_expires_at, next_run_at, last_error, completed_at,
                   updated_at
              FROM ${JOB_TABLE}
             WHERE next_run_at <= ?
               AND (
                 status = 'pending'
                 OR (status = 'running' AND lease_expires_at IS NOT NULL
                     AND lease_expires_at <= ?)
               )
             ORDER BY updated_at ASC
             LIMIT 1`,
      args: [now, now],
      timeoutMs: 3_000,
      maxAttempts: 1,
    });
    const candidate = rowFromResult(candidateResult);
    if (!candidate) return null;

    const updated = await tx.execute({
      sql: `UPDATE ${JOB_TABLE}
               SET status = 'running', lease_token = ?, lease_expires_at = ?,
                   updated_at = ?
             WHERE id = ?
               AND next_run_at <= ?
               AND (
                 status = 'pending'
                 OR (status = 'running' AND lease_expires_at IS NOT NULL
                     AND lease_expires_at <= ?)
               )`,
      args: [token, leaseExpiresAt, now, candidate.id, now, now],
      timeoutMs: 3_000,
      maxAttempts: 1,
    });
    if (updated.rowsAffected !== 1) return null;
    return rowToJob({
      ...candidate,
      status: "running",
      lease_token: token,
      lease_expires_at: leaseExpiresAt,
      updated_at: now,
    });
  });
}

async function finishJob(
  db: Executor,
  job: BigQueryBackfillJob,
  result: { nextCursor: string | null; copied: number; complete: boolean },
  now: string,
): Promise<void> {
  const completedAt = result.complete ? now : null;
  const updated = await db.execute({
    sql: `UPDATE ${JOB_TABLE}
             SET status = ?, backfill_cursor = ?, copied_count = copied_count + ?,
                 lease_token = NULL, lease_expires_at = NULL,
                 next_run_at = ?, last_error = NULL, completed_at = ?,
                 updated_at = ?
           WHERE id = ? AND lease_token = ?`,
    args: [
      result.complete ? "completed" : "pending",
      result.nextCursor,
      result.copied,
      now,
      completedAt,
      now,
      job.id,
      job.leaseToken,
    ],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
  if (updated.rowsAffected !== 1) {
    throw new Error("BigQuery backfill lost its lease before saving progress");
  }
}

async function scheduleRetry(
  db: Executor,
  job: BigQueryBackfillJob,
  error: string,
  now: string,
): Promise<void> {
  const retryAt = new Date(Date.now() + ERROR_RETRY_MS).toISOString();
  await db.execute({
    sql: `UPDATE ${JOB_TABLE}
             SET status = 'pending', lease_token = NULL, lease_expires_at = NULL,
                 next_run_at = ?, last_error = ?, updated_at = ?
           WHERE id = ? AND lease_token = ?`,
    args: [retryAt, error.slice(0, 1_000), now, job.id, job.leaseToken],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
}

async function pressureSnapshot(
  db: Executor,
): Promise<{ paused: boolean; reason?: string }> {
  if (!isPostgres()) return { paused: false };
  try {
    const result = await db.execute({
      sql: `SELECT
              COUNT(*) AS total_sessions,
              SUM(CASE WHEN state = 'active' THEN 1 ELSE 0 END) AS active_sessions,
              SUM(CASE WHEN wait_event_type IS NOT NULL THEN 1 ELSE 0 END) AS waiting_sessions,
              SUM(CASE WHEN wait_event_type = 'Lock' THEN 1 ELSE 0 END) AS lock_waiters
            FROM pg_stat_activity
           WHERE pid <> pg_backend_pid()`,
      timeoutMs: 2_000,
      maxAttempts: 1,
    });
    const row = rowFromResult(result);
    if (!row) return { paused: true, reason: "pressure probe returned no row" };
    const total = numberValue(row, "total_sessions");
    const active = numberValue(row, "active_sessions");
    const waiting = numberValue(row, "waiting_sessions");
    const lockWaiters = numberValue(row, "lock_waiters");
    const maxActive = positiveEnvNumber(
      "ANALYTICS_BIGQUERY_BACKFILL_MAX_ACTIVE_SESSIONS",
      DEFAULT_MAX_ACTIVE_SESSIONS,
    );
    const maxTotal = positiveEnvNumber(
      "ANALYTICS_BIGQUERY_BACKFILL_MAX_TOTAL_SESSIONS",
      DEFAULT_MAX_TOTAL_SESSIONS,
    );
    if (lockWaiters > 0 || active >= maxActive || total >= maxTotal) {
      return {
        paused: true,
        reason: `database pressure: total=${total}, active=${active}, waiting=${waiting}, lockWaiters=${lockWaiters}`,
      };
    }
    return { paused: false };
  } catch (error) {
    return {
      paused: true,
      reason: `pressure probe failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function runFirstPartyAnalyticsBigQueryBackfillOnce(): Promise<BigQueryBackfillSweepResult> {
  if (process.env.ANALYTICS_BIGQUERY_BACKFILL_JOBS?.trim() === "0") {
    return { status: "disabled", batches: 0, copied: 0, remaining: 0 };
  }

  const db = executor();
  const initialPressure = await pressureSnapshot(db);
  if (initialPressure.paused) {
    return {
      status: "paused-pressure",
      batches: 0,
      copied: 0,
      remaining: 1,
      reason: initialPressure.reason,
    };
  }

  let batches = 0;
  let copied = 0;
  for (let index = 0; index < maxBatchesPerSweep(); index += 1) {
    const pressure = await pressureSnapshot(db);
    if (pressure.paused) {
      return {
        status: "paused-pressure",
        batches,
        copied,
        remaining: 1,
        reason: pressure.reason,
      };
    }

    const job = await claimNextJob(db, new Date().toISOString());
    if (!job) {
      return {
        status: batches ? "progress" : "idle",
        batches,
        copied,
        remaining: batches ? 1 : 0,
      };
    }

    try {
      const batch = await runWithRequestContext(
        { userEmail: job.ownerEmail, orgId: job.orgId },
        () =>
          backfillFirstPartyAnalyticsBatch(
            { userEmail: job.ownerEmail, orgId: job.orgId },
            job.cursor,
            runtimeBatchSize(job),
            job.table,
          ),
      );
      const now = new Date().toISOString();
      // The lease row is the progress source of truth; the backend setting is
      // only the migration configuration and cutover marker.
      await finishJob(db, job, batch, now);
      batches += 1;
      copied += batch.copied;
      if (batch.complete) {
        return { status: "completed", batches, copied, remaining: 0 };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await scheduleRetry(db, job, message, new Date().toISOString());
      return {
        status: "retry-scheduled",
        batches,
        copied,
        remaining: 1,
        error: message,
      };
    }
  }

  return { status: "progress", batches, copied, remaining: 1 };
}
