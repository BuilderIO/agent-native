import { getDbExec } from "../db/client.js";
import {
  configuredIntegrationDurableDispatchScopes,
  dispatchPendingIntegrationTask,
  isIntegrationDurableDispatchEnabledForTask,
} from "./integration-durable-dispatch.js";
import {
  ensurePendingTasksTable,
  MAX_PENDING_TASK_ATTEMPTS,
} from "./pending-tasks-store.js";

/**
 * Retries stuck integration webhook tasks.
 *
 * The integration webhook flow enqueues work into `integration_pending_tasks`
 * (see `pending-tasks-store.ts`) and then fires a self-webhook to the
 * `/_agent-native/integrations/process-task` endpoint to drain the queue.
 * If that initial dispatch is lost (e.g. transient network blip), the
 * row stays in `pending` forever. Likewise, if the processor is killed mid-
 * processing (function timeout, container shutdown), a row can remain in
 * `processing` forever.
 *
 * The in-process fallback runs every 60s. Durable deployments also invoke the
 * same bounded sweep from an external scheduler so recovery does not depend on
 * a serverless process remaining alive.
 *
 * Each sweep re-fires the processor endpoint for tasks that
 * look stuck:
 *   - status='pending' AND created_at older than 90s (initial dispatch lost)
 *   - status='processing' AND updated_at older than the host-specific
 *     function budget (75s on serverless, 5min elsewhere)
 *
 * Retries are capped at MAX_ATTEMPTS attempts; after that the row is marked
 * `failed` permanently so it stops being retried.
 *
 * If the `integration_pending_tasks` table does not yet exist (e.g. older
 * deploy that hasn't run the new webhook flow), this job no-ops silently
 * rather than spamming logs.
 */

const RETRY_INTERVAL_MS = 60_000;
/** Tasks pending longer than this are considered stuck on initial dispatch */
const PENDING_STUCK_AFTER_MS = 90_000;
/** Tasks "processing" longer than this are considered killed mid-flight. */
const DEFAULT_PROCESSING_STUCK_AFTER_MS = 5 * 60 * 1000;
const SERVERLESS_PROCESSING_STUCK_AFTER_MS = 75_000;
const DURABLE_BACKGROUND_PROCESSING_STUCK_AFTER_MS = 16 * 60 * 1000;
/** After this many attempts we give up and mark the task failed */
const DEFAULT_SWEEP_LIMIT = 100;

let retryInterval: ReturnType<typeof setInterval> | null = null;
let initialTimer: ReturnType<typeof setTimeout> | null = null;
let activeWebhookBaseUrl: string | undefined;
/**
 * Whether the table exists. Cached after first probe so we don't log every
 * minute when the queue isn't in use yet on a given deployment.
 */
let tableExists: boolean | null = null;

interface StuckTaskRow {
  id: string;
  platform: string;
  externalThreadId: string;
  status: string;
  attempts: number;
  updatedAt: number;
}

export interface PendingTasksSweepResult {
  selected: number;
  dispatched: number;
  markedFailed: number;
  skipped: number;
  dispatchFailed: number;
}

export interface PendingTasksSweepOptions {
  webhookBaseUrl?: string;
  limit?: number;
  durableOnly?: boolean;
}

function affectedRows(result: unknown): number {
  return Number(
    (result as { rowsAffected?: number }).rowsAffected ??
      (result as { rowCount?: number }).rowCount ??
      0,
  );
}

function isMissingPendingTasksTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /no such table|relation .* does not exist|undefined_table/i.test(
    message,
  );
}

function durableScopeSql(): { clause: string; args: string[] } {
  const scopes = configuredIntegrationDurableDispatchScopes();
  if (scopes === null) return { clause: "", args: [] };
  if (scopes.length === 0) return { clause: " AND 1 = 0", args: [] };

  const clauses: string[] = [];
  const args: string[] = [];
  for (const scope of scopes) {
    if (scope.value === "*") {
      clauses.push("platform = ?");
      args.push(scope.platform);
      continue;
    }
    if (scope.platform === "slack" && /^[A-Za-z0-9]+$/.test(scope.value)) {
      clauses.push(
        "(platform = ? AND (external_thread_id = ? OR external_thread_id LIKE ?))",
      );
      args.push(scope.platform, scope.value, `%:%:${scope.value}:%`);
      continue;
    }
    clauses.push("(platform = ? AND external_thread_id = ?)");
    args.push(scope.platform, scope.value);
  }
  return { clause: ` AND (${clauses.join(" OR ")})`, args };
}

/**
 * One pass: find stuck tasks and re-fire the processor for each.
 * Exported for tests and for manual triggers.
 */
export async function retryStuckPendingTasks(
  input?: string | PendingTasksSweepOptions,
): Promise<PendingTasksSweepResult> {
  const options: PendingTasksSweepOptions =
    typeof input === "string" ? { webhookBaseUrl: input } : (input ?? {});
  const baseUrl = options.webhookBaseUrl ?? activeWebhookBaseUrl;
  const limit = Math.max(
    1,
    Math.min(500, Math.floor(options.limit ?? DEFAULT_SWEEP_LIMIT)),
  );
  const scopeSql = options.durableOnly
    ? durableScopeSql()
    : { clause: "", args: [] as string[] };
  const result: PendingTasksSweepResult = {
    selected: 0,
    dispatched: 0,
    markedFailed: 0,
    skipped: 0,
    dispatchFailed: 0,
  };
  await ensurePendingTasksTable();
  const client = getDbExec();
  const now = Date.now();
  const pendingCutoff = now - PENDING_STUCK_AFTER_MS;
  const processingCutoff = now - getProcessingStuckAfterMs();
  const durableProcessingCutoff =
    now - DURABLE_BACKGROUND_PROCESSING_STUCK_AFTER_MS;

  let stuckRows: StuckTaskRow[];
  try {
    const { rows } = await client.execute({
      sql: `
        SELECT id, platform, external_thread_id, status, attempts, updated_at
          FROM integration_pending_tasks
         WHERE ((status = 'pending' AND created_at <= ? AND updated_at <= ?)
            OR (status = 'processing' AND (
              (last_dispatch_outcome = 'background-acknowledged'
                AND updated_at <= ?)
              OR ((last_dispatch_outcome IS NULL
                    OR last_dispatch_outcome <> 'background-acknowledged')
                AND updated_at <= ?)
            )))
         ${scopeSql.clause}
         ORDER BY updated_at ASC
         LIMIT ?
      `,
      // `updated_at` is initialized to `created_at` on insert, so a genuinely
      // stuck pending row still matches on the first sweep. The retry path
      // below touches `updated_at`, which (with this predicate) keeps the row
      // from being re-selected — and re-firing the processor — on every tick.
      args: [
        pendingCutoff,
        pendingCutoff,
        durableProcessingCutoff,
        processingCutoff,
        ...scopeSql.args,
        limit,
      ],
    });
    stuckRows = rows.map((r) => ({
      id: r.id as string,
      platform: r.platform as string,
      externalThreadId: r.external_thread_id as string,
      status: r.status as string,
      attempts: Number(r.attempts ?? 0),
      updatedAt: Number(r.updated_at ?? 0),
    }));
    tableExists = true;
  } catch (err) {
    if (!isMissingPendingTasksTableError(err)) throw err;
    if (tableExists !== false) {
      tableExists = false;
      if (process.env.DEBUG) {
        console.log(
          "[integrations] pending-tasks retry job: table not present yet, skipping",
        );
      }
    }
    return result;
  }

  stuckRows = stuckRows.filter((row) => {
    const durable = isIntegrationDurableDispatchEnabledForTask({
      platform: row.platform,
      externalThreadId: row.externalThreadId,
    });
    if (options.durableOnly && !durable) return false;
    return true;
  });
  result.selected = stuckRows.length;
  if (stuckRows.length === 0) return result;

  for (const row of stuckRows) {
    try {
      // Cap retries — mark failed and move on so the row stops bouncing
      // between pending and processing forever.
      if (row.attempts >= MAX_PENDING_TASK_ATTEMPTS) {
        const update = await client.execute({
          sql: `
            UPDATE integration_pending_tasks
               SET status = 'failed',
                   updated_at = ?,
                   error_message = COALESCE(error_message, ?),
                   payload = '{}',
                   external_event_key = NULL
             WHERE id = ?
               AND status = ?
               AND updated_at = ?
          `,
          args: [
            Date.now(),
            `Retry job: exceeded ${MAX_PENDING_TASK_ATTEMPTS} attempts`,
            row.id,
            row.status,
            row.updatedAt,
          ],
        });
        if (affectedRows(update) === 0) {
          result.skipped += 1;
          continue;
        }
        result.markedFailed += 1;
        console.warn(
          `[integrations] Pending task ${row.id} exceeded ${MAX_PENDING_TASK_ATTEMPTS} attempts — marking failed`,
        );
        continue;
      }

      // Reset stuck `processing` rows back to `pending` so the processor's
      // atomic claim (which only matches pending) can re-acquire it.
      // Without this, processing rows stay stuck forever.
      // For pending rows, just touch updated_at to avoid re-firing every tick.
      const newStatus = row.status === "processing" ? "pending" : row.status;
      const update = await client.execute({
        sql: `
          UPDATE integration_pending_tasks
             SET status = ?, updated_at = ?
           WHERE id = ?
             AND status = ?
             AND updated_at = ?
        `,
        args: [newStatus, Date.now(), row.id, row.status, row.updatedAt],
      });
      if (affectedRows(update) === 0) {
        result.skipped += 1;
        continue;
      }

      const outcome = await dispatchPendingIntegrationTask({
        taskId: row.id,
        task: {
          platform: row.platform,
          externalThreadId: row.externalThreadId,
        },
        baseUrl,
        portableSettleMs: 1_000,
      });
      if (outcome === "failed") result.dispatchFailed += 1;
      else result.dispatched += 1;
    } catch (err) {
      result.dispatchFailed += 1;
      console.error(
        `[integrations] Failed to retry pending task ${row.id}:`,
        err,
      );
    }
  }
  return result;
}

function getProcessingStuckAfterMs(): number {
  if (
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.VERCEL ||
    "__cf_env" in globalThis
  ) {
    return SERVERLESS_PROCESSING_STUCK_AFTER_MS;
  }
  return DEFAULT_PROCESSING_STUCK_AFTER_MS;
}

/**
 * Start the periodic retry loop. Safe to call multiple times — second call
 * is a no-op.
 */
export function startPendingTasksRetryJob(options?: {
  webhookBaseUrl?: string;
}): void {
  if (retryInterval) return;
  activeWebhookBaseUrl = options?.webhookBaseUrl;

  // Stagger the first run a bit so we don't hammer the DB immediately on boot.
  initialTimer = setTimeout(() => {
    void retryStuckPendingTasks().catch((err) => {
      console.error("[integrations] Pending-tasks retry job error:", err);
    });
  }, 10_000);
  unrefTimer(initialTimer);

  retryInterval = setInterval(() => {
    void retryStuckPendingTasks().catch((err) => {
      console.error("[integrations] Pending-tasks retry job error:", err);
    });
  }, RETRY_INTERVAL_MS);
  unrefTimer(retryInterval);

  if (process.env.DEBUG) {
    console.log(
      `[integrations] Pending-tasks retry job started (every ${
        RETRY_INTERVAL_MS / 1000
      }s)`,
    );
  }
}

/** Stop the retry loop. */
export function stopPendingTasksRetryJob(): void {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
  activeWebhookBaseUrl = undefined;
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}
