import { useT } from "@agent-native/core/client/i18n";
import type { ContentTrashPurgePlanResponse } from "@shared/content-trash";
import { useEffect, useRef, useState } from "react";

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
  type ContentTrashPurgeInput,
  trashOperationIdFromError,
} from "@/hooks/use-content-trash";

import { TrashPurgeScope, useTrashPurgeScopeReady } from "./TrashPurgeScope";

export function TrashPurgeDialog({
  intent,
  onClose,
  onAcknowledged,
  returnFocus,
}: {
  intent: ContentTrashPurgeInput | null;
  onClose: () => void;
  onAcknowledged: (operationId: string) => void;
  returnFocus: () => HTMLElement | null;
}) {
  const t = useT();
  const planner = usePlanContentTrashPurge();
  const executor = useExecuteContentTrashPurge();
  const [plan, setPlan] = useState<ContentTrashPurgePlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const activeIntent = useRef(intent);
  const wasOpen = useRef(false);
  activeIntent.current = intent;
  const scope = useTrashPurgeScopeReady(plan?.planId ?? null);

  useEffect(() => {
    if (!intent) {
      setPlan(null);
      setError(null);
      setIdempotencyKey(null);
      return;
    }
    setError(null);
    setPlan(null);
    const requestedIntent = intent;
    void planner.mutateAsync(requestedIntent).then(
      (nextPlan) => {
        if (acceptTrashPlanSettlement(activeIntent.current, requestedIntent))
          setPlan(nextPlan);
      },
      (cause) => {
        if (acceptTrashPlanSettlement(activeIntent.current, requestedIntent))
          setError(trashActionError(cause, t("trash.planDeleteFailed")));
      },
    );
    // A new user gesture supplies a new immutable intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  useEffect(() => {
    if (intent) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const target = returnFocus();
    if (target?.isConnected) target.focus();
  }, [intent, returnFocus]);

  async function execute() {
    if (!plan || !scope.ready || !plan.eligibleCount) return;
    const key = idempotencyKey ?? crypto.randomUUID();
    setIdempotencyKey(key);
    setError(null);
    try {
      const result = await executor.mutateAsync({
        planId: plan.planId,
        scopeToken: plan.scopeToken,
        idempotencyKey: key,
      });
      onAcknowledged(result.operationId);
    } catch (cause) {
      const operationId = trashOperationIdFromError(cause);
      if (operationId) onAcknowledged(operationId);
      else setError(trashActionError(cause, t("trash.startFailed")));
    }
  }

  const empty = intent?.mode === "scope";
  return (
    <AlertDialog
      open={Boolean(intent)}
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
            {plan
              ? t("trash.deleteQuestion", { count: plan.eligibleCount })
              : empty
                ? t("trash.emptyQuestion")
                : t("trash.reviewDelete")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {empty ? t("trash.emptyDescription") : t("trash.deleteDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {planner.isPending ? (
          <div className="grid gap-2" aria-label={t("trash.planning")}>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : plan ? (
          <div className="grid gap-3 text-sm">
            <p>
              {t("trash.scopeCounts", {
                eligible: plan.eligibleCount,
                blocked: plan.blockedCount,
              })}
            </p>
            {empty ? (
              <p className="text-muted-foreground">
                {t("trash.filtersIgnored")}
              </p>
            ) : null}
            <TrashPurgeScope scope={scope} />
          </div>
        ) : null}
        {error ? <StatusMessage message={error} destructive /> : null}
        <AlertDialogFooter className="sticky bottom-0 bg-background pt-2">
          <AlertDialogCancel>{t("trash.cancel")}</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={
              !plan?.eligibleCount || !scope.ready || executor.isPending
            }
            onClick={() => void execute()}
          >
            {t("trash.deleteCount", { count: plan?.eligibleCount ?? 0 })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function TrashOperationSurface({
  operationId,
  stateError,
  onRetryState,
  onDismiss,
}: {
  operationId: string | null | undefined;
  stateError: boolean;
  onRetryState: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const operation = useContentTrashOperation(operationId ?? null);
  const executor = useExecuteContentTrashPurge();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const progress = operation.data?.pages[0];
  const outcomes = operation.data?.pages.flatMap((page) => page.outcomes) ?? [];
  if (operationId == null && !stateError) return null;

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
    <div className="fixed inset-x-3 bottom-3 z-20 grid gap-2 rounded-lg border bg-background p-3 shadow-lg sm:absolute sm:inset-x-auto sm:bottom-4 sm:end-4 sm:w-96">
      {stateError ? (
        <StatusMessage message={t("trash.operationStateFailed")} destructive />
      ) : operation.isError ? (
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
      <div className="flex justify-end gap-1">
        {stateError ? (
          <Button size="sm" variant="ghost" onClick={onRetryState}>
            {t("trash.retry")}
          </Button>
        ) : null}
        {progress?.status === "retryable" ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={executor.isPending}
            onClick={() => void retry()}
          >
            {t("trash.retry")}
          </Button>
        ) : null}
        {progress && isTerminalTrashOperation(progress.status) ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDetailsOpen((value) => !value)}
          >
            {t("trash.details")}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {t("trash.dismiss")}
        </Button>
      </div>
    </div>
  );
}

export function acceptTrashPlanSettlement(
  activeIntent: ContentTrashPurgeInput | null,
  settledIntent: ContentTrashPurgeInput,
) {
  return activeIntent === settledIntent;
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
