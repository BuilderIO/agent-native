import { randomUUID } from "node:crypto";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";

import {
  FIRST_PARTY_ANALYTICS_BACKFILL_COLUMNS,
  insertFirstPartyAnalyticsRowsWithResults,
} from "./first-party-analytics-backend.js";
import type { AnalyticsScope } from "./first-party-analytics.js";

const DELIVERY_TABLE = "analytics_bigquery_delivery_queue";
const DELIVERY_BATCH_SIZE = 200;
const MAX_DELIVERY_BATCHES_PER_SWEEP = 4;
const DELIVERY_LEASE_MS = 5 * 60 * 1000;
const DELIVERY_RETRY_BASE_MS = 60 * 1000;
const DELIVERY_RETRY_MAX_MS = 60 * 60 * 1000;
const DELIVERY_CLEANUP_RETENTION_MS = 10 * 60 * 1000;
export const FIRST_PARTY_ANALYTICS_DELIVERY_STALE_MS = 10 * 60 * 1000;

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

interface DeliveryQueueRow {
  eventId: string;
  ownerEmail: string;
  orgId: string | null;
  tableRef: string | null;
  attemptCount: number;
  createdAt: string;
  leaseToken: string;
}

export interface FirstPartyAnalyticsDeliveryHealth {
  pendingCount: number;
  oldestPendingAt: string | null;
  lastDeliveredAt: string | null;
  lastError: string | null;
}

export interface FirstPartyAnalyticsDeliverySweepResult extends FirstPartyAnalyticsDeliveryHealth {
  status: "disabled" | "idle" | "progress" | "retry-scheduled" | "unavailable";
  batches: number;
  delivered: number;
  cleaned: number;
}

export function isFirstPartyAnalyticsDeliveryQueueMissingError(
  error: unknown,
): boolean {
  const message = errorMessage(error);
  return (
    /analytics_bigquery_delivery_queue/i.test(message) &&
    /(does not exist|undefined table|no such table)/i.test(message)
  );
}

export function unavailableFirstPartyAnalyticsDeliverySweep(): FirstPartyAnalyticsDeliverySweepResult {
  return {
    status: "unavailable",
    batches: 0,
    delivered: 0,
    cleaned: 0,
    pendingCount: 0,
    oldestPendingAt: null,
    lastDeliveredAt: null,
    lastError: null,
  };
}

function executor(): Executor {
  return getDbExec() as unknown as Executor;
}

function stringValue(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") return value;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
  }
  return "";
}

function nullableStringValue(
  row: Record<string, unknown>,
  ...keys: string[]
): string | null {
  return stringValue(row, ...keys) || null;
}

function numberValue(row: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = row[key];
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function rowFromResult(result: QueryResult): Record<string, unknown> | null {
  const row = result.rows?.[0];
  return row && typeof row === "object"
    ? (row as Record<string, unknown>)
    : null;
}

function rowToDeliveryQueueRow(
  row: Record<string, unknown>,
  leaseToken: string,
): DeliveryQueueRow {
  const eventId = stringValue(row, "event_id", "eventId");
  const ownerEmail = stringValue(row, "owner_email", "ownerEmail");
  const createdAt = stringValue(row, "created_at", "createdAt");
  if (!eventId || !ownerEmail || !createdAt) {
    throw new Error("BigQuery delivery queue row is missing required fields");
  }
  return {
    eventId,
    ownerEmail,
    orgId: nullableStringValue(row, "org_id", "orgId"),
    tableRef: nullableStringValue(row, "table_ref", "tableRef"),
    attemptCount: numberValue(row, "attempt_count", "attemptCount"),
    createdAt,
    leaseToken,
  };
}

function requireRowsAffected(
  result: QueryResult,
  expected: number,
  operation: string,
): void {
  const actual = Number(result.rowsAffected);
  if (!Number.isFinite(actual) || actual !== expected) {
    throw new Error(
      `${operation} affected ${Number.isFinite(actual) ? actual : "an unknown number of"} rows; expected ${expected}`,
    );
  }
}

function idPlaceholders(start: number, count: number): string {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(
    ", ",
  );
}

function deliveryScope(scope?: AnalyticsScope): {
  predicate: string;
  args: string[];
} {
  if (scope?.orgId) {
    return {
      predicate: "(org_id = $1 OR (org_id IS NULL AND owner_email = $2))",
      args: [scope.orgId, scope.userEmail],
    };
  }
  if (scope?.userEmail) {
    return {
      predicate: "org_id IS NULL AND owner_email = $1",
      args: [scope.userEmail],
    };
  }
  return { predicate: "TRUE", args: [] };
}

export async function getFirstPartyAnalyticsDeliveryHealth(
  scope?: AnalyticsScope,
  db: Executor = executor(),
): Promise<FirstPartyAnalyticsDeliveryHealth> {
  const scoped = deliveryScope(scope);
  const result = await db.execute({
    sql: `WITH scoped_queue AS (
             SELECT delivered_at, created_at, last_error, updated_at
               FROM ${DELIVERY_TABLE}
              WHERE ${scoped.predicate}
           )
           SELECT COUNT(*) FILTER (WHERE delivered_at IS NULL) AS pending_count,
                  MIN(created_at) FILTER (WHERE delivered_at IS NULL) AS oldest_pending_at,
                  MAX(delivered_at) AS last_delivered_at,
                  (
                    SELECT last_error
                      FROM scoped_queue
                     WHERE last_error IS NOT NULL
                     ORDER BY updated_at DESC
                     LIMIT 1
                  ) AS last_error
             FROM scoped_queue`,
    args: scoped.args,
    timeoutMs: 3_000,
    maxAttempts: 1,
  });
  const row = rowFromResult(result);
  if (!row) throw new Error("BigQuery delivery health returned no row");
  return {
    pendingCount: numberValue(row, "pending_count", "pendingCount"),
    oldestPendingAt: nullableStringValue(
      row,
      "oldest_pending_at",
      "oldestPendingAt",
    ),
    lastDeliveredAt: nullableStringValue(
      row,
      "last_delivered_at",
      "lastDeliveredAt",
    ),
    lastError: nullableStringValue(row, "last_error", "lastError"),
  };
}

export function firstPartyAnalyticsDeliveryNeedsAttention(
  health: FirstPartyAnalyticsDeliveryHealth,
  now = Date.now(),
): boolean {
  if (health.lastError) return true;
  if (health.pendingCount < 1) return false;
  const oldest = health.oldestPendingAt
    ? Date.parse(health.oldestPendingAt)
    : Number.NaN;
  return (
    !Number.isFinite(oldest) ||
    now - oldest >= FIRST_PARTY_ANALYTICS_DELIVERY_STALE_MS
  );
}

async function claimPendingDeliveryRows(
  db: Executor,
  now: string,
): Promise<DeliveryQueueRow[]> {
  if (!db.transaction) {
    throw new Error("BigQuery delivery requires a database transaction");
  }
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(
    Date.parse(now) + DELIVERY_LEASE_MS,
  ).toISOString();
  return db.transaction(async (tx) => {
    const result = await tx.execute({
      sql: `SELECT event_id, owner_email, org_id, table_ref, attempt_count, created_at
              FROM ${DELIVERY_TABLE}
             WHERE delivered_at IS NULL
               AND next_attempt_at <= $1
               AND (
                 lease_token IS NULL
                 OR lease_expires_at IS NULL
                 OR lease_expires_at <= $1
               )
             ORDER BY created_at ASC, event_id ASC
             LIMIT $2
             FOR UPDATE SKIP LOCKED`,
      args: [now, DELIVERY_BATCH_SIZE],
      timeoutMs: 5_000,
      maxAttempts: 1,
    });
    const rows = (result.rows ?? []).map((row) => {
      if (!row || typeof row !== "object") {
        throw new Error("BigQuery delivery queue returned an invalid row");
      }
      return rowToDeliveryQueueRow(row as Record<string, unknown>, leaseToken);
    });
    if (!rows.length) return [];

    const updated = await tx.execute({
      sql: `UPDATE ${DELIVERY_TABLE}
               SET lease_token = $1,
                   lease_expires_at = $2,
                   updated_at = $3
             WHERE event_id IN (${idPlaceholders(4, rows.length)})
               AND delivered_at IS NULL`,
      args: [
        leaseToken,
        leaseExpiresAt,
        now,
        ...rows.map((row) => row.eventId),
      ],
      timeoutMs: 5_000,
      maxAttempts: 1,
    });
    requireRowsAffected(
      updated,
      rows.length,
      "Claiming BigQuery delivery rows",
    );
    return rows;
  });
}

async function hydrateDeliveryRows(
  db: Executor,
  rows: DeliveryQueueRow[],
): Promise<Record<string, unknown>[]> {
  const result = await db.execute({
    sql: `SELECT ${FIRST_PARTY_ANALYTICS_BACKFILL_COLUMNS.join(", ")}
            FROM analytics_events
           WHERE id IN (${idPlaceholders(1, rows.length)})`,
    args: rows.map((row) => row.eventId),
    timeoutMs: 20_000,
    maxAttempts: 1,
  });
  const byId = new Map<string, Record<string, unknown>>();
  for (const value of result.rows ?? []) {
    if (!value || typeof value !== "object") {
      throw new Error("BigQuery delivery hydration returned an invalid row");
    }
    const event = value as Record<string, unknown>;
    const eventId = stringValue(event, "id");
    if (!eventId || byId.has(eventId)) {
      throw new Error("BigQuery delivery hydration returned an invalid id");
    }
    byId.set(eventId, event);
  }
  return rows.map((queueRow) => {
    const event = byId.get(queueRow.eventId);
    if (!event) {
      throw new Error(
        `BigQuery delivery event ${queueRow.eventId} is missing from analytics_events`,
      );
    }
    const eventOwner = stringValue(event, "owner_email", "ownerEmail");
    const eventOrg = nullableStringValue(event, "org_id", "orgId");
    if (eventOwner !== queueRow.ownerEmail || eventOrg !== queueRow.orgId) {
      throw new Error(
        `BigQuery delivery event ${queueRow.eventId} does not match its tenant`,
      );
    }
    return event;
  });
}

async function renewDeliveryRows(
  db: Executor,
  rows: DeliveryQueueRow[],
  now: string,
): Promise<void> {
  const leaseExpiresAt = new Date(
    Date.parse(now) + DELIVERY_LEASE_MS,
  ).toISOString();
  const updated = await db.execute({
    sql: `UPDATE ${DELIVERY_TABLE}
             SET lease_expires_at = $1,
                 updated_at = $2
           WHERE lease_token = $3
             AND delivered_at IS NULL
             AND event_id IN (${idPlaceholders(4, rows.length)})`,
    args: [
      leaseExpiresAt,
      now,
      rows[0]!.leaseToken,
      ...rows.map((row) => row.eventId),
    ],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
  requireRowsAffected(updated, rows.length, "Renewing BigQuery delivery rows");
}

function groupKey(row: DeliveryQueueRow): string {
  return JSON.stringify([row.ownerEmail, row.orgId, row.tableRef]);
}

async function markDeliveryRowsDelivered(
  db: Executor,
  rows: DeliveryQueueRow[],
  deliveredAt: string,
): Promise<void> {
  const updated = await db.execute({
    sql: `UPDATE ${DELIVERY_TABLE}
             SET delivered_at = $1,
                 lease_token = NULL,
                 lease_expires_at = NULL,
                 last_error = NULL,
                 updated_at = $1
           WHERE lease_token = $2
             AND delivered_at IS NULL
             AND event_id IN (${idPlaceholders(3, rows.length)})`,
    args: [deliveredAt, rows[0]!.leaseToken, ...rows.map((row) => row.eventId)],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
  requireRowsAffected(
    updated,
    rows.length,
    "Marking BigQuery delivery rows delivered",
  );
}

async function scheduleDeliveryRetry(
  db: Executor,
  rows: DeliveryQueueRow[],
  errorMessage: string,
): Promise<void> {
  const attempt = Math.max(...rows.map((row) => row.attemptCount), 0) + 1;
  const delay = Math.min(
    DELIVERY_RETRY_MAX_MS,
    DELIVERY_RETRY_BASE_MS * 2 ** Math.min(attempt - 1, 10),
  );
  const retryAt = new Date(Date.now() + delay).toISOString();
  const updated = await db.execute({
    sql: `UPDATE ${DELIVERY_TABLE}
             SET attempt_count = attempt_count + 1,
                 next_attempt_at = $1,
                 lease_token = NULL,
                 lease_expires_at = NULL,
                 last_error = $2,
                 updated_at = $3
           WHERE lease_token = $4
             AND delivered_at IS NULL
             AND event_id IN (${idPlaceholders(5, rows.length)})`,
    args: [
      retryAt,
      errorMessage.slice(0, 1_000),
      new Date().toISOString(),
      rows[0]!.leaseToken,
      ...rows.map((row) => row.eventId),
    ],
    timeoutMs: 5_000,
    maxAttempts: 1,
  });
  requireRowsAffected(
    updated,
    rows.length,
    "Scheduling BigQuery delivery retry",
  );
}

async function cleanupDeliveredRows(db: Executor): Promise<number> {
  if (!db.transaction) {
    throw new Error(
      "BigQuery delivery cleanup requires a database transaction",
    );
  }
  const cutoff = new Date(
    Date.now() - DELIVERY_CLEANUP_RETENTION_MS,
  ).toISOString();
  return db.transaction(async (tx) => {
    const selected = await tx.execute({
      sql: `SELECT event_id
              FROM ${DELIVERY_TABLE}
             WHERE delivered_at IS NOT NULL
               AND delivered_at <= $1
             ORDER BY delivered_at ASC, event_id ASC
             LIMIT $2
             FOR UPDATE SKIP LOCKED`,
      args: [cutoff, DELIVERY_BATCH_SIZE],
      timeoutMs: 5_000,
      maxAttempts: 1,
    });
    const ids = (selected.rows ?? [])
      .map((row) =>
        row && typeof row === "object"
          ? stringValue(row as Record<string, unknown>, "event_id", "eventId")
          : "",
      )
      .filter(Boolean);
    if (!ids.length) return 0;
    await tx.execute({
      sql: `DELETE FROM analytics_events
             WHERE id IN (${idPlaceholders(1, ids.length)})`,
      args: ids,
      timeoutMs: 5_000,
      maxAttempts: 1,
    });
    const deleted = await tx.execute({
      sql: `DELETE FROM ${DELIVERY_TABLE}
             WHERE delivered_at IS NOT NULL
               AND event_id IN (${idPlaceholders(1, ids.length)})`,
      args: ids,
      timeoutMs: 5_000,
      maxAttempts: 1,
    });
    requireRowsAffected(deleted, ids.length, "Cleaning BigQuery delivery rows");
    return ids.length;
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runFirstPartyAnalyticsBigQueryDeliveryOnce(): Promise<FirstPartyAnalyticsDeliverySweepResult> {
  if (process.env.ANALYTICS_BIGQUERY_BACKFILL_JOBS?.trim() === "0") {
    return {
      status: "disabled",
      batches: 0,
      delivered: 0,
      cleaned: 0,
      pendingCount: 0,
      oldestPendingAt: null,
      lastDeliveredAt: null,
      lastError: null,
    };
  }

  const db = executor();
  let batches = 0;
  let delivered = 0;
  let retryScheduled = false;
  for (let index = 0; index < MAX_DELIVERY_BATCHES_PER_SWEEP; index += 1) {
    const claimed = await claimPendingDeliveryRows(
      db,
      new Date().toISOString(),
    );
    if (!claimed.length) break;
    batches += 1;

    const groups = new Map<string, DeliveryQueueRow[]>();
    for (const row of claimed) {
      const key = groupKey(row);
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }

    for (const rows of groups.values()) {
      const first = rows[0]!;
      try {
        const events = await hydrateDeliveryRows(db, rows);
        await renewDeliveryRows(db, rows, new Date().toISOString());
        const insertResult = await runWithRequestContext(
          { userEmail: first.ownerEmail, orgId: first.orgId ?? undefined },
          () =>
            insertFirstPartyAnalyticsRowsWithResults(events, first.tableRef),
        );
        const acceptedIds = new Set(insertResult.acceptedIds);
        const rejectedIds = new Set(insertResult.rejectedIds);
        if (
          acceptedIds.size + rejectedIds.size !== rows.length ||
          rows.some(
            (row) =>
              !acceptedIds.has(row.eventId) && !rejectedIds.has(row.eventId),
          )
        ) {
          throw new Error(
            "BigQuery delivery returned an incomplete row result",
          );
        }
        const acceptedRows = rows.filter((row) => acceptedIds.has(row.eventId));
        const rejectedRows = rows.filter((row) => rejectedIds.has(row.eventId));
        if (acceptedRows.length) {
          await markDeliveryRowsDelivered(
            db,
            acceptedRows,
            new Date().toISOString(),
          );
          delivered += acceptedRows.length;
        }
        if (rejectedRows.length) {
          retryScheduled = true;
          const message =
            insertResult.error ??
            `BigQuery rejected ${rejectedRows.length} event row(s)`;
          await scheduleDeliveryRetry(db, rejectedRows, message);
          console.error(
            "[first-party-analytics] BigQuery delivery rejected rows; retry scheduled:",
            message,
          );
        }
      } catch (error) {
        retryScheduled = true;
        const message = errorMessage(error);
        await scheduleDeliveryRetry(db, rows, message);
        console.error(
          "[first-party-analytics] BigQuery delivery failed; retry scheduled:",
          message,
        );
      }
    }
  }

  let cleaned = 0;
  for (let index = 0; index < MAX_DELIVERY_BATCHES_PER_SWEEP; index += 1) {
    const batch = await cleanupDeliveredRows(db);
    cleaned += batch;
    if (batch < DELIVERY_BATCH_SIZE) break;
  }
  const health = await getFirstPartyAnalyticsDeliveryHealth(undefined, db);
  if (firstPartyAnalyticsDeliveryNeedsAttention(health)) {
    console.error(
      "[first-party-analytics] BigQuery delivery backlog requires attention:",
      health,
    );
  }
  return {
    status: retryScheduled
      ? "retry-scheduled"
      : batches > 0
        ? "progress"
        : "idle",
    batches,
    delivered,
    cleaned,
    ...health,
  };
}
