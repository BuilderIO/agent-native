import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useLocale } from "@agent-native/core/client/i18n";
import {
  IconAlertCircle,
  IconArrowRight,
  IconClockPause,
  IconCopy,
  IconDotsVertical,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSitemap,
  IconTrash,
  IconUserExclamation,
  IconX,
} from "@tabler/icons-react";
import {
  type QueryClient,
  type QueryFilters,
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useWorkflowCanvasStrings } from "@/components/workflow-canvas";
import { factoryWorkflowUrl } from "@/lib/factory-tab-params";
import { cn } from "@/lib/utils";

import { useItemsStrings } from "./items-strings";
import { classifyReadError } from "./items/read-failure";
import { ReadErrorState } from "./items/read-support";
import { NewWorkflowDialog } from "./NewWorkflowDialog";
import { RunStatusChip } from "./RunStatusChip";
import { isUnknownActionError, readActionFailure } from "./workflow-errors";
import {
  WORKFLOW_NAME_MAX_LENGTH,
  anyRunInFlight,
  arrangeWorkflowRows,
  buildWorkflowRows,
  canSaveRename,
  chainWorkflowPages,
  copyWorkflowName,
  formatItemCount,
  joinWorkflowPages,
  parkedRefusal,
  scheduleLabel,
  withRenamedWorkflow,
  withoutWorkflow,
  withWorkflowEnabled,
  workflowListStats,
  type ItemCount,
  type StatValue,
  type WorkflowListRow,
  type WorkflowListStats,
  type WorkflowPageRead,
  type WorkflowSort,
  type WorkflowStatusFilter,
} from "./workflow-list-model";
import { useWorkflowStrings, type WorkflowStrings } from "./workflow-strings";
import { formatRelativeTime } from "./workflow-time";
import type {
  DeleteWorkflowResult,
  GetWorkflowResult,
  ListItemsResult,
  ListRunsResult,
  ListWorkflowsResult,
  RenameWorkflowResult,
  RunWorkflowResult,
  SaveWorkflowResult,
  SetEnabledResult,
  WorkflowSummaryRow,
} from "./workflow-types";

const PAGE = 100;
const WATCH_INTERVAL_MS = 3_000;
const CLOCK_INTERVAL_MS = 30_000;
const SEARCH_DEBOUNCE_MS = 300;
const SORTS: readonly WorkflowSort[] = ["attention", "updated", "name"];
const STATUSES: readonly WorkflowStatusFilter[] = ["all", "on", "off"];

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

/** A value that follows its source once the source has been still for `delayMs`. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/** The option a control reported, or null when it is not one the control was built from. */
function oneOf<T extends string>(
  options: readonly T[],
  value: string,
): T | null {
  return options.find((option) => option === value) ?? null;
}

/** Every cached read of this factory's workflow list: the first page and each later one, whatever its cursor. */
function factoryListFilter(factoryId: string): QueryFilters {
  return {
    queryKey: ["action", "list-factory-workflows"],
    predicate: (query) => {
      const params = query.queryKey[2];
      return (
        typeof params === "object" &&
        params !== null &&
        "factoryId" in params &&
        params.factoryId === factoryId
      );
    },
  };
}

/** Puts back the list reads an optimistic change took a copy of, when that change failed. */
function restoreListReads(
  queryClient: QueryClient,
  reads: ReadonlyArray<readonly [QueryKey, ListWorkflowsResult | undefined]>,
): void {
  for (const [key, data] of reads) queryClient.setQueryData(key, data);
}

/** Whether a page read already says what the state holds, so the state is left as it is. */
function sameRead(a: WorkflowPageRead, b: WorkflowPageRead): boolean {
  if (a.state === "failed" || b.state === "failed") return a.state === b.state;
  return a.page === b.page;
}

interface WorkflowsViewProps {
  factoryId: string;
}

export function WorkflowsView({ factoryId }: WorkflowsViewProps) {
  const ws = useWorkflowStrings();
  const itemsStrings = useItemsStrings();
  const { locale } = useLocale();

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const now = useNow(CLOCK_INTERVAL_MS);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [renaming, setRenaming] = useState<WorkflowSummaryRow | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [needsTest, setNeedsTest] = useState<ReadonlySet<string>>(new Set());
  const [togglePending, setTogglePending] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [searchText, setSearchText] = useState("");
  const [sort, setSort] = useState<WorkflowSort>("attention");
  const [status, setStatus] = useState<WorkflowStatusFilter>("all");
  const query = useDebounced(searchText, SEARCH_DEBOUNCE_MS);
  // How many pages after the first the viewer has opened, and what each read of those pages returned.
  const [laterPageCount, setLaterPageCount] = useState(0);
  const [laterReads, setLaterReads] = useState<
    Record<string, WorkflowPageRead | undefined>
  >({});
  const readLater = useCallback(
    (cursor: string, read: WorkflowPageRead | null) =>
      setLaterReads((previous) => {
        const current = previous[cursor];
        if (read === null) {
          if (current === undefined) return previous;
          const { [cursor]: _gone, ...rest } = previous;
          return rest;
        }
        return current !== undefined && sameRead(current, read)
          ? previous
          : { ...previous, [cursor]: read };
      }),
    [],
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

  const chain = useMemo(
    () =>
      chainWorkflowPages({
        first: workflowsQuery.data,
        extra: laterPageCount,
        reads: laterReads,
      }),
    [workflowsQuery.data, laterPageCount, laterReads],
  );
  const loaded = useMemo(() => joinWorkflowPages(chain.pages), [chain.pages]);
  const rows = useMemo(
    () =>
      buildWorkflowRows({
        workflows: loaded,
        runs: runsQuery.data,
        parked: parkedQuery.data,
        needsYou: needsYouQuery.data,
        runsFailed: runsQuery.isError,
      }),
    [
      loaded,
      runsQuery.data,
      runsQuery.isError,
      parkedQuery.data,
      needsYouQuery.data,
    ],
  );
  const itemsFailed = parkedQuery.isError || needsYouQuery.isError;
  // Some workflows are unloaded while a page still follows, and when a list says more without a cursor.
  const unloadedWorkflows = chain.nextCursor !== null || chain.dangling;
  const stats = useMemo(
    () => workflowListStats({ rows, unloadedWorkflows, itemsFailed }),
    [rows, unloadedWorkflows, itemsFailed],
  );
  const shownRows = useMemo(
    () => arrangeWorkflowRows(rows, { query, status, sort }, locale),
    [rows, query, status, sort, locale],
  );

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
  const renameMutation = useActionMutation<
    RenameWorkflowResult,
    { factoryId: string; workflowId: string; name: string }
  >("rename-factory-workflow");
  const duplicate = useMutation<
    { name: string; saved: SaveWorkflowResult },
    Error,
    WorkflowSummaryRow
  >({
    mutationFn: async (workflow) => {
      const read = await callAction<GetWorkflowResult>(
        "get-factory-workflow",
        { factoryId, workflowId: workflow.id },
        { method: "GET" },
      );
      const name = copyWorkflowName(workflow.name, ws.list.copyName);
      const saved = await callAction<SaveWorkflowResult>(
        "save-factory-workflow",
        { factoryId, name, graph: read.graph },
      );
      return { name, saved };
    },
    onSuccess: ({ name }) => toast.success(ws.list.duplicated(name)),
    onError: (error) => {
      const failure = readActionFailure(error, ws.errors.unknown);
      toast.error(ws.list.duplicateFailed(failure.message));
    },
    onSettled: () => {
      // A failed copy may still have been saved, so the list is read again either way.
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-factory-workflows"],
      });
    },
  });

  function askDelete(row: WorkflowListRow) {
    setDeleting({
      row,
      parked: row.itemsKnown && row.parked.count > 0 ? row.parked : null,
    });
  }

  function confirmDelete({ row, parked }: DeleteTarget) {
    const id = row.workflow.id;
    const filter = factoryListFilter(factoryId);
    void queryClient.cancelQueries(filter);
    const previous = queryClient.getQueriesData<ListWorkflowsResult>(filter);
    queryClient.setQueriesData<ListWorkflowsResult>(filter, (current) =>
      current ? withoutWorkflow(current, id) : current,
    );
    setDeleting(null);
    deleteWorkflow.mutate(
      { factoryId, workflowId: id, force: parked !== null },
      {
        onError: (error) => {
          restoreListReads(queryClient, previous);
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
    const filter = factoryListFilter(factoryId);
    const previous = queryClient.getQueriesData<ListWorkflowsResult>(filter);
    queryClient.setQueriesData<ListWorkflowsResult>(filter, (current) =>
      current ? withWorkflowEnabled(current, id, enabled) : current,
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
          restoreListReads(queryClient, previous);
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

  function renameTo(workflow: WorkflowSummaryRow, name: string) {
    const id = workflow.id;
    const filter = factoryListFilter(factoryId);
    void queryClient.cancelQueries(filter);
    queryClient.setQueriesData<ListWorkflowsResult>(filter, (current) =>
      current ? withRenamedWorkflow(current, id, name) : current,
    );
    renameMutation.mutate(
      { factoryId, workflowId: id, name },
      {
        onError: (error) => {
          const failure = readActionFailure(error, ws.errors.unknown);
          if (failure.errorCode === "job_sync_failed") {
            // The rename itself landed; only the schedule's copy of the name did not follow.
            toast.error(ws.list.renamedJobFailed);
          } else {
            // Nothing landed, or the outcome is unknown: put the old name back and read the list again.
            queryClient.setQueriesData<ListWorkflowsResult>(filter, (current) =>
              current
                ? withRenamedWorkflow(current, id, workflow.name)
                : current,
            );
            toast.error(ws.list.renameFailed(failure.message));
          }
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-factory-workflows"],
          });
        },
      },
    );
  }

  const loading = workflowsQuery.isLoading;
  const failed = workflowsQuery.isError && !workflowsQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {ws.list.pageTitle}
          </h1>
          <p className="text-sm text-muted-foreground">
            {ws.list.pageSubtitle}
          </p>
        </div>
        {loading || rows.length > 0 ? (
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            <IconPlus />
            {ws.list.newWorkflow}
          </Button>
        ) : null}
      </div>

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
      ) : rows.length === 0 && !loading ? (
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
        <>
          <WorkflowStats ws={ws} stats={loading ? null : stats} />
          <WorkflowListControls
            ws={ws}
            searchText={searchText}
            onSearchText={setSearchText}
            sort={sort}
            onSort={setSort}
            status={status}
            onStatus={setStatus}
          />
          {loading ? (
            <WorkflowRowsSkeleton />
          ) : shownRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {ws.list.noMatches}
            </p>
          ) : (
            <ul
              aria-label={ws.list.listName}
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              {shownRows.map((row) => (
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
                  duplicatePending={
                    duplicate.isPending &&
                    duplicate.variables?.id === row.workflow.id
                  }
                  onToggle={(enabled) => toggle(row, enabled)}
                  onRunTest={() => startTest(row.workflow.id)}
                  onRename={() => {
                    setRenaming(row.workflow);
                    setRenameOpen(true);
                  }}
                  onDuplicate={() => duplicate.mutate(row.workflow)}
                  onDelete={() => askDelete(row)}
                />
              ))}
            </ul>
          )}
          {chain.active.map((cursor) => (
            <LaterWorkflowPage
              key={cursor}
              factoryId={factoryId}
              cursor={cursor}
              onRead={readLater}
              onStartOver={() => setLaterPageCount(0)}
            />
          ))}
          {chain.dangling ? (
            <ReadErrorState
              failure={{
                kind: "generic",
                code: null,
                status: null,
                message: itemsStrings.error.dangling,
              }}
              className="my-3"
            />
          ) : null}
          {chain.nextCursor !== null && !chain.failed ? (
            <div className="flex justify-center py-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={chain.fetching}
                onClick={() => setLaterPageCount((count) => count + 1)}
              >
                {chain.fetching ? (
                  <IconLoader2 className="animate-spin" />
                ) : null}
                {ws.list.loadMore}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <NewWorkflowDialog
        factoryId={factoryId}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(workflowId) =>
          navigate(factoryWorkflowUrl(factoryId, { workflowId }))
        }
      />

      <RenameWorkflowDialog
        workflow={renaming}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        onRename={(workflow, name) => {
          setRenameOpen(false);
          renameTo(workflow, name);
        }}
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

/** The four figures over the loaded workflows. A null `stats` is still loading, and its figures show skeletons. */
function WorkflowStats({
  ws,
  stats,
}: {
  ws: WorkflowStrings;
  stats: WorkflowListStats | null;
}) {
  const pending = <Skeleton className="h-7 w-12" />;
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
      <StatCell label={ws.stats.on}>
        {stats
          ? ws.stats.onOfTotal(
              formatItemCount(stats.on),
              formatItemCount(stats.total),
            )
          : pending}
      </StatCell>
      <StatCell label={ws.stats.needsYou}>
        {stats ? (
          <StatFigure
            value={stats.needsYou}
            unknown={ws.list.countsFailed}
            attention
          />
        ) : (
          pending
        )}
      </StatCell>
      <StatCell label={ws.stats.waiting}>
        {stats ? (
          <StatFigure value={stats.waiting} unknown={ws.list.countsFailed} />
        ) : (
          pending
        )}
      </StatCell>
      <StatCell label={ws.stats.failing}>
        {stats ? (
          <StatFigure
            value={stats.failing}
            unknown={ws.list.runsFailed}
            attention
          />
        ) : (
          pending
        )}
      </StatCell>
    </dl>
  );
}

function StatCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card p-4">
      <dt className="truncate text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/** One figure: its count (a plus for a floor), or a dash whose read failed, named for screen readers. */
function StatFigure({
  value,
  unknown,
  attention = false,
}: {
  value: StatValue;
  unknown: string;
  attention?: boolean;
}) {
  if (value.state === "pending") return <Skeleton className="h-7 w-12" />;
  if (value.state === "failed") {
    return (
      <>
        <span aria-hidden>—</span>
        <span className="sr-only">{unknown}</span>
      </>
    );
  }
  return (
    <span className={cn(attention && value.count > 0 && "text-destructive")}>
      {formatItemCount(value)}
    </span>
  );
}

function WorkflowListControls({
  ws,
  searchText,
  onSearchText,
  sort,
  onSort,
  status,
  onStatus,
}: {
  ws: WorkflowStrings;
  searchText: string;
  onSearchText: (text: string) => void;
  sort: WorkflowSort;
  onSort: (sort: WorkflowSort) => void;
  status: WorkflowStatusFilter;
  onStatus: (status: WorkflowStatusFilter) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1 sm:max-w-xs">
        <IconSearch
          aria-hidden
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={searchText}
          placeholder={ws.list.searchPlaceholder}
          aria-label={ws.list.searchPlaceholder}
          className="ps-9 pe-9 [&::-webkit-search-cancel-button]:appearance-none"
          onChange={(event) => onSearchText(event.target.value)}
        />
        {searchText ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={ws.list.clearSearch}
            className="absolute end-1 top-1/2 -translate-y-1/2 text-muted-foreground"
            onClick={() => onSearchText("")}
          >
            <IconX />
          </Button>
        ) : null}
      </div>
      <Select
        value={sort}
        onValueChange={(value) => {
          const next = oneOf(SORTS, value);
          if (next) onSort(next);
        }}
      >
        <SelectTrigger
          aria-label={ws.list.sortLabel}
          className="w-auto min-w-44"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="attention">{ws.list.sortAttention}</SelectItem>
          <SelectItem value="updated">{ws.list.sortUpdated}</SelectItem>
          <SelectItem value="name">{ws.list.sortName}</SelectItem>
        </SelectContent>
      </Select>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={status}
        aria-label={ws.list.statusLabel}
        onValueChange={(value) => {
          // An empty value is a press on the pressed option: keep one choice.
          const next = oneOf(STATUSES, value);
          if (next) onStatus(next);
        }}
      >
        <ToggleGroupItem value="all">{ws.list.statusAll}</ToggleGroupItem>
        <ToggleGroupItem value="on">{ws.list.statusOn}</ToggleGroupItem>
        <ToggleGroupItem value="off">{ws.list.statusOff}</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

/** Renames one workflow. Its form is keyed to the workflow, so each opening starts from the name it has now. */
function RenameWorkflowDialog({
  workflow,
  open,
  onOpenChange,
  onRename,
}: {
  workflow: WorkflowSummaryRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (workflow: WorkflowSummaryRow, name: string) => void;
}) {
  const ws = useWorkflowStrings();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        closeLabel={ws.common.close}
        aria-describedby={undefined}
      >
        {workflow ? (
          <RenameForm
            key={workflow.id}
            workflow={workflow}
            onCancel={() => onOpenChange(false)}
            onSubmit={(name) => onRename(workflow, name)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  workflow,
  onCancel,
  onSubmit,
}: {
  workflow: WorkflowSummaryRow;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const ws = useWorkflowStrings();
  const fieldId = useId();
  const [draft, setDraft] = useState(workflow.name);
  const canSave = canSaveRename(workflow.name, draft);
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) onSubmit(draft.trim());
      }}
    >
      <DialogHeader>
        <DialogTitle>{ws.list.renameTitle}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor={fieldId}>{ws.list.renameLabel}</Label>
        <Input
          id={fieldId}
          autoFocus
          value={draft}
          maxLength={WORKFLOW_NAME_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onCancel}>
          {ws.list.cancel}
        </Button>
        <Button type="submit" disabled={!canSave}>
          {ws.list.rename}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * One page after the first, read by its own action query keyed by its cursor.
 * It draws nothing unless the read failed: its rows join the list above, and it
 * reports what it read so the list is built from every page in view.
 */
function LaterWorkflowPage({
  factoryId,
  cursor,
  onRead,
  onStartOver,
}: {
  factoryId: string;
  cursor: string;
  onRead: (cursor: string, read: WorkflowPageRead | null) => void;
  onStartOver: () => void;
}) {
  const query = useActionQuery<ListWorkflowsResult>("list-factory-workflows", {
    factoryId,
    limit: PAGE,
    cursor,
  });
  const page = query.data;
  const failed = query.isError && page === undefined;

  useEffect(() => {
    if (page) onRead(cursor, { state: "loaded", page });
    else if (failed) onRead(cursor, { state: "failed" });
  }, [cursor, page, failed, onRead]);
  // A cursor that leaves the view takes its read with it, so nothing stale is kept.
  useEffect(() => () => onRead(cursor, null), [cursor, onRead]);

  if (!failed) return null;
  return (
    <ReadErrorState
      failure={classifyReadError(query.error)}
      action="list-factory-workflows"
      onRetry={() => void query.refetch()}
      onStartOver={onStartOver}
      className="my-3"
    />
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
  duplicatePending,
  onToggle,
  onRunTest,
  onRename,
  onDuplicate,
  onDelete,
}: {
  factoryId: string;
  row: WorkflowListRow;
  now: number;
  itemsFailed: boolean;
  needsTest: boolean;
  togglePending: boolean;
  testPending: boolean;
  duplicatePending: boolean;
  onToggle: (enabled: boolean) => void;
  onRunTest: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const ws = useWorkflowStrings();
  const canvasStrings = useWorkflowCanvasStrings();
  const { locale } = useLocale();

  const { workflow } = row;
  const workflowUrl = factoryWorkflowUrl(factoryId, {
    workflowId: workflow.id,
  });
  const schedule =
    scheduleLabel(row.schedule, canvasStrings, ws) ?? ws.list.noSchedule;
  // A next run already in the past is an overdue job, not something to announce.
  const nextAt = workflow.job.nextRun ? Date.parse(workflow.job.nextRun) : NaN;
  const next =
    workflow.enabled && nextAt >= now
      ? formatRelativeTime(nextAt, now, locale)
      : null;
  // A change the server stamped a moment ahead of this clock reads as just now, not as a future time.
  const updated = formatRelativeTime(
    Math.min(Date.parse(workflow.updatedAt), now),
    now,
    locale,
  );

  return (
    <li
      className={cn(
        "relative grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 first:border-t-0 hover:bg-accent/30 md:grid-cols-[minmax(0,2fr)_2.5rem_minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1.4fr)_2rem]",
        row.attention === "failed" && "bg-destructive/5",
      )}
    >
      <div className="min-w-0">
        <Link
          to={workflowUrl}
          aria-label={ws.list.openWorkflow(workflow.name)}
          className="block truncate text-sm font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
        >
          {workflow.name}
        </Link>
        {updated ? (
          <div className="truncate text-xs text-muted-foreground">
            {ws.list.updated(updated)}
          </div>
        ) : null}
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
            <DropdownMenuItem asChild>
              <Link to={workflowUrl}>
                <IconArrowRight />
                {ws.list.open}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRename}>
              <IconPencil />
              {ws.list.rename}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={duplicatePending}
              onSelect={onDuplicate}
            >
              {duplicatePending ? (
                <IconLoader2 className="animate-spin" />
              ) : (
                <IconCopy />
              )}
              {ws.list.duplicate}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
