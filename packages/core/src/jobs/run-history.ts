import { randomUUID } from "node:crypto";

import { z } from "zod";

import { resolveBackgroundRunHardTimeoutMs } from "../agent/run-manager.js";
import { getDbExec } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { runMigrations, type MigrationEntry } from "../db/migrations.js";
import { emit as emitBusEvent, registerEvent } from "../event-bus/index.js";
import { decryptSecretValue, encryptSecretValue } from "../secrets/crypto.js";
import {
  createAutomationFailureUnsubscribeToken,
  sendAutomationFailureNotification,
} from "../server/automation-failure-notifications.js";

registerEvent({
  name: "automation.run.finished",
  description:
    "Fires after a scheduled or manual automation run records a terminal status.",
  payloadSchema: z.object({
    automationRunId: z.string(),
    owner: z.string(),
    automation: z.string(),
    path: z.string(),
    orgId: z.string().nullable(),
    runId: z.string().nullable(),
    threadId: z.string().nullable(),
    status: z.enum(["success", "error", "interrupted"]),
    error: z.string().nullable(),
    errorCode: z.string().nullable(),
    durationMs: z.number().nullable(),
  }),
});

export type AutomationRunStatus =
  | "running"
  | "success"
  | "error"
  | "interrupted";

export interface AutomationRun {
  id: string;
  owner: string;
  automation: string;
  path: string;
  scope: string | null;
  orgId: string | null;
  appId: string | null;
  runId: string | null;
  threadId: string | null;
  status: AutomationRunStatus;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  errorCode: string | null;
}

export interface StartAutomationRunInput {
  owner: string;
  automation: string;
  path: string;
  scope?: string | null;
  orgId?: string | null;
  appId?: string | null;
  notificationEmail?: string | null;
  runId?: string | null;
  threadId?: string | null;
  dispatchPending?: boolean;
}

const TABLE = "automation_runs";
const MAX_ERROR_LENGTH = 500;
const MAX_ERROR_CODE_LENGTH = 100;

function resolveRunLivenessCeilingMs(): number {
  return Math.ceil(resolveBackgroundRunHardTimeoutMs() * 1.5);
}
const INTERRUPTED_RUN_MESSAGE =
  "Worker stopped before a terminal result was recorded. The serverless worker may have timed out or been recycled. No delivery was confirmed.";
const INTERRUPTED_RUN_ERROR_CODE = "background_automation_interrupted";

const claimLeaseMs = () => resolveRunLivenessCeilingMs();

const RUNS_RETAINED_PER_AUTOMATION = 50;
const FAILURE_ALERT_LEASE_MS = 60_000;
const FAILURE_ALERT_RETRY_BASE_MS = 60_000;
const FAILURE_ALERT_RETRY_MAX_MS = 6 * 60 * 60_000;
const FAILURE_ALERT_NOT_READY_RETRY_MS = 15 * 60_000;
const FAILURE_ALERT_MAX_ATTEMPTS = 12;
// Keep all automatic retries inside Resend's 24-hour idempotency window.
const RESEND_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60_000;

export const AUTOMATION_RUN_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "automation-runs-table",
    sql: `
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        automation TEXT NOT NULL,
        path TEXT NOT NULL,
        scope TEXT,
        org_id TEXT,
        app_id TEXT,
        run_id TEXT,
        thread_id TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        error TEXT,
        claimed_at INTEGER,
        dispatch_pending INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_${TABLE}_owner_automation
        ON ${TABLE} (owner, automation, started_at)
    `,
  },
  {
    version: 2,
    name: "automation-runs-claimed-at",
    sql: `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS claimed_at INTEGER`,
  },
  {
    version: 3,
    name: "automation-runs-dispatch-pending",
    sql: `ALTER TABLE ${TABLE}
      ADD COLUMN IF NOT EXISTS dispatch_pending INTEGER NOT NULL DEFAULT 0`,
  },
  {
    version: 4,
    name: "automation-runs-app-id",
    sql: `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS app_id TEXT`,
  },
  {
    version: 5,
    name: "automation-runs-error-code",
    sql: `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS error_code TEXT`,
  },
  {
    version: 6,
    name: "automation-runs-notification-email",
    sql: `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS notification_email TEXT`,
  },
  {
    version: 7,
    name: "automation-runs-failure-alerted",
    sql: `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS failure_alerted INTEGER NOT NULL DEFAULT 0`,
  },
  {
    version: 8,
    name: "automation-runs-failure-alert-delivery",
    sql: `ALTER TABLE ${TABLE}
      ADD COLUMN IF NOT EXISTS failure_alert_state TEXT,
      ADD COLUMN IF NOT EXISTS failure_alert_attempts BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS failure_alert_next_attempt_at BIGINT,
      ADD COLUMN IF NOT EXISTS failure_alert_claimed_at BIGINT,
      ADD COLUMN IF NOT EXISTS failure_alert_provider TEXT,
      ADD COLUMN IF NOT EXISTS failure_alert_first_attempt_at BIGINT,
      ADD COLUMN IF NOT EXISTS failure_alert_unsubscribe_token TEXT`,
  },
];

export async function runAutomationRunMigrations(
  nitroApp: unknown,
): Promise<void> {
  await runMigrations(AUTOMATION_RUN_MIGRATIONS, {
    table: "_automation_run_migrations",
  })(nitroApp);
}

let _initPromise: Promise<void> | undefined;

export async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const createSql = `
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          id TEXT PRIMARY KEY,
          owner TEXT NOT NULL,
          automation TEXT NOT NULL,
            path TEXT NOT NULL,
            scope TEXT,
            org_id TEXT,
            app_id TEXT,
            run_id TEXT,
          thread_id TEXT,
          status TEXT NOT NULL DEFAULT 'running',
          started_at BIGINT NOT NULL,
          finished_at BIGINT,
          error TEXT,
          error_code TEXT,
          notification_email TEXT,
          failure_alerted BIGINT NOT NULL DEFAULT 0,
          failure_alert_state TEXT,
          failure_alert_attempts BIGINT NOT NULL DEFAULT 0,
          failure_alert_next_attempt_at BIGINT,
          failure_alert_claimed_at BIGINT,
          failure_alert_provider TEXT,
          failure_alert_first_attempt_at BIGINT,
          failure_alert_unsubscribe_token TEXT,
          claimed_at BIGINT,
          dispatch_pending BIGINT NOT NULL DEFAULT 0
        )
      `;
      const indexSql = `CREATE INDEX IF NOT EXISTS idx_${TABLE}_owner_automation ON ${TABLE} (owner, automation, started_at)`;

      {
        await ensureTableExists(TABLE, createSql);
        await ensureColumnExists(
          TABLE,
          "claimed_at",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS claimed_at BIGINT`,
        );
        await ensureColumnExists(
          TABLE,
          "dispatch_pending",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS dispatch_pending BIGINT NOT NULL DEFAULT 0`,
        );
        await ensureColumnExists(
          TABLE,
          "error_code",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS error_code TEXT`,
        );
        await ensureColumnExists(
          TABLE,
          "notification_email",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS notification_email TEXT`,
        );
        await ensureColumnExists(
          TABLE,
          "failure_alerted",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS failure_alerted BIGINT NOT NULL DEFAULT 0`,
        );
        await ensureColumnExists(
          TABLE,
          "failure_alert_state",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS failure_alert_state TEXT`,
        );
        await ensureColumnExists(
          TABLE,
          "failure_alert_attempts",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS failure_alert_attempts BIGINT NOT NULL DEFAULT 0`,
        );
        await ensureColumnExists(
          TABLE,
          "failure_alert_next_attempt_at",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS failure_alert_next_attempt_at BIGINT`,
        );
        await ensureColumnExists(
          TABLE,
          "failure_alert_claimed_at",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS failure_alert_claimed_at BIGINT`,
        );
        await ensureColumnExists(
          TABLE,
          "failure_alert_provider",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS failure_alert_provider TEXT`,
        );
        await ensureColumnExists(
          TABLE,
          "failure_alert_first_attempt_at",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS failure_alert_first_attempt_at BIGINT`,
        );
        await ensureColumnExists(
          TABLE,
          "failure_alert_unsubscribe_token",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS failure_alert_unsubscribe_token TEXT`,
        );
        await ensureIndexExists(`idx_${TABLE}_owner_automation`, indexSql);
        return;
      }
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

function toRun(row: Record<string, unknown>, now: number): AutomationRun {
  const stored = stringifyValue(row.status) as AutomationRunStatus;
  const startedAt = Number(row.started_at);
  const status: AutomationRunStatus =
    stored === "running" && now - startedAt > resolveRunLivenessCeilingMs()
      ? "interrupted"
      : stored;
  return {
    id: stringifyValue(row.id),
    owner: stringifyValue(row.owner),
    automation: stringifyValue(row.automation),
    path: stringifyValue(row.path),
    scope: row.scope == null ? null : stringifyValue(row.scope),
    orgId: row.org_id == null ? null : stringifyValue(row.org_id),
    appId: row.app_id == null ? null : stringifyValue(row.app_id),
    runId: row.run_id == null ? null : stringifyValue(row.run_id),
    threadId: row.thread_id == null ? null : stringifyValue(row.thread_id),
    status,
    startedAt,
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
    error:
      row.error == null && status === "interrupted"
        ? INTERRUPTED_RUN_MESSAGE
        : row.error == null
          ? null
          : stringifyValue(row.error),
    errorCode:
      row.error_code == null && status === "interrupted"
        ? INTERRUPTED_RUN_ERROR_CODE
        : row.error_code == null
          ? null
          : stringifyValue(row.error_code),
  };
}

export async function startAutomationRun(
  input: StartAutomationRunInput,
): Promise<string> {
  await ensureTable();
  const id = randomUUID();
  await getDbExec().execute({
    sql: `INSERT INTO ${TABLE} (id, owner, automation, path, scope, org_id, app_id, notification_email, run_id, thread_id, status, started_at, dispatch_pending)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
    args: [
      id,
      input.owner,
      input.automation,
      input.path,
      input.scope ?? null,
      input.orgId ?? null,
      input.appId ?? null,
      input.notificationEmail?.trim().toLowerCase() || null,
      input.runId ?? null,
      input.threadId ?? null,
      Date.now(),
      input.dispatchPending ? 1 : 0,
    ],
  });
  await pruneAutomationRuns(input.owner, input.automation);
  return id;
}

export async function getAutomationRun(
  id: string,
): Promise<AutomationRun | null> {
  await ensureTable();
  const result = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? toRun(row, Date.now()) : null;
}

export async function claimAutomationRun(id: string): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const result = await getDbExec().execute({
    sql: `UPDATE ${TABLE} SET claimed_at = ? WHERE id = ? AND dispatch_pending = 1 AND (claimed_at IS NULL OR claimed_at <= ?) AND status = 'running'`,
    args: [now, id, now - claimLeaseMs()],
  });
  return Number(result.rowsAffected ?? 0) > 0;
}

export async function listUnclaimedAutomationRuns(options?: {
  appId?: string | null;
  olderThanMs?: number;
  limit?: number;
}): Promise<AutomationRun[]> {
  await ensureTable();
  const appId = options?.appId?.trim() || null;
  const olderThanMs = Math.max(options?.olderThanMs ?? 10_000, 0);
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const appFilter = appId ? " AND (app_id = ? OR app_id IS NULL)" : "";
  const result = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE}
          WHERE dispatch_pending = 1 AND (claimed_at IS NULL OR claimed_at <= ?) AND status = 'running'
            ${appFilter}
            AND started_at <= ?
          ORDER BY started_at ASC LIMIT ${limit}`,
    args: [
      Date.now() - claimLeaseMs(),
      ...(appId ? [appId] : []),
      Date.now() - olderThanMs,
    ],
  });
  const now = Date.now();
  return (result.rows ?? []).map((row) =>
    toRun(row as Record<string, unknown>, now),
  );
}

function stringifyValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  return value == null ? "" : (JSON.stringify(value) ?? "");
}

async function pruneAutomationRuns(
  owner: string,
  automation: string,
): Promise<void> {
  await getDbExec().execute({
    sql: `DELETE FROM ${TABLE}
          WHERE owner = ? AND automation = ?
            AND COALESCE(failure_alert_state, '') NOT IN ('evaluating', 'pending', 'sending')
            AND started_at < (
            SELECT MIN(started_at) FROM (
              SELECT started_at FROM ${TABLE}
              WHERE owner = ? AND automation = ?
              ORDER BY started_at DESC
              LIMIT ${RUNS_RETAINED_PER_AUTOMATION}
            ) recent
          )`,
    args: [owner, automation, owner, automation],
  });
}

function failureAlertRetryDelayMs(attempt: number): number {
  return Math.min(
    FAILURE_ALERT_RETRY_MAX_MS,
    FAILURE_ALERT_RETRY_BASE_MS * 2 ** Math.min(Math.max(attempt - 1, 0), 10),
  );
}

async function claimEvaluatingFailureAlert(
  row: Record<string, unknown>,
  now: number,
): Promise<"sending" | "suppressed" | "lost"> {
  const db = getDbExec();
  const appId = row.app_id == null ? null : stringifyValue(row.app_id);
  const appFilter =
    appId === null
      ? "AND app_id IS NULL"
      : "AND (app_id = ? OR app_id IS NULL)";
  const claim = async (tx: typeof db) => {
    await tx.execute({
      sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
      args: [
        `agent-native:automation-failure-alert:${JSON.stringify([
          stringifyValue(row.owner),
          stringifyValue(row.automation),
          stringifyValue(row.path),
        ])}`,
      ],
    });
    const priorRuns = await tx.execute({
      sql: `SELECT status, notification_email, failure_alerted FROM ${TABLE}
            WHERE owner = ? AND automation = ? AND path = ?
              ${appFilter}
              AND id <> ? AND status IN ('success', 'error', 'interrupted')
            ORDER BY started_at DESC LIMIT 1`,
      args: [
        stringifyValue(row.owner),
        stringifyValue(row.automation),
        stringifyValue(row.path),
        ...(appId === null ? [] : [appId]),
        stringifyValue(row.id),
      ],
    });
    const priorRun = priorRuns.rows?.[0] as Record<string, unknown> | undefined;
    const priorStatus = priorRun?.status;
    const priorEmail = stringifyValue(priorRun?.notification_email)
      .trim()
      .toLowerCase();
    const recipient = stringifyValue(row.notification_email)
      .trim()
      .toLowerCase();
    if (
      (priorStatus === "error" || priorStatus === "interrupted") &&
      priorEmail === recipient &&
      Number(priorRun?.failure_alerted ?? 0) !== 0
    ) {
      await tx.execute({
        sql: `UPDATE ${TABLE}
              SET failure_alerted = 1, failure_alert_state = 'suppressed',
                  failure_alert_next_attempt_at = NULL
              WHERE id = ? AND failure_alert_state = 'evaluating'`,
        args: [stringifyValue(row.id)],
      });
      return "suppressed" as const;
    }

    const claimed = await tx.execute({
      sql: `UPDATE ${TABLE}
            SET failure_alerted = 1, failure_alert_state = 'sending',
                failure_alert_attempts = failure_alert_attempts + 1,
                failure_alert_claimed_at = ?
            WHERE id = ? AND failure_alert_state = 'evaluating'`,
      args: [now, stringifyValue(row.id)],
    });
    return Number(claimed.rowsAffected ?? 0) > 0 ? "sending" : "lost";
  };

  return db.transaction ? db.transaction(claim) : claim(db);
}

async function claimPendingFailureAlert(
  row: Record<string, unknown>,
  now: number,
): Promise<boolean> {
  const result = await getDbExec().execute({
    sql: `UPDATE ${TABLE}
          SET failure_alert_state = 'sending',
              failure_alert_attempts = failure_alert_attempts + 1,
              failure_alert_claimed_at = ?
          WHERE id = ? AND failure_alert_state = 'pending'
            AND failure_alert_next_attempt_at <= ? AND failure_alerted = 1`,
    args: [now, stringifyValue(row.id), now],
  });
  return Number(result.rowsAffected ?? 0) > 0;
}

async function setFailureAlertOutcome(
  id: string,
  status:
    | "sent"
    | "suppressed"
    | "not-ready"
    | "retry"
    | "uncertain"
    | "failed",
  attempt: number,
  provider: "resend" | "sendgrid" | null,
  firstAttemptAt: number | null,
  now: number,
  claimedAt: number,
): Promise<void> {
  const withinResendWindow =
    provider !== "resend" ||
    firstAttemptAt === null ||
    now - firstAttemptAt < RESEND_IDEMPOTENCY_WINDOW_MS;
  const retryable =
    (status === "not-ready" || status === "retry") && withinResendWindow;
  const retry = retryable && attempt < FAILURE_ALERT_MAX_ATTEMPTS;
  const nextState = retry
    ? "pending"
    : status === "retry" || status === "not-ready"
      ? withinResendWindow && (status === "not-ready" || provider !== "resend")
        ? "failed"
        : "uncertain"
      : status;
  const nextAttemptAt = retry
    ? now +
      (status === "not-ready"
        ? FAILURE_ALERT_NOT_READY_RETRY_MS
        : failureAlertRetryDelayMs(attempt))
    : null;
  await getDbExec().execute({
    sql: `UPDATE ${TABLE}
          SET failure_alert_state = ?, failure_alert_next_attempt_at = ?,
              failure_alert_claimed_at = NULL
          WHERE id = ? AND failure_alert_state = 'sending'
            AND failure_alert_claimed_at = ?`,
    args: [nextState, nextAttemptAt, id, claimedAt],
  });
}

export async function processPendingAutomationFailureAlerts(options?: {
  limit?: number;
  runId?: string;
}): Promise<{
  attempted: number;
  delivered: number;
  deferred: number;
  suppressed: number;
  uncertain: number;
  failed: number;
}> {
  await ensureTable();
  const db = getDbExec();
  const now = Date.now();
  const resendCutoff = now - RESEND_IDEMPOTENCY_WINDOW_MS;
  await db.execute({
    sql: `UPDATE ${TABLE}
          SET failure_alert_state = CASE
                WHEN failure_alert_attempts >= ? THEN
                  CASE WHEN failure_alert_provider IS NULL THEN 'failed'
                    ELSE 'uncertain' END
                WHEN failure_alert_provider IS NULL OR
                  (failure_alert_provider = 'resend' AND
                    (failure_alert_first_attempt_at IS NULL OR failure_alert_first_attempt_at > ?))
                THEN 'pending' ELSE 'uncertain' END,
              failure_alert_next_attempt_at = CASE
                WHEN failure_alert_attempts < ? AND
                  (failure_alert_provider IS NULL OR
                  (failure_alert_provider = 'resend' AND
                    (failure_alert_first_attempt_at IS NULL OR failure_alert_first_attempt_at > ?)))
                THEN ?::bigint ELSE NULL END,
              failure_alert_claimed_at = NULL
          WHERE failure_alert_state = 'sending' AND failure_alert_claimed_at <= ?`,
    args: [
      FAILURE_ALERT_MAX_ATTEMPTS,
      resendCutoff,
      FAILURE_ALERT_MAX_ATTEMPTS,
      resendCutoff,
      now,
      now - FAILURE_ALERT_LEASE_MS,
    ],
  });

  const limit = Math.min(Math.max(options?.limit ?? 10, 1), 50);
  const runFilter = options?.runId ? "AND id = ?" : "";
  const result = await db.execute({
    sql: `SELECT * FROM ${TABLE}
          WHERE status IN ('error', 'interrupted')
            AND (failure_alert_state = 'evaluating' OR
              (failure_alert_state = 'pending' AND failure_alert_next_attempt_at <= ?))
            AND notification_email IS NOT NULL ${runFilter}
          ORDER BY started_at ASC LIMIT ${limit}`,
    args: [now, ...(options?.runId ? [options.runId] : [])],
  });
  const rows = (result.rows ?? []) as Record<string, unknown>[];
  let attempted = 0;
  let delivered = 0;
  let deferred = 0;
  let suppressed = 0;
  let uncertain = 0;
  let failed = 0;

  for (const row of rows) {
    const id = stringifyValue(row.id);
    try {
      if (row.failure_alert_state === "evaluating") {
        const claim = await claimEvaluatingFailureAlert(row, now);
        if (claim === "suppressed") {
          suppressed += 1;
          continue;
        }
        if (claim === "lost") continue;
      } else if (!(await claimPendingFailureAlert(row, now))) {
        continue;
      }
    } catch {
      console.warn("[automations] Failure alert claim failed.");
      deferred += 1;
      continue;
    }

    const attempt = Number(row.failure_alert_attempts ?? 0) + 1;
    let provider = row.failure_alert_provider
      ? (stringifyValue(row.failure_alert_provider) as "resend" | "sendgrid")
      : null;
    let firstAttemptAt =
      row.failure_alert_first_attempt_at == null
        ? null
        : Number(row.failure_alert_first_attempt_at);
    attempted += 1;
    const email = stringifyValue(row.notification_email);
    const appId = row.app_id == null ? null : stringifyValue(row.app_id);
    let outcome: Awaited<ReturnType<typeof sendAutomationFailureNotification>>;
    try {
      let unsubscribeToken: string;
      if (row.failure_alert_unsubscribe_token) {
        unsubscribeToken = decryptSecretValue(
          stringifyValue(row.failure_alert_unsubscribe_token),
        );
      } else {
        unsubscribeToken = createAutomationFailureUnsubscribeToken(
          email,
          appId,
        );
        await db.execute({
          sql: `UPDATE ${TABLE} SET failure_alert_unsubscribe_token = ?
                WHERE id = ? AND failure_alert_unsubscribe_token IS NULL`,
          args: [encryptSecretValue(unsubscribeToken), id],
        });
      }

      outcome = await sendAutomationFailureNotification(
        {
          email,
          appId,
          automation: stringifyValue(row.automation),
          path: stringifyValue(row.path),
          orgId: row.org_id == null ? null : stringifyValue(row.org_id),
          status: row.status === "interrupted" ? "interrupted" : "error",
          error: row.error == null ? null : stringifyValue(row.error),
          errorCode:
            row.error_code == null ? null : stringifyValue(row.error_code),
          idempotencyKey: `automation-failure:${id}`,
          unsubscribeToken,
        },
        {
          onProviderReady: async (nextProvider) => {
            if (provider && provider !== nextProvider) return false;
            const readyAt = Date.now();
            const nextFirstAttemptAt =
              nextProvider === "resend"
                ? (firstAttemptAt ?? readyAt)
                : firstAttemptAt;
            const recorded = await db.execute({
              sql: `UPDATE ${TABLE}
                    SET failure_alert_provider = ?, failure_alert_first_attempt_at = ?
                    WHERE id = ? AND failure_alert_state = 'sending'
                      AND failure_alert_claimed_at = ?`,
              args: [nextProvider, nextFirstAttemptAt, id, now],
            });
            if (Number(recorded.rowsAffected ?? 0) === 0) return false;
            provider = nextProvider;
            firstAttemptAt = nextFirstAttemptAt;
            return true;
          },
        },
      );
    } catch {
      console.warn("[automations] Failure alert processing failed.");
      outcome =
        provider === "sendgrid"
          ? { status: "uncertain", provider }
          : provider === "resend"
            ? { status: "retry", provider }
            : { status: "not-ready" };
    }

    try {
      await setFailureAlertOutcome(
        id,
        outcome.status,
        attempt,
        "provider" in outcome ? outcome.provider : provider,
        firstAttemptAt,
        Date.now(),
        now,
      );
    } catch {
      console.warn("[automations] Failure alert state update failed.");
      deferred += 1;
      continue;
    }
    if (outcome.status === "sent") delivered += 1;
    else if (outcome.status === "suppressed") suppressed += 1;
    else if (outcome.status === "uncertain") uncertain += 1;
    else if (outcome.status === "failed") failed += 1;
    else deferred += 1;
  }

  return { attempted, delivered, deferred, suppressed, uncertain, failed };
}

export async function finishAutomationRun(
  id: string,
  status: Exclude<AutomationRunStatus, "running">,
  error?: string,
  errorCode?: string,
  /**
   * `notify: false` records the run without queueing the owner email. Used for
   * the early failures of a streak that will pause: the owner is told once,
   * by the run that pauses it.
   */
  options: { notify?: boolean } = {},
): Promise<void> {
  await ensureTable();
  const existing = await getDbExec().execute({
    sql: `SELECT owner, automation, path, org_id, app_id, notification_email, run_id, thread_id, started_at, status FROM ${TABLE} WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const row = existing.rows?.[0] as Record<string, unknown> | undefined;
  const finishedAt = Date.now();
  const shouldQueueFailureAlert =
    status !== "success" &&
    options.notify !== false &&
    Boolean(row?.notification_email);
  const update = await getDbExec().execute({
    sql: `UPDATE ${TABLE}
          SET status = ?, finished_at = ?, error = ?, error_code = ?,
              failure_alert_state = ?, failure_alert_next_attempt_at = ?,
              failure_alert_claimed_at = NULL
          WHERE id = ? AND status = 'running'`,
    args: [
      status,
      finishedAt,
      error?.slice(0, MAX_ERROR_LENGTH) ?? null,
      errorCode?.slice(0, MAX_ERROR_CODE_LENGTH) ?? null,
      shouldQueueFailureAlert ? "evaluating" : null,
      shouldQueueFailureAlert ? finishedAt : null,
      id,
    ],
  });
  if (!row || Number(update.rowsAffected ?? 0) === 0) return;
  const rawStartedAt = Number(row.started_at);
  const startedAt = Number.isFinite(rawStartedAt) ? rawStartedAt : null;
  try {
    emitBusEvent(
      "automation.run.finished",
      {
        automationRunId: id,
        owner: stringifyValue(row.owner),
        automation: stringifyValue(row.automation),
        path: stringifyValue(row.path),
        orgId: row.org_id == null ? null : stringifyValue(row.org_id),
        runId: row.run_id == null ? null : stringifyValue(row.run_id),
        threadId: row.thread_id == null ? null : stringifyValue(row.thread_id),
        status,
        error: error?.slice(0, MAX_ERROR_LENGTH) ?? null,
        errorCode: errorCode?.slice(0, MAX_ERROR_CODE_LENGTH) ?? null,
        durationMs:
          startedAt === null ? null : Math.max(0, finishedAt - startedAt),
      },
      { owner: stringifyValue(row.owner) },
    );
  } catch (eventError) {
    console.warn(
      "[automations] terminal-run event delivery failed:",
      eventError,
    );
  }

  if (shouldQueueFailureAlert) {
    try {
      await processPendingAutomationFailureAlerts({ limit: 1, runId: id });
    } catch (notificationError) {
      console.warn(
        "[automations] Failure alert delivery failed:",
        notificationError,
      );
    }
  }
}

export async function attachAutomationRunThread(
  id: string,
  threadId: string,
  runId: string,
): Promise<void> {
  await ensureTable();
  await getDbExec().execute({
    sql: `UPDATE ${TABLE} SET thread_id = ?, run_id = ? WHERE id = ?`,
    args: [threadId, runId, id],
  });
}

export async function deleteAutomationRuns(
  owner: string,
  automation: string,
): Promise<void> {
  await ensureTable();
  const cutoff = Date.now();
  await getDbExec().execute({
    sql: `DELETE FROM ${TABLE} WHERE owner = ? AND automation = ? AND started_at <= ?`,
    args: [owner, automation, cutoff],
  });
}

export async function listAutomationRuns(options: {
  owners: string[];
  automation: string;
  appId?: string | null;
  limit?: number;
}): Promise<AutomationRun[]> {
  await ensureTable();
  const owners = options.owners.filter(Boolean);
  if (!owners.length) return [];
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const appId = options.appId?.trim() || null;
  const placeholders = owners.map(() => "?").join(", ");
  const appFilter = appId ? " AND (app_id = ? OR app_id IS NULL)" : "";
  const result = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE} WHERE owner IN (${placeholders}) AND automation = ?
          ${appFilter}
          ORDER BY started_at DESC LIMIT ${limit}`,
    args: [...owners, options.automation, ...(appId ? [appId] : [])],
  });
  const now = Date.now();
  return (result.rows ?? []).map((row) =>
    toRun(row as Record<string, unknown>, now),
  );
}

export async function listLatestAutomationRuns(options: {
  owners: string[];
  appId?: string | null;
}): Promise<AutomationRun[]> {
  await ensureTable();
  const owners = options.owners.filter(Boolean);
  if (!owners.length) return [];
  const placeholders = owners.map(() => "?").join(", ");
  const appId = options.appId?.trim() || null;
  const appFilter = appId ? " AND (app_id = ? OR app_id IS NULL)" : "";
  const result = await getDbExec().execute({
    sql: `SELECT DISTINCT ON (owner, path) * FROM ${TABLE}
          WHERE owner IN (${placeholders})${appFilter}
          ORDER BY owner, path, started_at DESC`,
    args: [...owners, ...(appId ? [appId] : [])],
  });
  const now = Date.now();
  return (result.rows ?? []).map((row) =>
    toRun(row as Record<string, unknown>, now),
  );
}
