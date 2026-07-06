import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import { Card } from "@agent-native/toolkit/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@agent-native/toolkit/ui/table";
import {
  IconAlertTriangle,
  IconChecks,
  IconCircleCheck,
  IconCircleDashed,
  IconClock,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  EmptyActionState,
  LoadingRows,
  MetricCard,
  PageHeader,
} from "@/components/brain/Surface";
import {
  type BrainDistillationQueueStatus,
  type BrainOpsQueueItem,
  type BrainOpsQueueResponse,
  statusLabel,
} from "@/lib/brain";
import { cn } from "@/lib/utils";

const queueStatuses: Array<BrainDistillationQueueStatus | "all"> = [
  "all",
  "queued",
  "processing",
  "failed",
  "done",
];

const queueIssues = [
  { value: "all", labelKey: "ops.allQueueItems" },
  { value: "retryable", labelKey: "ops.retryable" },
  { value: "failed", labelKey: "ops.failed" },
  { value: "stale", labelKey: "ops.staleProcessing" },
] as const;

type QueueIssue = (typeof queueIssues)[number]["value"];

const emptySummary = {
  total: 0,
  queued: 0,
  processing: 0,
  done: 0,
  failed: 0,
  staleProcessing: 0,
  retryable: 0,
};

type BrainOpsQueueSummary = typeof emptySummary;
type BrainOpsQueueItemWithReason = BrainOpsQueueItem & {
  reason?: string | null;
  retryBlockedReason?: string | null;
};
type BrainOpsQueueData = BrainOpsQueueResponse & {
  visibleSummary?: BrainOpsQueueSummary;
  filters?: {
    sourceId?: string | null;
    status?: BrainDistillationQueueStatus | null;
    issue?: QueueIssue;
    limit?: number;
  };
  items?: BrainOpsQueueItemWithReason[];
};
type RetryDistillationResult = {
  queueId: string;
  captureId?: string | null;
  outcome: "retried" | "error";
  retried: boolean;
  error?: string;
};
type RetryDistillationResponse = {
  retried: boolean;
  requested?: number;
  retriedCount?: number;
  errorCount?: number;
  message?: string;
  results?: RetryDistillationResult[];
};
type RetryDistillationRequest = {
  queueId?: string;
  queueIds?: string[];
  retryAllRetryable?: boolean;
  priority?: number;
  limit?: number;
};

export default function OpsRoute() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "all";
  const issue = queueIssueFromParams(params);
  const [selectedQueueIds, setSelectedQueueIds] = useState<Set<string>>(
    () => new Set(),
  );

  const queueQuery = useActionQuery<BrainOpsQueueData>(
    "list-distillation-queue" as any,
    {
      status: status === "all" ? undefined : status,
      issue,
      limit: 100,
    } as any,
    { refetchInterval: 10_000 },
  );
  const retryDistillation = useActionMutation<
    RetryDistillationResponse,
    RetryDistillationRequest
  >("retry-distillation" as any);

  const items = (queueQuery.data?.items ?? []) as BrainOpsQueueItemWithReason[];
  const summary = queueQuery.data?.summary ?? emptySummary;
  const visibleSummary = queueQuery.data?.visibleSummary ?? emptySummary;
  const retryableVisibleIds = useMemo(
    () => items.filter((item) => item.retryable).map((item) => item.id),
    [items],
  );
  const selectedRetryableIds = useMemo(
    () =>
      retryableVisibleIds.filter((queueId) => selectedQueueIds.has(queueId)),
    [retryableVisibleIds, selectedQueueIds],
  );
  const allRetryableSelected =
    retryableVisibleIds.length > 0 &&
    retryableVisibleIds.every((queueId) => selectedQueueIds.has(queueId));

  useEffect(() => {
    setSelectedQueueIds((previous) => {
      const visible = new Set(items.map((item) => item.id));
      const next = new Set(
        Array.from(previous).filter((queueId) => visible.has(queueId)),
      );
      return next.size === previous.size ? previous : next;
    });
  }, [items]);

  function updateStatus(value: string) {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("status");
    else next.set("status", value);
    if (value !== "failed" && issue === "failed") next.delete("issue");
    if (value !== "processing" && issue === "stale") next.delete("issue");
    if (value !== "all" && issue === "retryable") next.delete("issue");
    setParams(next, { replace: true });
  }

  function updateIssue(value: string) {
    const nextIssue = queueIssues.some((option) => option.value === value)
      ? (value as QueueIssue)
      : "all";
    const next = new URLSearchParams(params);
    next.delete("stale");
    if (nextIssue === "all") next.delete("issue");
    else next.set("issue", nextIssue);
    if (nextIssue === "failed") next.set("status", "failed");
    if (nextIssue === "stale") next.set("status", "processing");
    if (nextIssue === "retryable") next.delete("status");
    setParams(next, { replace: true });
  }

  function toggleAllRetryable() {
    setSelectedQueueIds((previous) => {
      const next = new Set(previous);
      if (allRetryableSelected) {
        for (const queueId of retryableVisibleIds) next.delete(queueId);
      } else {
        for (const queueId of retryableVisibleIds) next.add(queueId);
      }
      return next;
    });
  }

  function toggleQueueSelection(queueId: string, checked: boolean) {
    setSelectedQueueIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(queueId);
      else next.delete(queueId);
      return next;
    });
  }

  async function retryItem(item: BrainOpsQueueItemWithReason) {
    await retryWithToast({ queueId: item.id, priority: retryPriority(item) }, [
      item.id,
    ]);
  }

  async function retrySelected() {
    if (!selectedRetryableIds.length) return;
    await retryWithToast(
      { queueIds: selectedRetryableIds, priority: 10 },
      selectedRetryableIds,
    );
  }

  async function retryAllRetryable() {
    if (!summary.retryable) return;
    await retryWithToast({
      retryAllRetryable: true,
      priority: 10,
      limit: 200,
    });
  }

  async function retryWithToast(
    payload: RetryDistillationRequest,
    selectedIdsToClear: string[] = [],
  ) {
    try {
      const result = await retryDistillation.mutateAsync(payload);
      const retried = result.retriedCount ?? (result.retried ? 1 : 0);
      const errors = result.errorCount ?? 0;
      if (retried) {
        toast.success(
          t("ops.queuedForRetry", {
            count: retried.toLocaleString(),
            itemLabel: retried === 1 ? t("ops.item") : t("ops.items"),
          }),
        );
      } else {
        toast.message(result.message ?? t("ops.noRetryableFound"));
      }
      if (errors) {
        const firstError = result.results?.find(
          (item) => item.outcome === "error",
        )?.error;
        toast.warning(
          firstError
            ? `${errors.toLocaleString()} retry ${
                errors === 1 ? t("ops.retryError") : t("ops.retryErrors")
              }: ${firstError}`
            : `${errors.toLocaleString()} retry ${
                errors === 1 ? t("ops.retryError") : t("ops.retryErrors")
              }`,
        );
      }
      if (selectedIdsToClear.length) {
        setSelectedQueueIds((previous) => {
          const next = new Set(previous);
          for (const queueId of selectedIdsToClear) next.delete(queueId);
          return next;
        });
      } else if (payload.retryAllRetryable) {
        setSelectedQueueIds(new Set());
      }
      await queueQuery.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("ops.retryFailed"),
      );
    }
  }

  const pendingRetry = retryDistillation.isPending;
  const filteredDetail =
    visibleSummary.total === summary.total
      ? `${summary.total.toLocaleString()} accessible`
      : t("ops.shownOf", {
          shown: visibleSummary.total.toLocaleString(),
          total: summary.total.toLocaleString(),
        });
  const accessibleDetail =
    visibleSummary.total === summary.total
      ? t("ops.accessible", { count: summary.total.toLocaleString() })
      : filteredDetail;

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        eyebrow={t("ops.eyebrow")}
        title={t("ops.title")}
        description={t("ops.description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Select value={status} onValueChange={updateStatus}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder={t("ops.status")} />
              </SelectTrigger>
              <SelectContent>
                {queueStatuses.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === "all"
                      ? t("ops.allStatuses")
                      : statusLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={issue} onValueChange={updateIssue}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder={t("ops.queueIssue")} />
              </SelectTrigger>
              <SelectContent>
                {queueIssues.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={!summary.retryable || pendingRetry}
              onClick={() => void retryAllRetryable()}
            >
              {pendingRetry ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconRefresh className="size-4" />
              )}
              {t("ops.retryAllRetryable")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 p-5 lg:p-7">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label={t("ops.queued")}
            value={summary.queued}
            detail={accessibleDetail}
          />
          <MetricCard
            label={t("ops.processing")}
            value={summary.processing}
            detail={`${summary.staleProcessing.toLocaleString()} ${t("ops.stale")}`}
            tone={summary.staleProcessing ? "warning" : "neutral"}
          />
          <MetricCard
            label={t("ops.failed")}
            value={summary.failed}
            detail={`${summary.retryable.toLocaleString()} ${t("ops.retryable")}`}
            tone={summary.failed ? "danger" : "neutral"}
          />
          <MetricCard
            label={t("ops.done")}
            value={summary.done}
            detail={t("ops.completed")}
          />
          <MetricCard
            label={t("ops.visible")}
            value={visibleSummary.total}
            detail={t("ops.selected", {
              count: selectedRetryableIds.length.toLocaleString(),
            })}
            tone={selectedRetryableIds.length ? "warning" : "good"}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("ops.retryControls")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("ops.retryControlsDetail", {
                visible: visibleSummary.retryable.toLocaleString(),
                total: summary.retryable.toLocaleString(),
              })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!retryableVisibleIds.length || pendingRetry}
              onClick={toggleAllRetryable}
            >
              <IconChecks className="size-4" />
              {allRetryableSelected
                ? t("ops.unselectRetryable")
                : t("ops.selectRetryable")}
            </Button>
            <Button
              size="sm"
              disabled={!selectedRetryableIds.length || pendingRetry}
              onClick={() => void retrySelected()}
            >
              {pendingRetry ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconRefresh className="size-4" />
              )}
              {t("ops.retrySelected")}
            </Button>
            {selectedQueueIds.size ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedQueueIds(new Set())}
              >
                {t("ops.clear")}
              </Button>
            ) : null}
          </div>
        </div>

        {queueQuery.isLoading ? (
          <LoadingRows rows={5} />
        ) : queueQuery.isError ? (
          <EmptyActionState
            title={t("ops.queueUnavailableTitle")}
            detail={t("ops.queueUnavailableDetail")}
          />
        ) : items.length ? (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <span className="sr-only">{t("ops.select")}</span>
                  </TableHead>
                  <TableHead>{t("ops.status")}</TableHead>
                  <TableHead>{t("ops.capture")}</TableHead>
                  <TableHead>{t("ops.source")}</TableHead>
                  <TableHead className="text-end">
                    {t("ops.attempts")}
                  </TableHead>
                  <TableHead>{t("ops.runAfter")}</TableHead>
                  <TableHead>{t("ops.updated")}</TableHead>
                  <TableHead>{t("ops.reason")}</TableHead>
                  <TableHead className="text-end">{t("ops.action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={item.id}
                    data-state={
                      selectedQueueIds.has(item.id) ? "selected" : undefined
                    }
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        className="size-4 rounded border-border accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                        checked={selectedQueueIds.has(item.id)}
                        disabled={!item.retryable || pendingRetry}
                        aria-label={t("ops.selectCapture", {
                          title: item.capture.title,
                        })}
                        onChange={(event) =>
                          toggleQueueSelection(item.id, event.target.checked)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <QueueStatusBadge item={item} />
                        {item.staleProcessing ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          >
                            {t("ops.stale")}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-[260px]">
                      <div className="max-w-md">
                        <p className="truncate font-medium">
                          {item.capture.title}
                        </p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {item.captureId}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-44">
                        <p className="truncate text-sm">{item.source.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.source.provider}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {item.attempts}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(item.runAfter) ?? t("ops.now")}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(item.updatedAt) ?? t("ops.unknown")}
                    </TableCell>
                    <TableCell className="max-w-sm">
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {item.reason ??
                          item.retryBlockedReason ??
                          item.lastError ??
                          t("ops.noIssueRecorded")}
                      </p>
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!item.retryable || pendingRetry}
                        onClick={() => void retryItem(item)}
                      >
                        {pendingRetry ? (
                          <IconLoader2 className="size-4 animate-spin" />
                        ) : (
                          <IconRefresh className="size-4" />
                        )}
                        {t("ops.retry")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ) : (
          <EmptyActionState
            title={t("ops.noItemsTitle")}
            detail={t("ops.noItemsDetail")}
          />
        )}

        {retryDistillation.isError ? (
          <EmptyActionState
            title={t("ops.retryFailed")}
            detail={t("ops.retryFailedDetail")}
          />
        ) : null}
      </div>
    </div>
  );
}

function queueIssueFromParams(params: URLSearchParams): QueueIssue {
  const value = params.get("issue");
  if (queueIssues.some((option) => option.value === value)) {
    return value as QueueIssue;
  }
  return params.get("stale") === "true" ? "stale" : "all";
}

function retryPriority(item: BrainOpsQueueItemWithReason) {
  return Math.min(item.priority ?? 50, 10);
}

function QueueStatusBadge({ item }: { item: BrainOpsQueueItem }) {
  const Icon =
    item.status === "done"
      ? IconCircleCheck
      : item.status === "failed"
        ? IconAlertTriangle
        : item.status === "processing"
          ? IconClock
          : IconCircleDashed;

  return (
    <Badge
      variant={item.status === "failed" ? "destructive" : "outline"}
      className={cn(
        "gap-1.5 capitalize",
        item.status === "done" &&
          "border-border bg-secondary text-secondary-foreground",
        item.status === "processing" &&
          "border-border bg-accent text-accent-foreground",
        item.status === "queued" &&
          "border-border bg-muted/35 text-muted-foreground",
      )}
    >
      <Icon className="size-3" />
      {item.status}
    </Badge>
  );
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
