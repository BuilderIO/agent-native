import { useT } from "@agent-native/core/client/i18n";
import type { ContentTrashPurgePlanResponse } from "@shared/content-trash";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  useContentTrashOperation,
  useExecuteContentTrashPurge,
  usePlanContentTrashPurge,
  type ContentTrashPurgeRequest,
  type ContentTrashPurgeTarget,
  trashOperationIdFromError,
} from "@/hooks/use-content-trash";

import { TrashPurgeScope, useTrashPurgeScopeReady } from "./TrashPurgeScope";

export type TrashPurgePlanState =
  | { status: "planning"; target: ContentTrashPurgeTarget }
  | {
      status: "planned";
      target: ContentTrashPurgeTarget;
      plan: ContentTrashPurgePlanResponse;
    }
  | { status: "empty"; target: ContentTrashPurgeTarget }
  | { status: "failed"; target: ContentTrashPurgeTarget; error: string };

export function isEmptyTrashScopeError(error: unknown) {
  return (
    (error as { errorCode?: unknown } | undefined)?.errorCode === "empty_scope"
  );
}

export function trashPlansToExecute(
  plans: readonly TrashPurgePlanState[],
  readyPlanIds: ReadonlySet<string>,
) {
  const planned: ContentTrashPurgePlanResponse[] = [];
  for (const entry of plans) {
    if (entry.status === "empty") continue;
    if (entry.status !== "planned" || !readyPlanIds.has(entry.plan.planId))
      return null;
    if (entry.plan.eligibleCount > 0) planned.push(entry.plan);
  }
  return planned.length ? planned : null;
}

export function TrashPurgeDialog({
  request,
  spaceName,
  onClose,
  onAcknowledged,
  returnFocus,
}: {
  request: ContentTrashPurgeRequest | null;
  spaceName: (spaceId: string | null) => string;
  onClose: () => void;
  onAcknowledged: (operationIds: string[]) => void;
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
  const idempotencyKeys = useRef(new Map<string, string>());
  const activeRequest = useRef(request);
  const plannerRef = useRef(planner);
  const tRef = useRef(t);
  const wasOpen = useRef(false);
  activeRequest.current = request;
  plannerRef.current = planner;
  tRef.current = t;

  useEffect(() => {
    setError(null);
    setReadyPlanIds(new Set());
    idempotencyKeys.current.clear();
    if (!request) {
      setPlans([]);
      return;
    }
    const requested = request;
    const settle = (index: number, next: TrashPurgePlanState) => {
      if (!acceptTrashPlanSettlement(activeRequest.current, requested)) return;
      setPlans((current) =>
        current.map((entry, entryIndex) =>
          entryIndex === index ? next : entry,
        ),
      );
    };
    setPlans(
      requested.targets.map((target) => ({ status: "planning", target })),
    );
    requested.targets.forEach((target, index) => {
      void plannerRef.current.mutateAsync(target.input).then(
        (plan) => settle(index, { status: "planned", target, plan }),
        (cause: unknown) =>
          settle(
            index,
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
    });
  }, [request]);

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
  const allEmpty =
    plans.length > 0 && plans.every((entry) => entry.status === "empty");
  const eligibleCount = plans.reduce(
    (total, entry) =>
      entry.status === "planned" ? total + entry.plan.eligibleCount : total,
    0,
  );
  const named = plans.length > 1;

  async function execute() {
    if (!toExecute || executing) return;
    setExecuting(true);
    setError(null);
    const operationIds: string[] = [];
    let failure: string | null = null;
    for (const plan of toExecute) {
      const key =
        idempotencyKeys.current.get(plan.planId) ?? crypto.randomUUID();
      idempotencyKeys.current.set(plan.planId, key);
      try {
        const result = await executor.mutateAsync({
          planId: plan.planId,
          scopeToken: plan.scopeToken,
          idempotencyKey: key,
        });
        operationIds.push(result.operationId);
      } catch (cause) {
        const operationId = trashOperationIdFromError(cause);
        if (operationId) {
          operationIds.push(operationId);
          continue;
        }
        failure = trashActionError(cause, t("trash.startFailed"));
        break;
      }
    }
    setExecuting(false);
    if (!operationIds.length) {
      setError(failure ?? t("trash.startFailed"));
      return;
    }
    if (failure) toast.error(t("trash.startFailed"), { description: failure });
    onAcknowledged(operationIds);
  }

  const empty = request?.kind === "empty";
  return (
    <AlertDialog
      open={Boolean(request)}
      onOpenChange={(open) => !open && onClose()}
    >
      <AlertDialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-lg"
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
        ) : allEmpty ? (
          <p className="text-sm text-muted-foreground">
            {t(empty ? "trash.empty" : "trash.noMatches")}
          </p>
        ) : (
          <div className="grid min-h-0 gap-4 overflow-y-auto text-sm">
            {plans.map((entry) => (
              <TrashPurgePlanSection
                key={entry.target.spaceId ?? "all"}
                entry={entry}
                workspace={named ? spaceName(entry.target.spaceId) : null}
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
          </div>
        )}
        {error ? <StatusMessage message={error} destructive /> : null}
        <AlertDialogFooter className="sticky bottom-0 bg-background pt-2">
          <AlertDialogCancel>{t("trash.cancel")}</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={!toExecute || executing}
            onClick={() => void execute()}
          >
            {t("trash.deleteCount", { count: eligibleCount })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function TrashPurgePlanSection({
  entry,
  workspace,
  onReadyChange,
}: {
  entry: TrashPurgePlanState;
  workspace: string | null;
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
      <StatusMessage
        message={
          workspace
            ? t("trash.workspaceError", { workspace, error: entry.error })
            : entry.error
        }
        destructive
      />
    );
  return (
    <section className="grid gap-2">
      <p className={workspace ? "font-medium" : undefined}>
        {counts(entry.plan.eligibleCount, entry.plan.blockedCount)}
      </p>
      <TrashPurgeScope scope={scope} />
    </section>
  );
}

export function TrashOperationSurface({
  operationIds,
  stateError,
  onRetryState,
  onDismiss,
}: {
  operationIds: readonly string[] | null | undefined;
  stateError: boolean;
  onRetryState: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  if (!operationIds?.length && !stateError) return null;
  const dismiss = (
    <Button size="sm" variant="ghost" onClick={onDismiss}>
      {t("trash.dismiss")}
    </Button>
  );

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 grid max-h-[60dvh] gap-2 overflow-y-auto rounded-lg border bg-background p-3 shadow-lg sm:absolute sm:inset-x-auto sm:bottom-4 sm:end-4 sm:w-96">
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
        operationIds?.map((operationId, index, ids) => (
          <TrashOperationStatus
            key={operationId}
            operationId={operationId}
            actions={index === ids.length - 1 ? dismiss : null}
          />
        ))
      )}
    </div>
  );
}

function TrashOperationStatus({
  operationId,
  actions,
}: {
  operationId: string;
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
      scopeToken: "persisted-operation-retry",
      idempotencyKey: progress.idempotencyKey,
    });
    await operation.refetch();
  }

  return (
    <div className="grid gap-2">
      {operation.isError ? (
        <StatusMessage
          message={trashActionError(operation.error, t("trash.statusFailed"))}
          destructive
        />
      ) : progress ? (
        <p className="text-sm font-medium">
          {progress.status === "queued"
            ? t("trash.queued")
            : progress.status === "running"
              ? t("trash.running", { count: progress.deletedCount })
              : progress.status === "succeeded" && progress.remains === 0
                ? t("trash.completed", { count: progress.deletedCount })
                : t("trash.completedWithRemaining", {
                    deleted: progress.deletedCount,
                    remains: progress.remains,
                  })}
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
