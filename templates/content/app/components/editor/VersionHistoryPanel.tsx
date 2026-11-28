import type { CollabUser } from "@agent-native/core/client/collab";
import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import type { Document } from "@shared/api";
import { builderBodyLineDiff } from "@shared/builder-body-diff";
import {
  DOCUMENT_VERSION_NAME_MAX_LENGTH,
  type DocumentHistoryCheckpoint,
  type DocumentHistoryCheckpointDetail,
  type DocumentHistoryGroup,
  type DocumentVersionComparison,
  NAME_DOCUMENT_VERSION_OPERATION,
} from "@shared/document-history";
import { IMPORT_CONTENT_OPERATION } from "@shared/import/types";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconBookmark,
  IconBookmarkEdit,
  IconBookmarkOff,
  IconBookmarkPlus,
  IconChevronDown,
  IconChevronRight,
  IconLoader2,
  IconRefresh,
  IconRotate,
} from "@tabler/icons-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useDocumentHistoryCheckpoint,
  useDocumentHistoryCheckpoints,
  useDocumentHistoryPage,
  type NamedDocumentVersion,
  useDocumentVersionComparison,
  useNameDocumentVersion,
  useNamedDocumentVersions,
  useRestoreDocumentVersion,
} from "@/hooks/use-document-versions";

import { BodyLineDiffView } from "./BodyLineDiffView";
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
  canNameVersions?: boolean;
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

type SelectedVersion = Pick<
  DocumentHistoryCheckpoint,
  "id" | "title" | "createdAt" | "name"
>;

type DetailView = "preview" | "compare";

type NamingTarget = "current" | "checkpoint";

function mergeRefreshedFirstPage<T extends { id: string }>(
  refreshed: T[],
  loaded: T[],
): T[] {
  const refreshedIds = new Set(refreshed.map((item) => item.id));
  return [...refreshed, ...loaded.filter((item) => !refreshedIds.has(item.id))];
}

function appendPage<T extends { id: string }>(loaded: T[], page: T[]): T[] {
  const incoming = new Map(page.map((item) => [item.id, item]));
  const loadedIds = new Set(loaded.map((item) => item.id));
  return [
    ...loaded.map((item) => incoming.get(item.id) ?? item),
    ...page.filter((item) => !loadedIds.has(item.id)),
  ];
}

type VersionNames = ReadonlyMap<string, string | null>;

function withVersionName<T extends { id: string; name: string | null }>(
  item: T,
  versionNames: VersionNames,
): T {
  return versionNames.has(item.id)
    ? { ...item, name: versionNames.get(item.id) ?? null }
    : item;
}

export function VersionHistoryPanel({
  documentId,
  open,
  onOpenChange,
  canRestore = true,
  canNameVersions = canRestore,
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
  const nameCurrentButtonRef = useRef<HTMLButtonElement>(null);
  const nameCheckpointButtonRef = useRef<HTMLButtonElement>(null);
  const focusAfterNamingRef = useRef<NamingTarget | null>(null);
  const t = useT();
  const formatters = useFormatters();
  const [cursor, setCursor] = useState<string | null>(null);
  const [groups, setGroups] = useState<DocumentHistoryGroup[]>([]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedCheckpoint, setSelectedCheckpoint] =
    useState<SelectedVersion | null>(null);
  const [detailView, setDetailView] = useState<DetailView>("preview");
  const [namingTarget, setNamingTarget] = useState<NamingTarget | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [versionNames, setVersionNames] = useState<VersionNames>(
    () => new Map(),
  );
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
  const namedVersions = useNamedDocumentVersions(open ? documentId : null);
  const comparison = useDocumentVersionComparison(
    open && detailView === "compare" ? documentId : null,
    selectedCheckpoint?.id ?? null,
  );
  const restoreVersion = useRestoreDocumentVersion(documentId);
  const nameVersion = useNameDocumentVersion();

  useEffect(() => {
    setCursor(null);
    setGroups([]);
    setExpandedGroupIds(new Set());
    setSelectedCheckpoint(null);
    setDetailView("preview");
    setNamingTarget(null);
    setNameError(null);
    setVersionNames(new Map());
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
  const selectedCheckpointView = selectedCheckpoint ? detailView : null;
  useEffect(() => {
    void setHistoryApplicationState(
      historyStateKey,
      open
        ? {
            documentId,
            open: true,
            expandedGroupIds: expandedGroupIdList,
            selectedCheckpointId: selectedCheckpoint?.id ?? null,
            selectedCheckpointView,
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
    selectedCheckpointView,
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

  const detail = checkpointDetail.data?.checkpoint;
  const detailId = detail?.id;
  const detailName = detail?.name;
  useEffect(() => {
    if (!detailId || detailName === undefined) return;
    setSelectedCheckpoint((current) =>
      current && current.id === detailId && current.name !== detailName
        ? { ...current, name: detailName }
        : current,
    );
  }, [detailId, detailName]);

  const selectedName = selectedCheckpoint?.name ?? null;
  useEffect(() => {
    const target = focusAfterNamingRef.current;
    if (namingTarget || !target) return;
    focusAfterNamingRef.current = null;
    (target === "current"
      ? nameCurrentButtonRef
      : nameCheckpointButtonRef
    ).current?.focus();
  }, [namingTarget, selectedName]);

  const selectCheckpoint = (checkpoint: SelectedVersion | null) => {
    operationContextRef.current.generation += 1;
    setIsPreparingRestore(false);
    setDetailView("preview");
    setNamingTarget(null);
    setNameError(null);
    setSelectedCheckpoint(
      checkpoint
        ? {
            id: checkpoint.id,
            title: checkpoint.title,
            createdAt: checkpoint.createdAt,
            name: checkpoint.name,
          }
        : null,
    );
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      operationContextRef.current.generation += 1;
      operationContextRef.current.open = false;
      setIsPreparingRestore(false);
      setSelectedCheckpoint(null);
      setNamingTarget(null);
      setNameError(null);
      setVersionNames(new Map());
      setPendingRestore(null);
    }
    onOpenChange(nextOpen);
  };

  const openNaming = (target: NamingTarget) => {
    setNameError(null);
    setNamingTarget(target);
  };

  const closeNaming = () => {
    focusAfterNamingRef.current = namingTarget;
    setNameError(null);
    setNamingTarget(null);
  };

  const saveVersionName = async (target: NamingTarget, name: string) => {
    if (target === "checkpoint" && !selectedCheckpoint) return;
    const generation = operationContextRef.current.generation;
    setNameError(null);
    let checkpoint: DocumentHistoryCheckpoint;
    try {
      ({ checkpoint } = await nameVersion.mutateAsync({
        documentId,
        ...(target === "checkpoint" && selectedCheckpoint
          ? { versionId: selectedCheckpoint.id }
          : {}),
        name,
      }));
    } catch (error) {
      if (operationContextRef.current.generation !== generation) return;
      setNameError(
        actionErrorMessage(error) ?? t("editor.historyVersionNameFailed"),
      );
      return;
    }
    if (operationContextRef.current.generation !== generation) return;
    focusAfterNamingRef.current = target;
    setNamingTarget(null);
    setVersionNames((current) =>
      new Map(current).set(checkpoint.id, checkpoint.name),
    );
    setSelectedCheckpoint((current) =>
      current && current.id === checkpoint.id
        ? { ...current, name: checkpoint.name }
        : current,
    );
    toast.success(
      checkpoint.name
        ? t("editor.historyVersionNamed", { name: checkpoint.name })
        : t("editor.historyVersionNameRemoved"),
    );
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

  const showRestore = canRestore;
  const namedVersionList = namedVersions.data?.versions ?? [];
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
        <SheetContent
          side="right"
          className="w-[92vw] max-w-[430px] p-0"
          onEscapeKeyDown={(event) => {
            if (!namingTarget) return;
            event.preventDefault();
            if (!nameVersion.isPending) closeNaming();
          }}
        >
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
                {namingTarget === "checkpoint" ? (
                  <VersionNameForm
                    initialName={selectedName ?? ""}
                    pending={nameVersion.isPending}
                    error={nameError}
                    onCancel={closeNaming}
                    onSubmit={(name) =>
                      void saveVersionName("checkpoint", name)
                    }
                  />
                ) : (
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      {selectedName ? (
                        <p className="flex items-center gap-1.5 text-xs font-medium">
                          <IconBookmark className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{selectedName}</span>
                        </p>
                      ) : null}
                      <p
                        className={
                          selectedName
                            ? "mt-0.5 truncate text-[11px] text-muted-foreground"
                            : "truncate text-xs font-medium"
                        }
                      >
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
                    {canNameVersions ? (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          ref={nameCheckpointButtonRef}
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={nameVersion.isPending}
                          onClick={() => openNaming("checkpoint")}
                        >
                          {selectedName ? (
                            <IconBookmarkEdit className="size-3.5" />
                          ) : (
                            <IconBookmarkPlus className="size-3.5" />
                          )}
                          {selectedName
                            ? t("editor.historyRenameVersion")
                            : t("editor.historyNameVersion")}
                        </Button>
                        {selectedName ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                aria-label={t(
                                  "editor.historyRemoveVersionName",
                                )}
                                disabled={nameVersion.isPending}
                                onClick={() =>
                                  void saveVersionName("checkpoint", "")
                                }
                              >
                                {nameVersion.isPending ? (
                                  <IconLoader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <IconBookmarkOff className="size-3.5" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("editor.historyRemoveVersionName")}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )}
                {nameError && !namingTarget ? (
                  <p role="alert" className="mt-2 text-xs text-destructive">
                    {nameError}
                  </p>
                ) : null}
              </div>
              <div
                role="group"
                aria-label={t("editor.historyViewMode")}
                className="flex gap-1 border-b border-border px-3 py-2"
              >
                {(["preview", "compare"] as const).map((view) => (
                  <Button
                    key={view}
                    type="button"
                    variant={detailView === view ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    aria-pressed={detailView === view}
                    onClick={() => setDetailView(view)}
                  >
                    {view === "preview"
                      ? t("editor.historyPreview")
                      : t("editor.historyCompareWithCurrent")}
                  </Button>
                ))}
              </div>
              <ScrollArea className="flex-1">
                {detailView === "compare" ? (
                  comparison.isLoading ? (
                    <HistoryPreviewSkeleton />
                  ) : comparison.error ? (
                    <HistoryError
                      message={t("editor.historyCompareLoadError")}
                      retry={() => void comparison.refetch()}
                    />
                  ) : comparison.data ? (
                    <VersionComparisonView comparison={comparison.data} />
                  ) : null
                ) : checkpointDetail.isLoading ? (
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
            className={
              selectedCheckpoint
                ? "hidden"
                : "flex h-[calc(100%-60px)] flex-col"
            }
          >
            {canNameVersions ? (
              <div className="border-b border-border px-3 py-2">
                {namingTarget === "current" ? (
                  <VersionNameForm
                    initialName=""
                    pending={nameVersion.isPending}
                    error={nameError}
                    onCancel={closeNaming}
                    onSubmit={(name) => void saveVersionName("current", name)}
                  />
                ) : (
                  <Button
                    ref={nameCurrentButtonRef}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-full justify-start px-2 text-xs"
                    onClick={() => openNaming("current")}
                  >
                    <IconBookmarkPlus className="size-3.5" />
                    {t("editor.historyNameCurrentVersion")}
                  </Button>
                )}
              </div>
            ) : null}
            <ScrollArea className="min-h-0 flex-1">
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
              {namedVersionList.length > 0 ? (
                <NamedVersionList
                  versions={namedVersionList}
                  onSelect={selectCheckpoint}
                  formatDate={formatters.formatDate}
                />
              ) : namedVersions.error ? (
                <HistoryError
                  compact
                  message={t("editor.historyLoadError")}
                  retry={() => void namedVersions.refetch()}
                />
              ) : null}
              {namedVersionList.length > 0 && groups.length > 0 ? (
                <h3 className="px-4 pt-3 text-[11px] font-medium text-muted-foreground">
                  {t("editor.historyAllChanges")}
                </h3>
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
                      versionNames={versionNames}
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
  versionNames,
  formatDate,
}: {
  documentId: string;
  group: DocumentHistoryGroup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectCheckpoint: (checkpoint: DocumentHistoryCheckpoint) => void;
  versionNames: VersionNames;
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
            {loadedCheckpoints
              .map((checkpoint) => withVersionName(checkpoint, versionNames))
              .map((checkpoint) => (
                <button
                  type="button"
                  key={checkpoint.id}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-start hover:bg-accent"
                  onClick={() => onSelectCheckpoint(checkpoint)}
                >
                  {checkpoint.name ? (
                    <IconBookmark className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : null}
                  <span
                    className={
                      checkpoint.name
                        ? "min-w-0 flex-1 truncate text-xs font-medium"
                        : "min-w-0 flex-1 truncate text-xs"
                    }
                  >
                    {checkpoint.name ||
                      checkpoint.title ||
                      t("sidebar.untitled")}
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

function NamedVersionList({
  versions,
  onSelect,
  formatDate,
}: {
  versions: NamedDocumentVersion[];
  onSelect: (version: NamedDocumentVersion) => void;
  formatDate: ReturnType<typeof useFormatters>["formatDate"];
}) {
  const t = useT();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="px-1.5 pt-1.5">
      <h3
        id={headingId}
        className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground"
      >
        {t("editor.historyNamedVersions")}
      </h3>
      {versions.map((version) => (
        <button
          type="button"
          key={version.id}
          className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-start hover:bg-accent"
          onClick={() => onSelect(version)}
        >
          <IconBookmark className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">
              {version.name}
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
              {version.namedBy ? `${version.namedBy} · ` : ""}
              {formatHistoryDate(version.createdAt, formatDate)}
            </span>
          </span>
        </button>
      ))}
    </section>
  );
}

function VersionNameForm({
  initialName,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  pending: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialName);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const name = value.trim();
  const canSave = name.length > 0 && name !== initialName.trim() && !pending;
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) onSubmit(name);
      }}
    >
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={DOCUMENT_VERSION_NAME_MAX_LENGTH}
        readOnly={pending}
        aria-label={t("editor.historyVersionNameLabel")}
        placeholder={t("editor.historyVersionNameLabel")}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        size="sm"
      />
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={pending}
          onClick={onCancel}
        >
          {t("comments.cancel")}
        </Button>
        <Button
          type="submit"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={!canSave}
        >
          {pending ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
          {t("editor.historySaveVersionName")}
        </Button>
      </div>
    </form>
  );
}

function VersionComparisonView({
  comparison,
}: {
  comparison: DocumentVersionComparison;
}) {
  const t = useT();
  const titleDiff = useMemo(
    () =>
      comparison.title
        ? builderBodyLineDiff(comparison.title.before, comparison.title.after)
        : null,
    [comparison.title],
  );
  if (comparison.identical) {
    return (
      <p className="px-4 py-12 text-center text-xs text-muted-foreground">
        {t("editor.historyCompareIdentical")}
      </p>
    );
  }
  return (
    <div className="grid gap-4 px-4 py-4">
      {titleDiff ? (
        <div className="grid gap-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">
            {t("editor.historyCompareTitle")}
          </p>
          <BodyLineDiffView
            diff={titleDiff}
            label={t("editor.historyCompareTitle")}
          />
        </div>
      ) : null}
      {comparison.body ? (
        <BodyLineDiffView
          diff={comparison.body}
          label={t("editor.historyCompareLabel")}
        />
      ) : null}
    </div>
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
    if (group.origin === "github") return t("editor.historyGroupGitHub");
    if (group.operation === "restore-document-version") {
      return t("editor.historyGroupRestore");
    }
    if (group.operation === NAME_DOCUMENT_VERSION_OPERATION) {
      return t("editor.historyGroupNamed");
    }
    if (group.operation === IMPORT_CONTENT_OPERATION) {
      return group.importSourceName
        ? t("contentImport.historyGroupFrom", {
            name: group.importSourceName,
          })
        : t("contentImport.historyGroup");
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
