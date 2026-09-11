import type { CollabUser } from "@agent-native/core/client/collab";
import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import type { Document } from "@shared/api";
import type {
  DocumentHistoryCheckpoint,
  DocumentHistoryCheckpointDetail,
  DocumentHistoryGroup,
} from "@shared/document-history";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconChevronDown,
  IconChevronRight,
  IconLoader2,
  IconRefresh,
  IconRotate,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDocumentHistoryCheckpoint,
  useDocumentHistoryCheckpoints,
  useDocumentHistoryPage,
  useRestoreDocumentVersion,
} from "@/hooks/use-document-versions";

import { setHistoryApplicationState } from "./history-application-state";
import { VisualEditor } from "./VisualEditor";

export type HistoryRestoreApplyResult =
  | { status: "applied" }
  | { status: "committed-editor-refresh-required" };

interface VersionHistoryPanelProps {
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRestore?: boolean;
  restoreReady?: boolean;
  activeUsers?: CollabUser[];
  prepareRestore?: () => Promise<string>;
  restoreUnavailableReason?: string;
  onRestored?: (
    restored: Document,
  ) => HistoryRestoreApplyResult | Promise<HistoryRestoreApplyResult>;
}

interface PendingRestore {
  checkpoint: DocumentHistoryCheckpointDetail;
  expectedUpdatedAt: string;
}

function mergeRefreshedFirstPage<T extends { id: string }>(
  refreshed: T[],
  loaded: T[],
): T[] {
  const refreshedIds = new Set(refreshed.map((item) => item.id));
  return [...refreshed, ...loaded.filter((item) => !refreshedIds.has(item.id))];
}

function appendPage<T extends { id: string }>(loaded: T[], page: T[]): T[] {
  const loadedIds = new Set(loaded.map((item) => item.id));
  return [...loaded, ...page.filter((item) => !loadedIds.has(item.id))];
}

export function VersionHistoryPanel({
  documentId,
  open,
  onOpenChange,
  canRestore = true,
  restoreReady = true,
  prepareRestore,
  restoreUnavailableReason,
  onRestored,
}: VersionHistoryPanelProps) {
  const operationContextRef = useRef({ documentId, open, generation: 0 });
  if (
    operationContextRef.current.documentId !== documentId ||
    operationContextRef.current.open !== open
  ) {
    operationContextRef.current = {
      documentId,
      open,
      generation: operationContextRef.current.generation + 1,
    };
  }
  useEffect(
    () => () => {
      operationContextRef.current.generation += 1;
    },
    [],
  );
  const restoreButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const t = useT();
  const formatters = useFormatters();
  const [cursor, setCursor] = useState<string | null>(null);
  const [groups, setGroups] = useState<DocumentHistoryGroup[]>([]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedCheckpoint, setSelectedCheckpoint] =
    useState<DocumentHistoryCheckpoint | null>(null);
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(
    null,
  );
  const [isPreparingRestore, setIsPreparingRestore] = useState(false);
  const [restoreApplyFailed, setRestoreApplyFailed] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const firstHistoryPage = useDocumentHistoryPage(
    open ? documentId : null,
    null,
  );
  const historyPage = useDocumentHistoryPage(
    open && cursor ? documentId : null,
    cursor,
  );
  const checkpointDetail = useDocumentHistoryCheckpoint(
    open ? documentId : null,
    selectedCheckpoint?.id ?? null,
  );
  const restoreVersion = useRestoreDocumentVersion(documentId);

  useEffect(() => {
    setCursor(null);
    setGroups([]);
    setExpandedGroupIds(new Set());
    setSelectedCheckpoint(null);
    setPendingRestore(null);
    setRestoreApplyFailed(false);
    setRestoreError(null);
    setIsPreparingRestore(false);
  }, [documentId]);

  useEffect(() => {
    setRestoreError(null);
  }, [selectedCheckpoint?.id, open]);

  useEffect(() => {
    if (!open || firstHistoryPage.isPlaceholderData || !firstHistoryPage.data)
      return;
    setGroups((current) => {
      return mergeRefreshedFirstPage(firstHistoryPage.data.groups, current);
    });
  }, [firstHistoryPage.data, firstHistoryPage.isPlaceholderData, open]);

  useEffect(() => {
    if (!open || !cursor || historyPage.isPlaceholderData || !historyPage.data)
      return;
    setGroups((current) => appendPage(current, historyPage.data.groups));
  }, [cursor, historyPage.data, historyPage.isPlaceholderData, open]);

  const currentHistoryPage = cursor ? historyPage : firstHistoryPage;
  const historyError = firstHistoryPage.error ?? historyPage.error;
  const historyIsFetching =
    firstHistoryPage.isFetching || (!!cursor && historyPage.isFetching);

  const historyStateKey = `content-history:${documentId}`;
  const expandedGroupIdList = useMemo(
    () => Array.from(expandedGroupIds),
    [expandedGroupIds],
  );
  useEffect(() => {
    void setHistoryApplicationState(
      historyStateKey,
      open
        ? {
            documentId,
            open: true,
            expandedGroupIds: expandedGroupIdList,
            selectedCheckpointId: selectedCheckpoint?.id ?? null,
          }
        : null,
    ).catch((error) =>
      console.warn("Could not write history application state", error),
    );
  }, [
    documentId,
    expandedGroupIdList,
    historyStateKey,
    open,
    selectedCheckpoint?.id,
  ]);
  useEffect(
    () => () => {
      void setHistoryApplicationState(historyStateKey, null, true).catch(
        (error) =>
          console.warn("Could not clear history application state", error),
      );
    },
    [historyStateKey],
  );

  const selectCheckpoint = (checkpoint: DocumentHistoryCheckpoint | null) => {
    operationContextRef.current.generation += 1;
    setIsPreparingRestore(false);
    setSelectedCheckpoint(checkpoint);
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      operationContextRef.current.generation += 1;
      operationContextRef.current.open = false;
      setIsPreparingRestore(false);
      setSelectedCheckpoint(null);
      setPendingRestore(null);
    }
    onOpenChange(nextOpen);
  };

  const handleRestoreClick = async (
    checkpoint: DocumentHistoryCheckpointDetail,
  ) => {
    if (!prepareRestore || !restoreReady) return;
    const generation = operationContextRef.current.generation;
    setIsPreparingRestore(true);
    setRestoreError(null);
    try {
      const expectedUpdatedAt = await prepareRestore();
      if (operationContextRef.current.generation !== generation) return;
      setPendingRestore({ checkpoint, expectedUpdatedAt });
    } catch (error) {
      if (operationContextRef.current.generation !== generation) return;
      toast.error(
        actionErrorMessage(error) ?? t("editor.historySaveBeforeRestoreFailed"),
      );
    } finally {
      if (operationContextRef.current.generation === generation)
        setIsPreparingRestore(false);
    }
  };

  const doRestore = async () => {
    if (!pendingRestore || !restoreReady) return;
    const generation = operationContextRef.current.generation;
    let restored: Document;
    try {
      restored = await restoreVersion.mutateAsync({
        documentId,
        versionId: pendingRestore.checkpoint.id,
        expectedUpdatedAt: pendingRestore.expectedUpdatedAt,
      });
    } catch (error) {
      if (operationContextRef.current.generation !== generation) return;
      const message =
        actionErrorMessage(error) ?? t("editor.versionRestoreFailed");
      setPendingRestore(null);
      setRestoreError(message);
      toast.error(message);
      return;
    }
    if (operationContextRef.current.generation !== generation) return;
    setPendingRestore(null);
    let application: HistoryRestoreApplyResult;
    try {
      application = onRestored
        ? await onRestored(restored)
        : { status: "committed-editor-refresh-required" };
    } catch {
      application = { status: "committed-editor-refresh-required" };
    }
    if (operationContextRef.current.generation !== generation) return;
    if (application.status === "committed-editor-refresh-required") {
      setRestoreApplyFailed(true);
      toast.error(t("editor.historyRestoreAppliedRefreshFailed"));
      return;
    }
    toast.success(t("editor.versionRestored"));
    setSelectedCheckpoint(null);
    onOpenChange(false);
  };

  const detail = checkpointDetail.data?.checkpoint;
  const showRestore = canRestore;
  const restoreDisabled =
    !restoreReady ||
    restoreApplyFailed ||
    !!restoreUnavailableReason ||
    !prepareRestore ||
    isPreparingRestore ||
    restoreVersion.isPending;

  return (
    <>
      <Sheet open={open} onOpenChange={handleClose}>
        <SheetContent side="right" className="w-[92vw] max-w-[430px] p-0">
          <SheetHeader className="px-4 pt-4 pb-0">
            <SheetTitle className="text-sm font-medium">
              {selectedCheckpoint ? (
                <button
                  type="button"
                  onClick={() => selectCheckpoint(null)}
                  className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <IconArrowLeft className="size-3.5" />
                  <span>{t("editor.versionBackToHistory")}</span>
                </button>
              ) : (
                t("editor.toolbar.versionHistory")
              )}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("editor.versionHistoryDescription")}
            </SheetDescription>
          </SheetHeader>

          <Separator className="mt-3" />

          {selectedCheckpoint ? (
            <div className="flex h-[calc(100%-60px)] flex-col">
              <div className="border-b border-border px-4 py-3">
                <p className="truncate text-xs font-medium">
                  {detail?.title ||
                    selectedCheckpoint.title ||
                    t("sidebar.untitled")}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {formatHistoryDate(
                    detail?.createdAt ?? selectedCheckpoint.createdAt,
                    formatters.formatDate,
                  )}
                </p>
              </div>
              <ScrollArea className="flex-1">
                {checkpointDetail.isLoading ? (
                  <HistoryPreviewSkeleton />
                ) : checkpointDetail.error ? (
                  <HistoryError
                    message={t("editor.historyDetailLoadError")}
                    retry={() => void checkpointDetail.refetch()}
                  />
                ) : detail ? (
                  <div className="px-4 py-4">
                    <VisualEditor
                      content={detail.content}
                      onChange={() => {}}
                      editable={false}
                    />
                  </div>
                ) : null}
              </ScrollArea>
              {showRestore ? (
                <div className="border-t border-border p-3">
                  <Button
                    ref={restoreButtonRef}
                    size="sm"
                    className="w-full"
                    onClick={() => detail && void handleRestoreClick(detail)}
                    disabled={restoreDisabled || !detail}
                  >
                    {isPreparingRestore ? (
                      <IconLoader2 className="size-3.5 animate-spin" />
                    ) : (
                      <IconRotate className="size-3.5" />
                    )}
                    {isPreparingRestore
                      ? t("editor.historyPreparingRestore")
                      : t("editor.versionRestoreThisVersion")}
                  </Button>
                  {restoreError ? (
                    <p
                      role="alert"
                      className="mt-2 text-center text-xs text-destructive"
                    >
                      {restoreError}
                    </p>
                  ) : null}
                  {restoreApplyFailed ? (
                    <p
                      role="alert"
                      className="mt-2 text-center text-xs text-destructive"
                    >
                      {t("editor.historyRestoreAppliedRefreshFailed")}
                    </p>
                  ) : null}
                  {restoreUnavailableReason || !prepareRestore ? (
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      {restoreUnavailableReason ??
                        t("editor.historyRestoreUnavailable")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <div
            className={selectedCheckpoint ? "hidden" : "h-[calc(100%-60px)]"}
          >
            <ScrollArea className="h-full">
              {firstHistoryPage.isPlaceholderData ||
              (historyIsFetching && groups.length > 0) ? (
                <div className="flex items-center gap-1.5 border-b border-border px-4 py-2 text-xs text-muted-foreground">
                  <IconLoader2 className="size-3 animate-spin" />
                  {t("editor.historyRefreshing")}
                </div>
              ) : null}
              {historyError && groups.length > 0 ? (
                <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
                  <IconAlertCircle className="size-3.5 shrink-0 text-destructive" />
                  <span className="min-w-0 flex-1">
                    {t("editor.historyShowingSavedResults")}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() =>
                      void (firstHistoryPage.error
                        ? firstHistoryPage.refetch()
                        : historyPage.refetch())
                    }
                  >
                    <IconRefresh className="size-3.5" />
                    {t("editor.historyRetry")}
                  </Button>
                </div>
              ) : null}
              {firstHistoryPage.isLoading && groups.length === 0 ? (
                <HistoryListSkeleton />
              ) : firstHistoryPage.error && groups.length === 0 ? (
                <HistoryError
                  message={t("editor.historyLoadError")}
                  retry={() => void firstHistoryPage.refetch()}
                />
              ) : groups.length === 0 && !firstHistoryPage.isFetching ? (
                <div className="px-4 py-12 text-center text-xs text-muted-foreground">
                  {t("editor.versionNoHistoryYet")}
                </div>
              ) : (
                <div className="p-1.5">
                  {groups.map((group) => (
                    <HistoryGroupRow
                      key={group.id}
                      documentId={documentId}
                      group={group}
                      open={expandedGroupIds.has(group.id)}
                      onOpenChange={(nextOpen) =>
                        setExpandedGroupIds((current) => {
                          const next = new Set(current);
                          if (nextOpen) next.add(group.id);
                          else next.delete(group.id);
                          return next;
                        })
                      }
                      onSelectCheckpoint={selectCheckpoint}
                      formatDate={formatters.formatDate}
                    />
                  ))}
                  {currentHistoryPage.data?.hasMore ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-1 w-full"
                      disabled={currentHistoryPage.isFetching}
                      onClick={() =>
                        setCursor(currentHistoryPage.data?.nextCursor ?? null)
                      }
                    >
                      {currentHistoryPage.isFetching ? (
                        <IconLoader2 className="size-3.5 animate-spin" />
                      ) : null}
                      {currentHistoryPage.isFetching
                        ? t("editor.historyLoadingMore")
                        : t("editor.historyLoadMore")}
                    </Button>
                  ) : null}
                </div>
              )}
            </ScrollArea>
          </div>
          <Dialog
            open={pendingRestore !== null}
            onOpenChange={(nextOpen) => {
              if (!nextOpen && !restoreVersion.isPending)
                setPendingRestore(null);
            }}
          >
            <DialogContent
              role="alertdialog"
              hideClose
              onPointerDownOutside={(event) => event.preventDefault()}
              onEscapeKeyDown={(event) => {
                if (restoreVersion.isPending) event.preventDefault();
              }}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                cancelButtonRef.current?.focus();
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                restoreButtonRef.current?.focus();
              }}
            >
              <DialogHeader>
                <DialogTitle>
                  {t("editor.versionRestoreThisVersionQuestion")}
                </DialogTitle>
                <DialogDescription>
                  {t("editor.versionRestoreWarning")}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  ref={cancelButtonRef}
                  variant="outline"
                  disabled={restoreVersion.isPending}
                  onClick={() => setPendingRestore(null)}
                >
                  {t("comments.cancel")}
                </Button>
                <Button
                  disabled={restoreVersion.isPending}
                  onClick={(event) => {
                    event.preventDefault();
                    void doRestore();
                  }}
                >
                  {restoreVersion.isPending ? (
                    <IconLoader2 className="size-3.5 animate-spin" />
                  ) : null}
                  {t("editor.versionRestoreAnyway")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </SheetContent>
      </Sheet>
    </>
  );
}

function HistoryGroupRow({
  documentId,
  group,
  open,
  onOpenChange,
  onSelectCheckpoint,
  formatDate,
}: {
  documentId: string;
  group: DocumentHistoryGroup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectCheckpoint: (checkpoint: DocumentHistoryCheckpoint) => void;
  formatDate: ReturnType<typeof useFormatters>["formatDate"];
}) {
  const t = useT();
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadedCheckpoints, setLoadedCheckpoints] = useState<
    DocumentHistoryCheckpoint[]
  >([]);
  const firstCheckpoints = useDocumentHistoryCheckpoints(
    open ? documentId : null,
    open ? group.id : null,
    null,
  );
  const checkpoints = useDocumentHistoryCheckpoints(
    open && cursor ? documentId : null,
    open && cursor ? group.id : null,
    cursor,
  );
  useEffect(() => {
    if (!open || firstCheckpoints.isPlaceholderData || !firstCheckpoints.data)
      return;
    setLoadedCheckpoints((current) =>
      mergeRefreshedFirstPage(firstCheckpoints.data.checkpoints, current),
    );
  }, [firstCheckpoints.data, firstCheckpoints.isPlaceholderData, open]);
  useEffect(() => {
    if (!open || !cursor || checkpoints.isPlaceholderData || !checkpoints.data)
      return;
    setLoadedCheckpoints((current) =>
      appendPage(current, checkpoints.data.checkpoints),
    );
  }, [checkpoints.data, checkpoints.isPlaceholderData, cursor, open]);
  const currentCheckpointPage = cursor ? checkpoints : firstCheckpoints;
  const checkpointError = firstCheckpoints.error ?? checkpoints.error;
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-start gap-2 rounded-md px-2.5 py-2.5 text-start hover:bg-accent"
        >
          {open ? (
            <IconChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <IconChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">
              {historyGroupTitle(group, t)}
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
              {group.actorEmail ? `${group.actorEmail} · ` : ""}
              {formatHistoryDate(group.endedAt, formatDate)}
            </span>
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="ms-5 border-s border-border ps-2">
        {firstCheckpoints.isLoading && loadedCheckpoints.length === 0 ? (
          <div className="grid gap-2 px-2 py-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-4/5" />
          </div>
        ) : firstCheckpoints.error && loadedCheckpoints.length === 0 ? (
          <HistoryError
            compact
            message={t("editor.historyCheckpointLoadError")}
            retry={() => void firstCheckpoints.refetch()}
          />
        ) : (
          <>
            {checkpointError ? (
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                <IconAlertCircle className="size-3.5 text-destructive" />
                <span className="min-w-0 flex-1">
                  {t("editor.historyShowingSavedResults")}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() =>
                    void (firstCheckpoints.error
                      ? firstCheckpoints.refetch()
                      : checkpoints.refetch())
                  }
                >
                  {t("editor.historyRetry")}
                </Button>
              </div>
            ) : null}
            {loadedCheckpoints.map((checkpoint) => (
              <button
                type="button"
                key={checkpoint.id}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-start hover:bg-accent"
                onClick={() => onSelectCheckpoint(checkpoint)}
              >
                <span className="min-w-0 flex-1 truncate text-xs">
                  {checkpoint.title || t("sidebar.untitled")}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {t(
                    `editor.historyCheckpoint${capitalize(
                      checkpoint.checkpointKind,
                    )}`,
                  )}
                </span>
              </button>
            ))}
            {currentCheckpointPage.data?.hasMore ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={currentCheckpointPage.isFetching}
                onClick={() =>
                  setCursor(currentCheckpointPage.data?.nextCursor ?? null)
                }
              >
                {currentCheckpointPage.isFetching ? (
                  <IconLoader2 className="size-3.5 animate-spin" />
                ) : null}
                {currentCheckpointPage.isFetching
                  ? t("editor.historyLoadingMore")
                  : t("editor.historyLoadMore")}
              </Button>
            ) : null}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function HistoryError({
  message,
  retry,
  compact = false,
}: {
  message: string;
  retry: () => void;
  compact?: boolean;
}) {
  const t = useT();
  return (
    <div
      className={
        compact
          ? "flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground"
          : "flex flex-col items-center gap-3 px-4 py-12 text-center text-xs text-muted-foreground"
      }
    >
      <span className="flex items-center gap-1.5">
        <IconAlertCircle className="size-3.5 shrink-0 text-destructive" />
        {message}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={compact ? "ms-auto h-7 px-2" : undefined}
        onClick={retry}
      >
        <IconRefresh className="size-3.5" />
        {t("editor.historyRetry")}
      </Button>
    </div>
  );
}

function HistoryListSkeleton() {
  return (
    <div className="grid gap-3 p-4">
      {["first", "second", "third"].map((key) => (
        <div key={key} className="flex items-start gap-3">
          <Skeleton className="mt-1 size-3.5" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function HistoryPreviewSkeleton() {
  return (
    <div className="grid gap-3 p-4">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-11/12" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  );
}

function historyGroupTitle(
  group: DocumentHistoryGroup,
  t: ReturnType<typeof useT>,
) {
  if (group.kind === "human_session") return t("editor.historyGroupHuman");
  if (group.kind === "agent_run") return t("editor.historyGroupAgent");
  if (group.kind === "operation") {
    if (group.operation === "restore-document-version") {
      return t("editor.historyGroupRestore");
    }
    return t("editor.historyGroupOperation");
  }
  return t("editor.historyGroupLegacy");
}

function formatHistoryDate(
  value: string,
  formatDate: ReturnType<typeof useFormatters>["formatDate"],
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDate(date, { dateStyle: "medium", timeStyle: "short" });
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
