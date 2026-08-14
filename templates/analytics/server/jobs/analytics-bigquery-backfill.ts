import { randomUUID } from "node:crypto";

import { getDbExec, isPostgres } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";

import {
  backfillFirstPartyAnalyticsBatch,
  type FirstPartyAnalyticsBackfillCursor,
  type FirstPartyAnalyticsScope,
} from "../lib/first-party-analytics-backend.js";

const JOB_TABLE = "analytics_bigquery_backfill_jobs";
const SHARD_TABLE = "analytics_bigquery_backfill_shards";
const LEASE_MS = 5 * 60 * 1000;
const DEDICATED_LEASE_MS = 24 * 60 * 60 * 1000;
const ERROR_RETRY_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 750;
const DEFAULT_MAX_BATCHES_PER_SWEEP = 4;
const MAX_BATCHES_PER_SWEEP = 4;
const DEFAULT_PARALLELISM = 8;
const MAX_PARALLELISM = 8;
const DEFAULT_MAX_TOTAL_SESSIONS = 250;
const PRESSURE_RETRY_MS = 60 * 1000;

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

interface BigQueryBackfillShard {
  id: string;
  jobId: string;
  orgId: string;
  ownerEmail: string;
  table: string;
  startAt: string;
  startId: string;
  endAt: string;
  endId: string;
  endInclusive: boolean;
  batchSize: number;
  cursor: FirstPartyAnalyticsBackfillCursor | null;
  status: BigQueryBackfillJobStatus;
  copied: number;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  nextRunAt: string;
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

function maxBatchesPerSweep(): number {
  const raw = process.env.ANALYTICS_BIGQUERY_BACKFILL_SWEEP_LIMIT?.trim();
  if (!raw) return DEFAULT_MAX_BATCHES_PER_SWEEP;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, MAX_BATCHES_PER_SWEEP)
    : DEFAULT_MAX_BATCHES_PER_SWEEP;
}

function parallelism(): number {
  const raw = process.env.ANALYTICS_BIGQUERY_BACKFILL_PARALLELISM?.trim();
  if (!raw) return DEFAULT_PARALLELISM;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, MAX_PARALLELISM)
    : DEFAULT_PARALLELISM;
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
    id: stringValue(row, "id", "shard_id"),
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

function cursorFromFields(
  receivedAt: unknown,
  id: unknown,
): FirstPartyAnalyticsBackfillCursor | null {
  return typeof receivedAt === "string" && receivedAt && typeof id === "string"
    ? { receivedAt, id }
    : null;
}

function booleanValue(row: Record<string, unknown>, key: string): boolean {
  return row[key] === true || row[key] === 1 || row[key] === "1";
}

function rowToShard(row: Record<string, unknown>): BigQueryBackfillShard {
  const status = stringValue(row, "status");
  if (status !== "pending" && status !== "running" && status !== "completed") {
    throw new Error(
      `Unknown BigQuery backfill shard status: ${status || "empty"}`,
    );
  }
  return {
    id: stringValue(row, "shard_id", "id"),
    jobId: stringValue(row, "job_id", "jobId"),
    orgId: stringValue(row, "org_id", "orgId"),
    ownerEmail: stringValue(row, "owner_email", "ownerEmail"),
    table: stringValue(row, "table_ref", "tableRef"),
    startAt: stringValue(row, "start_at", "startAt"),
    startId: stringValue(row, "start_id", "startId"),
    endAt: stringValue(row, "end_at", "endAt"),
    endId: stringValue(row, "end_id", "endId"),
    endInclusive: booleanValue(row, "end_inclusive"),
    batchSize: boundedBatchSize(numberValue(row, "batch_size", "batchSize")),
    cursor: cursorFromFields(
      row.backfill_cursor_at ?? row.backfillCursorAt,
      row.backfill_cursor_id ?? row.backfillCursorId,
    ),
    status: status as BigQueryBackfillJobStatus,
    copied: numberValue(row, "copied_count", "copiedCount"),
    leaseToken: nullableStringValue(row, "lease_token", "leaseToken"),
    leaseExpiresAt: nullableStringValue(
      row,
      "lease_expires_at",
      "leaseExpiresAt",
    ),
    nextRunAt: stringValue(row, "next_run_at", "nextRunAt"),
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

async function getNextFirstPartyAnalyticsBigQueryBackfillJob(
  db: Executor,
  now: string,
  scope?: FirstPartyAnalyticsScope,
): Promise<BigQueryBackfillJob | null> {
  const scopeClauses: string[] = [];
  const args: unknown[] = [now, now];
  if (scope?.orgId) {
    scopeClauses.push("AND org_id = ?");
    args.push(scope.orgId);
  }
  if (scope?.userEmail) {
    scopeClauses.push("AND owner_email = ?");
    args.push(scope.userEmail);
  }
  const result = await db.execute({
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
             ${scopeClauses.join("\n             ")}
           ORDER BY updated_at ASC
           LIMIT 1`,
    args,
    timeoutMs: 3_000,
    maxAttempts: 1,
  });
  const row = rowFromResult(result);
  return row ? rowToJob(row) : null;
}

function parseJobCursor(
  cursor: string | null,
): FirstPartyAnalyticsBackfillCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      cursor,
    ) as Partial<FirstPartyAnalyticsBackfillCursor>;
    if (
      typeof parsed.receivedAt !== "string" ||
      !parsed.receivedAt ||
      typeof parsed.id !== "string"
    ) {
      throw new Error("cursor fields are missing");
    }
    return { receivedAt: parsed.receivedAt, id: parsed.id };
  } catch (error) {
    throw new Error(
      `The durable BigQuery backfill cursor is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function compareCursors(
  left: FirstPartyAnalyticsBackfillCursor,
  right: FirstPartyAnalyticsBackfillCursor,
): number {
  return (
    left.receivedAt.localeCompare(right.receivedAt) ||
    left.id.localeCompare(right.id)
  );
}

function configuredLookbackDays(): number {
  const raw = process.env.ANALYTICS_BIGQUERY_BACKFILL_LOOKBACK_DAYS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 60;
  return Number.isInteger(parsed) && parsed >= 30 && parsed <= 60 ? parsed : 60;
}

function utcDayStart(value: string): string {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function addUtcDays(value: string, days: number): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function initialShardCursor(
  job: BigQueryBackfillJob,
  now: string,
): FirstPartyAnalyticsBackfillCursor {
  return (
    parseJobCursor(job.cursor) ?? {
      receivedAt: new Date(
        Date.parse(now) - configuredLookbackDays() * 24 * 60 * 60 * 1000,
      ).toISOString(),
      id: "",
    }
  );
}

export function buildBackfillShardRanges(
  job: BigQueryBackfillJob,
  now: string,
): Array<{
  start: FirstPartyAnalyticsBackfillCursor;
  end: FirstPartyAnalyticsBackfillCursor;
  endInclusive: boolean;
}> {
  const start = initialShardCursor(job, now);
  const currentDayEnd = addUtcDays(utcDayStart(now), 1);
  const ranges: Array<{
    start: FirstPartyAnalyticsBackfillCursor;
    end: FirstPartyAnalyticsBackfillCursor;
    endInclusive: boolean;
  }> = [];
  let rangeStart = start;
  while (
    compareCursors(rangeStart, {
      receivedAt: currentDayEnd,
      id: "",
    }) < 0
  ) {
    const nextDay = addUtcDays(utcDayStart(rangeStart.receivedAt), 1);
    const endAt = nextDay < currentDayEnd ? nextDay : currentDayEnd;
    const end = { receivedAt: endAt, id: "" };
    ranges.push({ start: rangeStart, end, endInclusive: false });
    rangeStart = end;
  }
  return ranges;
}

async function finalizeCoordinatorIfComplete(
  db: Executor,
  job: BigQueryBackfillJob,
): Promise<boolean> {
  const remainingResult = await db.execute({
    sql: `SELECT COUNT(*) AS remaining
            FROM ${SHARD_TABLE}
           WHERE job_id = ? AND status <> 'completed'`,
    args: [job.id],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
  const remaining = numberValue(
    rowFromResult(remainingResult) ?? {},
    "remaining",
  );
  if (remaining !== 0) return false;

  const summaryResult = await db.execute({
    sql: `SELECT COALESCE(SUM(copied_count), 0) AS copied_count
            FROM ${SHARD_TABLE}
           WHERE job_id = ?`,
    args: [job.id],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
  const endpointResult = await db.execute({
    sql: `SELECT end_at, end_id
            FROM ${SHARD_TABLE}
           WHERE job_id = ?
           ORDER BY end_at DESC, end_id DESC
           LIMIT 1`,
    args: [job.id],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
  const summary = rowFromResult(summaryResult);
  const endpoint = rowFromResult(endpointResult);
  const endAt = stringValue(endpoint ?? {}, "end_at", "endAt");
  const endId = stringValue(endpoint ?? {}, "end_id", "endId");
  const cursor = endAt
    ? JSON.stringify({ receivedAt: endAt, id: endId })
    : job.cursor;
  await db.execute({
    sql: `UPDATE ${JOB_TABLE}
             SET status = 'completed', backfill_cursor = ?,
                 copied_count = copied_count + ?, lease_token = NULL, lease_expires_at = NULL,
                 next_run_at = ?, last_error = NULL, completed_at = ?, updated_at = ?
           WHERE id = ? AND status <> 'completed'`,
    args: [
      cursor,
      numberValue(summary ?? {}, "copied_count", "copiedCount"),
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
      job.id,
    ],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
  return true;
}

async function ensureBackfillShards(
  db: Executor,
  job: BigQueryBackfillJob,
): Promise<void> {
  if (job.status === "completed") return;
  const existing = await db.execute({
    sql: `SELECT shard_id FROM ${SHARD_TABLE} WHERE job_id = ? LIMIT 1`,
    args: [job.id],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
  if (rowFromResult(existing)) return;

  const now = new Date().toISOString();
  for (const range of buildBackfillShardRanges(job, now)) {
    const id = `${job.id}:${range.start.receivedAt}:${range.start.id}:${range.end.receivedAt}`;
    await db.execute({
      sql: `INSERT INTO ${SHARD_TABLE} (
              shard_id, job_id, org_id, owner_email, table_ref,
              start_at, start_id, end_at, end_id, end_inclusive,
              batch_size, backfill_cursor_at, backfill_cursor_id,
              status, copied_count, lease_token, lease_expires_at,
              next_run_at, last_error, completed_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL,
                      'pending', 0, NULL, NULL, ?, NULL, NULL, ?)
            ON CONFLICT (shard_id) DO NOTHING`,
      args: [
        id,
        job.id,
        job.orgId,
        job.ownerEmail,
        job.table,
        range.start.receivedAt,
        range.start.id,
        range.end.receivedAt,
        range.end.id,
        range.endInclusive,
        job.batchSize,
        now,
        now,
      ],
      timeoutMs: 5_000,
      maxAttempts: 1,
    });
  }
}

async function claimNextShard(
  db: Executor,
  coordinatorId: string,
  now: string,
): Promise<BigQueryBackfillShard | null> {
  if (!db.transaction) {
    throw new Error("BigQuery backfill requires a database transaction");
  }
  const token = randomUUID();
  const leaseExpiresAt = new Date(Date.now() + LEASE_MS).toISOString();
  return db.transaction(async (tx) => {
    const candidateResult = await tx.execute({
      sql: `SELECT shard_id, job_id, org_id, owner_email, table_ref,
                   start_at, start_id, end_at, end_id, end_inclusive,
                   batch_size, backfill_cursor_at, backfill_cursor_id,
                   status, copied_count, lease_token, lease_expires_at,
                   next_run_at, updated_at
             FROM ${SHARD_TABLE}
             WHERE job_id = ?
               AND next_run_at <= ?
               AND (
                 status = 'pending'
                 OR (status = 'running' AND lease_expires_at IS NOT NULL
                     AND lease_expires_at <= ?)
               )
             ORDER BY start_at DESC, start_id DESC, updated_at ASC
             LIMIT 1`,
      args: [coordinatorId, now, now],
      timeoutMs: 3_000,
      maxAttempts: 1,
    });
    const candidate = rowFromResult(candidateResult);
    if (!candidate) return null;
    const updated = await tx.execute({
      sql: `UPDATE ${SHARD_TABLE}
               SET status = 'running', lease_token = ?, lease_expires_at = ?,
                   updated_at = ?
             WHERE shard_id = ? AND job_id = ? AND next_run_at <= ?
               AND (
                 status = 'pending'
                 OR (status = 'running' AND lease_expires_at IS NOT NULL
                     AND lease_expires_at <= ?)
               )`,
      args: [
        token,
        leaseExpiresAt,
        now,
        stringValue(candidate, "shard_id", "id"),
        coordinatorId,
        now,
        now,
      ],
      timeoutMs: 3_000,
      maxAttempts: 1,
    });
    if (updated.rowsAffected !== 1) return null;
    return rowToShard({
      ...candidate,
      status: "running",
      lease_token: token,
      lease_expires_at: leaseExpiresAt,
      updated_at: now,
    });
  });
}

async function finishShard(
  db: Executor,
  shard: BigQueryBackfillShard,
  result: { nextCursor: string | null; copied: number; complete: boolean },
): Promise<void> {
  let nextCursor: FirstPartyAnalyticsBackfillCursor | null = null;
  if (result.nextCursor) {
    try {
      const parsed = JSON.parse(
        result.nextCursor,
      ) as Partial<FirstPartyAnalyticsBackfillCursor>;
      if (
        typeof parsed.receivedAt !== "string" ||
        !parsed.receivedAt ||
        typeof parsed.id !== "string"
      ) {
        throw new Error("cursor fields are missing");
      }
      nextCursor = { receivedAt: parsed.receivedAt, id: parsed.id };
    } catch (error) {
      throw new Error(
        `BigQuery backfill returned an invalid shard cursor: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const now = new Date().toISOString();
  const updated = await db.execute({
    sql: `UPDATE ${SHARD_TABLE}
             SET status = ?, backfill_cursor_at = ?, backfill_cursor_id = ?,
                 copied_count = copied_count + ?, lease_token = NULL,
                 lease_expires_at = NULL, next_run_at = ?, last_error = NULL,
                 completed_at = ?, updated_at = ?
           WHERE shard_id = ? AND lease_token = ?`,
    args: [
      result.complete ? "completed" : "pending",
      nextCursor?.receivedAt ?? null,
      nextCursor?.id ?? null,
      result.copied,
      now,
      result.complete ? now : null,
      now,
      shard.id,
      shard.leaseToken,
    ],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
  if (updated.rowsAffected !== 1) {
    throw new Error(
      "BigQuery backfill shard lost its lease before saving progress",
    );
  }
}

async function scheduleShardRetry(
  db: Executor,
  shard: BigQueryBackfillShard,
  error: string,
): Promise<void> {
  const retryAt = new Date(Date.now() + ERROR_RETRY_MS).toISOString();
  await db.execute({
    sql: `UPDATE ${SHARD_TABLE}
             SET status = 'pending', lease_token = NULL, lease_expires_at = NULL,
                 next_run_at = ?, last_error = ?, updated_at = ?
           WHERE shard_id = ? AND lease_token = ?`,
    args: [
      retryAt,
      error.slice(0, 1_000),
      new Date().toISOString(),
      shard.id,
      shard.leaseToken,
    ],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
  await db.execute({
    sql: `UPDATE ${JOB_TABLE}
             SET last_error = ?, updated_at = ?
           WHERE id = ? AND status <> 'completed'`,
    args: [error.slice(0, 1_000), new Date().toISOString(), shard.jobId],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
}

async function runClaimedShard(
  db: Executor,
  shard: BigQueryBackfillShard,
): Promise<{ copied: number; complete: boolean }> {
  const cursor = shard.cursor ? JSON.stringify(shard.cursor) : null;
  const result = await runWithRequestContext(
    { userEmail: shard.ownerEmail, orgId: shard.orgId },
    () =>
      backfillFirstPartyAnalyticsBatch(
        { userEmail: shard.ownerEmail, orgId: shard.orgId },
        cursor,
        shard.batchSize,
        shard.table,
        {
          rangeStart: {
            receivedAt: shard.startAt,
            id: shard.startId,
          },
          rangeEnd: {
            receivedAt: shard.endAt,
            id: shard.endId,
          },
          rangeEndInclusive: shard.endInclusive,
        },
      ),
  );
  await finishShard(db, shard, result);
  return { copied: result.copied, complete: result.complete };
}

export async function acquireDedicatedFirstPartyAnalyticsBackfillLease(
  scope: FirstPartyAnalyticsScope,
  table: string,
): Promise<() => Promise<void>> {
  if (!scope.orgId) {
    throw new Error("Dedicated BigQuery backfill requires an organization");
  }
  const id = jobId(scope.orgId);
  const sharded = await executor().execute({
    sql: `SELECT shard_id FROM ${SHARD_TABLE} WHERE job_id = ? LIMIT 1`,
    args: [id],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
  if (rowFromResult(sharded)) {
    throw new Error(
      "The sharded BigQuery backfill owns this migration; use the durable scheduled worker",
    );
  }
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

async function pressureSnapshot(
  db: Executor,
): Promise<{ paused: boolean; degraded?: boolean; reason?: string }> {
  if (!isPostgres()) return { paused: false };
  try {
    const result = await db.execute({
      sql: `SELECT
              COUNT(*) AS total_sessions,
              SUM(CASE WHEN state = 'active' THEN 1 ELSE 0 END) AS active_sessions,
              SUM(CASE WHEN state = 'active' AND wait_event_type IS NOT NULL THEN 1 ELSE 0 END) AS waiting_sessions,
              SUM(CASE WHEN state = 'active' AND wait_event_type = 'Lock' THEN 1 ELSE 0 END) AS lock_waiters
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
    const maxTotal = positiveEnvNumber(
      "ANALYTICS_BIGQUERY_BACKFILL_MAX_TOTAL_SESSIONS",
      DEFAULT_MAX_TOTAL_SESSIONS,
    );
    if (lockWaiters > 0 || waiting >= 8 || total >= maxTotal) {
      return {
        paused: true,
        reason: `database pressure: total=${total}, active=${active}, waiting=${waiting}, lockWaiters=${lockWaiters}`,
      };
    }
    return { paused: false };
  } catch (error) {
    return {
      paused: false,
      degraded: true,
      reason: `pressure probe failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function recordPressurePause(
  db: Executor,
  jobId: string | null,
  reason: string,
): Promise<void> {
  if (!jobId) return;
  const retryAt = new Date(Date.now() + PRESSURE_RETRY_MS).toISOString();
  await db.execute({
    sql: `UPDATE ${JOB_TABLE}
             SET last_error = ?, next_run_at = ?, updated_at = ?
           WHERE id = ? AND status <> 'completed'`,
    args: [reason.slice(0, 1_000), retryAt, new Date().toISOString(), jobId],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
}

export async function runFirstPartyAnalyticsBigQueryBackfillOnce(
  scope?: FirstPartyAnalyticsScope,
): Promise<BigQueryBackfillSweepResult> {
  if (process.env.ANALYTICS_BIGQUERY_BACKFILL_JOBS?.trim() === "0") {
    return { status: "disabled", batches: 0, copied: 0, remaining: 0 };
  }

  const db = executor();
  const coordinator = await getNextFirstPartyAnalyticsBigQueryBackfillJob(
    db,
    new Date().toISOString(),
    scope,
  );
  if (!coordinator) {
    return { status: "idle", batches: 0, copied: 0, remaining: 0 };
  }

  const initialPressure = await pressureSnapshot(db);
  if (initialPressure.paused) {
    await recordPressurePause(
      db,
      coordinator.id,
      initialPressure.reason ?? "database pressure",
    );
    return {
      status: "paused-pressure",
      batches: 0,
      copied: 0,
      remaining: 1,
      reason: initialPressure.reason,
    };
  }

  await ensureBackfillShards(db, coordinator);

  let batches = 0;
  let copied = 0;
  let degraded = initialPressure.degraded === true;
  for (let index = 0; index < maxBatchesPerSweep(); index += 1) {
    const pressure = await pressureSnapshot(db);
    if (pressure.paused) {
      await recordPressurePause(
        db,
        coordinator.id,
        pressure.reason ?? "database pressure",
      );
      return {
        status: "paused-pressure",
        batches,
        copied,
        remaining: 1,
        reason: pressure.reason,
      };
    }
    degraded ||= pressure.degraded === true;

    const claimed = (
      await Promise.all(
        Array.from({ length: degraded ? 1 : parallelism() }, () =>
          claimNextShard(db, coordinator.id, new Date().toISOString()),
        ),
      )
    ).filter((shard): shard is BigQueryBackfillShard => shard !== null);
    if (!claimed.length) {
      const completed = await finalizeCoordinatorIfComplete(db, coordinator);
      return {
        status: completed ? "completed" : batches ? "progress" : "idle",
        batches,
        copied,
        remaining: completed ? 0 : 1,
      };
    }

    const outcomes = await Promise.allSettled(
      claimed.map((shard) => runClaimedShard(db, shard)),
    );
    let retryScheduled = false;
    for (
      let outcomeIndex = 0;
      outcomeIndex < outcomes.length;
      outcomeIndex += 1
    ) {
      const outcome = outcomes[outcomeIndex]!;
      const shard = claimed[outcomeIndex]!;
      if (outcome.status === "fulfilled") {
        batches += 1;
        copied += outcome.value.copied;
      } else {
        retryScheduled = true;
        const message =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
        await scheduleShardRetry(db, shard, message);
      }
    }
    if (retryScheduled) {
      return {
        status: "retry-scheduled",
        batches,
        copied,
        remaining: 1,
      };
    }

    if (await finalizeCoordinatorIfComplete(db, coordinator)) {
      return { status: "completed", batches, copied, remaining: 0 };
    }
  }

  return { status: "progress", batches, copied, remaining: 1 };
}
