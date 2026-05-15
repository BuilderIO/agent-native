import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleDashed,
  IconClock,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import {
  type BrainDistillationQueueStatus,
  type BrainOpsQueueItem,
  type BrainOpsQueueResponse,
  type RetryDistillationResponse,
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

const emptySummary = {
  total: 0,
  queued: 0,
  processing: 0,
  done: 0,
  failed: 0,
  staleProcessing: 0,
  retryable: 0,
};

export default function OpsRoute() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "all";
  const staleOnly = params.get("stale") === "true";

  const queueQuery = useActionQuery<BrainOpsQueueResponse>(
    "list-distillation-queue" as any,
    {
      status: status === "all" ? undefined : status,
      staleOnly,
      limit: 100,
    } as any,
    { refetchInterval: 10_000 },
  );
  const retryDistillation = useActionMutation<
    RetryDistillationResponse,
    { queueId: string; priority?: number }
  >("retry-distillation" as any);

  const items = queueQuery.data?.items ?? [];
  const summary = queueQuery.data?.summary ?? emptySummary;
  const visibleItems = useMemo(
    () => (staleOnly ? items.filter((item) => item.staleProcessing) : items),
    [items, staleOnly],
  );

  function updateStatus(value: string) {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("status");
    else next.set("status", value);
    if (value !== "processing") next.delete("stale");
    setParams(next, { replace: true });
  }

  function toggleStaleOnly() {
    const next = new URLSearchParams(params);
    if (staleOnly) next.delete("stale");
    else {
      next.set("stale", "true");
      next.set("status", "processing");
    }
    setParams(next, { replace: true });
  }

  function retry(item: BrainOpsQueueItem) {
    retryDistillation.mutate({
      queueId: item.id,
      priority: Math.min(item.priority ?? 50, 10),
    });
  }

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
            <Button
              size="sm"
              variant={staleOnly ? "secondary" : "outline"}
              onClick={toggleStaleOnly}
            >
              <IconAlertTriangle className="size-4" />
              Stale only
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 p-5 lg:p-7">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Queued"
            value={summary.queued}
            detail={`${summary.total} visible items`}
          />
          <MetricCard
            label="Processing"
            value={summary.processing}
            detail={`${summary.staleProcessing} stale`}
            tone={summary.staleProcessing ? "warning" : "neutral"}
          />
          <MetricCard
            label="Failed"
            value={summary.failed}
            detail={`${summary.retryable} retryable`}
            tone={summary.failed ? "danger" : "neutral"}
          />
          <MetricCard label="Done" value={summary.done} detail="Completed" />
          <MetricCard
            label="Retryable"
            value={summary.retryable}
            detail="Failed or stale"
            tone={summary.retryable ? "warning" : "good"}
          />
        </div>

        {queueQuery.isLoading ? (
          <LoadingRows rows={5} />
        ) : queueQuery.isError ? (
          <EmptyActionState
            title="Queue unavailable"
            detail="Brain could not load accessible distillation queue items."
          />
        ) : visibleItems.length ? (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Capture</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead>Run after</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleItems.map((item) => (
                  <TableRow key={item.id}>
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
                    <TableCell className="text-right tabular-nums">
                      {item.attempts}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(item.runAfter) ?? "Now"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(item.updatedAt) ?? "Unknown"}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      {item.lastError ? (
                        <p className="truncate text-sm text-muted-foreground">
                          {item.lastError}
                        </p>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          None
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          !item.retryable || retryDistillation.isPending
                        }
                        onClick={() => retry(item)}
                      >
                        {retryDistillation.isPending ? (
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
            detail="Change the status filter or wait for new captures to enter distillation."
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
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        item.status === "processing" &&
          "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
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
