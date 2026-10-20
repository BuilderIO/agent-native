import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useLocale } from "@agent-native/core/client/i18n";
import {
  IconAlertCircle,
  IconClockPause,
  IconDotsVertical,
  IconLoader2,
  IconPlus,
  IconSitemap,
  IconTrash,
  IconUserExclamation,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useWorkflowCanvasStrings } from "@/components/workflow-canvas";
import { factoryWorkflowUrl } from "@/lib/factory-tab-params";
import { cn } from "@/lib/utils";

import { NewWorkflowDialog } from "./NewWorkflowDialog";
import { RunStatusChip } from "./RunStatusChip";
import { isUnknownActionError, readActionFailure } from "./workflow-errors";
import {
  anyRunInFlight,
  buildWorkflowRows,
  formatItemCount,
  parkedRefusal,
  scheduleLabel,
  withoutWorkflow,
  type ItemCount,
  type WorkflowListRow,
} from "./workflow-list-model";
import { useWorkflowStrings } from "./workflow-strings";
import { formatRelativeTime } from "./workflow-time";
import type {
  DeleteWorkflowResult,
  ListItemsResult,
  ListRunsResult,
  ListWorkflowsResult,
  RunWorkflowResult,
  SetEnabledResult,
} from "./workflow-types";

const PAGE = 100;
const WATCH_INTERVAL_MS = 3_000;
const CLOCK_INTERVAL_MS = 30_000;

interface DeleteTarget {
  row: WorkflowListRow;
  /** Items the dialog shows as waiting; only a count the person has seen passes `force`. */
  parked: ItemCount | null;
}

/** The current time, refreshed so "2 min. ago" does not go stale on a page left open. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

interface WorkflowsViewProps {
  factoryId: string;
}

export function WorkflowsView({ factoryId }: WorkflowsViewProps) {
  const ws = useWorkflowStrings();

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const now = useNow(CLOCK_INTERVAL_MS);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [needsTest, setNeedsTest] = useState<ReadonlySet<string>>(new Set());
  const [togglePending, setTogglePending] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const workflowsParams = { factoryId, limit: PAGE };
  const watching = (query: { state: { data: unknown } }) =>
    anyRunInFlight(query.state.data as ListRunsResult | undefined)
      ? WATCH_INTERVAL_MS
      : false;
  const runsQuery = useActionQuery<ListRunsResult>(
    "list-factory-workflow-runs",
    { factoryId, limit: PAGE },
    { refetchInterval: watching },
  );
  const runsInFlight = anyRunInFlight(runsQuery.data);
  const workflowsQuery = useActionQuery<ListWorkflowsResult>(
    "list-factory-workflows",
    workflowsParams,
    { refetchInterval: runsInFlight ? WATCH_INTERVAL_MS : false },
  );
  const parkedQuery = useActionQuery<ListItemsResult>("list-workflow-items", {
    factoryId,
    parked: true,
    limit: PAGE,
  });
  const needsYouQuery = useActionQuery<ListItemsResult>("list-workflow-items", {
    factoryId,
    needsYou: true,
    limit: PAGE,
  });

  const rows = useMemo(
    () =>
      buildWorkflowRows({
        workflows: workflowsQuery.data,
        runs: runsQuery.data,
        parked: parkedQuery.data,
        needsYou: needsYouQuery.data,
        runsFailed: runsQuery.isError,
      }),
    [
      workflowsQuery.data,
      runsQuery.data,
      runsQuery.isError,
      parkedQuery.data,
      needsYouQuery.data,
    ],
  );
  const itemsFailed = parkedQuery.isError || needsYouQuery.isError;

  const setEnabled = useActionMutation<
    SetEnabledResult,
    { factoryId: string; workflowId: string; enabled: boolean }
  >("set-factory-workflow-enabled", { skipActionQueryInvalidation: true });
  const runTest = useActionMutation<
    RunWorkflowResult,
    { factoryId: string; workflowId: string; mode: "dry" }
  >("run-factory-workflow");
  const deleteWorkflow = useActionMutation<
    DeleteWorkflowResult,
    { factoryId: string; workflowId: string; force: boolean }
  >("delete-factory-workflow");

  function askDelete(row: WorkflowListRow) {
    setDeleting({
      row,
      parked: row.itemsKnown && row.parked.count > 0 ? row.parked : null,
    });
  }

  function confirmDelete({ row, parked }: DeleteTarget) {
    const id = row.workflow.id;
    const key = ["action", "list-factory-workflows", workflowsParams];
    void queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData<ListWorkflowsResult>(key);
    queryClient.setQueryData<ListWorkflowsResult>(key, (current) =>
      current ? withoutWorkflow(current, id) : current,
    );
    setDeleting(null);
    deleteWorkflow.mutate(
      { factoryId, workflowId: id, force: parked !== null },
      {
        onError: (error) => {
          queryClient.setQueryData(key, previous);
          const failure = readActionFailure(error, ws.errors.unknown);
          const refused = parkedRefusal(failure);
          if (refused) {
            // Items the list did not know about: ask again with the real count.
            setDeleting({ row, parked: refused });
            return;
          }
          toast.error(ws.list.deleteFailed(failure.message));
        },
      },
    );
  }

  function toggle(row: WorkflowListRow, enabled: boolean) {
    const id = row.workflow.id;
    const key = ["action", "list-factory-workflows", workflowsParams];
    const previous = queryClient.getQueryData<ListWorkflowsResult>(key);
    queryClient.setQueryData<ListWorkflowsResult>(key, (current) =>
      current
        ? {
            ...current,
            workflows: current.workflows.map((workflow) =>
              workflow.id === id ? { ...workflow, enabled } : workflow,
            ),
          }
        : current,
    );
    setNeedsTest((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setTogglePending((current) => new Set(current).add(id));
    setEnabled.mutate(
      { factoryId, workflowId: id, enabled },
      {
        onError: (error) => {
          // Roll the switch back first; what to say about it comes after.
          queryClient.setQueryData(key, previous);
          const failure = readActionFailure(error, ws.errors.unknown);
          if (failure.errorCode === "dry_run_required") {
            setNeedsTest((current) => new Set(current).add(id));
            return;
          }
          toast.error(ws.run.enableFailed(failure.message));
        },
        onSettled: () => {
          setTogglePending((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-factory-workflows"],
          });
        },
      },
    );
  }

  function startTest(workflowId: string) {
    runTest.mutate(
      { factoryId, workflowId, mode: "dry" },
      {
        onSuccess: (result) =>
          navigate(
            factoryWorkflowUrl(factoryId, { workflowId, runId: result.runId }),
          ),
        onError: (error) => {
          const failure = readActionFailure(error, ws.errors.unknown);
          toast.error(
            isUnknownActionError(failure)
              ? ws.run.unavailable
              : ws.run.failed(failure.message),
          );
        },
      },
    );
  }

  const loading = workflowsQuery.isLoading;
  const failed = workflowsQuery.isError && !workflowsQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-4 lg:p-6">
      {loading || rows.length > 0 ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            <IconPlus />
            {ws.list.newWorkflow}
          </Button>
        </div>
      ) : null}

      {failed ? (
        <div className="flex items-center gap-2 rounded-lg border border-border p-4 text-sm text-destructive">
          <IconAlertCircle className="size-4 shrink-0" />
          <span>{ws.list.loadFailed}</span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() => void workflowsQuery.refetch()}
          >
            {ws.list.retry}
          </Button>
        </div>
      ) : loading ? (
        <WorkflowRowsSkeleton />
      ) : rows.length === 0 ? (
        <Empty className="border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconSitemap />
            </EmptyMedia>
            <EmptyTitle>{ws.list.noWorkflows}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" size="sm" onClick={() => setCreating(true)}>
              <IconPlus />
              {ws.list.newWorkflow}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ul
          aria-label={ws.list.listName}
          className="overflow-hidden rounded-xl border border-border bg-card"
        >
          {rows.map((row) => (
            <WorkflowRow
              key={row.workflow.id}
              factoryId={factoryId}
              row={row}
              now={now}
              itemsFailed={itemsFailed}
              needsTest={needsTest.has(row.workflow.id)}
              togglePending={togglePending.has(row.workflow.id)}
              testPending={
                runTest.isPending &&
                runTest.variables?.workflowId === row.workflow.id
              }
              onToggle={(enabled) => toggle(row, enabled)}
              onRunTest={() => startTest(row.workflow.id)}
              onDelete={() => askDelete(row)}
            />
          ))}
        </ul>
      )}

      <NewWorkflowDialog
        factoryId={factoryId}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(workflowId) =>
          navigate(factoryWorkflowUrl(factoryId, { workflowId }))
        }
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleting
                ? ws.list.deleteTitle(deleting.row.workflow.name)
                : null}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? [
                    ws.list.deleteBody,
                    deleting.parked
                      ? ws.list.deleteParked(formatItemCount(deleting.parked))
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" ")
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ws.list.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleting) confirmDelete(deleting);
              }}
            >
              {deleting?.parked ? ws.list.deleteAnyway : ws.list.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function WorkflowRowsSkeleton() {
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="grid items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 first:border-t-0 md:grid-cols-[minmax(0,2fr)_2.5rem_minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1.4fr)_2rem]"
        >
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-[1.15rem] w-8 rounded-full" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </div>
  );
}

function WorkflowRow({
  factoryId,
  row,
  now,
  itemsFailed,
  needsTest,
  togglePending,
  testPending,
  onToggle,
  onRunTest,
  onDelete,
}: {
  factoryId: string;
  row: WorkflowListRow;
  now: number;
  itemsFailed: boolean;
  needsTest: boolean;
  togglePending: boolean;
  testPending: boolean;
  onToggle: (enabled: boolean) => void;
  onRunTest: () => void;
  onDelete: () => void;
}) {
  const ws = useWorkflowStrings();
  const canvasStrings = useWorkflowCanvasStrings();
  const { locale } = useLocale();

  const { workflow } = row;
  const schedule =
    scheduleLabel(row.schedule, canvasStrings, ws) ?? ws.list.noSchedule;
  // A next run already in the past is an overdue job, not something to announce.
  const nextAt = workflow.job.nextRun ? Date.parse(workflow.job.nextRun) : NaN;
  const next =
    workflow.enabled && nextAt >= now
      ? formatRelativeTime(nextAt, now, locale)
      : null;

  return (
    <li
      className={cn(
        "relative grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 first:border-t-0 hover:bg-accent/30 md:grid-cols-[minmax(0,2fr)_2.5rem_minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1.4fr)_2rem]",
        row.attention === "failed" && "bg-destructive/5",
      )}
    >
      <div className="min-w-0">
        <Link
          to={factoryWorkflowUrl(factoryId, { workflowId: workflow.id })}
          aria-label={ws.list.openWorkflow(workflow.name)}
          className="block truncate text-sm font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
        >
          {workflow.name}
        </Link>
      </div>

      <div className="relative z-10 flex items-center">
        <Switch
          checked={workflow.enabled}
          disabled={togglePending}
          aria-label={
            workflow.enabled
              ? ws.list.turnOff(workflow.name)
              : ws.list.turnOn(workflow.name)
          }
          onCheckedChange={onToggle}
        />
      </div>

      <div className="col-span-full min-w-0 text-sm text-muted-foreground md:col-span-1">
        <div className="truncate">{schedule}</div>
        {next ? (
          <div className="truncate text-xs">{ws.list.nextRun(next)}</div>
        ) : null}
      </div>

      <div className="col-span-full min-w-0 md:col-span-1">
        <LastRunCell row={row} now={now} />
      </div>

      <div className="col-span-full flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm empty:hidden md:col-span-1">
        {!row.itemsKnown ? (
          itemsFailed ? (
            <span className="text-destructive">{ws.list.countsFailed}</span>
          ) : (
            <Skeleton className="h-4 w-24" />
          )
        ) : null}
        {row.parked.count > 0 ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <IconClockPause className="size-4" aria-hidden />
            {ws.list.waiting(formatItemCount(row.parked))}
          </span>
        ) : null}
        {row.needsYou.count > 0 ? (
          <span className="inline-flex items-center gap-1 font-medium text-destructive">
            <IconUserExclamation className="size-4" aria-hidden />
            {ws.list.needsYou(formatItemCount(row.needsYou))}
          </span>
        ) : null}
      </div>

      <div className="relative z-10 flex items-center justify-end max-md:col-start-3 max-md:row-start-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={ws.list.rowActions(workflow.name)}
              className="text-muted-foreground hover:text-foreground"
            >
              <IconDotsVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={onDelete}
            >
              <IconTrash />
              {ws.list.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {needsTest ? (
        <div className="relative z-10 col-span-full flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{ws.list.dryRunRequired}</span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={testPending}
            onClick={onRunTest}
          >
            {testPending ? <IconLoader2 className="animate-spin" /> : null}
            {ws.list.runTest}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function LastRunCell({ row, now }: { row: WorkflowListRow; now: number }) {
  const ws = useWorkflowStrings();
  const { locale } = useLocale();

  if (!row.lastRun.known) {
    if (row.lastRun.why === "pending") return <Skeleton className="h-5 w-32" />;
    return (
      <div
        className={cn(
          "text-sm",
          row.lastRun.why === "failed"
            ? "text-destructive"
            : "text-muted-foreground",
        )}
      >
        {row.lastRun.why === "failed" ? ws.list.runsFailed : ws.list.olderRun}
      </div>
    );
  }
  const { run } = row.lastRun;
  if (!run) {
    return (
      <div className="text-sm text-muted-foreground">{ws.list.neverRun}</div>
    );
  }
  const when = formatRelativeTime(run.finishedAt ?? run.startedAt, now, locale);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <RunStatusChip status={run.status} triggerKind={run.triggerKind} />
      {when ? (
        <span className="text-sm text-muted-foreground">{when}</span>
      ) : null}
      {run.status === "failed" && run.error ? (
        <span className="min-w-0 basis-full truncate text-xs text-destructive">
          {run.error.message}
        </span>
      ) : null}
    </div>
  );
}
