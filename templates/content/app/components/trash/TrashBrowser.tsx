import { useT } from "@agent-native/core/client/i18n";
import type { DataGridColumn } from "@agent-native/toolkit/data-grid";
import type { ContentTrashItem } from "@shared/content-trash";
import {
  useDeferredValue,
  useEffect,
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
import { useContentSpaces } from "@/hooks/use-content-spaces";
import {
  useContentTrash,
  clearTrashSelection,
  loadedTrashSelection,
  extendTrashSelection,
  nearestVisibleTrashRow,
  readTrashOperationId,
  reconcileTrashBrowseFilters,
  selectedTrashItems,
  trashActionError,
  trashFilterMembershipKey,
  trashMatchingFilters,
  trashScopePlanInput,
  trashSelectionPlanInput,
  trashSelectionState,
  toggleVisibleTrashSelection,
  useRestoreTrashItem,
  useTrashContext,
  uniqueTrashItems,
  visibleTrashItems,
  type ContentTrashFilters,
  type ContentTrashPurgeInput,
  type ContentTrashSelection,
  changeTrashSort,
} from "@/hooks/use-content-trash";

import { TrashOperationSurface, TrashPurgeDialog } from "./EmptyTrashDialog";
import { TrashFilters } from "./TrashFilters";
import { TrashRecoveryActions } from "./TrashRecoveryActions";
import {
  TRASH_TABLE_COLUMNS,
  TRASH_TABLE_WIDTHS,
  TrashRow,
  TrashTableHeader,
  trashTableWidthsForViewport,
} from "./TrashRow";

const TRASH_DATA_GRID_COLUMNS = TRASH_TABLE_COLUMNS.map((id) => ({
  id,
  width: TRASH_TABLE_WIDTHS[id],
  resizable: false,
})) satisfies DataGridColumn<ContentTrashItem>[];

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
  const [tableViewportWidth, setTableViewportWidth] = useState<number>();
  const tableWidths = useMemo(
    () => trashTableWidthsForViewport(tableViewportWidth),
    [tableViewportWidth],
  );
  const deferredFilters = useDeferredValue(filters);
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
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const emptyTrashRef = useRef<HTMLButtonElement>(null);
  const deleteSelectionRef = useRef<HTMLButtonElement>(null);
  const purgeInvokerRef = useRef<HTMLElement | null>(null);
  const previousVisibleOrder = useRef<string[]>([]);
  const [previewId, setPreviewId] = useState(initialPreviewId ?? null);
  const [purgeRequest, setPurgeRequest] = useState<{
    id: string;
    input: ContentTrashPurgeInput;
  } | null>(null);
  const [trashOperationId, setTrashOperationId] = useState<
    string | null | undefined
  >(undefined);
  const [trashOperationStateError, setTrashOperationStateError] =
    useState(false);
  const query = useContentTrash(deferredFilters);
  const contentSpaces = useContentSpaces();
  const spaces = contentSpaces.data?.spaces ?? [];
  const restore = useRestoreTrashItem();
  const items = useMemo(
    () =>
      uniqueTrashItems(query.data?.pages.flatMap((page) => page.items) ?? []),
    [query.data],
  );
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
  const selected = selectedTrashItems(
    [...items, ...Object.values(nestedItems).flat()],
    selectedIds,
  );
  useTrashContext({
    filters: deferredFilters,
    selection,
    previewId,
    operationId: trashOperationId,
  });

  useEffect(() => setSelection(clearTrashSelection()), [filterMembershipKey]);
  useEffect(() => setPreviewId(initialPreviewId ?? null), [initialPreviewId]);
  async function loadTrashOperationId() {
    setTrashOperationStateError(false);
    try {
      setTrashOperationId(await readTrashOperationId());
    } catch {
      setTrashOperationStateError(true);
    }
  }

  useEffect(() => {
    void loadTrashOperationId();
  }, []);

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
        requestAnimationFrame(() =>
          rowRefs.current.get(nextFocus ?? "")?.focus(),
        );
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

  async function restoreSelected() {
    const target =
      selected.length === 1 && selected[0]?.canRestore ? selected[0] : null;
    if (!target) return;
    try {
      await restore.mutateAsync({ id: target.documentId });
      setSelection(clearTrashSelection());
      toast.success(t("trash.restored"));
    } catch (error) {
      toast.error(t("trash.restoreFailed"), {
        description: trashActionError(error, t("trash.restoreFailed")),
      });
    }
  }

  if (fullPagePreview && previewId)
    return <TrashDocumentPreview documentId={previewId} fullPage />;

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-background">
      <main className="flex min-w-0 flex-1 flex-col">
        <TrashFilters
          emptyTrashRef={emptyTrashRef}
          filters={filters}
          spaces={spaces}
          onChange={updateFilters}
          onEmptyTrash={() => {
            purgeInvokerRef.current = emptyTrashRef.current;
            setPurgeRequest({
              id: crypto.randomUUID(),
              input: trashScopePlanInput(
                filters.spaceId ??
                  (spaces.length === 1 ? spaces[0]?.id : undefined),
              ),
            });
          }}
        />
        <ContentTableSurface
          columnOrder={TRASH_TABLE_COLUMNS}
          frozenThroughColumnId="name"
          rows={items}
          columns={TRASH_DATA_GRID_COLUMNS}
          columnWidths={tableWidths}
          onViewportWidthChange={setTableViewportWidth}
          getRowId={(item) => item.documentId}
          aria-label={t("trash.tableLabel")}
          className="h-full"
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
                onSort={(sort) => updateFilters(changeTrashSort(filters, sort))}
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
                  {Object.keys(filters).some(
                    (key) => filters[key as keyof ContentTrashFilters],
                  )
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
        {!trashOperationId &&
        (selection.mode === "matching" || selected.length) ? (
          <TrashRecoveryActions
            deleteRef={deleteSelectionRef}
            selection={selection}
            selectedItems={selected}
            pendingRestore={restore.isPending}
            onRestore={() => void restoreSelected()}
            onSelectMatching={() =>
              setSelection({
                mode: "matching",
                filters: trashMatchingFilters(deferredFilters),
              })
            }
            onClear={() => setSelection(clearTrashSelection())}
            onDelete={() => {
              purgeInvokerRef.current = deleteSelectionRef.current;
              setPurgeRequest({
                id: crypto.randomUUID(),
                input: trashSelectionPlanInput(selection),
              });
            }}
          />
        ) : null}
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
        intent={purgeRequest?.input ?? null}
        onClose={() => setPurgeRequest(null)}
        returnFocus={() =>
          purgeInvokerRef.current?.isConnected
            ? purgeInvokerRef.current
            : (rowRefs.current.get(focusedId ?? "") ?? emptyTrashRef.current)
        }
        onAcknowledged={(operationId) => {
          setTrashOperationId(operationId);
          setPurgeRequest(null);
          setSelection(clearTrashSelection());
        }}
      />
      <TrashOperationSurface
        operationId={trashOperationId}
        stateError={trashOperationStateError}
        onRetryState={loadTrashOperationId}
        onDismiss={() => setTrashOperationId(null)}
      />
    </div>
  );
}

function TrashItemWithChildren({
  item,
  sort,
  direction,
  selectedIds,
  expanded,
  onSelectionChange,
  onToggle,
  onOpen,
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
  onVisibleItemsChange: (items: ContentTrashItem[]) => void;
  focusedId: string | null;
  onRowFocus: (id: string) => void;
  onRowRef: (id: string, node: HTMLDivElement | null) => void;
  onRowKeyDown: (event: KeyboardEvent<HTMLDivElement>, id: string) => void;
  widths: Record<string, number>;
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
