import { getDbExec } from "@agent-native/core/db";

import { FIRST_PARTY_ANALYTICS_ROLLUP_BACKFILL_LOCK_KEY } from "../lib/analytics-rollup-lock";

const BACKFILL_STATE_ID = "historical-v1";
const BACKFILL_LEASE_MINUTES = 15;

const POSTGRES_BACKFILL_STATEMENTS = [
  `
    INSERT INTO analytics_event_daily_rollups (
      id, tenant_key, owner_email, org_id, event_date, event_name,
      app, template, event_count
    )
    SELECT
      md5(random()::text || clock_timestamp()::text), tenant_key,
      MIN(owner_email), MIN(org_id), event_date, event_name, app, template,
      COUNT(*)::INTEGER
    FROM (
      SELECT
        CASE
          WHEN org_id IS NOT NULL AND org_id <> '' THEN 'org:' || org_id
          ELSE 'user:' || owner_email
        END AS tenant_key,
        owner_email,
        org_id,
        COALESCE(NULLIF(event_date, ''), substr(timestamp, 1, 10)) AS event_date,
        event_name,
        COALESCE(app, '') AS app,
        COALESCE(template, '') AS template
      FROM analytics_events
    ) AS historical_events
    WHERE event_date <> ''
    GROUP BY tenant_key, event_date, event_name, app, template
    ON CONFLICT (tenant_key, event_date, event_name, app, template)
    DO UPDATE SET event_count = GREATEST(
      analytics_event_daily_rollups.event_count,
      EXCLUDED.event_count
    )
  `,
  `
    INSERT INTO analytics_user_days (
      id, tenant_key, owner_email, org_id, event_date, user_key
    )
    SELECT
      md5(random()::text || clock_timestamp()::text), tenant_key,
      owner_email, org_id, event_date, user_key
    FROM (
      SELECT DISTINCT
        CASE
          WHEN org_id IS NOT NULL AND org_id <> '' THEN 'org:' || org_id
          ELSE 'user:' || owner_email
        END AS tenant_key,
        owner_email,
        org_id,
        COALESCE(NULLIF(event_date, ''), substr(timestamp, 1, 10)) AS event_date,
        COALESCE(
          NULLIF(user_key, ''),
          NULLIF(user_id, ''),
          NULLIF(anonymous_id, '')
        ) AS user_key
      FROM analytics_events
      WHERE COALESCE(
        NULLIF(user_key, ''),
        NULLIF(user_id, ''),
        NULLIF(anonymous_id, '')
      ) IS NOT NULL
    ) AS historical_user_days
    WHERE event_date <> '' AND user_key <> ''
    ON CONFLICT (tenant_key, event_date, user_key) DO NOTHING
  `,
] as const;

type BackfillStatus =
  | "completed"
  | "already-complete"
  | "disabled"
  | "skipped-lock"
  | "already-running";

export interface AnalyticsRollupBackfillResult {
  status: BackfillStatus;
  remaining: number;
}

let running = false;

function nowSql(): string {
  return "now()::text";
}

function ensureStateSql(): string {
  return `INSERT INTO analytics_rollup_backfill_state (id, status, updated_at)
       VALUES (?, 'pending', ${nowSql()})
       ON CONFLICT (id) DO NOTHING`;
}

function createBackfillLeaseToken(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `analytics-rollup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function claimStateSql(): string {
  return `UPDATE analytics_rollup_backfill_state
          SET status = 'running', lease_token = ?,
              lease_expires_at = now() + INTERVAL '${BACKFILL_LEASE_MINUTES} minutes',
              updated_at = now()
        WHERE id = ?
          AND (
            status = 'pending'
            OR (
              status = 'running'
              AND (
                lease_expires_at IS NULL
                OR lease_expires_at <= now()
              )
            )
          )`;
}

function releaseStateLeaseSql(): string {
  return `UPDATE analytics_rollup_backfill_state
             SET status = 'pending', lease_token = NULL,
                 lease_expires_at = NULL, updated_at = now()
           WHERE id = ? AND lease_token = ?`;
}

async function stateStatus(db: {
  execute: (query: { sql: string; args: unknown[] }) => Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
}): Promise<string | null> {
  const result = await db.execute({
    sql: "SELECT status FROM analytics_rollup_backfill_state WHERE id = ?",
    args: [BACKFILL_STATE_ID],
  });
  const status = result.rows[0]?.status;
  return typeof status === "string" ? status : null;
}

async function completeState(tx: {
  execute: (query: { sql: string; args: unknown[] }) => Promise<unknown>;
}): Promise<void> {
  await tx.execute({
    sql: `UPDATE analytics_rollup_backfill_state
          SET status = 'completed', completed_at = ${nowSql()}, updated_at = ${nowSql()}
        WHERE id = ?`,
    args: [BACKFILL_STATE_ID],
  });
}

async function runBackfillStatements(tx: {
  execute: (query: string) => Promise<unknown>;
}): Promise<void> {
  const statements = POSTGRES_BACKFILL_STATEMENTS;
  for (const statement of statements) await tx.execute(statement);
}

export async function isHistoricalAnalyticsRollupBackfillComplete(): Promise<boolean> {
  return (await stateStatus(getDbExec())) === "completed";
}

async function runTransactionalBackfill(
  db: ReturnType<typeof getDbExec>,
): Promise<BackfillStatus> {
  if (!db.transaction) {
    throw new Error(
      "Analytics rollup backfill requires a database transaction",
    );
  }

  return db.transaction(async (tx) => {
    {
      // This scans all of analytics_events (41 GB in production) in one
      // GROUP BY, and the lease budgets 15 minutes for it. A role-level
      // statement_timeout — the thing that stops a runaway dashboard query
      // from holding every pooler connection — would otherwise kill this
      // legitimate job partway through. SET LOCAL is scoped to this
      // transaction and reverts on commit or rollback.
      await tx.execute(
        `SET LOCAL statement_timeout = '${BACKFILL_LEASE_MINUTES}min'`,
      );
      const lockResult = await tx.execute({
        sql: "SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0::bigint)) AS acquired",
        args: [FIRST_PARTY_ANALYTICS_ROLLUP_BACKFILL_LOCK_KEY],
      });
      const acquired = lockResult.rows[0]?.acquired;
      if (acquired !== true && acquired !== "t") return "skipped-lock";
    }

    await tx.execute({ sql: ensureStateSql(), args: [BACKFILL_STATE_ID] });
    if ((await stateStatus(tx)) === "completed") return "already-complete";

    await runBackfillStatements(tx);
    await completeState(tx);
    return "completed";
  });
}

/**
 * Rebuild historical compact rollups outside the server boot path. The state
 * row is completed in the same transaction as both aggregates, so a timeout
 * or failed write leaves the job pending and a later scheduled run retries it.
 */
export async function runAnalyticsRollupBackfillOnce(): Promise<AnalyticsRollupBackfillResult> {
  if (process.env.ANALYTICS_ROLLUP_BACKFILL_JOBS?.trim() === "0") {
    return { status: "disabled", remaining: 1 };
  }
  if (running) {
    return { status: "already-running", remaining: 1 };
  }
  running = true;

  try {
    const db = getDbExec();
    const status = await runTransactionalBackfill(db);
    return {
      status,
      remaining:
        status === "completed" || status === "already-complete" ? 0 : 1,
    };
  } finally {
    running = false;
  }
}
