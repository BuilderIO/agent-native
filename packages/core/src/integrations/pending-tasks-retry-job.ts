import { getDbExec } from "../db/client.js";
import { FRAMEWORK_ROUTE_PREFIX } from "../server/core-routes-plugin.js";
import { signInternalToken } from "./internal-token.js";

/**
 * Retries stuck integration webhook tasks.
 *
 * The integration webhook flow enqueues work into `integration_pending_tasks`
 * (see `pending-tasks-store.ts`) and then fires a self-webhook to the
 * `/_agent-native/integrations/process-task` endpoint to drain the queue.
 * If that fire-and-forget dispatch fails (e.g. transient network blip), the
 * row stays in `pending` forever. Likewise, if the processor is killed mid-
 * processing (function timeout, container shutdown), a row can remain in
 * `processing` forever.
 *
 * This job runs every 60s and re-fires the processor endpoint for tasks that
 * look stuck:
 *   - status='pending' AND created_at older than 90s (initial dispatch lost)
 *   - status='processing' AND updated_at older than 5min (killed mid-flight)
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
/** Tasks "processing" longer than this are considered killed mid-flight */
const PROCESSING_STUCK_AFTER_MS = 5 * 60 * 1000;
/** After this many attempts we give up and mark the task failed */
const MAX_ATTEMPTS = 3;

const PROCESSOR_PATH = `${FRAMEWORK_ROUTE_PREFIX}/integrations/process-task`;

let retryInterval: ReturnType<typeof setInterval> | null = null;
let activeWebhookBaseUrl: string | undefined;
/**
 * Whether the table exists. Cached after first probe so we don't log every
 * minute when the queue isn't in use yet on a given deployment.
 */
let tableExists: boolean | null = null;

interface StuckTaskRow {
  id: string;
  status: string;
  attempts: number;
}

/**
 * One pass: find stuck tasks and re-fire the processor for each.
 * Exported for tests and for manual triggers.
 */
export async function retryStuckPendingTasks(
  webhookBaseUrl?: string,
): Promise<void> {
  const baseUrl = webhookBaseUrl ?? activeWebhookBaseUrl;
  const client = getDbExec();
  const now = Date.now();
  const pendingCutoff = now - PENDING_STUCK_AFTER_MS;
  const processingCutoff = now - PROCESSING_STUCK_AFTER_MS;

  let stuckRows: StuckTaskRow[];
  try {
    const { rows } = await client.execute({
      sql: `
        SELECT id, status, attempts
          FROM integration_pending_tasks
         WHERE (status = 'pending' AND created_at <= ?)
            OR (status = 'processing' AND updated_at <= ?)
      `,
      args: [pendingCutoff, processingCutoff],
    });
    stuckRows = rows.map((r) => ({
      id: r.id as string,
      status: r.status as string,
      attempts: Number(r.attempts ?? 0),
    }));
    tableExists = true;
  } catch (err) {
    // Most common case: the table hasn't been created yet because no inbound
    // integration webhook has been processed on this deployment. Silently
    // no-op until the table appears.
    if (tableExists !== false) {
      tableExists = false;
      if (process.env.DEBUG) {
        console.log(
          "[integrations] pending-tasks retry job: table not present yet, skipping",
          err,
        );
      }
    }
    return;
  }

  if (stuckRows.length === 0) return;

  for (const row of stuckRows) {
    try {
      // Cap retries — mark failed and move on so the row stops bouncing
      // between pending and processing forever.
      if (row.attempts >= MAX_ATTEMPTS) {
        await client.execute({
          sql: `
            UPDATE integration_pending_tasks
               SET status = 'failed',
                   updated_at = ?,
                   error_message = COALESCE(error_message, ?)
             WHERE id = ?
          `,
          args: [
            Date.now(),
            `Retry job: exceeded ${MAX_ATTEMPTS} attempts`,
            row.id,
          ],
        });
        console.warn(
          `[integrations] Pending task ${row.id} exceeded ${MAX_ATTEMPTS} attempts — marking failed`,
        );
        continue;
      }

      // Reset stuck `processing` rows back to `pending` so the processor's
      // atomic claim (which only matches pending/failed) can re-acquire it.
      // Without this, processing rows stay stuck forever.
      // For pending rows, just touch updated_at to avoid re-firing every tick.
      const newStatus = row.status === "processing" ? "pending" : row.status;
      await client.execute({
        sql: `
          UPDATE integration_pending_tasks
             SET status = ?, updated_at = ?
           WHERE id = ?
        `,
        args: [newStatus, Date.now(), row.id],
      });

      await refireProcessor(row.id, baseUrl);
    } catch (err) {
      console.error(
        `[integrations] Failed to retry pending task ${row.id}:`,
        err,
      );
    }
  }
}

/**
 * Fire-and-forget POST to the processor endpoint for a single task id.
 * Mirrors the original dispatch from the webhook handler, including the
 * short-lived HMAC bearer token bound to this taskId.
 */
async function refireProcessor(
  taskId: string,
  webhookBaseUrl: string | undefined,
): Promise<void> {
  const baseUrl =
    webhookBaseUrl ||
    process.env.WEBHOOK_BASE_URL ||
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    `http://localhost:${process.env.PORT || 3000}`;

  const url = `${baseUrl.replace(/\/$/, "")}${PROCESSOR_PATH}`;

  // Sign with HMAC if A2A_SECRET is configured. If it isn't, we still fire
  // the request — the processor accepts unsigned requests when A2A_SECRET is
  // absent (see plugin.ts). This keeps the retry job working on templates
  // that haven't yet enrolled in the A2A identity scheme.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  try {
    headers["Authorization"] = `Bearer ${signInternalToken(taskId)}`;
  } catch {
    // No A2A_SECRET — proceed unsigned.
  }

  // Don't await the body — we just want the request to leave the box.
  // A short timeout avoids tying up the retry loop on a hung processor.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ taskId }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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
  setTimeout(() => {
    void retryStuckPendingTasks().catch((err) => {
      console.error("[integrations] Pending-tasks retry job error:", err);
    });
  }, 10_000);

  retryInterval = setInterval(() => {
    void retryStuckPendingTasks().catch((err) => {
      console.error("[integrations] Pending-tasks retry job error:", err);
    });
  }, RETRY_INTERVAL_MS);

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
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
  activeWebhookBaseUrl = undefined;
}
