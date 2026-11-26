import { useT } from "@agent-native/core/client/i18n";
import {
  createFilterState,
  filterToday,
  type FilterState,
} from "@agent-native/toolkit/app/filters";
import type { DataGridColumn } from "@agent-native/toolkit/data-grid";
import type {
  ContentTrashItem,
  ContentTrashPurgeSpace,
  ContentTrashWhere,
} from "@shared/content-trash";
import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { ContentTableSurface } from "@/components/editor/database/ContentTable";
import { TrashDocumentPreview } from "@/components/editor/TrashDocumentPreview";
import { QueryErrorState } from "@/components/QueryErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRestoreContentDatabase } from "@/hooks/use-content-database";
import { useContentSpaces } from "@/hooks/use-content-spaces";
import {
  useContentTrash,
  clearTrashSelection,
  loadedTrashSelection,
  extendTrashSelection,
  nearestVisibleTrashRow,
  loadTrashPurgeStarts,
  reconcileTrashBrowseFilters,
  removeTrashPurgeStarts,
  isRestoreBusyError,
  isSettledRestoreFailure,
  isTrashRevisionConflict,
  restoredTrashItemIds,
  saveTrashPurgeStarts,
  selectedTrashItems,
  trashActionError,
  trashDeleteRequest,
  trashEmptyRequest,
  trashFilterMembershipKey,
  trashMatchingFilters,
  trashPurgeStartKey,
  trashRestoreIntentKey,
  trashRestoreRequest,
  trashRestoreSelectionCleanup,
  trashRestoreTargets,
  trashSelectionState,
  toggleVisibleTrashSelection,
  upsertTrashPurgeStarts,
  useContentTrashFilterOptions,
  useContentTrashPurgeSpaces,
  useRestoreTrashPage,
  useTrashContext,
  uniqueTrashItems,
  visibleTrashItems,
  type ContentTrashFilters,
  type ContentTrashPurgeRequest,
  type ContentTrashPurgeStart,
  type ContentTrashSelection,
  changeTrashSort,
} from "@/hooks/use-content-trash";

import { TrashOperationSurface, TrashPurgeDialog } from "./EmptyTrashDialog";
import {
  trashFilterFields,
  trashFilterOptions,
  trashWhereFromFilterState,
  type TrashFilterOptions,
} from "./trash-filter-model";
import { TrashFilters } from "./TrashFilters";
import { TrashRecoveryActions } from "./TrashRecoveryActions";
import {
  TRASH_TABLE_COLUMNS,
  TRASH_TABLE_WIDTHS,
  TrashRow,
  TrashTableHeader,
  trashTableWidths,
  type TrashColumnWidths,
} from "./TrashRow";

const TRASH_DATA_GRID_COLUMNS = TRASH_TABLE_COLUMNS.map((id) => ({
  id,
  width: TRASH_TABLE_WIDTHS[id],
  resizable: false,
})) satisfies DataGridColumn<ContentTrashItem>[];

function useStableWhere(where: ContentTrashWhere | undefined) {
  const ref = useRef(where);
  if (JSON.stringify(ref.current) !== JSON.stringify(where))
    ref.current = where;
  return ref.current;
}

export function TrashBrowser({
  initialPreviewId,
  fullPagePreview = false,
}: {
  initialPreviewId?: string | null;
  fullPagePreview?: boolean;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ContentTrashFilters>({});
  const [filterState, setFilterState] = useState<FilterState>(() =>
    createFilterState([]),
  );
  const [filterOptions, setFilterOptions] = useState<
    Pick<TrashFilterOptions, "people" | "locations">
  >({ people: [], locations: [] });
  const [columnWidths, setColumnWidths] = useState(TRASH_TABLE_WIDTHS);
  const [tableViewportWidth, setTableViewportWidth] = useState<number>();
  const tableFrameRef = useRef<HTMLDivElement>(null);
  const tableWidths = useMemo(
    () => trashTableWidths(columnWidths, tableViewportWidth),
    [columnWidths, tableViewportWidth],
  );
  const contentSpaces = useContentSpaces();
  const spaces = useMemo(
    () => contentSpaces.data?.spaces ?? [],
    [contentSpaces.data],
  );
  const purgeSpaces = useContentTrashPurgeSpaces();
  const serverFilterOptions = useContentTrashFilterOptions();
  const filterFields = useMemo(
    () =>
      trashFilterFields(
        {
          createdBy: t("trash.createdBy"),
          updatedBy: t("trash.updatedBy"),
          deletedBy: t("trash.deletedByColumn"),
          workspace: t("trash.workspace"),
          location: t("trash.location"),
          kind: t("trash.kind"),
          page: t("trash.page"),
          collection: t("trash.collection"),
          deletedAt: t("trash.deletedAtColumn"),
        },
        {
          ...filterOptions,
          spaces: spaces.map((space) => ({ id: space.id, label: space.name })),
        },
      ),
    [filterOptions, spaces, t],
  );
  const where = useStableWhere(
    trashWhereFromFilterState(filterState, filterFields, filterToday()),
  );
  const queryFilters = useMemo(
    () => (where ? { ...filters, where } : filters),
    [filters, where],
  );
  const deferredFilters = useDeferredValue(queryFilters);
  const filterMembershipKey = trashFilterMembershipKey(deferredFilters);
  const [selection, setSelection] = useState<ContentTrashSelection>(
    loadedTrashSelection([]),
  );
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [nestedItems, setNestedItems] = useState<
    Record<string, ContentTrashItem[]>
  >({});
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(
    null,
  );
  const [restoringIds, setRestoringIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const emptyTrashRef = useRef<HTMLButtonElement>(null);
  const deleteSelectionRef = useRef<HTMLButtonElement>(null);
  const purgeInvokerRef = useRef<HTMLElement | null>(null);
  const activePurgeId = useRef<string | null>(null);
  const previousVisibleOrder = useRef<string[]>([]);
  const [previewId, setPreviewId] = useState(initialPreviewId ?? null);
  const [purgeRequest, setPurgeRequest] = useState<{
    id: string;
    request: ContentTrashPurgeRequest;
  } | null>(null);
  const [purgeStarts, setPurgeStarts] = useState<
    ContentTrashPurgeStart[] | undefined
  >(undefined);
  const purgeStartsRef = useRef<ContentTrashPurgeStart[]>([]);
  const purgeWrites = useRef<Promise<unknown>>(Promise.resolve());
  const [trashOperationStateError, setTrashOperationStateError] =
    useState(false);
  const query = useContentTrash(deferredFilters);
  const restorePage = useRestoreTrashPage();
  const restoreCollection = useRestoreContentDatabase();
  const items = useMemo(
    () =>
      uniqueTrashItems(query.data?.pages.flatMap((page) => page.items) ?? []),
    [query.data],
  );
  const loadedItems = useMemo(
    () => [...items, ...Object.values(nestedItems).flat()],
    [items, nestedItems],
  );
  const loadedItemsRef = useRef(loadedItems);
  loadedItemsRef.current = loadedItems;
  const restoreIntents = useRef(new Map<string, string>());
  const selectedIds = selection.mode === "loaded" ? selection.documentIds : [];
  const visibleItems = useMemo(
    () => visibleTrashItems(items, nestedItems, expandedIds),
    [expandedIds, items, nestedItems],
  );
  const visibleIds = useMemo(
    () => visibleItems.map((item) => item.documentId),
    [visibleItems],
  );
  const activeFocusedId = focusedId ?? visibleIds[0] ?? null;
  const selected = selectedTrashItems(loadedItems, selectedIds);
  const purgeSpaceList = purgeSpaces.data?.spaces ?? [];
  const trashContext = { filters: deferredFilters, selection, previewId };
  const trashContextRef = useRef(trashContext);
  trashContextRef.current = trashContext;
  useTrashContext({ ...trashContext, enabled: purgeStarts !== undefined });

  useEffect(() => setSelection(clearTrashSelection()), [filterMembershipKey]);
  useEffect(() => setPreviewId(initialPreviewId ?? null), [initialPreviewId]);
  const untitled = t("sidebar.untitled");
  useEffect(
    () =>
      setFilterOptions(
        trashFilterOptions(loadedItems, serverFilterOptions.data, untitled),
      ),
    [loadedItems, serverFilterOptions.data, untitled],
  );

  const showsFullPagePreview = fullPagePreview && Boolean(previewId);
  useLayoutEffect(() => {
    if (showsFullPagePreview) return;
    const scroller = tableFrameRef.current?.querySelector(
      "[data-data-grid-scroll-container]",
    );
    if (!scroller) return;
    setTableViewportWidth(scroller.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries)
        setTableViewportWidth(entry.contentRect.width);
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [showsFullPagePreview]);

  function showPurgeStarts(next: ContentTrashPurgeStart[]) {
    purgeStartsRef.current = next;
    setPurgeStarts(next);
    setTrashOperationStateError(false);
  }

  function queuePurgeWrite<T>(write: () => Promise<T>) {
    const next = purgeWrites.current.then(write, write);
    purgeWrites.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function reloadPurgeStarts() {
    setTrashOperationStateError(false);
    void queuePurgeWrite(loadTrashPurgeStarts).then(
      (starts) =>
        showPurgeStarts(upsertTrashPurgeStarts(starts, purgeStartsRef.current)),
      () => setTrashOperationStateError(true),
    );
  }

  useEffect(() => {
    reloadPurgeStarts();
  }, []);

  function savePurgeStarts(updates: readonly ContentTrashPurgeStart[]) {
    return queuePurgeWrite(async () => {
      try {
        showPurgeStarts(
          await saveTrashPurgeStarts(purgeStartsRef.current, updates),
        );
      } catch (error) {
        purgeStartsRef.current = upsertTrashPurgeStarts(
          purgeStartsRef.current,
          updates.filter((start) => start.status !== "starting"),
        );
        setPurgeStarts((current) =>
          current === undefined ? current : purgeStartsRef.current,
        );
        throw error;
      }
    });
  }

  function dismissPurgeStarts() {
    const dismissed = purgeStartsRef.current;
    const keys = new Set(dismissed.map(trashPurgeStartKey));
    showPurgeStarts([]);
    if (!keys.size) return;
    void queuePurgeWrite(() => removeTrashPurgeStarts(keys)).then(
      () => undefined,
      () =>
        showPurgeStarts(
          upsertTrashPurgeStarts(dismissed, purgeStartsRef.current),
        ),
    );
  }

  function reviewPurgeAgain(
    start: ContentTrashPurgeStart,
    invoker: HTMLElement | null,
  ) {
    const input = start.input;
    if (!input) return;
    const key = trashPurgeStartKey(start);
    showPurgeStarts(
      purgeStartsRef.current.filter(
        (current) => trashPurgeStartKey(current) !== key,
      ),
    );
    void queuePurgeWrite(() => removeTrashPurgeStarts(new Set([key]))).then(
      () => undefined,
      () => toast.error(t("trash.startProgressUnsaved")),
    );
    void openPurgeWithSpaces(
      () => ({
        kind: input.mode === "scope" ? "empty" : "delete",
        targets: [{ spaceId: start.spaceId, input }],
        unavailableSpaceIds: [],
      }),
      invoker ?? emptyTrashRef.current,
    );
  }

  useEffect(() => {
    const nextFocus = nearestVisibleTrashRow(
      previousVisibleOrder.current,
      visibleIds,
      focusedId,
    );
    previousVisibleOrder.current = visibleIds;
    if (nextFocus !== focusedId) {
      setFocusedId(nextFocus);
      if (focusedId)
        requestAnimationFrame(() => {
          const row = rowRefs.current.get(nextFocus ?? "");
          if (row) row.focus();
          else if (document.activeElement === document.body)
            emptyTrashRef.current?.focus();
        });
    }
  }, [focusedId, visibleIds]);

  function handleRowKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    rowId: string,
  ) {
    if (event.target !== event.currentTarget) return;
    const index = visibleIds.indexOf(rowId);
    const offset =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (offset) {
      event.preventDefault();
      const targetId =
        visibleIds[
          Math.max(0, Math.min(visibleIds.length - 1, index + offset))
        ];
      if (!targetId) return;
      if (event.shiftKey) {
        const anchor =
          selectionAnchorId && visibleIds.includes(selectionAnchorId)
            ? selectionAnchorId
            : rowId;
        setSelection(
          loadedTrashSelection(
            extendTrashSelection(visibleIds, selectedIds, anchor, targetId),
          ),
        );
        setSelectionAnchorId(anchor);
      } else {
        setSelectionAnchorId(targetId);
      }
      setFocusedId(targetId);
      rowRefs.current.get(targetId)?.focus();
    } else if (event.key === " ") {
      event.preventDefault();
      setSelection(
        loadedTrashSelection(
          selectedIds.includes(rowId)
            ? selectedIds.filter((id) => id !== rowId)
            : [...selectedIds, rowId],
        ),
      );
      setSelectionAnchorId(rowId);
    }
  }

  function updateFilters(next: ContentTrashFilters) {
    const browseState = reconcileTrashBrowseFilters(filters, next, expandedIds);
    setFilters(next);
    setExpandedIds(browseState.expandedIds);
    if (browseState.clearNestedItems) {
      setNestedItems({});
    }
  }

  function updateFilterState(next: FilterState) {
    setFilterState(next);
    setExpandedIds([]);
    setNestedItems({});
  }

  async function restoreItem(item: ContentTrashItem) {
    const intentKey = trashRestoreIntentKey(item);
    const idempotencyKey =
      restoreIntents.current.get(intentKey) ?? crypto.randomUUID();
    restoreIntents.current.set(intentKey, idempotencyKey);
    const request = trashRestoreRequest(item, idempotencyKey);
    try {
      if (request.kind === "collection") {
        await restoreCollection.mutateAsync(request.input);
        restoreIntents.current.delete(intentKey);
        return {
          restored: true,
          ids: restoredTrashItemIds(item, loadedItems, null),
        };
      }
      const result = await restorePage.mutateAsync(request.input);
      restoreIntents.current.delete(intentKey);
      return {
        restored: result.receipt.outcome === "restored",
        ids: restoredTrashItemIds(item, loadedItems, result),
      };
    } catch (error) {
      if (isSettledRestoreFailure(error))
        restoreIntents.current.delete(intentKey);
      throw error;
    }
  }

  async function restoreItems(targets: ContentTrashItem[]) {
    if (!targets.length) return;
    setRestoringIds(
      (current) =>
        new Set([...current, ...targets.map((item) => item.documentId)]),
    );
    const submitted = new Map(
      loadedItems.map((item) => [item.documentId, item.trashedAt]),
    );
    let restoredCount = 0;
    let failure: unknown = null;
    for (const target of targets) {
      try {
        const restoredItem = await restoreItem(target);
        if (restoredItem.restored) restoredCount += 1;
        const ids = trashRestoreSelectionCleanup(
          restoredItem.ids,
          submitted,
          loadedItemsRef.current,
        );
        setSelection((current) =>
          current.mode === "loaded"
            ? loadedTrashSelection(
                current.documentIds.filter((id) => !ids.has(id)),
              )
            : current,
        );
        if (previewId && ids.has(previewId)) {
          setPreviewId(null);
          void navigate("/trash");
        }
      } catch (error) {
        failure ??= error;
      }
      setRestoringIds((current) => {
        const next = new Set(current);
        next.delete(target.documentId);
        return next;
      });
    }
    if (restoredCount)
      toast.success(
        restoredCount === 1
          ? t("trash.restored")
          : t("trash.restoredCount", { count: restoredCount }),
      );
    if (failure)
      toast.error(t("trash.restoreFailed"), {
        description: isRestoreBusyError(failure)
          ? t("trash.restoreBusy")
          : isTrashRevisionConflict(failure)
            ? t("trash.restoreConflict")
            : trashActionError(failure, t("trash.restoreFailed")),
      });
  }

  const purgeEmptyPending = purgeSpaces.isFetching && !purgeSpaces.data;

  async function openPurgeWithSpaces(
    build: (spaces: ContentTrashPurgeSpace[]) => ContentTrashPurgeRequest,
    invoker: HTMLElement | null,
  ) {
    const loaded =
      purgeSpaces.data?.spaces ?? (await purgeSpaces.refetch()).data?.spaces;
    if (!loaded) {
      toast.error(t("trash.workspacesFailed"));
      (invoker?.isConnected ? invoker : emptyTrashRef.current)?.focus();
      return;
    }
    const id = crypto.randomUUID();
    activePurgeId.current = id;
    purgeInvokerRef.current = invoker;
    setPurgeRequest({ id, request: build(loaded) });
  }

  function closePurge(id: string | null) {
    if (!id || activePurgeId.current !== id) return;
    activePurgeId.current = null;
    setPurgeRequest(null);
  }

  function spaceName(spaceId: string | null) {
    return (
      purgeSpaceList.find((space) => space.spaceId === spaceId)?.name ??
      spaces.find((space) => space.id === spaceId)?.name ??
      t("trash.unknownLocation")
    );
  }

  function rowHandlers(item: ContentTrashItem) {
    return {
      onRestore: () => void restoreItems([item]),
      onDelete: (invoker: HTMLElement | null) =>
        void openPurgeWithSpaces(
          (loaded) =>
            trashDeleteRequest(
              loadedTrashSelection([item.documentId]),
              loadedItems,
              loaded,
            ),
          invoker,
        ),
      restoring: restoringIds.has(item.documentId),
      purgeable: !purgeSpaceList.some(
        (space) => space.spaceId === item.spaceId && !space.canPurge,
      ),
    };
  }

  if (showsFullPagePreview && previewId)
    return <TrashDocumentPreview documentId={previewId} fullPage />;

  const purgeRequestId = purgeRequest?.id ?? null;

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-background">
      <main className="flex min-w-0 flex-1 flex-col gap-2 px-4 pt-3 sm:px-8 lg:px-10">
        <TrashFilters
          emptyTrashRef={emptyTrashRef}
          filters={filters}
          onChange={updateFilters}
          fields={filterFields}
          filterState={filterState}
          onFilterStateChange={updateFilterState}
          emptyTrashPending={purgeEmptyPending}
          onEmptyTrash={() =>
            void openPurgeWithSpaces(trashEmptyRequest, emptyTrashRef.current)
          }
        />
        <div
          ref={tableFrameRef}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {selection.mode === "matching" || selected.length ? (
            <TrashRecoveryActions
              deleteRef={deleteSelectionRef}
              selection={selection}
              selectedItems={selected}
              pendingRestore={restoringIds.size > 0}
              onRestore={() => void restoreItems(trashRestoreTargets(selected))}
              onSelectMatching={() =>
                setSelection({
                  mode: "matching",
                  filters: trashMatchingFilters(deferredFilters),
                })
              }
              onClear={() => setSelection(clearTrashSelection())}
              onDelete={() =>
                void openPurgeWithSpaces(
                  (loaded) =>
                    trashDeleteRequest(selection, loadedItems, loaded),
                  deleteSelectionRef.current,
                )
              }
            />
          ) : null}
          <ContentTableSurface
            columnOrder={TRASH_TABLE_COLUMNS}
            frozenThroughColumnId="name"
            rows={items}
            columns={TRASH_DATA_GRID_COLUMNS}
            columnWidths={tableWidths}
            viewportWidth={tableViewportWidth}
            getRowId={(item) => item.documentId}
            aria-label={t("trash.tableLabel")}
            className="h-full [&>div]:h-full"
            scrollContainerProps={{ className: "h-full" }}
            renderHeader={() =>
              items.length > 0 ? (
                <TrashTableHeader
                  checked={trashSelectionState(visibleIds, selectedIds)}
                  sort={filters.sort ?? "deletedAt"}
                  direction={filters.direction ?? "desc"}
                  onSelectLoaded={() =>
                    setSelection(
                      loadedTrashSelection(
                        toggleVisibleTrashSelection(visibleIds, selectedIds),
                      ),
                    )
                  }
                  onSort={(sort) =>
                    updateFilters(changeTrashSort(filters, sort))
                  }
                  onResize={(column, width) =>
                    setColumnWidths((current) => ({
                      ...current,
                      [column]: width,
                    }))
                  }
                  widths={tableWidths}
                />
              ) : null
            }
            renderBody={() => (
              <>
                {query.isLoading ? (
                  <div className="grid gap-px">
                    {Array.from({ length: 7 }, (_, index) => (
                      <Skeleton
                        key={index}
                        className="h-12 w-full rounded-none"
                      />
                    ))}
                  </div>
                ) : query.isError ? (
                  <div className="flex h-full items-center justify-center">
                    <QueryErrorState
                      onRetry={() => void query.refetch()}
                      retrying={query.isFetching}
                    />
                  </div>
                ) : items.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    {filters.query || where
                      ? t("trash.noMatches")
                      : t("trash.empty")}
                  </div>
                ) : (
                  items.map((item) => (
                    <TrashItemWithChildren
                      key={item.documentId}
                      item={item}
                      sort={filters.sort}
                      direction={filters.direction}
                      selectedIds={selectedIds}
                      expanded={expandedIds.includes(item.documentId)}
                      onSelectionChange={(ids) =>
                        setSelection(loadedTrashSelection(ids))
                      }
                      onToggle={() =>
                        setExpandedIds((current) =>
                          current.includes(item.documentId)
                            ? current.filter((id) => id !== item.documentId)
                            : [...current, item.documentId],
                        )
                      }
                      onOpen={setPreviewId}
                      rowHandlers={rowHandlers}
                      onVisibleItemsChange={(children) =>
                        setNestedItems((current) => ({
                          ...current,
                          [item.documentId]: children,
                        }))
                      }
                      focusedId={activeFocusedId}
                      onRowFocus={(id) => setFocusedId(id)}
                      onRowRef={(id, node) =>
                        node
                          ? rowRefs.current.set(id, node)
                          : rowRefs.current.delete(id)
                      }
                      onRowKeyDown={handleRowKeyDown}
                      widths={tableWidths}
                    />
                  ))
                )}
                {query.hasNextPage ? (
                  <div className="flex justify-center p-4">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={query.isFetchingNextPage}
                      onClick={() => void query.fetchNextPage()}
                    >
                      {t("trash.loadMore")}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          />
        </div>
        <TrashOperationSurface
          starts={purgeStarts}
          stateError={trashOperationStateError}
          spaceName={spaceName}
          onRetryState={reloadPurgeStarts}
          onStartsChange={savePurgeStarts}
          onDismiss={dismissPurgeStarts}
          onReviewAgain={reviewPurgeAgain}
        />
      </main>
      {previewId ? (
        <aside className="hidden min-w-0 flex-[0_0_48%] border-s lg:flex">
          <TrashDocumentPreview
            documentId={previewId}
            onClose={() => {
              setPreviewId(null);
              void navigate("/trash");
            }}
          />
        </aside>
      ) : null}
      {previewId ? (
        <div className="fixed inset-0 z-30 flex bg-background lg:hidden">
          <TrashDocumentPreview documentId={previewId} fullPage />
        </div>
      ) : null}
      <TrashPurgeDialog
        key={purgeRequest?.id ?? "closed"}
        request={purgeRequest?.request ?? null}
        spaceName={spaceName}
        onClose={() => closePurge(purgeRequestId)}
        onStartsChange={savePurgeStarts}
        returnFocus={() =>
          purgeInvokerRef.current?.isConnected
            ? purgeInvokerRef.current
            : emptyTrashRef.current
        }
        onAcknowledged={() => {
          if (activePurgeId.current !== purgeRequestId) return;
          closePurge(purgeRequestId);
          setSelection(clearTrashSelection());
        }}
      />
    </div>
  );
}

type TrashRowHandlers = (item: ContentTrashItem) => {
  onRestore: () => void;
  onDelete: (invoker: HTMLElement | null) => void;
  restoring: boolean;
  purgeable: boolean;
};

function TrashItemWithChildren({
  item,
  sort,
  direction,
  selectedIds,
  expanded,
  onSelectionChange,
  onToggle,
  onOpen,
  rowHandlers,
  onVisibleItemsChange,
  focusedId,
  onRowFocus,
  onRowRef,
  onRowKeyDown,
  widths,
}: {
  item: ContentTrashItem;
  sort: ContentTrashFilters["sort"];
  direction: ContentTrashFilters["direction"];
  selectedIds: string[];
  expanded: boolean;
  onSelectionChange: (ids: string[]) => void;
  onToggle: () => void;
  onOpen: (id: string) => void;
  rowHandlers: TrashRowHandlers;
  onVisibleItemsChange: (items: ContentTrashItem[]) => void;
  focusedId: string | null;
  onRowFocus: (id: string) => void;
  onRowRef: (id: string, node: HTMLDivElement | null) => void;
  onRowKeyDown: (event: KeyboardEvent<HTMLDivElement>, id: string) => void;
  widths: TrashColumnWidths;
}) {
  const t = useT();
  const children = useContentTrash({ sort, direction }, item.documentId, {
    enabled: expanded && item.hasAccessibleTrashedChildren,
  });
  const visibleChildren = useMemo(
    () =>
      children.isPlaceholderData
        ? []
        : uniqueTrashItems(
            children.data?.pages.flatMap((page) => page.items) ?? [],
          ).filter((child) => child.documentId !== item.documentId),
    [children.data, children.isPlaceholderData, item.documentId],
  );
  useEffect(() => {
    onVisibleItemsChange(expanded ? visibleChildren : []);
    // The parent callback is render-local; fetched rows and expansion own updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, visibleChildren]);
  return (
    <>
      <TrashRow
        item={item}
        selected={selectedIds.includes(item.documentId)}
        expanded={expanded}
        onSelect={(checked) =>
          onSelectionChange(
            checked
              ? [...new Set([...selectedIds, item.documentId])]
              : selectedIds.filter((id) => id !== item.documentId),
          )
        }
        onToggle={onToggle}
        onOpen={() => onOpen(item.documentId)}
        {...rowHandlers(item)}
        focused={focusedId === item.documentId}
        rowRef={(node) => onRowRef(item.documentId, node)}
        onFocus={() => onRowFocus(item.documentId)}
        onKeyDown={(event) => onRowKeyDown(event, item.documentId)}
        widths={widths}
      />
      {expanded ? (
        <div>
          {children.isLoading || children.isPlaceholderData ? (
            <Skeleton className="h-12 w-full rounded-none" />
          ) : children.isError ? (
            <div className="p-3 text-xs text-destructive">
              {t("trash.nestedUnavailable")}
            </div>
          ) : (
            <>
              {visibleChildren.map((child) => (
                <TrashRow
                  key={child.documentId}
                  item={child}
                  selected={selectedIds.includes(child.documentId)}
                  expanded={false}
                  onSelect={(checked) =>
                    onSelectionChange(
                      checked
                        ? [...new Set([...selectedIds, child.documentId])]
                        : selectedIds.filter((id) => id !== child.documentId),
                    )
                  }
                  onToggle={() => {}}
                  onOpen={() => onOpen(child.documentId)}
                  {...rowHandlers(child)}
                  focused={focusedId === child.documentId}
                  rowRef={(node) => onRowRef(child.documentId, node)}
                  onFocus={() => onRowFocus(child.documentId)}
                  onKeyDown={(event) => onRowKeyDown(event, child.documentId)}
                  nested
                  widths={widths}
                />
              ))}
              {children.hasNextPage ? (
                <div className="flex justify-center p-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={children.isFetchingNextPage}
                    onClick={() => void children.fetchNextPage()}
                  >
                    {children.isFetchingNextPage
                      ? t("trash.loadingMore")
                      : t("trash.loadMore")}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
