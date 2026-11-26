import { useT } from "@agent-native/core/client/i18n";
import type { ContentTrashPurgePlanResponse } from "@shared/content-trash";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  isTerminalTrashOperation,
  trashActionError,
  trashPurgeStartAfterError,
  useContentTrashOperation,
  useExecuteContentTrashPurge,
  usePlanContentTrashPurge,
  type ContentTrashOperation,
  type ContentTrashPurgeRequest,
  type ContentTrashPurgeStart,
  type ContentTrashPurgeTarget,
} from "@/hooks/use-content-trash";

import { TrashPurgeScope, useTrashPurgeScopeReady } from "./TrashPurgeScope";

export const PERSISTED_PURGE_RETRY_TOKEN = "persisted-operation-retry";

export type TrashPurgePlanState =
  | { status: "planning"; target: ContentTrashPurgeTarget }
  | {
      status: "planned";
      target: ContentTrashPurgeTarget;
      plan: ContentTrashPurgePlanResponse;
    }
  | { status: "empty"; target: ContentTrashPurgeTarget }
  | { status: "failed"; target: ContentTrashPurgeTarget; error: string };

type PendingStart = ContentTrashPurgeStart & {
  planId: string;
  idempotencyKey: string;
};

export function isEmptyTrashScopeError(error: unknown) {
  return (
    (error as { errorCode?: unknown } | undefined)?.errorCode === "empty_scope"
  );
}

export function trashPlansToExecute(
  plans: readonly TrashPurgePlanState[],
  readyPlanIds: ReadonlySet<string>,
) {
  const planned: Array<{
    spaceId: string | null;
    plan: ContentTrashPurgePlanResponse;
  }> = [];
  for (const entry of plans) {
    if (entry.status === "empty") continue;
    if (entry.status !== "planned" || !readyPlanIds.has(entry.plan.planId))
      return null;
    if (entry.plan.eligibleCount > 0)
      planned.push({ spaceId: entry.target.spaceId, plan: entry.plan });
  }
  return planned.length ? planned : null;
}

export function trashStartsToRun(
  toExecute: ReadonlyArray<{
    spaceId: string | null;
    plan: ContentTrashPurgePlanResponse;
  }>,
  previous: readonly ContentTrashPurgeStart[],
  newKey: () => string,
): PendingStart[] {
  const saved = new Map(previous.map((start) => [start.planId, start]));
  return toExecute.map(({ spaceId, plan }) => {
    const start = saved.get(plan.planId);
    return start?.status === "started"
      ? {
          ...start,
          planId: plan.planId,
          idempotencyKey: start.idempotencyKey ?? newKey(),
        }
      : {
          spaceId,
          planId: plan.planId,
          idempotencyKey: start?.idempotencyKey ?? newKey(),
          status: "starting",
          operationId: null,
          error: null,
        };
  });
}

export function TrashPurgeDialog({
  request,
  spaceName,
  onClose,
  onStartsChange,
  onAcknowledged,
  returnFocus,
}: {
  request: ContentTrashPurgeRequest | null;
  spaceName: (spaceId: string | null) => string;
  onClose: () => void;
  onStartsChange: (starts: ContentTrashPurgeStart[]) => Promise<void>;
  onAcknowledged: () => void;
  returnFocus: () => HTMLElement | null;
}) {
  const t = useT();
  const planner = usePlanContentTrashPurge();
  const executor = useExecuteContentTrashPurge();
  const [plans, setPlans] = useState<TrashPurgePlanState[]>([]);
  const [readyPlanIds, setReadyPlanIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [starts, setStarts] = useState<ContentTrashPurgeStart[]>([]);
  const activeRequest = useRef(request);
  const plannerRef = useRef(planner);
  const tRef = useRef(t);
  const wasOpen = useRef(false);
  activeRequest.current = request;
  plannerRef.current = planner;
  tRef.current = t;

  const planTarget = useCallback(
    (
      requested: ContentTrashPurgeRequest,
      target: ContentTrashPurgeRequest["targets"][number],
      index: number,
    ) => {
      const settle = (next: TrashPurgePlanState) => {
        if (!acceptTrashPlanSettlement(activeRequest.current, requested))
          return;
        setPlans((current) =>
          current.map((entry, entryIndex) =>
            entryIndex === index ? next : entry,
          ),
        );
      };
      settle({ status: "planning", target });
      void plannerRef.current.mutateAsync(target.input).then(
        (plan) => settle({ status: "planned", target, plan }),
        (cause: unknown) =>
          settle(
            isEmptyTrashScopeError(cause)
              ? { status: "empty", target }
              : {
                  status: "failed",
                  target,
                  error: trashActionError(
                    cause,
                    tRef.current("trash.planDeleteFailed"),
                  ),
                },
          ),
      );
    },
    [],
  );

  useEffect(() => {
    setError(null);
    setReadyPlanIds(new Set());
    setStarts([]);
    if (!request) {
      setPlans([]);
      return;
    }
    setPlans(request.targets.map((target) => ({ status: "planning", target })));
    request.targets.forEach((target, index) =>
      planTarget(request, target, index),
    );
  }, [planTarget, request]);

  useEffect(() => {
    if (request) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const target = returnFocus();
    if (target?.isConnected) target.focus();
  }, [request, returnFocus]);

  const toExecute = trashPlansToExecute(plans, readyPlanIds);
  const planning = plans.some((entry) => entry.status === "planning");
  const allEmpty = plans.every((entry) => entry.status === "empty");
  const unavailableSpaceIds = request?.unavailableSpaceIds ?? [];
  const eligibleCount = plans.reduce(
    (total, entry) =>
      entry.status === "planned" ? total + entry.plan.eligibleCount : total,
    0,
  );
  const named = plans.length + unavailableSpaceIds.length > 1;
  const unresolved = starts.some((start) => start.status !== "started");

  async function execute() {
    if (!toExecute || executing) return;
    const previous = starts;
    let current = trashStartsToRun(toExecute, previous, () =>
      crypto.randomUUID(),
    );
    setExecuting(true);
    setError(null);
    setStarts(current);
    try {
      await onStartsChange(current);
    } catch {
      const notStarted = current.map(
        (start): PendingStart =>
          start.status === "started"
            ? start
            : {
                ...start,
                status: "failed",
                error: t("trash.startRecordFailed"),
              },
      );
      setExecuting(false);
      setStarts(notStarted);
      setError(t("trash.startRecordFailed"));
      void onStartsChange(notStarted).then(undefined, () =>
        setError(t("trash.startRecordFailed")),
      );
      return;
    }
    let unsaved = false;
    for (const { plan } of toExecute) {
      const start = current.find((entry) => entry.planId === plan.planId);
      if (!start || start.status === "started") continue;
      let next: PendingStart;
      try {
        const result = await executor.mutateAsync({
          planId: plan.planId,
          scopeToken: plan.scopeToken,
          idempotencyKey: start.idempotencyKey,
        });
        next = {
          ...start,
          status: "started",
          operationId: result.operationId,
          error: null,
        };
      } catch (cause) {
        next = trashPurgeStartAfterError(start, cause, t("trash.startFailed"));
      }
      current = current.map((entry) =>
        entry.planId === plan.planId ? next : entry,
      );
      setStarts(current);
      try {
        await onStartsChange([next]);
      } catch {
        unsaved = true;
      }
    }
    setExecuting(false);
    if (unsaved) toast.error(t("trash.startProgressUnsaved"));
    if (current.every((start) => start.status === "started")) onAcknowledged();
  }

  const empty = request?.kind === "empty";
  return (
    <AlertDialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open && !executing) onClose();
      }}
    >
      <AlertDialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-lg"
        onEscapeKeyDown={(event) => {
          if (executing) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocus();
          if (!target?.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {!planning && !allEmpty
              ? t("trash.deleteQuestion", { count: eligibleCount })
              : empty
                ? t("trash.emptyQuestion")
                : t("trash.reviewDelete")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {empty ? t("trash.emptyDescription") : t("trash.deleteDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {planning ? (
          <div className="grid gap-2" aria-label={t("trash.planning")}>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : allEmpty && !unavailableSpaceIds.length ? (
          <p className="text-sm text-muted-foreground">
            {t(empty ? "trash.empty" : "trash.noMatches")}
          </p>
        ) : (
          <div className="grid min-h-0 gap-4 overflow-y-auto text-sm">
            {plans.map((entry, index) => (
              <TrashPurgePlanSection
                key={entry.target.spaceId ?? "all"}
                entry={entry}
                workspace={named ? spaceName(entry.target.spaceId) : null}
                start={
                  entry.status === "planned"
                    ? starts.find((start) => start.planId === entry.plan.planId)
                    : undefined
                }
                startWorkspace={spaceName(entry.target.spaceId)}
                onRetryPlan={() => {
                  if (request) planTarget(request, entry.target, index);
                }}
                onReadyChange={(planId, ready) =>
                  setReadyPlanIds((current) => {
                    if (current.has(planId) === ready) return current;
                    const next = new Set(current);
                    if (ready) next.add(planId);
                    else next.delete(planId);
                    return next;
                  })
                }
              />
            ))}
            {unavailableSpaceIds.map((spaceId) => (
              <p key={spaceId} className="text-muted-foreground">
                {t("trash.cannotPurgeWorkspace", {
                  workspace: spaceName(spaceId),
                })}
              </p>
            ))}
          </div>
        )}
        {error ? <StatusMessage message={error} destructive /> : null}
        <AlertDialogFooter className="sticky bottom-0 bg-background pt-2">
          <AlertDialogCancel disabled={executing}>
            {t("trash.cancel")}
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={!toExecute || executing}
            onClick={() => void execute()}
          >
            {unresolved && !executing
              ? t("trash.retry")
              : t("trash.deleteCount", { count: eligibleCount })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function TrashPurgePlanSection({
  entry,
  workspace,
  start,
  startWorkspace,
  onRetryPlan,
  onReadyChange,
}: {
  entry: TrashPurgePlanState;
  workspace: string | null;
  start: ContentTrashPurgeStart | undefined;
  startWorkspace: string;
  onRetryPlan: () => void;
  onReadyChange: (planId: string, ready: boolean) => void;
}) {
  const t = useT();
  const planId = entry.status === "planned" ? entry.plan.planId : null;
  const scope = useTrashPurgeScopeReady(planId);
  const onReadyChangeRef = useRef(onReadyChange);
  onReadyChangeRef.current = onReadyChange;
  useEffect(() => {
    if (planId) onReadyChangeRef.current(planId, scope.ready);
  }, [planId, scope.ready]);

  const counts = (eligible: number, blocked: number) =>
    workspace
      ? t("trash.workspaceScopeCounts", { workspace, eligible, blocked })
      : t("trash.scopeCounts", { eligible, blocked });
  if (entry.status === "planning")
    return (
      <div className="grid gap-2">
        <Skeleton className="h-5 w-40" />
      </div>
    );
  if (entry.status === "empty")
    return <p className="text-muted-foreground">{counts(0, 0)}</p>;
  if (entry.status === "failed")
    return (
      <div className="flex items-start justify-between gap-2">
        <StatusMessage
          message={
            workspace
              ? t("trash.workspaceError", { workspace, error: entry.error })
              : entry.error
          }
          destructive
        />
        <Button size="sm" variant="outline" onClick={onRetryPlan}>
          {t("trash.retry")}
        </Button>
      </div>
    );
  return (
    <section className="grid gap-2">
      <p className={workspace ? "font-medium" : undefined}>
        {counts(entry.plan.eligibleCount, entry.plan.blockedCount)}
      </p>
      {start && start.status !== "starting" ? (
        <TrashPurgeStartLine start={start} workspace={startWorkspace} />
      ) : null}
      <TrashPurgeScope scope={scope} />
    </section>
  );
}

function TrashPurgeStartLine({
  start,
  workspace,
}: {
  start: ContentTrashPurgeStart;
  workspace: string;
}) {
  const t = useT();
  if (start.status === "started")
    return <StatusMessage message={t("trash.startStarted", { workspace })} />;
  return (
    <StatusMessage
      message={
        start.status === "failed"
          ? t("trash.startDidNotStart", {
              workspace,
              error: start.error ?? t("trash.startFailed"),
            })
          : t("trash.startUnknown", { workspace })
      }
      destructive
    />
  );
}

export function TrashOperationSurface({
  starts,
  stateError,
  spaceName,
  onRetryState,
  onStartsChange,
  onDismiss,
}: {
  starts: readonly ContentTrashPurgeStart[] | undefined;
  stateError: boolean;
  spaceName: (spaceId: string | null) => string;
  onRetryState: () => void;
  onStartsChange: (starts: ContentTrashPurgeStart[]) => Promise<void>;
  onDismiss: () => void;
}) {
  const t = useT();
  if (!starts?.length && !stateError) return null;
  const dismiss = (
    <Button size="sm" variant="ghost" onClick={onDismiss}>
      {t("trash.dismiss")}
    </Button>
  );
  const named = (starts?.length ?? 0) > 1;

  return (
    <div
      data-trash-operation-surface=""
      className="mb-3 grid max-h-[40dvh] shrink-0 gap-2 overflow-y-auto rounded-lg border bg-background p-3 sm:ms-auto sm:w-96"
    >
      {stateError ? (
        <>
          <StatusMessage
            message={t("trash.operationStateFailed")}
            destructive
          />
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={onRetryState}>
              {t("trash.retry")}
            </Button>
            {dismiss}
          </div>
        </>
      ) : (
        starts?.map((start, index, all) => {
          const actions = index === all.length - 1 ? dismiss : null;
          const workspace = spaceName(start.spaceId);
          return start.status === "started" && start.operationId ? (
            <TrashOperationStatus
              key={start.operationId}
              operationId={start.operationId}
              workspace={named && start.spaceId ? workspace : null}
              actions={actions}
            />
          ) : (
            <TrashPurgeStartStatus
              key={start.planId ?? index}
              start={start}
              workspace={workspace}
              onStartsChange={onStartsChange}
              actions={actions}
            />
          );
        })
      )}
    </div>
  );
}

function TrashPurgeStartStatus({
  start,
  workspace,
  onStartsChange,
  actions,
}: {
  start: ContentTrashPurgeStart;
  workspace: string;
  onStartsChange: (starts: ContentTrashPurgeStart[]) => Promise<void>;
  actions: ReactNode;
}) {
  const t = useT();
  const executor = useExecuteContentTrashPurge();
  const [checking, setChecking] = useState(false);
  const { planId, idempotencyKey } = start;

  async function retry() {
    if (!planId || !idempotencyKey) return;
    setChecking(true);
    let next: ContentTrashPurgeStart;
    try {
      const result = await executor.mutateAsync({
        planId,
        scopeToken: PERSISTED_PURGE_RETRY_TOKEN,
        idempotencyKey,
      });
      next = {
        ...start,
        status: "started",
        operationId: result.operationId,
        error: null,
      };
    } catch (cause) {
      next =
        (cause as { errorCode?: unknown } | undefined)?.errorCode ===
        "invalid_scope"
          ? { ...start, status: "failed", error: t("trash.startExpired") }
          : trashPurgeStartAfterError(start, cause, t("trash.startFailed"));
    }
    try {
      await onStartsChange([next]);
    } catch {
      toast.error(t("trash.startProgressUnsaved"));
    }
    setChecking(false);
  }

  return (
    <div className="grid gap-2">
      <TrashPurgeStartLine start={start} workspace={workspace} />
      <div className="flex justify-end gap-1">
        {start.status !== "failed" && planId && idempotencyKey ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={checking}
            onClick={() => void retry()}
          >
            {t("trash.retry")}
          </Button>
        ) : null}
        {actions}
      </div>
    </div>
  );
}

export function trashOperationStatusText(
  t: ReturnType<typeof useT>,
  progress: Pick<
    ContentTrashOperation,
    "status" | "deletedCount" | "blockedCount" | "conflictedCount"
  >,
) {
  switch (progress.status) {
    case "queued":
      return t("trash.queued");
    case "running":
      return t("trash.running", { count: progress.deletedCount });
    case "succeeded":
      return t("trash.completed", { count: progress.deletedCount });
    case "partially_completed":
      return t("trash.partiallyCompleted", {
        deleted: progress.deletedCount,
        blocked: progress.blockedCount,
      });
    case "conflicted":
      return t("trash.conflicted", {
        deleted: progress.deletedCount,
        conflicted: progress.conflictedCount,
      });
    case "retryable":
      return t("trash.retryable");
    case "failed":
      return t("trash.failed");
  }
}

function TrashOperationStatus({
  operationId,
  workspace,
  actions,
}: {
  operationId: string;
  workspace: string | null;
  actions: ReactNode;
}) {
  const t = useT();
  const operation = useContentTrashOperation(operationId);
  const executor = useExecuteContentTrashPurge();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const progress = operation.data?.pages[0];
  const finished =
    progress && isTerminalTrashOperation(progress.status) ? progress : null;
  const outcomes = operation.data?.pages.flatMap((page) => page.outcomes) ?? [];

  async function retry() {
    if (!progress) return;
    await executor.mutateAsync({
      planId: progress.planId,
      scopeToken: PERSISTED_PURGE_RETRY_TOKEN,
      idempotencyKey: progress.idempotencyKey,
    });
    await operation.refetch();
  }

  return (
    <div className="grid gap-2">
      {workspace ? (
        <span className="text-xs text-muted-foreground">{workspace}</span>
      ) : null}
      {operation.isError ? (
        <StatusMessage
          message={trashActionError(operation.error, t("trash.statusFailed"))}
          destructive
        />
      ) : progress ? (
        <p className="text-sm font-medium">
          {trashOperationStatusText(t, progress)}
        </p>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {t("trash.queued")}
        </p>
      )}
      {detailsOpen && outcomes.length ? (
        <div className="max-h-52 overflow-y-auto rounded-md border">
          {outcomes.map((item) => (
            <div
              key={item.documentId}
              className="grid gap-0.5 border-b px-3 py-2 last:border-0"
            >
              <span className="truncate text-sm font-medium">{item.title}</span>
              <span className="text-xs text-muted-foreground">
                {item.detail ?? t("trash.outcome", { outcome: item.outcome })}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {detailsOpen && operation.hasNextPage ? (
        <Button
          size="sm"
          variant="outline"
          disabled={operation.isFetchingNextPage}
          onClick={() => void operation.fetchNextPage()}
        >
          {operation.isFetchingNextPage
            ? t("trash.loadingMore")
            : t("trash.loadMore")}
        </Button>
      ) : null}
      {finished || actions ? (
        <div className="flex justify-end gap-1">
          {finished?.status === "retryable" ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={executor.isPending}
              onClick={() => void retry()}
            >
              {t("trash.retry")}
            </Button>
          ) : null}
          {finished ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDetailsOpen((value) => !value)}
            >
              {t("trash.details")}
            </Button>
          ) : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function acceptTrashPlanSettlement(
  activeRequest: ContentTrashPurgeRequest | null,
  settledRequest: ContentTrashPurgeRequest,
) {
  return activeRequest === settledRequest;
}

function StatusMessage({
  message,
  destructive = false,
}: {
  message: string;
  destructive?: boolean;
}) {
  return (
    <div
      role={destructive ? "alert" : "status"}
      className={
        destructive
          ? "text-sm text-destructive"
          : "text-sm text-muted-foreground"
      }
    >
      {message}
    </div>
  );
}
