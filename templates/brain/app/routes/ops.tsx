import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconAlertTriangle,
  IconChecks,
  IconCircleCheck,
  IconCircleDashed,
  IconClock,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  type BrainDistillationQueueStatus,
  type BrainOpsQueueItem,
  type BrainOpsQueueResponse,
  statusLabel,
} from "@/lib/brain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyActionState,
  LoadingRows,
  MetricCard,
  PageHeader,
} from "@/components/brain/Surface";
import { cn } from "@/lib/utils";

const queueStatuses: Array<BrainDistillationQueueStatus | "all"> = [
  "all",
  "queued",
  "processing",
  "failed",
  "done",
];

const queueIssues = [
  { value: "all", label: "All queue items" },
  { value: "retryable", label: "Retryable" },
  { value: "failed", label: "Failed" },
  { value: "stale", label: "Stale processing" },
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
          `${retried.toLocaleString()} distillation ${
            retried === 1 ? "item" : "items"
          } queued for retry`,
        );
      } else {
        toast.message(
          result.message ?? "No retryable distillation items found",
        );
      }
      if (errors) {
        const firstError = result.results?.find(
          (item) => item.outcome === "error",
        )?.error;
        toast.warning(
          firstError
            ? `${errors.toLocaleString()} retry ${
                errors === 1 ? "error" : "errors"
              }: ${firstError}`
            : `${errors.toLocaleString()} retry ${
                errors === 1 ? "error" : "errors"
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
      toast.error(error instanceof Error ? error.message : "Retry failed");
    }
  }

  const pendingRetry = retryDistillation.isPending;
  const filteredDetail =
    visibleSummary.total === summary.total
      ? `${summary.total.toLocaleString()} accessible`
      : `${visibleSummary.total.toLocaleString()} shown of ${summary.total.toLocaleString()}`;

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        eyebrow="Ops"
        title="Distillation operations"
        description="Monitor Brain distillation handoffs, stale workers, and retryable failures from one compact queue view."
        actions={
          <div className="flex flex-wrap gap-2">
            <Select value={status} onValueChange={updateStatus}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {queueStatuses.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === "all" ? "All statuses" : statusLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={issue} onValueChange={updateIssue}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Queue issue" />
              </SelectTrigger>
              <SelectContent>
                {queueIssues.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
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
              Retry all retryable
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 p-5 lg:p-7">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Queued"
            value={summary.queued}
            detail={filteredDetail}
          />
          <MetricCard
            label="Processing"
            value={summary.processing}
            detail={`${summary.staleProcessing.toLocaleString()} stale`}
            tone={summary.staleProcessing ? "warning" : "neutral"}
          />
          <MetricCard
            label="Failed"
            value={summary.failed}
            detail={`${summary.retryable.toLocaleString()} retryable`}
            tone={summary.failed ? "danger" : "neutral"}
          />
          <MetricCard label="Done" value={summary.done} detail="Completed" />
          <MetricCard
            label="Visible"
            value={visibleSummary.total}
            detail={`${selectedRetryableIds.length.toLocaleString()} selected`}
            tone={selectedRetryableIds.length ? "warning" : "good"}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Retry controls</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {visibleSummary.retryable.toLocaleString()} retryable in this
              view, {summary.retryable.toLocaleString()} across accessible
              queues.
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
              {allRetryableSelected ? "Unselect retryable" : "Select retryable"}
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
              Retry selected
            </Button>
            {selectedQueueIds.size ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedQueueIds(new Set())}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        {queueQuery.isLoading ? (
          <LoadingRows rows={5} />
        ) : queueQuery.isError ? (
          <EmptyActionState
            title="Queue unavailable"
            detail="Brain could not load accessible distillation queue items."
          />
        ) : items.length ? (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <span className="sr-only">Select</span>
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Capture</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-end">Attempts</TableHead>
                  <TableHead>Run after</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-end">Action</TableHead>
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
                        aria-label={`Select ${item.capture.title}`}
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
                            stale
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
                      {formatDate(item.runAfter) ?? "Now"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(item.updatedAt) ?? "Unknown"}
                    </TableCell>
                    <TableCell className="max-w-sm">
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {item.reason ??
                          item.retryBlockedReason ??
                          item.lastError ??
                          "No issue recorded"}
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
                        Retry
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ) : (
          <EmptyActionState
            title="No queue items match this view"
            detail="Change the status or issue filter, or wait for new captures to enter distillation."
          />
        )}

        {retryDistillation.isError ? (
          <EmptyActionState
            title="Retry failed"
            detail="The queue item may already be done, active, or no longer accessible."
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
