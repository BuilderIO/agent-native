import { getDbExec } from "../db/client.js";
import {
  startIntervalJob,
  type IntervalJobHandle,
} from "../server/interval-job.js";
import { hasActiveIntegrationCampaign } from "./integration-campaigns-store.js";
import {
  configuredIntegrationDurableDispatchScopes,
  dispatchPendingIntegrationTask,
  isIntegrationDurableDispatchEnabledForTask,
} from "./integration-durable-dispatch.js";
import {
  ensurePendingTasksTable,
  MAX_PENDING_TASK_ATTEMPTS,
} from "./pending-tasks-store.js";

const RETRY_INTERVAL_MS = 60_000;
const PENDING_STUCK_AFTER_MS = 90_000;
const DEFAULT_PROCESSING_STUCK_AFTER_MS = 5 * 60 * 1000;
const SERVERLESS_PROCESSING_STUCK_AFTER_MS = 75_000;
const DURABLE_BACKGROUND_PROCESSING_STUCK_AFTER_MS = 16 * 60 * 1000;
const DEFAULT_SWEEP_LIMIT = 100;

let job: IntervalJobHandle | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let activeWebhookBaseUrl: string | undefined;
let tableExists: boolean | null = null;

interface StuckTaskRow {
  id: string;
  platform: string;
  externalThreadId: string;
  status: string;
  attempts: number;
  updatedAt: number;
  dispatchScope: string | null;
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
  return /relation .* does not exist|undefined_table/i.test(message);
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
        "(platform = ? AND (external_thread_id = ? OR dispatch_scope = ? OR external_thread_id LIKE ?))",
      );
      args.push(
        scope.platform,
        scope.value,
        scope.value,
        `%:%:${scope.value}:%`,
      );
      continue;
    }
    clauses.push(
      "(platform = ? AND (external_thread_id = ? OR dispatch_scope = ?))",
    );
    args.push(scope.platform, scope.value, scope.value);
  }
  return { clause: ` AND (${clauses.join(" OR ")})`, args };
}

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
        SELECT id, platform, external_thread_id, dispatch_scope, status, attempts, updated_at
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
      dispatchScope: (r.dispatch_scope as string | null) ?? null,
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
      platformContext: row.dispatchScope
        ? { channelId: row.dispatchScope }
        : undefined,
    });
    if (options.durableOnly && !durable) return false;
    return true;
  });
  result.selected = stuckRows.length;
  if (stuckRows.length === 0) return result;

  for (const row of stuckRows) {
    try {
      if (
        row.status === "processing" &&
        (await hasActiveIntegrationCampaign(row.id))
      ) {
        result.skipped += 1;
        continue;
      }
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
          platformContext: row.dispatchScope
            ? { channelId: row.dispatchScope }
            : undefined,
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
    "__cf_env" in globalThis ||
    "__env__" in globalThis
  ) {
    return SERVERLESS_PROCESSING_STUCK_AFTER_MS;
  }
  return DEFAULT_PROCESSING_STUCK_AFTER_MS;
}

export function startPendingTasksRetryJob(options?: {
  webhookBaseUrl?: string;
}): void {
  if (job || startupTimer) return;
  activeWebhookBaseUrl = options?.webhookBaseUrl;

  startupTimer = setTimeout(() => {
    startupTimer = null;
    job = startIntervalJob(async () => void (await retryStuckPendingTasks()), {
      intervalMs: RETRY_INTERVAL_MS,
      onError: (err) => {
        console.error("[integrations] Pending-tasks retry job error:", err);
      },
    });
  }, 10_000);
  startupTimer.unref?.();

  if (process.env.DEBUG) {
    console.log(
      `[integrations] Pending-tasks retry job started (every ${
        RETRY_INTERVAL_MS / 1000
      }s)`,
    );
  }
}

export function stopPendingTasksRetryJob(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  job?.stop();
  job = null;
  activeWebhookBaseUrl = undefined;
}
