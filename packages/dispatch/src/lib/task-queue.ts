import { agentNativePath } from "@agent-native/core/client";

export interface TaskQueueFailure {
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
  recent_failures: TaskQueueFailure[];
}

export const ZERO_TASK_QUEUE_STATS: TaskQueueStats = {
  pending: 0,
  processing: 0,
  completed_last_hour: 0,
  failed_last_hour: 0,
  oldest_pending_age_seconds: 0,
  recent_failures: [],
};

function asNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeTaskQueueStats(value: unknown): TaskQueueStats {
  if (!value || typeof value !== "object") return ZERO_TASK_QUEUE_STATS;
  const stats = value as Record<string, unknown>;
  return {
    pending: asNumber(stats.pending),
    processing: asNumber(stats.processing),
    completed_last_hour: asNumber(stats.completed_last_hour),
    failed_last_hour: asNumber(stats.failed_last_hour),
    oldest_pending_age_seconds: asNumber(stats.oldest_pending_age_seconds),
    recent_failures: Array.isArray(stats.recent_failures)
      ? stats.recent_failures.map((failure, index) => {
          const row =
            failure && typeof failure === "object"
              ? (failure as Record<string, unknown>)
              : {};
          return {
            id: String(row.id ?? `failure-${index}`),
            platform: String(row.platform ?? ""),
            error: String(row.error ?? ""),
            attempts: asNumber(row.attempts),
          };
        })
      : [],
  };
}

export async function getDispatchTaskQueueStats(): Promise<TaskQueueStats> {
  const response = await fetch(
    agentNativePath("/_agent-native/integrations/task-queue/status"),
  );
  if (!response.ok) return ZERO_TASK_QUEUE_STATS;
  return normalizeTaskQueueStats(await response.json().catch(() => null));
}

export function formatQueueAgeSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "none";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
