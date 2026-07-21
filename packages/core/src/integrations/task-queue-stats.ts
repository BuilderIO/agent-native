/**
 * Read-only observability helpers for the integration task queue.
 *
 * Lives in its own file so it stays out of `pending-tasks-store.ts`, which is
 * actively being edited by the agent that owns the queue itself. These
 * Queue reads never expose payloads or user text. The helper first runs the
 * additive schema guard so older deployments gain the dispatch diagnostic
 * columns before the SELECTs execute.
 */
import { getDbExec } from "../db/client.js";
import { ensurePendingTasksTable } from "./pending-tasks-store.js";

export interface RecentFailure {
  id: string;
  platform: string;
  error: string;
  attempts: number;
}

export interface TaskQueueStats {
  pending: number;
  processing: number;
  completed_last_hour: number;
  failed_last_hour: number;
  oldest_pending_age_seconds: number;
  recent_failures: RecentFailure[];
  recent_tasks: Array<{
    id: string;
    platform: string;
    status: string;
    attempts: number;
    dispatch_attempts: number;
    last_dispatch_outcome: string | null;
    age_seconds: number;
  }>;
}

export interface TaskQueueStatsScope {
  ownerEmail: string;
  orgId: string | null;
}

const ZERO_STATS: TaskQueueStats = {
  pending: 0,
  processing: 0,
  completed_last_hour: 0,
  failed_last_hour: 0,
  oldest_pending_age_seconds: 0,
  recent_failures: [],
  recent_tasks: [],
};

function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /no such table|does not exist|relation .* does not exist|undefined_table/i.test(
    msg,
  );
}

/**
 * Get a snapshot of the integration task queue health.
 *
 * Safe to call before the pending-tasks store has initialized the schema.
 */
export async function getTaskQueueStats(
  scope: TaskQueueStatsScope,
): Promise<TaskQueueStats> {
  await ensurePendingTasksTable();
  const client = getDbExec();
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const scopeSql = `owner_email = ?
              AND ((org_id IS NULL AND CAST(? AS TEXT) IS NULL) OR org_id = ?)`;
  const scopeArgs = [scope.ownerEmail, scope.orgId, scope.orgId];

  try {
    // Status counts (pending, processing) — only need the live ones.
    const liveCounts = await client.execute({
      sql: `SELECT status, COUNT(*) AS c FROM integration_pending_tasks
            WHERE ${scopeSql}
              AND status IN ('pending', 'processing')
            GROUP BY status`,
      args: scopeArgs,
    });

    let pending = 0;
    let processing = 0;
    for (const row of liveCounts.rows as Array<Record<string, unknown>>) {
      const status = row.status as string;
      const count = Number(row.c ?? 0);
      if (status === "pending") pending = count;
      else if (status === "processing") processing = count;
    }

    // Last-hour completion + failure counts. updated_at is the most reliable
    // column — completed_at can be null on failed tasks, and created_at would
    // miss tasks queued >1h ago that just finished now.
    const lastHourCounts = await client.execute({
      sql: `SELECT status, COUNT(*) AS c FROM integration_pending_tasks
            WHERE ${scopeSql}
              AND status IN ('completed', 'failed') AND updated_at >= ?
            GROUP BY status`,
      args: [...scopeArgs, oneHourAgo],
    });

    let completedLastHour = 0;
    let failedLastHour = 0;
    for (const row of lastHourCounts.rows as Array<Record<string, unknown>>) {
      const status = row.status as string;
      const count = Number(row.c ?? 0);
      if (status === "completed") completedLastHour = count;
      else if (status === "failed") failedLastHour = count;
    }

    // Oldest pending task — used to surface stuck queues.
    let oldestPendingAgeSeconds = 0;
    if (pending > 0) {
      const oldest = await client.execute({
        sql: `SELECT created_at FROM integration_pending_tasks
              WHERE ${scopeSql}
                AND status = 'pending'
              ORDER BY created_at ASC
              LIMIT 1`,
        args: scopeArgs,
      });
      const oldestRow = oldest.rows[0] as Record<string, unknown> | undefined;
      if (oldestRow) {
        const createdAt = Number(oldestRow.created_at ?? now);
        oldestPendingAgeSeconds = Math.max(
          0,
          Math.floor((now - createdAt) / 1000),
        );
      }
    }

    // Recent failures, capped at 5 — enough to spot patterns without
    // blowing up the response payload.
    const failures = await client.execute({
      sql: `SELECT id, platform, error_message, attempts FROM integration_pending_tasks
            WHERE ${scopeSql}
              AND status = 'failed' AND updated_at >= ?
            ORDER BY updated_at DESC
            LIMIT 5`,
      args: [...scopeArgs, oneHourAgo],
    });
    const recentFailures: RecentFailure[] = (
      failures.rows as Array<Record<string, unknown>>
    ).map((row) => ({
      id: String(row.id ?? ""),
      platform: String(row.platform ?? ""),
      error: String(row.error_message ?? ""),
      attempts: Number(row.attempts ?? 0),
    }));

    const recent = await client.execute({
      sql: `SELECT id, platform, status, attempts, dispatch_attempts,
                   last_dispatch_outcome, created_at
              FROM integration_pending_tasks
             WHERE ${scopeSql}
             ORDER BY created_at DESC
             LIMIT 10`,
      args: scopeArgs,
    });
    const recentTasks = (recent.rows as Array<Record<string, unknown>>).map(
      (row) => ({
        id: String(row.id ?? ""),
        platform: String(row.platform ?? ""),
        status: String(row.status ?? ""),
        attempts: Number(row.attempts ?? 0),
        dispatch_attempts: Number(row.dispatch_attempts ?? 0),
        last_dispatch_outcome:
          row.last_dispatch_outcome == null
            ? null
            : String(row.last_dispatch_outcome),
        age_seconds: Math.max(
          0,
          Math.floor((now - Number(row.created_at ?? now)) / 1000),
        ),
      }),
    );

    return {
      pending,
      processing,
      completed_last_hour: completedLastHour,
      failed_last_hour: failedLastHour,
      oldest_pending_age_seconds: oldestPendingAgeSeconds,
      recent_failures: recentFailures,
      recent_tasks: recentTasks,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { ...ZERO_STATS, recent_failures: [], recent_tasks: [] };
    }
    throw err;
  }
}
