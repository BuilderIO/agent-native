import { useChangeVersions, useT } from "@agent-native/core/client";
import { IconAlertTriangle, IconPlayerPlay } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import {
  formatQueueAgeSeconds,
  getDispatchTaskQueueStats,
  type TaskQueueStats,
  ZERO_TASK_QUEUE_STATS,
} from "../lib/task-queue";
import { cn } from "../lib/utils";
import { Skeleton } from "./ui/skeleton";

const TASK_QUEUE_QUERY_KEY = ["dispatch-task-queue"] as const;

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
  }).format(value);
}

function useTaskQueueStats() {
  const version = useChangeVersions(["action", "screen-refresh"]);
  return useQuery<TaskQueueStats>({
    queryKey: [...TASK_QUEUE_QUERY_KEY, version],
    queryFn: getDispatchTaskQueueStats,
    placeholderData: (prev) => prev,
    // Queue work can finish outside the action transport, so retain a bounded
    // fallback only here. Idle workspaces back off aggressively; active queues
    // keep the existing monitoring cadence.
    refetchInterval: (query) => {
      const stats = query.state.data;
      return stats && (stats.pending > 0 || stats.processing > 0)
        ? 15_000
        : 300_000;
    },
    staleTime: 5_000,
  });
}

function QueueCell({
  label,
  value,
  danger,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="rounded-md border bg-background px-2 py-2">
      <div
        className={cn(
          "text-lg font-semibold text-foreground",
          danger && "text-destructive",
        )}
      >
        {formatNumber(value)}
      </div>
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

export function TaskQueueHealth() {
  const t = useT();
  const query = useTaskQueueStats();
  const taskQueue = query.data ?? ZERO_TASK_QUEUE_STATS;
  const hasFailure = taskQueue.failed_last_hour > 0;
  const hasBacklog =
    taskQueue.pending > 5 || taskQueue.oldest_pending_age_seconds > 300;
  const oldestAge = formatQueueAgeSeconds(taskQueue.oldest_pending_age_seconds);
  const oldestAgeLabel =
    oldestAge === "none" ? t("dispatch.pages.queueAgeNone") : oldestAge;

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <IconPlayerPlay
            size={16}
            className="shrink-0 text-muted-foreground"
          />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {t("dispatch.pages.deliveryQueue")}
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {hasFailure
                ? t("dispatch.pages.failedLastHour", {
                    count: taskQueue.failed_last_hour,
                  })
                : t("dispatch.pages.processingCount", {
                    count: taskQueue.processing,
                  })}
            </p>
          </div>
        </div>
      </div>

      {query.isLoading && !query.data ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-14 rounded-md" />
          ))}
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <QueueCell
              label={t("dispatch.pages.queued")}
              value={taskQueue.pending}
            />
            <QueueCell
              label={t("dispatch.pages.active")}
              value={taskQueue.processing}
            />
            <QueueCell
              label={t("dispatch.pages.done1h")}
              value={taskQueue.completed_last_hour}
            />
            <QueueCell
              label={t("dispatch.pages.failed1h")}
              value={taskQueue.failed_last_hour}
              danger={hasFailure}
            />
          </div>

          <div
            className={cn(
              "mt-3 rounded-md border px-3 py-2 text-xs",
              hasFailure
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : hasBacklog
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "bg-muted/20 text-muted-foreground",
            )}
          >
            {t("dispatch.pages.oldestQueued", { age: oldestAgeLabel })}
          </div>

          {hasFailure ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{t("dispatch.pages.queueFailureHint")}</span>
            </div>
          ) : null}

          {taskQueue.recent_failures.length > 0 ? (
            <div className="mt-3 divide-y rounded-md border">
              {taskQueue.recent_failures.slice(0, 3).map((failure) => (
                <div key={failure.id} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-foreground">
                      {failure.platform || t("dispatch.pages.unknownPlatform")}
                    </span>
                    <span className="text-muted-foreground">
                      {t("dispatch.pages.attemptsCount", {
                        count: failure.attempts,
                      })}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {failure.error || t("dispatch.pages.noErrorMessage")}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
