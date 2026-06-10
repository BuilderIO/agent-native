import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconAdjustmentsHorizontal,
  IconArrowsSort,
  IconCalendar,
  IconCalendarDue,
  IconCalendarEvent,
  IconCalendarOff,
  IconChevronRight,
  IconCopy,
  IconChevronDown,
  IconCheck,
  IconDots,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconFilter,
  IconFileText,
  IconGripVertical,
  IconLayoutKanban,
  IconLayoutGrid,
  IconList,
  IconMinus,
  IconPlus,
  IconPalette,
  IconPencil,
  IconSearch,
  IconTable,
  IconTimeline,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import {
  useAddDatabaseItem,
  useContentDatabase,
  useDuplicateDatabaseItem,
  useMoveDatabaseItem,
  useUpdateContentDatabaseView,
} from "@/hooks/use-content-database";
import {
  useConfigureDocumentProperty,
  useSetDocumentProperty,
} from "@/hooks/use-document-properties";
import {
  useDeleteDocument,
  useDocument,
  useUpdateDocument,
} from "@/hooks/use-documents";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AddProperty,
  DocumentProperties,
  PropertyManagementPopover,
  PropertyValuePopover,
  OPTION_COLORS,
  OPTION_COLOR_CLASSES,
  TYPE_ICONS,
  canCreatePropertyOption,
  dateInputValueForOffset,
  filterPropertyOptions,
  filesMediaItems,
  displayValue,
  nextPropertyOption,
  removePropertyOption,
  renamePropertyOption,
  updatePropertyOptionColor,
} from "./DocumentProperties";
import { EmojiPicker } from "./EmojiPicker";
import { VisualEditor } from "./VisualEditor";
import type {
  ContentDatabaseItem,
  ContentDatabaseResponse,
  ContentDatabaseView,
  ContentDatabaseViewConfig,
  ContentDatabaseColumnCalculation,
  ContentDatabaseFilter,
  ContentDatabaseFilterMode,
  ContentDatabaseFilterOperator,
  ContentDatabaseOpenPagesIn,
  ContentDatabaseRowDensity,
  ContentDatabaseSort,
  ContentDatabaseSortDirection,
  ContentDatabaseViewType,
  Document,
  DocumentProperty,
  DocumentPropertyOption,
  DocumentPropertyType,
  DocumentPropertyValue,
} from "@shared/api";
import {
  type DocumentPropertyOptionColor,
  documentPropertyDateKey,
  documentPropertyDatePart,
  formulaValueText,
  isComputedPropertyType,
  isEmptyPropertyValue,
} from "@shared/properties";

interface DocumentDatabaseProps {
  document: Document;
  canEdit: boolean;
}

export type SortDirection = ContentDatabaseSortDirection;
export type DatabaseSort = ContentDatabaseSort;
export type FilterOperator = ContentDatabaseFilterOperator;
export type DatabaseFilter = ContentDatabaseFilter;
export type DatabaseFilterMode = ContentDatabaseFilterMode;
export type DatabaseColumnCalculation = ContentDatabaseColumnCalculation;
export type DatabaseRowDensity = ContentDatabaseRowDensity;
export type ColumnKey = "name" | string;

const DEFAULT_NAME_COLUMN_WIDTH = 240;
const DEFAULT_PROPERTY_COLUMN_WIDTH = 180;
const MIN_COLUMN_WIDTH = 96;
const MAX_COLUMN_WIDTH = 640;
const ACTION_COLUMN_WIDTH = 48;
const EMPTY_DEFAULT_ADD_PROPERTY_COLUMN_WIDTH = 220;
const EMPTY_DEFAULT_BLANK_ROW_COUNT = 5;
const DATABASE_DRAG_THRESHOLD = 6;
const DATABASE_VIEW_TYPES: ContentDatabaseViewType[] = [
  "table",
  "board",
  "gallery",
  "list",
  "timeline",
  "calendar",
];
const DATABASE_OPEN_PAGES_IN: ContentDatabaseOpenPagesIn[] = [
  "preview",
  "full_page",
];
const DATABASE_FILTER_MODES: DatabaseFilterMode[] = ["and", "or"];
type CreateDatabaseRowHandler = (
  title?: string,
) => Promise<ContentDatabaseItem | null>;
type DatabaseDragPreviewState =
  | {
      kind: "view";
      label: string;
      type: ContentDatabaseViewType;
      x: number;
      y: number;
      width: number;
    }
  | {
      kind: "property";
      label: string;
      type: DocumentPropertyType;
      x: number;
      y: number;
      width: number;
    };
type DatabaseDropSide = "before" | "after";
type DatabaseDropTargetState = {
  id: string;
  side: DatabaseDropSide;
};

function databaseDragMoved(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
) {
  return (
    Math.hypot(clientX - startX, clientY - startY) >= DATABASE_DRAG_THRESHOLD
  );
}

function suppressNextDocumentClick() {
  const handler = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  globalThis.document.addEventListener("click", handler, {
    capture: true,
    once: true,
  });
}

function databaseDragPreviewFromElement(
  element: HTMLElement,
  label: string,
  preview:
    | { kind: "view"; type: ContentDatabaseViewType }
    | { kind: "property"; type: DocumentPropertyType },
  clientX: number,
  clientY: number,
): DatabaseDragPreviewState {
  const rect = element.getBoundingClientRect();
  return {
    ...preview,
    label,
    x: clientX,
    y: clientY,
    width: Math.min(rect.width, preview.kind === "property" ? 220 : 180),
  };
}

function databaseDropSideForElement(
  element: HTMLElement,
  clientX: number,
): DatabaseDropSide {
  const rect = element.getBoundingClientRect();
  return clientX < rect.left + rect.width / 2 ? "before" : "after";
}

function DatabaseDragPreview({
  preview,
}: {
  preview: DatabaseDragPreviewState | null;
}) {
  if (!preview) return null;

  const Icon =
    preview.kind === "view"
      ? databaseViewIcon(preview.type)
      : TYPE_ICONS[preview.type];

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed left-0 top-0 z-[9999] flex max-w-56 items-center gap-1.5 overflow-hidden rounded-md border border-border bg-background/95 px-2 text-sm shadow-lg",
        preview.kind === "view" ? "h-7 font-medium" : "h-8 text-xs",
      )}
      style={{
        width: preview.width,
        transform: `translate3d(${preview.x + 12}px, ${preview.y + 10}px, 0)`,
      }}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{preview.label}</span>
    </div>
  );
}

function DatabaseDropIndicator({ side }: { side: DatabaseDropSide | null }) {
  if (!side) return null;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute bottom-1 top-1 z-20 w-[3px] rounded-full",
        side === "before" ? "-left-0.5" : "-right-0.5",
      )}
      style={{
        background: "hsl(210 100% 52%)",
        boxShadow: "0 0 0 1px hsl(var(--background))",
      }}
    />
  );
}

export function databaseItemPageIconText(
  document: Pick<Document, "icon"> | null | undefined,
) {
  const icon = document?.icon?.trim();
  return icon ? icon : null;
}

function DatabaseItemPageIcon({
  document,
  className,
  fallbackClassName,
}: {
  document: Pick<Document, "icon">;
  className?: string;
  fallbackClassName?: string;
}) {
  const icon = databaseItemPageIconText(document);
  if (icon) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center leading-none",
          className,
        )}
      >
        {icon}
      </span>
    );
  }

  return (
    <IconFileText
      className={cn("shrink-0 text-muted-foreground", fallbackClassName)}
    />
  );
}

export function DocumentDatabase({ document, canEdit }: DocumentDatabaseProps) {
  if (document.database) {
    return <DatabaseTable document={document} canEdit={canEdit} />;
  }

  return null;
}

function DatabaseTable({
  document,
  canEdit,
}: {
  document: Document;
  canEdit: boolean;
}) {
  const navigate = useNavigate();
  const database = useContentDatabase(document.id);
  const addItem = useAddDatabaseItem(document.id);
  const setProperty = useSetDocumentProperty(document.id);
  const updateView = useUpdateContentDatabaseView(document.id);
  const data = database.data;
  const properties = data?.properties ?? [];
  const items = data?.items ?? [];
  const databaseId = data?.database.id ?? null;
  const [previewDocumentId, setPreviewDocumentId] = useState<string | null>(
    null,
  );
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [previewTitleFocusDocumentId, setPreviewTitleFocusDocumentId] =
    useState<string | null>(null);
  const [inlineTitleFocusDocumentId, setInlineTitleFocusDocumentId] = useState<
    string | null
  >(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPanel, setSettingsPanel] =
    useState<DatabaseSettingsPanel>("main");
  const [viewConfig, setViewConfig] = useState<ContentDatabaseViewConfig>(
    defaultDatabaseViewConfig(),
  );
  const [dateViewMonth, setDateViewMonth] = useState(() =>
    startOfMonth(new Date()),
  );
  const activeView = useMemo(
    () => activeDatabaseView(viewConfig),
    [viewConfig],
  );
  const orderedProperties = useMemo(
    () => orderDatabasePropertiesForView(properties, activeView),
    [properties, activeView],
  );
  const sorts = activeView.sorts;
  const filters = activeView.filters;
  const filterMode = activeView.filterMode ?? "and";
  const columnWidths = activeView.columnWidths;
  const databaseGroupProperty = useMemo(
    () => databaseViewGroupingProperty(activeView, orderedProperties),
    [activeView, orderedProperties],
  );
  const boardGroupProperty = useMemo(
    () => databaseBoardGroupingProperty(activeView, orderedProperties),
    [activeView, orderedProperties],
  );
  const dateViewProperty = useMemo(
    () => databaseCalendarDateProperty(activeView, orderedProperties),
    [activeView, orderedProperties],
  );
  const dateViewRange = useMemo(
    () => databaseDateViewRange(activeView.type, dateViewMonth),
    [activeView.type, dateViewMonth],
  );
  const hydratedViewRef = useRef("");
  const saveViewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewStateRef = useRef<{
    documentId: string | null;
    visibleItems: ContentDatabaseItem[];
  }>({ documentId: null, visibleItems: [] });
  const tableProperties = useMemo(
    () =>
      orderedProperties.filter((property) =>
        isDatabasePropertyVisibleInView(property, items, activeView),
      ),
    [orderedProperties, items, activeView],
  );
  const hiddenProperties = useMemo(
    () =>
      orderedProperties.filter(
        (property) =>
          !isDatabasePropertyVisibleInView(property, items, activeView),
      ),
    [orderedProperties, items, activeView],
  );
  const visibleItems = useMemo(
    () =>
      applyDatabaseView(
        items,
        properties,
        searchQuery,
        filters,
        sorts,
        filterMode,
      ),
    [items, properties, searchQuery, filters, sorts, filterMode],
  );
  const screenVisibleItems = useMemo(
    () =>
      databaseScreenVisibleItems(
        activeView,
        visibleItems,
        orderedProperties,
        dateViewRange,
      ),
    [activeView, visibleItems, orderedProperties, dateViewRange],
  );
  const activeFilters = useMemo(
    () => filters.filter(isActiveFilter),
    [filters],
  );
  const activeConstraintCount = activeDatabaseConstraintCount(
    searchQuery,
    sorts,
    filters,
  );
  const rowsAreManuallyOrdered =
    !searchQuery.trim() &&
    sorts.length === 0 &&
    activeFilters.length === 0 &&
    !databaseGroupProperty;
  const hasResultConstraints = !!searchQuery.trim() || activeFilters.length > 0;
  const previewItem =
    items.find((item) => item.document.id === previewDocumentId) ?? null;
  const previousPreviewItem = previewItem
    ? databaseItemPreviewNeighbor(
        screenVisibleItems,
        previewItem.document.id,
        "prev",
      )
    : null;
  const nextPreviewItem = previewItem
    ? databaseItemPreviewNeighbor(
        screenVisibleItems,
        previewItem.document.id,
        "next",
      )
    : null;
  const previewPosition = previewItem
    ? databaseItemPreviewPosition(screenVisibleItems, previewItem.document.id)
    : null;
  const selectedItems = useMemo(
    () => databaseSelectedItems(visibleItems, selectedItemIds),
    [visibleItems, selectedItemIds],
  );

  useEffect(() => {
    previewStateRef.current = {
      documentId: previewDocumentId,
      visibleItems: screenVisibleItems,
    };
  }, [previewDocumentId, screenVisibleItems]);

  useEffect(() => {
    setSelectedItemIds((current) =>
      pruneDatabaseRowSelection(current, visibleItems),
    );
  }, [visibleItems]);

  useEffect(() => {
    if (!databaseId) return;
    const state = databaseNavigationState({
      document,
      databaseId,
      views: viewConfig.views,
      activeView,
      searchQuery,
      sorts,
      activeFilters,
      activeFilterCount: activeFilters.length,
      properties: orderedProperties,
      dateRange: dateViewRange,
      visibleItems: screenVisibleItems,
      visibleProperties: tableProperties,
      visibleItemCount: screenVisibleItems.length,
      totalItemCount: items.length,
      selectedItems,
      previewItem,
    });
    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [
    activeView,
    activeFilters.length,
    databaseId,
    dateViewRange,
    document,
    activeFilters,
    items.length,
    orderedProperties,
    previewItem,
    searchQuery,
    selectedItems,
    sorts,
    screenVisibleItems,
    tableProperties,
  ]);

  function previewItemPage(item: ContentDatabaseItem) {
    if (activeView.openPagesIn === "full_page") {
      openItemPage(item);
      return;
    }
    setPreviewDocumentId(item.document.id);
  }

  function handleDeletedPreviewItem(item: ContentDatabaseItem) {
    const previewState = previewStateRef.current;
    if (previewState.documentId !== item.document.id) return false;
    const nextPreviewItem = databaseItemPreviewFallbackAfterDelete(
      previewState.visibleItems,
      item.document.id,
    );
    setPreviewDocumentId(nextPreviewItem?.document.id ?? null);
    return true;
  }

  function handleDeletedPreviewItems(deletedItems: ContentDatabaseItem[]) {
    const previewState = previewStateRef.current;
    const deletedDocumentIds = deletedItems.map((item) => item.document.id);
    if (
      !previewState.documentId ||
      !deletedDocumentIds.includes(previewState.documentId)
    ) {
      return false;
    }
    const nextPreviewItem = databaseItemPreviewFallbackAfterBulkDelete(
      previewState.visibleItems,
      previewState.documentId,
      deletedDocumentIds,
    );
    setPreviewDocumentId(nextPreviewItem?.document.id ?? null);
    return true;
  }

  function openItemPage(item: ContentDatabaseItem) {
    navigate(`/page/${item.document.id}`);
  }

  async function createRow(
    title = "",
    propertyValueOverrides: Record<string, DocumentPropertyValue> = {},
    options: {
      openAfterCreate?: boolean;
      focusInlineTitle?: boolean;
    } = {},
  ) {
    if (!databaseId) return null;
    const propertyValues = {
      ...databasePropertyValuesForNewItem(filters, properties, filterMode),
      ...propertyValueOverrides,
    };
    const response = await addItem.mutateAsync({
      databaseId,
      title,
      propertyValues:
        Object.keys(propertyValues).length > 0 ? propertyValues : undefined,
    });
    const createdItem = response.items.find(
      (item) => item.id === response.createdItemId,
    );
    if (createdItem && options.openAfterCreate !== false) {
      setPreviewDocumentId(createdItem.document.id);
      setPreviewTitleFocusDocumentId(createdItem.document.id);
    }
    if (createdItem && options.focusInlineTitle) {
      setInlineTitleFocusDocumentId(createdItem.document.id);
    }
    return createdItem ?? null;
  }

  async function createBoardCard(group: DatabaseBoardGroup, title = "") {
    if (!databaseId) return null;
    const propertyValueOverrides: Record<string, DocumentPropertyValue> = {};
    if (group.property && group.value !== BOARD_UNGROUPED_VALUE) {
      propertyValueOverrides[group.property.definition.id] =
        boardGroupValueForProperty(group.property, group.value);
    }
    return createRow(title, propertyValueOverrides);
  }

  async function createGroupedRow(group: DatabaseBoardGroup, title = "") {
    const propertyValueOverrides: Record<string, DocumentPropertyValue> = {};
    if (group.property && group.value !== BOARD_UNGROUPED_VALUE) {
      propertyValueOverrides[group.property.definition.id] =
        boardGroupValueForProperty(group.property, group.value);
    }
    return createRow(title, propertyValueOverrides);
  }

  async function createInlineRow(title = "") {
    return createRow(
      title,
      {},
      { openAfterCreate: false, focusInlineTitle: true },
    );
  }

  async function createInlineGroupedRow(group: DatabaseBoardGroup, title = "") {
    const propertyValueOverrides: Record<string, DocumentPropertyValue> = {};
    if (group.property && group.value !== BOARD_UNGROUPED_VALUE) {
      propertyValueOverrides[group.property.definition.id] =
        boardGroupValueForProperty(group.property, group.value);
    }
    return createRow(title, propertyValueOverrides, {
      openAfterCreate: false,
      focusInlineTitle: true,
    });
  }

  async function createDatedCard(dateKey: string, title = "") {
    if (!databaseId) return null;
    const propertyValueOverrides: Record<string, DocumentPropertyValue> = {};
    if (
      dateViewProperty?.editable &&
      dateViewProperty.definition.type === "date"
    ) {
      propertyValueOverrides[dateViewProperty.definition.id] = {
        start: dateKey,
        includeTime: false,
      };
    }
    return createRow(title, propertyValueOverrides);
  }

  async function moveBoardCard(
    item: ContentDatabaseItem,
    group: DatabaseBoardGroup,
  ) {
    if (!group.property) return;
    await setProperty.mutateAsync({
      documentId: item.document.id,
      propertyId: group.property.definition.id,
      value: boardGroupValueForProperty(group.property, group.value),
    });
  }

  function updateActiveView(
    update: (view: ContentDatabaseView) => ContentDatabaseView,
  ) {
    setViewConfig((current) => updateActiveDatabaseView(current, update));
  }

  function setActiveSorts(nextSorts: DatabaseSort[]) {
    updateActiveView((view) => ({ ...view, sorts: nextSorts }));
  }

  function setActiveFilters(nextFilters: DatabaseFilter[]) {
    updateActiveView((view) => ({ ...view, filters: nextFilters }));
  }

  function setFilterMode(filterMode: DatabaseFilterMode) {
    updateActiveView((view) => ({ ...view, filterMode }));
  }

  function clearSearchAndFilters() {
    setSearchQuery("");
    setSearchOpen(false);
    setActiveFilters([]);
  }

  function setActiveColumnWidths(
    update:
      | Record<string, number>
      | ((current: Record<string, number>) => Record<string, number>),
  ) {
    updateActiveView((view) => ({
      ...view,
      columnWidths:
        typeof update === "function" ? update(view.columnWidths) : update,
    }));
  }

  function setPropertyHiddenInActiveView(propertyId: string, hidden: boolean) {
    updateActiveView((view) => {
      return setDatabaseViewHiddenPropertyIds(view, [propertyId], hidden);
    });
  }

  function setPropertiesHiddenInActiveView(
    propertyIds: string[],
    hidden: boolean,
  ) {
    updateActiveView((view) =>
      setDatabaseViewHiddenPropertyIds(view, propertyIds, hidden),
    );
  }

  function movePropertyInActiveView(
    propertyId: string,
    targetPropertyId: string,
    side: DatabaseDropSide = "before",
  ) {
    updateActiveView((view) =>
      reorderDatabaseViewProperty(
        view,
        propertyId,
        targetPropertyId,
        {
          allProperties: properties,
          visibleProperties: tableProperties,
        },
        side,
      ),
    );
  }

  function setColumnCalculation(
    key: ColumnKey,
    calculation: DatabaseColumnCalculation | null,
  ) {
    updateActiveView((view) =>
      setDatabaseViewColumnCalculation(view, key, calculation),
    );
  }

  function setWrapCells(wrapCells: boolean) {
    updateActiveView((view) => ({ ...view, wrapCells }));
  }

  function setOpenPagesIn(openPagesIn: ContentDatabaseOpenPagesIn) {
    updateActiveView((view) => ({ ...view, openPagesIn }));
  }

  function setGroupCollapsed(groupId: string, collapsed: boolean) {
    updateActiveView((view) =>
      setDatabaseViewCollapsedGroup(view, groupId, collapsed),
    );
  }

  function setGroupsCollapsed(groupIds: string[], collapsed: boolean) {
    updateActiveView((view) =>
      setDatabaseViewCollapsedGroups(view, groupIds, collapsed),
    );
  }

  function setHideEmptyGroups(hideEmptyGroups: boolean) {
    updateActiveView((view) => ({ ...view, hideEmptyGroups }));
  }

  const toolbarGroups = useMemo(() => {
    if (!databaseGroupProperty) return [];
    return databaseVisibleGroups(
      databaseViewItemGroups(
        visibleItems,
        orderedProperties,
        activeView.groupByPropertyId,
      ),
      activeView.hideEmptyGroups === true,
    );
  }, [
    activeView.groupByPropertyId,
    activeView.hideEmptyGroups,
    databaseGroupProperty,
    orderedProperties,
    visibleItems,
  ]);

  useEffect(() => {
    if (!data?.database.id) return;
    const nextViewConfig = normalizeClientDatabaseViewConfig(
      data.database.viewConfig,
    );
    hydratedViewRef.current = databaseViewStateKey(
      data.database.id,
      nextViewConfig,
    );
    setViewConfig(nextViewConfig);
  }, [data?.database.id, data?.database.viewConfig]);

  useEffect(() => {
    if (!databaseId) return;
    const nextKey = databaseViewStateKey(databaseId, viewConfig);
    if (hydratedViewRef.current === nextKey) return;
    if (!canEdit) return;
    if (saveViewTimerRef.current) {
      clearTimeout(saveViewTimerRef.current);
    }
    saveViewTimerRef.current = setTimeout(() => {
      updateView.mutate(
        { databaseId, viewConfig },
        {
          onSuccess: (response) => {
            const nextViewConfig = normalizeClientDatabaseViewConfig(
              response.database.viewConfig,
            );
            hydratedViewRef.current = databaseViewStateKey(
              response.database.id,
              nextViewConfig,
            );
          },
        },
      );
    }, 350);
    return () => {
      if (saveViewTimerRef.current) {
        clearTimeout(saveViewTimerRef.current);
      }
    };
  }, [canEdit, databaseId, updateView, viewConfig]);

  function resizeColumn(
    key: ColumnKey,
    defaultWidth: number,
    event: ReactPointerEvent,
  ) {
    if (!canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[key] ?? defaultWidth;

    globalThis.document.body.style.userSelect = "none";
    globalThis.document.body.style.cursor = "col-resize";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = clampColumnWidth(
        startWidth + moveEvent.clientX - startX,
      );
      setActiveColumnWidths((current) => ({ ...current, [key]: nextWidth }));
    };

    const handlePointerUp = () => {
      globalThis.document.body.style.userSelect = "";
      globalThis.document.body.style.cursor = "";
      globalThis.document.removeEventListener("pointermove", handlePointerMove);
      globalThis.document.removeEventListener("pointerup", handlePointerUp);
    };

    globalThis.document.addEventListener("pointermove", handlePointerMove);
    globalThis.document.addEventListener("pointerup", handlePointerUp);
  }

  return (
    <div className="mt-4 min-w-0 w-full max-w-[calc(100vw-var(--content-sidebar-width,0px)-1.5rem)]">
      <div className="mb-1 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1 pb-1">
        <DatabaseViewTabs
          viewConfig={viewConfig}
          canEdit={canEdit}
          onViewConfigChange={setViewConfig}
        />
        <div className="flex max-w-full flex-wrap items-center justify-end gap-1">
          {searchOpen ? (
            <div className="flex h-7 w-52 items-center gap-1 rounded border border-border bg-background px-2">
              <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
              <Input
                autoFocus
                value={searchQuery}
                placeholder="Search"
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchQuery("");
                    setSearchOpen(false);
                  }
                }}
                className="h-6 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
              />
              <button
                type="button"
                aria-label="Close search"
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => {
                  setSearchQuery("");
                  setSearchOpen(false);
                }}
              >
                <IconX className="size-3.5" />
              </button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Search"
              title="Search"
              className={cn(
                databaseToolbarIconButtonClass(),
                searchQuery && "bg-muted text-foreground",
              )}
              onClick={() => setSearchOpen(true)}
            >
              <IconSearch className="size-3.5" />
            </Button>
          )}
          <SortMenu
            properties={orderedProperties}
            sorts={sorts}
            onSortsChange={setActiveSorts}
          />
          <FilterMenu
            documentId={document.id}
            properties={orderedProperties}
            filters={filters}
            filterMode={filterMode}
            onFiltersChange={setActiveFilters}
            onFilterModeChange={setFilterMode}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="View settings"
            title="View settings"
            className={databaseToolbarIconButtonClass(
              settingsOpen ||
                activeView.wrapCells === true ||
                hiddenProperties.length > 0 ||
                Boolean(activeView.groupByPropertyId),
            )}
            onClick={() => {
              setSettingsPanel("main");
              setSettingsOpen((open) => !open);
            }}
          >
            <IconAdjustmentsHorizontal className="size-3.5" />
          </Button>
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              className="h-7 rounded-md bg-foreground px-2.5 text-xs font-medium text-background hover:bg-foreground/90"
              disabled={addItem.isPending || !databaseId}
              onClick={() => void createRow()}
            >
              {addItem.isPending ? (
                <Spinner className="mr-1.5 size-3.5" />
              ) : null}
              New
            </Button>
          ) : null}
        </div>
      </div>

      <DatabaseActiveConstraintsBar
        searchQuery={searchQuery}
        sorts={sorts}
        filters={filters}
        properties={properties}
        constraintCount={activeConstraintCount}
        onClearSearch={() => {
          setSearchQuery("");
          setSearchOpen(false);
        }}
        onRemoveSort={(index) =>
          setActiveSorts(sorts.filter((_, sortIndex) => sortIndex !== index))
        }
        onRemoveFilter={(index) =>
          setActiveFilters(
            filters.filter((_, filterIndex) => filterIndex !== index),
          )
        }
        onClearAll={() => {
          setSearchQuery("");
          setSearchOpen(false);
          setActiveSorts([]);
          setActiveFilters([]);
        }}
      />

      {activeView.type === "board" ? (
        <DatabaseBoardView
          activeView={activeView}
          properties={orderedProperties}
          items={visibleItems}
          groupProperty={boardGroupProperty}
          databaseDocumentId={document.id}
          canEdit={canEdit}
          isLoading={database.isLoading}
          isCreating={addItem.isPending || setProperty.isPending}
          hasActiveConstraints={!!searchQuery || activeFilters.length > 0}
          isMoving={setProperty.isPending}
          collapsedGroupIds={activeView.collapsedGroupIds ?? []}
          hideEmptyGroups={activeView.hideEmptyGroups === true}
          onClearResultConstraints={clearSearchAndFilters}
          onGroupByChange={(propertyId) =>
            updateActiveView((view) =>
              setDatabaseViewGroupByProperty(view, propertyId),
            )
          }
          onHideEmptyGroupsChange={setHideEmptyGroups}
          onGroupsCollapsedChange={setGroupsCollapsed}
          onCreateCard={createBoardCard}
          onMoveCard={moveBoardCard}
          onGroupCollapsedChange={setGroupCollapsed}
          onPreview={previewItemPage}
          onDeletedPreviewItem={handleDeletedPreviewItem}
          onOpenPage={openItemPage}
        />
      ) : activeView.type === "list" ? (
        <DatabaseListView
          properties={tableProperties}
          groupableProperties={orderedProperties}
          items={visibleItems}
          databaseDocumentId={document.id}
          canEdit={canEdit}
          isLoading={database.isLoading}
          isCreating={addItem.isPending}
          activeFilters={activeFilters}
          hasSearch={!!searchQuery}
          rowsAreManuallyOrdered={rowsAreManuallyOrdered}
          groupByPropertyId={activeView.groupByPropertyId ?? null}
          collapsedGroupIds={activeView.collapsedGroupIds ?? []}
          hideEmptyGroups={activeView.hideEmptyGroups === true}
          onClearResultConstraints={clearSearchAndFilters}
          onCreateRow={createRow}
          onCreateGroupedRow={createGroupedRow}
          onGroupCollapsedChange={setGroupCollapsed}
          onPreview={previewItemPage}
          onDeletedPreviewItem={handleDeletedPreviewItem}
          onOpenPage={openItemPage}
        />
      ) : activeView.type === "gallery" ? (
        <DatabaseGalleryView
          properties={tableProperties}
          groupableProperties={orderedProperties}
          items={visibleItems}
          databaseDocumentId={document.id}
          canEdit={canEdit}
          isLoading={database.isLoading}
          isCreating={addItem.isPending}
          activeFilters={activeFilters}
          hasSearch={!!searchQuery}
          rowsAreManuallyOrdered={rowsAreManuallyOrdered}
          groupByPropertyId={activeView.groupByPropertyId ?? null}
          collapsedGroupIds={activeView.collapsedGroupIds ?? []}
          hideEmptyGroups={activeView.hideEmptyGroups === true}
          onClearResultConstraints={clearSearchAndFilters}
          onCreateRow={createRow}
          onCreateGroupedRow={createGroupedRow}
          onGroupCollapsedChange={setGroupCollapsed}
          onPreview={previewItemPage}
          onDeletedPreviewItem={handleDeletedPreviewItem}
          onOpenPage={openItemPage}
        />
      ) : activeView.type === "calendar" ? (
        <DatabaseCalendarView
          activeView={activeView}
          properties={orderedProperties}
          items={visibleItems}
          databaseDocumentId={document.id}
          canEdit={canEdit}
          isLoading={database.isLoading}
          isCreating={addItem.isPending || setProperty.isPending}
          activeFilters={activeFilters}
          hasSearch={!!searchQuery}
          dateProperty={dateViewProperty}
          month={dateViewMonth}
          onClearResultConstraints={clearSearchAndFilters}
          onMonthChange={setDateViewMonth}
          onDatePropertyChange={(propertyId) =>
            updateActiveView((view) => ({
              ...view,
              datePropertyId: propertyId,
            }))
          }
          onCreateCard={createDatedCard}
          onPreview={previewItemPage}
          onDeletedPreviewItem={handleDeletedPreviewItem}
          onOpenPage={openItemPage}
        />
      ) : activeView.type === "timeline" ? (
        <DatabaseTimelineView
          activeView={activeView}
          properties={orderedProperties}
          items={visibleItems}
          databaseDocumentId={document.id}
          canEdit={canEdit}
          isLoading={database.isLoading}
          isCreating={addItem.isPending || setProperty.isPending}
          activeFilters={activeFilters}
          hasSearch={!!searchQuery}
          dateProperty={dateViewProperty}
          month={dateViewMonth}
          onClearResultConstraints={clearSearchAndFilters}
          onMonthChange={setDateViewMonth}
          onDatePropertyChange={(propertyId) =>
            updateActiveView((view) => ({
              ...view,
              datePropertyId: propertyId,
            }))
          }
          onEndDatePropertyChange={(propertyId) =>
            updateActiveView((view) => ({
              ...view,
              endDatePropertyId: propertyId,
            }))
          }
          onCreateCard={createDatedCard}
          onPreview={previewItemPage}
          onDeletedPreviewItem={handleDeletedPreviewItem}
          onOpenPage={openItemPage}
        />
      ) : (
        <DatabaseTableView
          properties={tableProperties}
          groupableProperties={orderedProperties}
          items={visibleItems}
          databaseDocumentId={document.id}
          canEdit={canEdit}
          isLoading={database.isLoading}
          isCreating={addItem.isPending}
          columnWidths={columnWidths}
          sorts={sorts}
          filters={filters}
          activeFilters={activeFilters}
          selectedItemIds={selectedItemIds}
          hasSearch={!!searchQuery}
          totalCount={items.length}
          constrained={hasResultConstraints}
          rowsAreManuallyOrdered={rowsAreManuallyOrdered}
          wrapCells={activeView.wrapCells === true}
          rowDensity={activeView.rowDensity ?? "default"}
          groupByPropertyId={activeView.groupByPropertyId ?? null}
          collapsedGroupIds={activeView.collapsedGroupIds ?? []}
          hideEmptyGroups={activeView.hideEmptyGroups === true}
          focusedTitleDocumentId={inlineTitleFocusDocumentId}
          onClearResultConstraints={clearSearchAndFilters}
          onSortsChange={setActiveSorts}
          onFiltersChange={setActiveFilters}
          onResizeColumn={resizeColumn}
          onPropertyHiddenChange={setPropertyHiddenInActiveView}
          onPropertyMove={movePropertyInActiveView}
          calculations={activeView.calculations ?? {}}
          onCalculationChange={setColumnCalculation}
          onToggleRowSelection={(itemId) =>
            setSelectedItemIds((current) =>
              toggleDatabaseRowSelection(current, itemId),
            )
          }
          onToggleAllRowsSelection={() =>
            setSelectedItemIds((current) =>
              toggleAllDatabaseRowSelection(current, visibleItems),
            )
          }
          onClearSelection={() => setSelectedItemIds([])}
          onCreateRow={createInlineRow}
          onCreateGroupedRow={createInlineGroupedRow}
          onTitleFocusHandled={() => setInlineTitleFocusDocumentId(null)}
          onGroupCollapsedChange={setGroupCollapsed}
          onPreview={previewItemPage}
          onDeletedPreviewItem={handleDeletedPreviewItem}
          onDeletedPreviewItems={handleDeletedPreviewItems}
          onOpenPage={openItemPage}
        />
      )}

      <DatabaseItemPreviewSheet
        item={previewItem}
        previousItem={previousPreviewItem}
        nextItem={nextPreviewItem}
        position={previewPosition}
        databaseDocumentId={document.id}
        open={!!previewItem}
        focusTitle={previewTitleFocusDocumentId === previewItem?.document.id}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewDocumentId(null);
            setPreviewTitleFocusDocumentId(null);
          }
        }}
        onPreviewItem={(item) => setPreviewDocumentId(item.document.id)}
        onTitleFocused={() => setPreviewTitleFocusDocumentId(null)}
        onOpenPage={(item) => {
          setPreviewDocumentId(null);
          setPreviewTitleFocusDocumentId(null);
          openItemPage(item);
        }}
      />

      <DatabaseViewSettingsPanel
        open={settingsOpen}
        panel={settingsPanel}
        documentId={document.id}
        activeView={activeView}
        properties={orderedProperties}
        items={items}
        hiddenCount={hiddenProperties.length}
        groupIds={toolbarGroups.map((group) => group.id)}
        onClose={() => setSettingsOpen(false)}
        onPanelChange={setSettingsPanel}
        onViewTypeChange={(type) =>
          setViewConfig(updateDatabaseViewType(viewConfig, activeView.id, type))
        }
        onWrapCellsChange={setWrapCells}
        onOpenPagesInChange={setOpenPagesIn}
        onPropertyHiddenChange={setPropertyHiddenInActiveView}
        onPropertiesHiddenChange={setPropertiesHiddenInActiveView}
        onGroupByChange={(propertyId) =>
          updateActiveView((view) =>
            setDatabaseViewGroupByProperty(view, propertyId),
          )
        }
        onHideEmptyGroupsChange={setHideEmptyGroups}
        onGroupsCollapsedChange={setGroupsCollapsed}
      />

      {!database.isLoading ? (
        activeView.type === "table" ? null : (
          <DatabaseResultCountFooter
            visibleCount={databaseFooterVisibleCount(
              activeView.type,
              visibleItems,
              screenVisibleItems,
            )}
            totalCount={items.length}
            constrained={hasResultConstraints}
          />
        )
      ) : null}
    </div>
  );
}

export function databaseItemPreviewTitle(
  item: Pick<ContentDatabaseItem, "document"> | null | undefined,
) {
  return item?.document.title?.trim() || "Untitled";
}

export function databaseNavigationState({
  document,
  databaseId,
  views = [],
  activeView,
  searchQuery = "",
  sorts = [],
  activeFilters = [],
  activeFilterCount = 0,
  properties = [],
  dateRange = null,
  visibleItems = [],
  visibleProperties = [],
  visibleItemCount,
  totalItemCount,
  selectedItems = [],
  previewItem,
}: {
  document: Pick<Document, "id" | "title">;
  databaseId: string;
  views?: Array<Pick<ContentDatabaseView, "id" | "name" | "type">>;
  activeView: Pick<
    ContentDatabaseView,
    | "id"
    | "name"
    | "type"
    | "filterMode"
    | "groupByPropertyId"
    | "collapsedGroupIds"
    | "hideEmptyGroups"
    | "datePropertyId"
    | "endDatePropertyId"
    | "calculations"
    | "wrapCells"
    | "rowDensity"
    | "openPagesIn"
  >;
  searchQuery?: string;
  sorts?: DatabaseSort[];
  activeFilters?: DatabaseFilter[];
  activeFilterCount?: number;
  properties?: DocumentProperty[];
  dateRange?: DatabaseDateViewRange | null;
  visibleItems?: ContentDatabaseItem[];
  visibleProperties?: DocumentProperty[];
  visibleItemCount?: number;
  totalItemCount?: number;
  selectedItems?: ContentDatabaseItem[];
  previewItem: ContentDatabaseItem | null;
}) {
  const trimmedSearchQuery = searchQuery.trim();
  const calculations = activeView.calculations ?? {};
  const calculationResults = databaseCalculationSummaries(
    calculations,
    visibleItems,
    visibleProperties,
  );
  const groupProperty = activeView.groupByPropertyId
    ? visibleProperties.find(
        (property) => property.definition.id === activeView.groupByPropertyId,
      )
    : null;
  const dateProperty =
    activeView.type === "calendar" || activeView.type === "timeline"
      ? databaseCalendarDateProperty(activeView, properties)
      : activeView.datePropertyId
        ? properties.find(
            (property) => property.definition.id === activeView.datePropertyId,
          )
        : null;
  const endDateProperty = activeView.endDatePropertyId
    ? properties.find(
        (property) => property.definition.id === activeView.endDatePropertyId,
      )
    : null;

  return {
    view: "editor",
    documentId: document.id,
    title: document.title,
    databaseId,
    databaseViews: databaseViewSummaries(
      views.length > 0 ? views : [activeView],
    ),
    databaseViewId: activeView.id,
    databaseViewName: activeView.name,
    databaseViewType: activeView.type,
    databaseSearchQuery: trimmedSearchQuery || undefined,
    databaseSortCount: sorts.length,
    databaseSorts: sorts.length > 0 ? sorts : undefined,
    databaseFilterMode:
      activeView.filterMode === "or" && activeFilterCount > 1
        ? activeView.filterMode
        : undefined,
    databaseActiveFilterCount: activeFilterCount,
    databaseActiveFilters: activeFilters.length > 0 ? activeFilters : undefined,
    databaseGroupByPropertyId: activeView.groupByPropertyId ?? undefined,
    databaseGroupByPropertyName: groupProperty?.definition.name,
    databaseCollapsedGroupIds:
      activeView.collapsedGroupIds && activeView.collapsedGroupIds.length > 0
        ? activeView.collapsedGroupIds
        : undefined,
    databaseHideEmptyGroups: activeView.hideEmptyGroups === true || undefined,
    databaseDatePropertyId: dateProperty?.definition.id,
    databaseDatePropertyName: dateProperty?.definition.name,
    databaseEndDatePropertyId: activeView.endDatePropertyId ?? undefined,
    databaseEndDatePropertyName: endDateProperty?.definition.name,
    databaseDateRangeStart: dateRange?.start,
    databaseDateRangeEnd: dateRange?.end,
    databaseDateRangeLabel: dateRange?.label,
    databaseCalculations:
      Object.keys(calculations).length > 0 ? calculations : undefined,
    databaseCalculationResults:
      calculationResults.length > 0 ? calculationResults : undefined,
    databaseWrapCells: activeView.wrapCells === true || undefined,
    databaseRowDensity:
      activeView.rowDensity && activeView.rowDensity !== "default"
        ? activeView.rowDensity
        : undefined,
    databaseOpenPagesIn:
      activeView.openPagesIn === "full_page"
        ? activeView.openPagesIn
        : undefined,
    databaseVisibleItemCount: visibleItemCount,
    databaseTotalItemCount: totalItemCount,
    databaseVisibleItems: databaseVisibleItemSummaries(
      visibleItems,
      visibleProperties,
    ),
    databaseVisibleItemLimit: DATABASE_NAVIGATION_VISIBLE_ITEM_LIMIT,
    databaseSelectedItemCount: selectedItems.length,
    databaseSelectedItems:
      selectedItems.length > 0
        ? databaseVisibleItemSummaries(
            selectedItems,
            visibleProperties,
            DATABASE_NAVIGATION_VISIBLE_ITEM_LIMIT,
          )
        : undefined,
    databasePreviewItemId: previewItem?.id,
    databasePreviewDocumentId: previewItem?.document.id,
    databasePreviewTitle: previewItem
      ? databaseItemPreviewTitle(previewItem)
      : undefined,
  };
}

export function databaseViewSummaries(
  views: Array<Pick<ContentDatabaseView, "id" | "name" | "type">>,
) {
  return views.map((view) => ({
    id: view.id,
    name: view.name,
    type: view.type,
  }));
}

export const DATABASE_NAVIGATION_VISIBLE_ITEM_LIMIT = 50;

export function databaseVisibleItemSummaries(
  items: ContentDatabaseItem[],
  visibleProperties: DocumentProperty[] = [],
  limit = DATABASE_NAVIGATION_VISIBLE_ITEM_LIMIT,
) {
  return items.slice(0, limit).map((item) => ({
    itemId: item.id,
    documentId: item.document.id,
    title: databaseItemPreviewTitle(item),
    position: item.position,
    properties: visibleProperties.map((property) => {
      const itemProperty =
        item.properties.find(
          (candidate) => candidate.definition.id === property.definition.id,
        ) ?? property;
      return {
        propertyId: property.definition.id,
        name: property.definition.name,
        type: property.definition.type,
        value: itemProperty.value,
        text: propertyValueText(itemProperty),
      };
    }),
  }));
}

export function databaseCalculationSummaries(
  calculations: Record<string, DatabaseColumnCalculation> | undefined,
  items: ContentDatabaseItem[],
  visibleProperties: DocumentProperty[],
) {
  if (!calculations) return [];
  return Object.entries(calculations).flatMap(([propertyId, calculation]) => {
    const property = visibleProperties.find(
      (candidate) => candidate.definition.id === propertyId,
    );
    if (!property) return [];
    return [
      {
        propertyId,
        name: property.definition.name,
        type: property.definition.type,
        calculation,
        result: databaseColumnCalculationResult(calculation, items, property),
      },
    ];
  });
}

export function databaseSelectedItems(
  visibleItems: ContentDatabaseItem[],
  selectedItemIds: string[],
) {
  const selectedIds = new Set(selectedItemIds);
  return visibleItems.filter((item) => selectedIds.has(item.id));
}

export function databaseBulkEditableProperties(properties: DocumentProperty[]) {
  return properties.filter(
    (property) =>
      property.editable && !isComputedPropertyType(property.definition.type),
  );
}

export function databaseBulkScalarInputState(
  type: DocumentPropertyType,
  input: string,
): { isValid: boolean; value: DocumentPropertyValue } {
  const trimmed = input.trim();
  if (!trimmed) return { isValid: true, value: null };
  if (type === "number") {
    const numberValue = Number(trimmed);
    return Number.isFinite(numberValue)
      ? { isValid: true, value: numberValue }
      : { isValid: false, value: null };
  }
  if (type === "date") {
    return {
      isValid: /^\d{4}-\d{2}-\d{2}$/.test(trimmed),
      value: { start: trimmed, includeTime: false },
    };
  }
  return { isValid: true, value: trimmed };
}

export function databaseDuplicatedItemFromResponse(
  response: Pick<ContentDatabaseResponse, "items"> &
    Pick<Partial<ContentDatabaseResponse>, "duplicatedItemId">,
) {
  return (
    response.items.find((item) => item.id === response.duplicatedItemId) ?? null
  );
}

export function toggleDatabaseRowSelection(
  selectedItemIds: string[],
  itemId: string,
) {
  return selectedItemIds.includes(itemId)
    ? selectedItemIds.filter((id) => id !== itemId)
    : [...selectedItemIds, itemId];
}

export function pruneDatabaseRowSelection(
  selectedItemIds: string[],
  visibleItems: ContentDatabaseItem[],
) {
  const visibleIds = new Set(visibleItems.map((item) => item.id));
  return selectedItemIds.filter((id) => visibleIds.has(id));
}

export function toggleAllDatabaseRowSelection(
  selectedItemIds: string[],
  visibleItems: ContentDatabaseItem[],
) {
  if (visibleItems.length === 0) return [];
  const visibleIds = visibleItems.map((item) => item.id);
  const selectedIds = new Set(selectedItemIds);
  const allVisibleSelected = visibleIds.every((id) => selectedIds.has(id));
  return allVisibleSelected ? [] : visibleIds;
}

export type DatabasePreviewNeighborDirection = "prev" | "next";

export function databaseItemPreviewNeighbor<
  T extends Pick<ContentDatabaseItem, "document">,
>(
  items: T[],
  documentId: string | null | undefined,
  direction: DatabasePreviewNeighborDirection,
) {
  if (!documentId) return null;
  const index = items.findIndex((item) => item.document.id === documentId);
  if (index < 0) return null;
  const targetIndex = direction === "prev" ? index - 1 : index + 1;
  return items[targetIndex] ?? null;
}

export function databaseItemPreviewFallbackAfterDelete<
  T extends Pick<ContentDatabaseItem, "document">,
>(items: T[], deletedDocumentId: string | null | undefined) {
  return (
    databaseItemPreviewNeighbor(items, deletedDocumentId, "next") ??
    databaseItemPreviewNeighbor(items, deletedDocumentId, "prev")
  );
}

export function databaseItemPreviewFallbackAfterBulkDelete<
  T extends Pick<ContentDatabaseItem, "document">,
>(
  items: T[],
  previewDocumentId: string | null | undefined,
  deletedDocumentIds: string[],
) {
  if (!previewDocumentId) return null;
  const previewIndex = items.findIndex(
    (item) => item.document.id === previewDocumentId,
  );
  if (previewIndex < 0) return null;
  const deletedIds = new Set(deletedDocumentIds);

  for (let index = previewIndex + 1; index < items.length; index += 1) {
    const item = items[index];
    if (!deletedIds.has(item.document.id)) return item;
  }
  for (let index = previewIndex - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!deletedIds.has(item.document.id)) return item;
  }
  return null;
}

export function databaseItemPreviewPosition(
  items: Array<Pick<ContentDatabaseItem, "document">>,
  documentId: string | null | undefined,
) {
  if (!documentId) return null;
  const index = items.findIndex((item) => item.document.id === documentId);
  if (index < 0) return null;
  return { index, total: items.length };
}

function DatabaseItemPreviewSheet({
  item,
  previousItem,
  nextItem,
  position,
  databaseDocumentId,
  open,
  focusTitle,
  onOpenChange,
  onPreviewItem,
  onTitleFocused,
  onOpenPage,
}: {
  item: ContentDatabaseItem | null;
  previousItem: ContentDatabaseItem | null;
  nextItem: ContentDatabaseItem | null;
  position: { index: number; total: number } | null;
  databaseDocumentId: string;
  open: boolean;
  focusTitle: boolean;
  onOpenChange: (open: boolean) => void;
  onPreviewItem?: (item: ContentDatabaseItem) => void;
  onTitleFocused?: () => void;
  onOpenPage: (item: ContentDatabaseItem) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        showOverlay={false}
        onInteractOutside={(event) => event.preventDefault()}
        className="flex w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:w-[min(64vw,560px)] sm:max-w-none"
      >
        {item ? (
          <DatabaseItemPreview
            item={item}
            previousItem={previousItem}
            nextItem={nextItem}
            position={position}
            databaseDocumentId={databaseDocumentId}
            focusTitle={focusTitle}
            onPreviewItem={onPreviewItem}
            onTitleFocused={onTitleFocused}
            onClose={() => onOpenChange(false)}
            onOpenPage={() => onOpenPage(item)}
          />
        ) : (
          <SheetHeader className="sr-only">
            <SheetTitle>Database page preview</SheetTitle>
            <SheetDescription>No database page selected.</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DatabaseItemPreview({
  item,
  previousItem,
  nextItem,
  position,
  databaseDocumentId,
  focusTitle,
  onPreviewItem,
  onTitleFocused,
  onClose,
  onOpenPage,
}: {
  item: ContentDatabaseItem;
  previousItem: ContentDatabaseItem | null;
  nextItem: ContentDatabaseItem | null;
  position: { index: number; total: number } | null;
  databaseDocumentId: string;
  focusTitle: boolean;
  onPreviewItem?: (item: ContentDatabaseItem) => void;
  onTitleFocused?: () => void;
  onClose: () => void;
  onOpenPage: () => void;
}) {
  const queryClient = useQueryClient();
  const updateDocument = useUpdateDocument();
  const deleteDocument = useDeleteDocument();
  const duplicateItem = useDuplicateDatabaseItem(databaseDocumentId);
  const { data: document, isLoading } = useDocument(item.document.id);
  const previewTitle = databaseItemPreviewTitle(item);
  const canEdit = document?.canEdit ?? item.document.canEdit ?? true;
  const canManage = document?.canManage ?? item.document.canManage ?? false;
  const [localTitle, setLocalTitle] = useState(item.document.title);
  const [localContent, setLocalContent] = useState(item.document.content);
  const [localIcon, setLocalIcon] = useState(item.document.icon);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const lastSavedRef = useRef({
    title: item.document.title,
    content: item.document.content,
  });

  useEffect(() => {
    const nextTitle = document?.title ?? item.document.title;
    const nextContent = document?.content ?? item.document.content;
    const nextIcon = document?.icon ?? item.document.icon;
    setLocalTitle(nextTitle);
    setLocalContent(nextContent);
    setLocalIcon(nextIcon);
    lastSavedRef.current = { title: nextTitle, content: nextContent };
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [
    document?.id,
    document?.title,
    document?.content,
    document?.icon,
    item.document.id,
    item.document.title,
    item.document.content,
    item.document.icon,
  ]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!focusTitle || !canEdit || isLoading || !document) return;

    const frame = requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
      onTitleFocused?.();
    });

    return () => cancelAnimationFrame(frame);
  }, [canEdit, document, focusTitle, isLoading, onTitleFocused]);

  function savePreviewDocument(next: { title: string; content: string }) {
    if (!canEdit || !document) return;
    if (
      next.title === lastSavedRef.current.title &&
      next.content === lastSavedRef.current.content
    ) {
      return;
    }

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      updateDocument.mutate(
        { id: document.id, title: next.title, content: next.content },
        {
          onSuccess: () => {
            lastSavedRef.current = next;
            void queryClient.invalidateQueries({
              queryKey: ["action", "get-content-database"],
            });
            void queryClient.invalidateQueries({
              queryKey: ["action", "list-documents"],
            });
          },
          onError: (err) => {
            toast.error("Failed to save page preview", {
              description:
                err instanceof Error ? err.message : "Something went wrong",
            });
          },
        },
      );
    }, 450);
  }

  function handleTitleChange(nextTitle: string) {
    setLocalTitle(nextTitle);
    savePreviewDocument({ title: nextTitle, content: localContent });
  }

  function handleContentChange(nextContent: string) {
    setLocalContent(nextContent);
    savePreviewDocument({ title: localTitle, content: nextContent });
  }

  function handleIconChange(nextIcon: string | null) {
    if (!canEdit || !document) return;
    setLocalIcon(nextIcon);
    updateDocument.mutate(
      { id: document.id, icon: nextIcon },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-content-database"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-document", { id: document.id }],
          });
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-documents"],
          });
        },
        onError: (err) => {
          setLocalIcon(document.icon);
          toast.error("Failed to save page icon", {
            description:
              err instanceof Error ? err.message : "Something went wrong",
          });
        },
      },
    );
  }

  async function duplicatePreviewRow() {
    setActionsMenuOpen(false);
    try {
      const response = await duplicateItem.mutateAsync({ itemId: item.id });
      const duplicatedItem = response.items.find(
        (candidate) => candidate.id === response.duplicatedItemId,
      );
      if (duplicatedItem) onPreviewItem?.(duplicatedItem);
    } catch (err) {
      toast.error("Failed to duplicate row", {
        description:
          err instanceof Error ? err.message : "Something went wrong",
      });
    }
  }

  async function deletePreviewRow() {
    const nextPreviewItem = nextItem ?? previousItem;
    if (nextPreviewItem) {
      onPreviewItem?.(nextPreviewItem);
    } else {
      onClose();
    }

    try {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      await deleteDocument.mutateAsync({ id: item.document.id });
      await queryClient.invalidateQueries({
        queryKey: [
          "action",
          "get-content-database",
          { documentId: databaseDocumentId },
        ],
      });
      await queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
    } catch (err) {
      onPreviewItem?.(item);
      toast.error("Failed to delete row", {
        description:
          err instanceof Error ? err.message : "Something went wrong",
      });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="shrink-0 gap-0 border-b border-border px-5 py-3 text-left">
        <div className="flex min-w-0 items-center justify-between gap-3 pr-14">
          <div className="flex min-w-0 items-center gap-2">
            <DatabaseItemPageIcon
              document={{ icon: localIcon }}
              className="size-4 text-sm"
              fallbackClassName="size-4"
            />
            <SheetTitle className="truncate text-sm font-medium">
              {previewTitle}
            </SheetTitle>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {position ? (
              <span className="hidden px-1.5 text-xs text-muted-foreground sm:inline">
                {position.index + 1} of {position.total}
              </span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              disabled={!previousItem}
              aria-label="Previous database page"
              onClick={() => {
                if (previousItem) onPreviewItem?.(previousItem);
              }}
            >
              <IconArrowLeft className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              disabled={!nextItem}
              aria-label="Next database page"
              onClick={() => {
                if (nextItem) onPreviewItem?.(nextItem);
              }}
            >
              <IconArrowRight className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 gap-1.5 px-2 text-xs"
              onClick={onOpenPage}
            >
              <IconExternalLink className="size-3.5" />
              Open page
            </Button>
            {canEdit || canManage ? (
              <DropdownMenu
                open={actionsMenuOpen}
                onOpenChange={setActionsMenuOpen}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    aria-label={`Preview actions for ${previewTitle}`}
                  >
                    <IconDots className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {canEdit ? (
                    <DropdownMenuItem
                      disabled={duplicateItem.isPending}
                      onSelect={(event) => {
                        event.preventDefault();
                        void duplicatePreviewRow();
                      }}
                    >
                      <IconCopy className="mr-2 size-4 text-muted-foreground" />
                      Duplicate row
                    </DropdownMenuItem>
                  ) : null}
                  {canEdit && canManage ? <DropdownMenuSeparator /> : null}
                  {canManage ? (
                    <DropdownMenuItem
                      className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                      onSelect={(event) => {
                        event.preventDefault();
                        setActionsMenuOpen(false);
                        setConfirmDeleteOpen(true);
                      }}
                    >
                      <IconTrash className="mr-2 size-4" />
                      Delete row
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
        <SheetDescription className="sr-only">
          Preview this database page without leaving the database.
        </SheetDescription>
      </SheetHeader>

      {isLoading || !document ? (
        <div className="grid gap-4 p-6">
          <div className="h-10 w-2/3 rounded bg-muted" />
          <div className="h-4 w-full rounded bg-muted" />
          <div className="h-4 w-5/6 rounded bg-muted" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-3xl px-6 pt-8 pb-12">
            <div className="mb-5 flex items-start gap-3">
              {canEdit ? (
                <EmojiPicker
                  icon={localIcon}
                  variant="compact"
                  portalled={false}
                  onSelect={handleIconChange}
                />
              ) : (
                <DatabaseItemPageIcon
                  document={document}
                  className="mt-2 size-5 text-xl"
                  fallbackClassName="mt-2 size-5"
                />
              )}
              <textarea
                ref={titleInputRef}
                rows={1}
                value={localTitle}
                readOnly={!canEdit}
                aria-label="Preview page title"
                placeholder="Untitled"
                onChange={(event) => handleTitleChange(event.target.value)}
                style={{ fieldSizing: "content" } as any}
                className="min-w-0 flex-1 resize-none overflow-hidden break-words border-0 bg-transparent p-0 text-3xl font-bold leading-tight text-foreground outline-none placeholder:text-muted-foreground/40"
              />
            </div>
            {document.databaseMembership ? (
              <DocumentProperties
                documentId={document.id}
                canEdit={canEdit}
                popoversPortalled={false}
              />
            ) : null}
            <div className="pt-6">
              <VisualEditor
                key={document.id}
                documentId={document.id}
                content={localContent}
                onChange={handleContentChange}
                ydoc={null}
                editable={canEdit}
              />
            </div>
          </div>
        </div>
      )}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete row?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{previewTitle}&rdquo; and any sub-pages will be permanently
              deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteDocument.isPending}
              onClick={() => void deletePreviewRow()}
            >
              {deleteDocument.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DatabaseTableView({
  properties,
  groupableProperties,
  items,
  databaseDocumentId,
  canEdit,
  isLoading,
  isCreating,
  columnWidths,
  sorts,
  filters,
  activeFilters,
  selectedItemIds,
  hasSearch,
  totalCount,
  constrained,
  rowsAreManuallyOrdered,
  wrapCells,
  rowDensity,
  groupByPropertyId,
  collapsedGroupIds,
  hideEmptyGroups,
  focusedTitleDocumentId,
  onSortsChange,
  onFiltersChange,
  onResizeColumn,
  onPropertyHiddenChange,
  onPropertyMove,
  calculations,
  onCalculationChange,
  onToggleRowSelection,
  onToggleAllRowsSelection,
  onClearSelection,
  onClearResultConstraints,
  onCreateRow,
  onCreateGroupedRow,
  onTitleFocusHandled,
  onGroupCollapsedChange,
  onPreview,
  onDeletedPreviewItem,
  onDeletedPreviewItems,
  onOpenPage,
}: {
  properties: DocumentProperty[];
  groupableProperties: DocumentProperty[];
  items: ContentDatabaseItem[];
  databaseDocumentId: string;
  canEdit: boolean;
  isLoading: boolean;
  isCreating: boolean;
  columnWidths: Record<string, number>;
  sorts: DatabaseSort[];
  filters: DatabaseFilter[];
  activeFilters: DatabaseFilter[];
  selectedItemIds: string[];
  hasSearch: boolean;
  totalCount: number;
  constrained: boolean;
  rowsAreManuallyOrdered: boolean;
  wrapCells: boolean;
  rowDensity: DatabaseRowDensity;
  groupByPropertyId: string | null;
  collapsedGroupIds: string[];
  hideEmptyGroups: boolean;
  focusedTitleDocumentId: string | null;
  onSortsChange: (sorts: DatabaseSort[]) => void;
  onFiltersChange: (filters: DatabaseFilter[]) => void;
  onResizeColumn: (
    key: ColumnKey,
    defaultWidth: number,
    event: ReactPointerEvent,
  ) => void;
  onPropertyHiddenChange: (propertyId: string, hidden: boolean) => void;
  onPropertyMove: (
    propertyId: string,
    targetPropertyId: string,
    side?: DatabaseDropSide,
  ) => void;
  calculations: Record<string, DatabaseColumnCalculation>;
  onCalculationChange: (
    key: ColumnKey,
    calculation: DatabaseColumnCalculation | null,
  ) => void;
  onToggleRowSelection: (itemId: string) => void;
  onToggleAllRowsSelection: () => void;
  onClearSelection: () => void;
  onClearResultConstraints: () => void;
  onCreateRow: CreateDatabaseRowHandler;
  onCreateGroupedRow: (
    group: DatabaseBoardGroup,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
  onTitleFocusHandled: () => void;
  onGroupCollapsedChange: (groupId: string, collapsed: boolean) => void;
  onPreview: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onDeletedPreviewItems: (items: ContentDatabaseItem[]) => boolean;
  onOpenPage: (item: ContentDatabaseItem) => void;
}) {
  const queryClient = useQueryClient();
  const moveItem = useMoveDatabaseItem(databaseDocumentId);
  const duplicateItem = useDuplicateDatabaseItem(databaseDocumentId);
  const setProperty = useSetDocumentProperty(databaseDocumentId);
  const deleteDocument = useDeleteDocument();
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTargetItemId, setDropTargetItemId] = useState<string | null>(null);
  const [draggedPropertyId, setDraggedPropertyId] = useState<string | null>(
    null,
  );
  const [dropTargetProperty, setDropTargetProperty] =
    useState<DatabaseDropTargetState | null>(null);
  const [dragPreview, setDragPreview] =
    useState<DatabaseDragPreviewState | null>(null);
  const [confirmDeleteSelectedOpen, setConfirmDeleteSelectedOpen] =
    useState(false);
  const [isDuplicatingSelected, setIsDuplicatingSelected] = useState(false);
  const selectedCount = selectedItemIds.length;
  const selectableCount = items.length;
  const selectedIdSet = new Set(selectedItemIds);
  const selectedItems = databaseSelectedItems(items, selectedItemIds);
  const bulkEditableProperties = databaseBulkEditableProperties(properties);
  const groups = databaseVisibleGroups(
    databaseViewItemGroups(items, groupableProperties, groupByPropertyId),
    hideEmptyGroups,
  );
  const grouped = !!databaseViewGroupingProperty(
    { type: "table", groupByPropertyId },
    groupableProperties,
  );
  const cleanDefaultTable =
    items.length === 0 &&
    properties.length === 0 &&
    !hasSearch &&
    activeFilters.length === 0 &&
    !grouped;
  const actionColumnWidth = cleanDefaultTable
    ? EMPTY_DEFAULT_ADD_PROPERTY_COLUMN_WIDTH
    : ACTION_COLUMN_WIDTH;
  const rowDraggingEnabled =
    canEdit &&
    rowsAreManuallyOrdered &&
    items.length > 1 &&
    !moveItem.isPending;

  async function moveDraggedRow(draggedItemId: string, targetItemId: string) {
    const draggedItem = items.find(
      (candidate) => candidate.id === draggedItemId,
    );
    const targetIndex = items.findIndex(
      (candidate) => candidate.id === targetItemId,
    );

    if (!draggedItem || draggedItem.id === targetItemId || targetIndex < 0) {
      clearDraggedRow();
      return;
    }

    try {
      await moveItem.mutateAsync({
        itemId: draggedItem.id,
        position: targetIndex,
      });
    } catch (err) {
      toast.error("Failed to move row", {
        description:
          err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      clearDraggedRow();
    }
  }

  function clearDraggedRow() {
    setDraggedItemId(null);
    setDropTargetItemId(null);
  }

  function clearDraggedProperty() {
    setDraggedPropertyId(null);
    setDropTargetProperty(null);
    setDragPreview(null);
    globalThis.document.body.classList.remove("notion-editor-is-dragging");
  }

  function startPropertyPointerDrag(
    property: DocumentProperty,
    event: ReactPointerEvent<HTMLElement>,
  ) {
    if (!canEdit) return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("[data-column-resize-handle]")
    ) {
      return;
    }

    const propertyId = property.definition.id;
    const sourceElement = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    function propertyTargetFromPoint(
      clientX: number,
      clientY: number,
    ): DatabaseDropTargetState | null {
      const element = globalThis.document.elementFromPoint(clientX, clientY);
      const header = element?.closest<HTMLElement>(
        "[data-database-property-id]",
      );
      const targetPropertyId = header?.dataset.databasePropertyId ?? null;
      if (!header || !targetPropertyId) return null;
      return {
        id: targetPropertyId,
        side: databaseDropSideForElement(header, clientX),
      };
    }

    function beginDrag(moveEvent: PointerEvent) {
      dragging = true;
      setDraggedPropertyId(propertyId);
      setDropTargetProperty(null);
      setDragPreview(
        databaseDragPreviewFromElement(
          sourceElement,
          property.definition.name,
          { kind: "property", type: property.definition.type },
          moveEvent.clientX,
          moveEvent.clientY,
        ),
      );
      globalThis.document.body.style.userSelect = "none";
      globalThis.document.body.style.cursor = "grabbing";
      globalThis.document.body.classList.add("notion-editor-is-dragging");
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (
        !dragging &&
        !databaseDragMoved(startX, startY, moveEvent.clientX, moveEvent.clientY)
      ) {
        return;
      }
      if (!dragging) beginDrag(moveEvent);
      moveEvent.preventDefault();
      setDragPreview((current) =>
        current
          ? { ...current, x: moveEvent.clientX, y: moveEvent.clientY }
          : current,
      );
      const targetProperty = propertyTargetFromPoint(
        moveEvent.clientX,
        moveEvent.clientY,
      );
      setDropTargetProperty(
        targetProperty && targetProperty.id !== propertyId
          ? targetProperty
          : null,
      );
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      globalThis.document.body.style.userSelect = "";
      globalThis.document.body.style.cursor = "";
      globalThis.document.removeEventListener("pointermove", handlePointerMove);
      globalThis.document.removeEventListener("pointerup", handlePointerUp);

      if (dragging) {
        suppressNextDocumentClick();
        const targetProperty = propertyTargetFromPoint(
          upEvent.clientX,
          upEvent.clientY,
        );
        if (targetProperty && targetProperty.id !== propertyId) {
          onPropertyMove(propertyId, targetProperty.id, targetProperty.side);
        }
      }

      clearDraggedProperty();
    };

    globalThis.document.addEventListener("pointermove", handlePointerMove);
    globalThis.document.addEventListener("pointerup", handlePointerUp);
  }

  function startRowDrag(itemId: string, event: ReactPointerEvent) {
    if (!rowDraggingEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    setDraggedItemId(itemId);
    setDropTargetItemId(null);
    globalThis.document.body.style.userSelect = "none";
    globalThis.document.body.style.cursor = "grabbing";

    function rowIdFromPoint(clientX: number, clientY: number) {
      const element = globalThis.document.elementFromPoint(clientX, clientY);
      const row = element?.closest<HTMLElement>("[data-database-row-id]");
      return row?.dataset.databaseRowId ?? null;
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const targetItemId = rowIdFromPoint(moveEvent.clientX, moveEvent.clientY);
      setDropTargetItemId(
        targetItemId && targetItemId !== itemId ? targetItemId : null,
      );
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const targetItemId = rowIdFromPoint(upEvent.clientX, upEvent.clientY);
      globalThis.document.body.style.userSelect = "";
      globalThis.document.body.style.cursor = "";
      globalThis.document.removeEventListener("pointermove", handlePointerMove);
      globalThis.document.removeEventListener("pointerup", handlePointerUp);

      if (targetItemId && targetItemId !== itemId) {
        void moveDraggedRow(itemId, targetItemId);
        return;
      }

      clearDraggedRow();
    };

    globalThis.document.addEventListener("pointermove", handlePointerMove);
    globalThis.document.addEventListener("pointerup", handlePointerUp);
  }

  async function toggleCheckboxCell(
    item: ContentDatabaseItem,
    property: DocumentProperty,
  ) {
    try {
      await setProperty.mutateAsync({
        documentId: item.document.id,
        propertyId: property.definition.id,
        value: property.value !== true,
      });
    } catch (err) {
      toast.error("Failed to update checkbox", {
        description:
          err instanceof Error ? err.message : "Something went wrong",
      });
    }
  }

  async function deleteSelectedRows() {
    if (selectedItems.length === 0) return;
    const selectedSnapshot = selectedItems;
    onClearSelection();
    setConfirmDeleteSelectedOpen(false);

    try {
      onDeletedPreviewItems(selectedSnapshot);
      for (const item of selectedSnapshot) {
        await deleteDocument.mutateAsync({ id: item.document.id });
      }
      await queryClient.invalidateQueries({
        queryKey: [
          "action",
          "get-content-database",
          { documentId: databaseDocumentId },
        ],
      });
      await queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
    } catch (err) {
      toast.error("Failed to delete selected rows", {
        description:
          err instanceof Error ? err.message : "Something went wrong",
      });
    }
  }

  async function duplicateSelectedRows() {
    if (selectedItems.length === 0 || isDuplicatingSelected) return;
    const selectedSnapshot = selectedItems;
    setIsDuplicatingSelected(true);

    let duplicatedPreviewItem: ContentDatabaseItem | null = null;
    let duplicatedCount = 0;
    let failedCount = 0;

    try {
      for (const item of selectedSnapshot) {
        try {
          const response = await duplicateItem.mutateAsync({ itemId: item.id });
          duplicatedCount += 1;
          duplicatedPreviewItem =
            databaseDuplicatedItemFromResponse(response) ??
            duplicatedPreviewItem;
        } catch {
          failedCount += 1;
        }
      }

      await queryClient.invalidateQueries({
        queryKey: [
          "action",
          "get-content-database",
          { documentId: databaseDocumentId },
        ],
      });
      await queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });

      if (duplicatedPreviewItem) onPreview(duplicatedPreviewItem);
      if (duplicatedCount > 0) onClearSelection();
      if (failedCount > 0) {
        toast.error("Failed to duplicate every selected row", {
          description:
            duplicatedCount > 0
              ? `${duplicatedCount} duplicated, ${failedCount} failed.`
              : "No rows were duplicated.",
        });
      }
    } finally {
      setIsDuplicatingSelected(false);
    }
  }

  async function setSelectedPropertyValue(
    property: DocumentProperty,
    value: DocumentPropertyValue,
  ) {
    if (selectedItems.length === 0) return;
    const selectedSnapshot = selectedItems;

    let updatedCount = 0;
    let failedCount = 0;
    for (const item of selectedSnapshot) {
      try {
        await setProperty.mutateAsync({
          documentId: item.document.id,
          propertyId: property.definition.id,
          value,
        });
        updatedCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    await queryClient.invalidateQueries({
      queryKey: [
        "action",
        "get-content-database",
        { documentId: databaseDocumentId },
      ],
    });

    if (failedCount > 0) {
      toast.error("Failed to update every selected row", {
        description:
          updatedCount > 0
            ? `${updatedCount} updated, ${failedCount} failed.`
            : "No rows were updated.",
      });
    }
  }

  return (
    <div
      data-database-scroll-surface="table"
      className="relative w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain"
    >
      <DatabaseDragPreview preview={dragPreview} />
      <div className="w-max min-w-full min-w-[720px]">
        {selectedCount > 0 ? (
          <DatabaseSelectionBar
            selectedCount={selectedCount}
            canEdit={canEdit}
            properties={bulkEditableProperties}
            duplicateDisabled={
              isDuplicatingSelected || deleteDocument.isPending
            }
            deleteDisabled={deleteDocument.isPending}
            updateDisabled={setProperty.isPending}
            onClearSelection={onClearSelection}
            onSetPropertyValue={setSelectedPropertyValue}
            onDuplicateSelected={() => void duplicateSelectedRows()}
            onDeleteSelected={() => setConfirmDeleteSelectedOpen(true)}
          />
        ) : null}
        <div
          className="grid border-y border-border/45 text-xs font-medium text-muted-foreground/70"
          style={{
            gridTemplateColumns: databaseGridColumns(
              properties,
              canEdit,
              columnWidths,
              actionColumnWidth,
            ),
          }}
        >
          <DatabaseNameHeader
            sorts={sorts}
            filters={filters}
            selectedCount={selectedCount}
            selectableCount={selectableCount}
            onSortsChange={onSortsChange}
            onFiltersChange={onFiltersChange}
            onToggleAllRowsSelection={onToggleAllRowsSelection}
            onResize={(event) =>
              onResizeColumn("name", DEFAULT_NAME_COLUMN_WIDTH, event)
            }
          />
          {properties.map((property) => {
            return (
              <DatabasePropertyHeader
                key={property.definition.id}
                property={property}
                documentId={databaseDocumentId}
                canEdit={canEdit}
                isDragging={draggedPropertyId === property.definition.id}
                dropSide={
                  !!draggedPropertyId &&
                  dropTargetProperty?.id === property.definition.id &&
                  draggedPropertyId !== property.definition.id
                    ? dropTargetProperty.side
                    : null
                }
                sorts={sorts}
                filters={filters}
                onPointerDown={(event) =>
                  startPropertyPointerDrag(property, event)
                }
                onResize={(event) =>
                  onResizeColumn(
                    property.definition.id,
                    DEFAULT_PROPERTY_COLUMN_WIDTH,
                    event,
                  )
                }
              />
            );
          })}
          {canEdit ? (
            <div
              className={cn(
                "flex h-8 items-center",
                cleanDefaultTable
                  ? "justify-start border-r border-border/40 px-1"
                  : "justify-center",
              )}
            >
              <AddProperty
                documentId={databaseDocumentId}
                variant={cleanDefaultTable ? "header" : "icon"}
                label="Add property"
              />
            </div>
          ) : null}
        </div>

        {isLoading ? (
          <div className="flex h-16 items-center gap-2 border-t border-border px-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading database
          </div>
        ) : (
          <>
            {databaseViewHasNoMatchingPages(
              items.length,
              hasSearch,
              activeFilters.length,
            ) ? (
              <DatabaseNoMatchingPages
                className="border-t border-border"
                label="No rows match this view"
                onClear={onClearResultConstraints}
              />
            ) : null}
            {grouped
              ? groups.map((group) => (
                  <DatabaseGroupedTableSection
                    key={group.id}
                    group={group}
                    properties={properties}
                    columnWidths={columnWidths}
                    databaseDocumentId={databaseDocumentId}
                    canEdit={canEdit}
                    selectedIdSet={selectedIdSet}
                    wrapCells={wrapCells}
                    rowDensity={rowDensity}
                    isCreating={isCreating}
                    focusedTitleDocumentId={focusedTitleDocumentId}
                    collapsed={databaseGroupIsCollapsed(
                      collapsedGroupIds,
                      group.id,
                    )}
                    onCreateRow={onCreateGroupedRow}
                    onTitleFocusHandled={onTitleFocusHandled}
                    onCollapsedChange={(collapsed) =>
                      onGroupCollapsedChange(group.id, collapsed)
                    }
                    onToggleCheckbox={toggleCheckboxCell}
                    onToggleRowSelection={onToggleRowSelection}
                    onPreview={onPreview}
                    onDeletedPreviewItem={onDeletedPreviewItem}
                    onOpenPage={onOpenPage}
                  />
                ))
              : items.map((item, index) => (
                  <DatabaseTableRow
                    key={item.id}
                    item={item}
                    properties={properties}
                    columnWidths={columnWidths}
                    databaseDocumentId={databaseDocumentId}
                    canEdit={canEdit}
                    rowIndex={index}
                    canReorder={rowsAreManuallyOrdered}
                    canDragRow={rowDraggingEnabled}
                    canMoveUp={rowsAreManuallyOrdered && index > 0}
                    canMoveDown={
                      rowsAreManuallyOrdered && index < items.length - 1
                    }
                    selected={selectedIdSet.has(item.id)}
                    isDragging={draggedItemId === item.id}
                    isDropTarget={
                      !!draggedItemId &&
                      dropTargetItemId === item.id &&
                      draggedItemId !== item.id
                    }
                    startEditingTitle={
                      focusedTitleDocumentId === item.document.id
                    }
                    onDragHandlePointerDown={(event) =>
                      startRowDrag(item.id, event)
                    }
                    onToggleCheckbox={(property) =>
                      void toggleCheckboxCell(item, property)
                    }
                    wrapCells={wrapCells}
                    rowDensity={rowDensity}
                    onToggleSelected={() => onToggleRowSelection(item.id)}
                    onPreviewItem={onPreview}
                    onDeletedPreviewItem={onDeletedPreviewItem}
                    onTitleEditStarted={onTitleFocusHandled}
                    onPreview={() => onPreview(item)}
                    onOpenPage={() => onOpenPage(item)}
                  />
                ))}
            {canEdit && !grouped ? (
              <NewDatabaseRow
                properties={properties}
                columnWidths={columnWidths}
                rowDensity={rowDensity}
                disabled={isCreating}
                isPending={isCreating}
                onCreate={onCreateRow}
                actionColumnWidth={actionColumnWidth}
              />
            ) : null}
            {cleanDefaultTable ? (
              <DatabaseBlankDefaultRows
                rowCount={EMPTY_DEFAULT_BLANK_ROW_COUNT}
                actionColumnWidth={actionColumnWidth}
              />
            ) : null}
            <DatabaseTableFooter
              properties={properties}
              items={items}
              totalCount={totalCount}
              constrained={constrained}
              columnWidths={columnWidths}
              canEdit={canEdit}
              calculations={calculations}
              actionColumnWidth={actionColumnWidth}
              onCalculationChange={onCalculationChange}
            />
          </>
        )}
      </div>
      <AlertDialog
        open={confirmDeleteSelectedOpen}
        onOpenChange={setConfirmDeleteSelectedOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected rows?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedCount} selected row{selectedCount === 1 ? "" : "s"} and
              any sub-pages will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteDocument.isPending}
              onClick={() => void deleteSelectedRows()}
            >
              {deleteDocument.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DatabaseActiveConstraintsBar({
  searchQuery,
  sorts,
  filters,
  properties,
  constraintCount,
  onClearSearch,
  onRemoveSort,
  onRemoveFilter,
  onClearAll,
}: {
  searchQuery: string;
  sorts: DatabaseSort[];
  filters: DatabaseFilter[];
  properties: DocumentProperty[];
  constraintCount: number;
  onClearSearch: () => void;
  onRemoveSort: (index: number) => void;
  onRemoveFilter: (index: number) => void;
  onClearAll: () => void;
}) {
  if (constraintCount === 0) return null;
  const activeFilterEntries = filters
    .map((filter, index) => ({ filter, index }))
    .filter((entry) => isActiveFilter(entry.filter));

  return (
    <div className="mb-2 flex min-h-8 flex-wrap items-center gap-1 border-b border-border pb-2 text-xs text-muted-foreground">
      <span className="px-1.5">
        Showing {constraintCount} condition{constraintCount === 1 ? "" : "s"}
      </span>
      {searchQuery.trim() ? (
        <DatabaseConstraintChip
          icon={<IconSearch className="size-3.5" />}
          label={`Search: ${searchQuery.trim()}`}
          onRemove={onClearSearch}
        />
      ) : null}
      {sorts.map((sort, index) => (
        <DatabaseConstraintChip
          key={`${sort.key}-${index}`}
          icon={<IconArrowsSort className="size-3.5" />}
          label={`${sort.label} ${sort.direction === "asc" ? "ascending" : "descending"}`}
          onRemove={() => onRemoveSort(index)}
        />
      ))}
      {activeFilterEntries.map(({ filter, index }) => (
        <DatabaseConstraintChip
          key={`${filter.key}-${index}`}
          icon={<IconFilter className="size-3.5" />}
          label={databaseFilterChipLabel(filter, properties)}
          onRemove={() => onRemoveFilter(index)}
        />
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="ml-auto h-7 px-2 text-xs"
        onClick={onClearAll}
      >
        Clear all
      </Button>
    </div>
  );
}

function databaseToolbarIconButtonClass(active = false) {
  return cn(
    "h-7 w-7 p-0 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-45",
    active && "bg-muted text-foreground",
  );
}

type DatabaseSettingsPanel =
  | "main"
  | "layout"
  | "property_visibility"
  | "group";

function DatabaseViewSettingsPanel({
  open,
  panel,
  documentId,
  activeView,
  properties,
  items,
  hiddenCount,
  groupIds,
  onClose,
  onPanelChange,
  onViewTypeChange,
  onWrapCellsChange,
  onOpenPagesInChange,
  onPropertyHiddenChange,
  onPropertiesHiddenChange,
  onGroupByChange,
  onHideEmptyGroupsChange,
  onGroupsCollapsedChange,
}: {
  open: boolean;
  panel: DatabaseSettingsPanel;
  documentId: string;
  activeView: ContentDatabaseView;
  properties: DocumentProperty[];
  items: ContentDatabaseItem[];
  hiddenCount: number;
  groupIds: string[];
  onClose: () => void;
  onPanelChange: (panel: DatabaseSettingsPanel) => void;
  onViewTypeChange: (type: ContentDatabaseViewType) => void;
  onWrapCellsChange: (wrapCells: boolean) => void;
  onOpenPagesInChange: (openPagesIn: ContentDatabaseOpenPagesIn) => void;
  onPropertyHiddenChange: (propertyId: string, hidden: boolean) => void;
  onPropertiesHiddenChange: (propertyIds: string[], hidden: boolean) => void;
  onGroupByChange: (propertyId: string | null) => void;
  onHideEmptyGroupsChange: (hideEmptyGroups: boolean) => void;
  onGroupsCollapsedChange: (groupIds: string[], collapsed: boolean) => void;
}) {
  if (!open) return null;

  const title =
    panel === "main" ? "View settings" : databaseSettingsPanelTitle(panel);

  return (
    <aside className="fixed bottom-0 right-0 top-12 z-40 flex w-[320px] max-w-[calc(100vw-1rem)] flex-col border-l border-border bg-background shadow-[-12px_0_32px_rgba(15,23,42,0.06)]">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        {panel === "main" ? null : (
          <button
            type="button"
            aria-label="Back to view settings"
            className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onPanelChange("main")}
          >
            <IconArrowLeft className="size-4" />
          </button>
        )}
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
        </div>
        <button
          type="button"
          aria-label="Close view settings"
          className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onClose}
        >
          <IconX className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {panel === "main" ? (
          <DatabaseSettingsMainPanel
            activeView={activeView}
            propertyCount={properties.length}
            hiddenCount={hiddenCount}
            onPanelChange={onPanelChange}
          />
        ) : panel === "layout" ? (
          <DatabaseSettingsLayoutPanel
            activeView={activeView}
            onViewTypeChange={onViewTypeChange}
            onWrapCellsChange={onWrapCellsChange}
            onOpenPagesInChange={onOpenPagesInChange}
          />
        ) : panel === "property_visibility" ? (
          <DatabaseSettingsPropertyVisibilityPanel
            documentId={documentId}
            properties={properties}
            activeView={activeView}
            items={items}
            hiddenCount={hiddenCount}
            onPropertyHiddenChange={onPropertyHiddenChange}
            onPropertiesHiddenChange={onPropertiesHiddenChange}
          />
        ) : panel === "group" ? (
          <DatabaseSettingsGroupPanel
            activeView={activeView}
            properties={properties}
            groupIds={groupIds}
            onGroupByChange={onGroupByChange}
            onHideEmptyGroupsChange={onHideEmptyGroupsChange}
            onGroupsCollapsedChange={onGroupsCollapsedChange}
          />
        ) : null}
      </div>
    </aside>
  );
}

function databaseSettingsPanelTitle(panel: DatabaseSettingsPanel) {
  if (panel === "layout") return "Layout";
  if (panel === "property_visibility") return "Property visibility";
  if (panel === "group") return "Group";
  return "View settings";
}

function DatabaseSettingsMainPanel({
  activeView,
  propertyCount,
  hiddenCount,
  onPanelChange,
}: {
  activeView: ContentDatabaseView;
  propertyCount: number;
  hiddenCount: number;
  onPanelChange: (panel: DatabaseSettingsPanel) => void;
}) {
  const groupLabel = activeView.groupByPropertyId ? "On" : "";
  return (
    <div className="grid gap-3">
      <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2">
        {databaseViewIconElement(
          activeView.type,
          "size-4 text-muted-foreground",
        )}
        <Input
          value={activeView.name}
          readOnly
          aria-label="View name"
          className="h-7 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="grid gap-1">
        <DatabaseSettingsRow
          icon={databaseViewIconElement(activeView.type)}
          label="Layout"
          value={databaseViewDefaultName(activeView.type)}
          onClick={() => onPanelChange("layout")}
        />
        <DatabaseSettingsRow
          icon={<IconEye className="size-4" />}
          label="Property visibility"
          value={propertyCount > 0 ? String(propertyCount - hiddenCount) : ""}
          onClick={() => onPanelChange("property_visibility")}
        />
        <DatabaseSettingsRow
          icon={<IconLayoutKanban className="size-4" />}
          label="Group"
          value={groupLabel}
          onClick={() => onPanelChange("group")}
        />
      </div>
    </div>
  );
}

function databaseViewIconElement(
  type: ContentDatabaseViewType,
  className = "size-4",
) {
  const Icon = databaseViewIcon(type);
  return <Icon className={className} />;
}

function DatabaseSettingsRow({
  icon,
  label,
  value,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || !onClick}
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled || !onClick
          ? "cursor-default text-muted-foreground/60"
          : "text-foreground hover:bg-muted",
      )}
      onClick={onClick}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value ? (
        <span className="max-w-28 truncate text-xs text-muted-foreground">
          {value}
        </span>
      ) : null}
      {onClick && !disabled ? (
        <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
      ) : null}
    </button>
  );
}

function DatabaseSettingsSwitch({
  label,
  checked,
  disabled = false,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className="flex h-9 w-full items-center justify-between rounded-md px-2 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:text-muted-foreground/60 disabled:hover:bg-transparent"
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="truncate">{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          checked ? "bg-[#2383e2]" : "bg-muted-foreground/25",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-transform",
            checked ? "left-0.5 translate-x-4" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

function DatabaseSettingsLayoutPanel({
  activeView,
  onViewTypeChange,
  onWrapCellsChange,
  onOpenPagesInChange,
}: {
  activeView: ContentDatabaseView;
  onViewTypeChange: (type: ContentDatabaseViewType) => void;
  onWrapCellsChange: (wrapCells: boolean) => void;
  onOpenPagesInChange: (openPagesIn: ContentDatabaseOpenPagesIn) => void;
}) {
  const wrapCells = activeView.wrapCells === true;
  const openPagesIn = activeView.openPagesIn ?? "preview";

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-3 gap-2">
        {DATABASE_VIEW_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={activeView.type === type}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 rounded-md border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activeView.type === type
                ? "border-[#2383e2] bg-[#2383e2]/5 text-[#2383e2]"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={() => onViewTypeChange(type)}
          >
            {databaseViewIconElement(type, "size-4")}
            {databaseViewDefaultName(type)}
          </button>
        ))}
      </div>
      <div className="grid gap-1">
        <DatabaseSettingsSwitch
          label="Wrap all content"
          checked={wrapCells}
          disabled={activeView.type !== "table"}
          onCheckedChange={onWrapCellsChange}
        />
      </div>
      <DatabaseOpenPagesInSetting
        value={openPagesIn}
        onChange={onOpenPagesInChange}
      />
    </div>
  );
}

function DatabaseOpenPagesInSetting({
  value,
  onChange,
}: {
  value: ContentDatabaseOpenPagesIn;
  onChange: (value: ContentDatabaseOpenPagesIn) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between rounded-md px-2 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">Open pages in</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="max-w-28 truncate">
              {databaseOpenPagesInLabel(value)}
            </span>
            <IconChevronRight className="size-4 shrink-0" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-1">
        {DATABASE_OPEN_PAGES_IN.map((option) => {
          const Icon =
            option === "full_page" ? IconExternalLink : IconLayoutGrid;
          return (
            <DropdownMenuItem
              key={option}
              className="items-start gap-2 py-2"
              onSelect={(event) => {
                event.preventDefault();
                onChange(option);
              }}
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {databaseOpenPagesInLabel(option)}
                </span>
                <span className="block text-xs leading-4 text-muted-foreground">
                  {databaseOpenPagesInDescription(option)}
                </span>
              </span>
              {value === option ? (
                <IconCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DatabaseSettingsPropertyVisibilityPanel({
  documentId,
  properties,
  activeView,
  items,
  hiddenCount,
  onPropertyHiddenChange,
  onPropertiesHiddenChange,
}: {
  documentId: string;
  properties: DocumentProperty[];
  activeView: ContentDatabaseView;
  items: ContentDatabaseItem[];
  hiddenCount: number;
  onPropertyHiddenChange: (propertyId: string, hidden: boolean) => void;
  onPropertiesHiddenChange: (propertyIds: string[], hidden: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredProperties = normalizedQuery
    ? properties.filter((property) =>
        property.definition.name.toLowerCase().includes(normalizedQuery),
      )
    : properties;
  const visibleCount = properties.filter((property) =>
    isDatabasePropertyVisibleInView(property, items, activeView),
  ).length;
  const propertyIds = properties.map((property) => property.definition.id);

  return (
    <div className="grid gap-3">
      <div className="flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2">
        <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          placeholder="Search properties"
          aria-label="Search properties"
          onChange={(event) => setQuery(event.target.value)}
          className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {visibleCount} shown, {properties.length - visibleCount} hidden
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={hiddenCount === 0}
            onClick={() => onPropertiesHiddenChange(propertyIds, false)}
          >
            Show all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={visibleCount === 0}
            onClick={() => onPropertiesHiddenChange(propertyIds, true)}
          >
            Hide all
          </Button>
        </div>
      </div>
      <div className="grid gap-1">
        {filteredProperties.map((property) => {
          const Icon = TYPE_ICONS[property.definition.type];
          const visible = isDatabasePropertyVisibleInView(
            property,
            items,
            activeView,
          );
          return (
            <button
              key={property.definition.id}
              type="button"
              className="flex h-9 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() =>
                onPropertyHiddenChange(property.definition.id, visible)
              }
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {property.definition.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {visible ? "Shown" : "Hidden"}
              </span>
              {visible ? (
                <IconCheck className="size-4 shrink-0 text-muted-foreground" />
              ) : null}
            </button>
          );
        })}
        {filteredProperties.length === 0 ? (
          <div className="px-2 py-4 text-sm text-muted-foreground">
            No matching properties
          </div>
        ) : null}
      </div>
      <div className="border-t border-border/70 pt-3">
        <AddProperty documentId={documentId} label="New property" />
      </div>
    </div>
  );
}

function DatabaseSettingsGroupPanel({
  activeView,
  properties,
  groupIds,
  onGroupByChange,
  onHideEmptyGroupsChange,
  onGroupsCollapsedChange,
}: {
  activeView: Pick<
    ContentDatabaseView,
    "type" | "groupByPropertyId" | "hideEmptyGroups"
  >;
  properties: DocumentProperty[];
  groupIds: string[];
  onGroupByChange: (propertyId: string | null) => void;
  onHideEmptyGroupsChange: (hideEmptyGroups: boolean) => void;
  onGroupsCollapsedChange: (groupIds: string[], collapsed: boolean) => void;
}) {
  const [propertyQuery, setPropertyQuery] = useState("");
  const groupableProperties = databaseViewGroupableProperties(properties);
  const groupProperty = databaseViewGroupingProperty(activeView, properties);
  const hideEmptyGroups = activeView.hideEmptyGroups === true;
  const groupPropertyItems = databasePropertyPickerItems(
    groupableProperties,
    propertyQuery,
    { includeName: false },
  );
  const canGroupView =
    activeView.type === "table" ||
    activeView.type === "list" ||
    activeView.type === "gallery";

  return (
    <div className="grid gap-3">
      <div className="flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2">
        <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={propertyQuery}
          placeholder="Search properties"
          aria-label="Search group properties"
          disabled={!canGroupView}
          onChange={(event) => setPropertyQuery(event.target.value)}
          className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="grid gap-1">
        <button
          type="button"
          disabled={!canGroupView}
          className="flex h-9 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:text-muted-foreground/60 disabled:hover:bg-transparent"
          onClick={() => onGroupByChange(null)}
        >
          <IconX className="size-4 text-muted-foreground" />
          <span className="flex-1">None</span>
          {!groupProperty ? (
            <IconCheck className="size-4 text-muted-foreground" />
          ) : null}
        </button>
        {groupPropertyItems.map((item) => {
          const Icon =
            item.type === "name" ? IconFileText : TYPE_ICONS[item.type];
          return (
            <button
              key={item.key}
              type="button"
              disabled={!canGroupView}
              className="flex h-9 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:text-muted-foreground/60 disabled:hover:bg-transparent"
              onClick={() => onGroupByChange(item.key)}
            >
              <Icon className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {groupProperty?.definition.id === item.key ? (
                <IconCheck className="size-4 text-muted-foreground" />
              ) : null}
            </button>
          );
        })}
      </div>
      {groupableProperties.length === 0 ? (
        <div className="px-2 text-xs text-muted-foreground">
          Add a status, select, multi-select, or checkbox property to group.
        </div>
      ) : null}
      {groupProperty ? (
        <div className="grid gap-1 border-t border-border/70 pt-3">
          <DatabaseSettingsSwitch
            label="Hide empty groups"
            checked={hideEmptyGroups}
            onCheckedChange={onHideEmptyGroupsChange}
          />
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 flex-1 text-xs"
              disabled={groupIds.length === 0}
              onClick={() => onGroupsCollapsedChange(groupIds, true)}
            >
              Collapse all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 flex-1 text-xs"
              disabled={groupIds.length === 0}
              onClick={() => onGroupsCollapsedChange(groupIds, false)}
            >
              Expand all
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type DatabasePropertyPickerOption = {
  key: string;
  label: string;
  type: DocumentPropertyType | "name";
};

export function databasePropertyPickerItems(
  properties: DocumentProperty[],
  query: string,
  { includeName = true }: { includeName?: boolean } = {},
): DatabasePropertyPickerOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  const items: DatabasePropertyPickerOption[] = [
    ...(includeName
      ? [{ key: "name", label: "Name", type: "name" as const }]
      : []),
    ...properties.map((property) => ({
      key: property.definition.id,
      label: property.definition.name,
      type: property.definition.type,
    })),
  ];

  if (!normalizedQuery) return items;
  return items.filter((item) =>
    [item.key, item.label, item.type].some((value) =>
      String(value).toLowerCase().includes(normalizedQuery),
    ),
  );
}

function DatabasePropertyPickerSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="border-b border-border/70 p-1">
      <div className="flex h-8 items-center gap-2 rounded border border-input bg-background px-2">
        <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder="Search properties"
          aria-label="Search properties"
          className="h-6 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  );
}

function DatabasePropertyPickerItem({
  item,
  selected,
  onSelect,
}: {
  item: DatabasePropertyPickerOption;
  selected: boolean;
  onSelect: (key: string, label: string) => void;
}) {
  const Icon = item.type === "name" ? IconFileText : TYPE_ICONS[item.type];
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        onSelect(item.key, item.label);
      }}
    >
      <Icon className="mr-2 size-4 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {selected ? <IconCheck className="size-4 text-muted-foreground" /> : null}
    </DropdownMenuItem>
  );
}

function DatabasePropertyPickerSubContent({
  properties,
  selectedKey,
  includeName,
  onSelect,
}: {
  properties: DocumentProperty[];
  selectedKey: string;
  includeName?: boolean;
  onSelect: (key: string, label: string) => void;
}) {
  const [query, setQuery] = useState("");
  const items = databasePropertyPickerItems(properties, query, { includeName });

  return (
    <DropdownMenuSubContent className="max-h-80 w-64 overflow-auto">
      <DatabasePropertyPickerSearch value={query} onChange={setQuery} />
      {items.map((item) => (
        <DatabasePropertyPickerItem
          key={item.key}
          item={item}
          selected={selectedKey === item.key}
          onSelect={onSelect}
        />
      ))}
      {items.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          No properties found
        </div>
      ) : null}
    </DropdownMenuSubContent>
  );
}

function DatabaseGroupMenu({
  activeView,
  properties,
  groupIds,
  onGroupByChange,
  onHideEmptyGroupsChange,
  onGroupsCollapsedChange,
}: {
  activeView: Pick<
    ContentDatabaseView,
    "type" | "groupByPropertyId" | "hideEmptyGroups"
  >;
  properties: DocumentProperty[];
  groupIds: string[];
  onGroupByChange: (propertyId: string | null) => void;
  onHideEmptyGroupsChange: (hideEmptyGroups: boolean) => void;
  onGroupsCollapsedChange: (groupIds: string[], collapsed: boolean) => void;
}) {
  const groupableProperties = databaseViewGroupableProperties(properties);
  const groupProperty = databaseViewGroupingProperty(activeView, properties);
  const hideEmptyGroups = activeView.hideEmptyGroups === true;
  const [propertyQuery, setPropertyQuery] = useState("");
  const groupPropertyItems = databasePropertyPickerItems(
    groupableProperties,
    propertyQuery,
    { includeName: false },
  );
  const canGroupView =
    activeView.type === "table" ||
    activeView.type === "list" ||
    activeView.type === "gallery";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canGroupView}
          aria-label={
            groupProperty
              ? `Group by ${groupProperty.definition.name}`
              : "Group"
          }
          title="Group"
          className={cn(databaseToolbarIconButtonClass(Boolean(groupProperty)))}
        >
          <IconLayoutKanban className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Group by
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onGroupByChange(null);
          }}
        >
          <span className="flex-1">None</span>
          {!groupProperty ? (
            <IconCheck className="size-4 text-muted-foreground" />
          ) : null}
        </DropdownMenuItem>
        {groupableProperties.length > 0 ? <DropdownMenuSeparator /> : null}
        {groupableProperties.length > 0 ? (
          <DatabasePropertyPickerSearch
            value={propertyQuery}
            onChange={setPropertyQuery}
          />
        ) : null}
        {groupPropertyItems.map((item) => (
          <DatabasePropertyPickerItem
            key={item.key}
            item={item}
            selected={groupProperty?.definition.id === item.key}
            onSelect={(key) => onGroupByChange(key)}
          />
        ))}
        {groupableProperties.length > 0 && groupPropertyItems.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No properties found
          </div>
        ) : null}
        {groupProperty ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                onHideEmptyGroupsChange(!hideEmptyGroups);
              }}
            >
              <IconEyeOff className="mr-2 size-4 text-muted-foreground" />
              <span className="flex-1">Hide empty groups</span>
              {hideEmptyGroups ? (
                <IconCheck className="size-4 text-muted-foreground" />
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={groupIds.length === 0}
              onSelect={(event) => {
                event.preventDefault();
                onGroupsCollapsedChange(groupIds, true);
              }}
            >
              <IconChevronRight className="mr-2 size-4 text-muted-foreground" />
              Collapse all groups
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={groupIds.length === 0}
              onSelect={(event) => {
                event.preventDefault();
                onGroupsCollapsedChange(groupIds, false);
              }}
            >
              <IconChevronDown className="mr-2 size-4 text-muted-foreground" />
              Expand all groups
            </DropdownMenuItem>
          </>
        ) : null}
        {groupableProperties.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Add a status, select, multi-select, or checkbox property to group.
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function databaseOpenPagesInLabel(value: ContentDatabaseOpenPagesIn) {
  return value === "full_page" ? "Full page" : "Side preview";
}

function databaseOpenPagesInDescription(value: ContentDatabaseOpenPagesIn) {
  return value === "full_page"
    ? "Navigate to the page when opening a row."
    : "Open rows in a side panel without leaving the database.";
}

function databaseFilterModeLabel(filterMode: DatabaseFilterMode) {
  return filterMode === "or" ? "Any" : "All";
}

function databaseFilterModePhrase(filterMode: DatabaseFilterMode) {
  return filterMode === "or" ? "any filter" : "all filters";
}

function DatabaseResultCountFooter({
  visibleCount,
  totalCount,
  constrained,
}: {
  visibleCount: number;
  totalCount: number;
  constrained: boolean;
}) {
  if (totalCount === 0 && !constrained) return null;

  return (
    <div className="flex h-7 items-center border-b border-border/40 px-2 text-xs text-muted-foreground/60">
      {databaseResultCountLabel(visibleCount, totalCount, constrained)}
    </div>
  );
}

function DatabaseTableFooter({
  properties,
  items,
  totalCount,
  constrained,
  columnWidths,
  canEdit,
  calculations,
  actionColumnWidth = ACTION_COLUMN_WIDTH,
  onCalculationChange,
}: {
  properties: DocumentProperty[];
  items: ContentDatabaseItem[];
  totalCount: number;
  constrained: boolean;
  columnWidths: Record<string, number>;
  canEdit: boolean;
  calculations: Record<string, DatabaseColumnCalculation>;
  actionColumnWidth?: number;
  onCalculationChange: (
    key: ColumnKey,
    calculation: DatabaseColumnCalculation | null,
  ) => void;
}) {
  if (totalCount === 0 && !constrained) return null;

  return (
    <div
      className="group/footer grid border-b border-border/30 bg-background text-xs text-muted-foreground/55"
      style={{
        gridTemplateColumns: databaseGridColumns(
          properties,
          canEdit,
          columnWidths,
          actionColumnWidth,
        ),
      }}
    >
      <div className="flex h-6 min-w-0 items-center border-r border-border/30 px-2">
        {databaseResultCountLabel(items.length, totalCount, constrained)}
      </div>
      {properties.map((property) => {
        const calculation = calculations[property.definition.id] ?? null;
        const result = calculation
          ? databaseColumnCalculationResult(calculation, items, property)
          : null;
        const options = databaseCalculationOptionsForProperty(property);
        return (
          <div
            key={property.definition.id}
            className="flex h-6 min-w-0 items-center border-r border-border/30 px-1"
          >
            {canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Calculate ${property.definition.name}`}
                    className={cn(
                      "flex h-6 w-full min-w-0 items-center rounded px-1 text-left hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      calculation
                        ? "text-muted-foreground/70"
                        : "justify-center text-muted-foreground/35 opacity-0 transition-opacity group-hover/footer:opacity-100 focus-visible:opacity-100",
                    )}
                  >
                    {result ? (
                      <>
                        <span className="truncate">{result}</span>
                        <IconChevronDown className="ml-auto size-3.5 shrink-0 opacity-55" />
                      </>
                    ) : (
                      <IconPlus className="size-3.5" />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuLabel>Calculate</DropdownMenuLabel>
                  {options.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onSelect={() =>
                        onCalculationChange(
                          property.definition.id,
                          option.value,
                        )
                      }
                    >
                      <span className="flex-1">{option.label}</span>
                      {calculation === option.value ? (
                        <IconCheck className="size-4 text-muted-foreground" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!calculation}
                    onSelect={() =>
                      onCalculationChange(property.definition.id, null)
                    }
                  >
                    Clear
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="truncate px-1">{result}</span>
            )}
          </div>
        );
      })}
      {canEdit ? <div className="h-6" /> : null}
    </div>
  );
}

export function databaseResultCountLabel(
  visibleCount: number,
  totalCount: number,
  constrained: boolean,
) {
  const countLabel = `${visibleCount} ${visibleCount === 1 ? "page" : "pages"}`;
  if (!constrained || visibleCount === totalCount) {
    return `Count ${countLabel}`;
  }
  return `Count ${countLabel} of ${totalCount}`;
}

export function databaseFooterVisibleCount(
  viewType: ContentDatabaseViewType,
  visibleItems: ContentDatabaseItem[],
  screenVisibleItems: ContentDatabaseItem[],
) {
  return viewType === "calendar" || viewType === "timeline"
    ? screenVisibleItems.length
    : visibleItems.length;
}

export function databaseCalculationOptionsForProperty(
  property: DocumentProperty,
): Array<{ value: DatabaseColumnCalculation; label: string }> {
  const options: Array<{ value: DatabaseColumnCalculation; label: string }> = [
    { value: "count_all", label: "Count all" },
    { value: "count_values", label: "Count values" },
    { value: "count_empty", label: "Count empty" },
    { value: "count_unique", label: "Count unique" },
    { value: "percent_filled", label: "Percent filled" },
    { value: "percent_empty", label: "Percent empty" },
  ];
  if (property.definition.type === "checkbox") {
    options.push(
      { value: "count_checked", label: "Checked" },
      { value: "count_unchecked", label: "Unchecked" },
      { value: "percent_checked", label: "Percent checked" },
      { value: "percent_unchecked", label: "Percent unchecked" },
    );
  }
  if (property.definition.type === "number") {
    options.push(
      { value: "sum", label: "Sum" },
      { value: "average", label: "Average" },
      { value: "median", label: "Median" },
      { value: "min", label: "Min" },
      { value: "max", label: "Max" },
      { value: "range", label: "Range" },
    );
  }
  if (property.definition.type === "date") {
    options.push(
      { value: "min", label: "Earliest" },
      { value: "max", label: "Latest" },
      { value: "date_range", label: "Date range" },
    );
  }
  return options;
}

export function databaseColumnCalculationResult(
  calculation: DatabaseColumnCalculation,
  items: ContentDatabaseItem[],
  property: DocumentProperty,
) {
  const itemProperties = items.map((item) =>
    databaseItemPropertyById(item, [property], property.definition.id),
  );
  const filledCount = databaseCalculationFilledCount(itemProperties);

  if (calculation === "count_all") {
    return `${items.length} row${items.length === 1 ? "" : "s"}`;
  }
  if (calculation === "count_values") {
    return `${filledCount} value${filledCount === 1 ? "" : "s"}`;
  }
  if (calculation === "count_empty") {
    const emptyCount = items.length - filledCount;
    return `${emptyCount} empty`;
  }
  if (calculation === "count_unique") {
    const uniqueCount = databaseCalculationUniqueValues(itemProperties).size;
    return `${uniqueCount} unique`;
  }
  if (calculation === "percent_filled") {
    return items.length === 0
      ? "0% filled"
      : `${Math.round((filledCount / items.length) * 100)}% filled`;
  }
  if (calculation === "percent_empty") {
    const emptyCount = items.length - filledCount;
    return items.length === 0
      ? "0% empty"
      : `${Math.round((emptyCount / items.length) * 100)}% empty`;
  }

  if (property.definition.type === "checkbox") {
    const checkedCount = itemProperties.filter(
      (itemProperty) => itemProperty?.value === true,
    ).length;
    if (calculation === "count_checked") {
      return `${checkedCount} checked`;
    }
    if (calculation === "count_unchecked") {
      const uncheckedCount = items.length - checkedCount;
      return `${uncheckedCount} unchecked`;
    }
    if (calculation === "percent_checked") {
      return items.length === 0
        ? "0% checked"
        : `${Math.round((checkedCount / items.length) * 100)}% checked`;
    }
    if (calculation === "percent_unchecked") {
      const uncheckedCount = items.length - checkedCount;
      return items.length === 0
        ? "0% unchecked"
        : `${Math.round((uncheckedCount / items.length) * 100)}% unchecked`;
    }
  }

  if (property.definition.type === "number") {
    const numbers = itemProperties
      .map((itemProperty) => propertyNumberValue(itemProperty))
      .filter(Number.isFinite);
    if (numbers.length === 0) return "Empty";
    if (calculation === "sum") {
      return `Sum ${formatDatabaseCalculationNumber(
        numbers.reduce((sum, value) => sum + value, 0),
      )}`;
    }
    if (calculation === "average") {
      return `Avg ${formatDatabaseCalculationNumber(
        numbers.reduce((sum, value) => sum + value, 0) / numbers.length,
      )}`;
    }
    if (calculation === "median") {
      return `Median ${formatDatabaseCalculationNumber(
        databaseCalculationMedianNumber(numbers),
      )}`;
    }
    if (calculation === "min") {
      return `Min ${formatDatabaseCalculationNumber(Math.min(...numbers))}`;
    }
    if (calculation === "max") {
      return `Max ${formatDatabaseCalculationNumber(Math.max(...numbers))}`;
    }
    if (calculation === "range") {
      return `Range ${formatDatabaseCalculationNumber(
        Math.max(...numbers) - Math.min(...numbers),
      )}`;
    }
  }

  if (property.definition.type === "date") {
    const dateKeys = itemProperties
      .map((itemProperty) => calendarDateKey(itemProperty?.value ?? null))
      .filter((value): value is string => !!value)
      .sort();
    if (dateKeys.length === 0) return "Empty";
    if (calculation === "min") return `Earliest ${dateKeys[0]}`;
    if (calculation === "max") return `Latest ${dateKeys[dateKeys.length - 1]}`;
    if (calculation === "date_range") {
      const days = databaseCalculationDateRangeDays(
        dateKeys[0],
        dateKeys[dateKeys.length - 1],
      );
      return `Range ${days} day${days === 1 ? "" : "s"}`;
    }
  }

  return "Calculate";
}

function databaseCalculationFilledCount(
  itemProperties: Array<DocumentProperty | null>,
) {
  return itemProperties.filter(
    (itemProperty) => itemProperty && !isEmptyPropertyValue(itemProperty.value),
  ).length;
}

function databaseCalculationUniqueValues(
  itemProperties: Array<DocumentProperty | null>,
) {
  const values = new Set<string>();
  for (const itemProperty of itemProperties) {
    if (!itemProperty || isEmptyPropertyValue(itemProperty.value)) continue;
    const value = itemProperty.value;
    if (Array.isArray(value)) {
      for (const item of value) values.add(item);
      continue;
    }
    values.add(propertyValueText(itemProperty));
  }
  return values;
}

function formatDatabaseCalculationNumber(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function databaseCalculationMedianNumber(numbers: number[]) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function databaseCalculationDateRangeDays(startKey: string, endKey: string) {
  const start = new Date(`${startKey}T00:00:00.000Z`).getTime();
  const end = new Date(`${endKey}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function databaseViewHasNoMatchingPages(
  visibleCount: number,
  hasSearch: boolean,
  activeFilterCount: number,
) {
  return visibleCount === 0 && (hasSearch || activeFilterCount > 0);
}

function DatabaseNoMatchingPages({
  label = "No pages match this view",
  className,
  onClear,
}: {
  label?: string;
  className?: string;
  onClear: () => void;
}) {
  return (
    <div
      className={cn(
        "flex min-h-16 flex-wrap items-center justify-between gap-2 px-2 py-3 text-sm text-muted-foreground",
        className,
      )}
    >
      <span>{label}</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-xs"
        onClick={onClear}
      >
        Clear search and filters
      </Button>
    </div>
  );
}

function DatabaseConstraintChip({
  icon,
  label,
  onRemove,
}: {
  icon: ReactNode;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-7 max-w-72 items-center gap-1.5 rounded border border-border bg-muted/40 px-2 text-foreground">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={onRemove}
      >
        <IconX className="size-3.5" />
      </button>
    </span>
  );
}

function DatabaseListView({
  properties,
  groupableProperties,
  items,
  databaseDocumentId,
  canEdit,
  isLoading,
  isCreating,
  activeFilters,
  hasSearch,
  rowsAreManuallyOrdered,
  groupByPropertyId,
  collapsedGroupIds,
  hideEmptyGroups,
  onClearResultConstraints,
  onCreateRow,
  onCreateGroupedRow,
  onGroupCollapsedChange,
  onPreview,
  onDeletedPreviewItem,
  onOpenPage,
}: {
  properties: DocumentProperty[];
  groupableProperties: DocumentProperty[];
  items: ContentDatabaseItem[];
  databaseDocumentId: string;
  canEdit: boolean;
  isLoading: boolean;
  isCreating: boolean;
  activeFilters: DatabaseFilter[];
  hasSearch: boolean;
  rowsAreManuallyOrdered: boolean;
  groupByPropertyId: string | null;
  collapsedGroupIds: string[];
  hideEmptyGroups: boolean;
  onClearResultConstraints: () => void;
  onCreateRow: CreateDatabaseRowHandler;
  onCreateGroupedRow: (
    group: DatabaseBoardGroup,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
  onGroupCollapsedChange: (groupId: string, collapsed: boolean) => void;
  onPreview: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onOpenPage: (item: ContentDatabaseItem) => void;
}) {
  const groups = databaseVisibleGroups(
    databaseViewItemGroups(items, groupableProperties, groupByPropertyId),
    hideEmptyGroups,
  );
  const grouped = !!databaseViewGroupingProperty(
    { type: "list", groupByPropertyId },
    groupableProperties,
  );

  return (
    <div className="border-b border-border">
      <div className="flex min-h-9 items-center gap-2 border-t border-border px-1 text-xs text-muted-foreground">
        <IconList className="size-4 shrink-0" />
        <span>List</span>
      </div>
      {isLoading ? (
        <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading list
        </div>
      ) : (
        <div className="grid">
          {databaseViewHasNoMatchingPages(
            items.length,
            hasSearch,
            activeFilters.length,
          ) ? (
            <DatabaseNoMatchingPages onClear={onClearResultConstraints} />
          ) : null}
          {grouped
            ? groups.map((group) => (
                <DatabaseGroupedListSection
                  key={group.id}
                  group={group}
                  properties={properties}
                  databaseDocumentId={databaseDocumentId}
                  canEdit={canEdit}
                  isCreating={isCreating}
                  collapsed={databaseGroupIsCollapsed(
                    collapsedGroupIds,
                    group.id,
                  )}
                  onCreateRow={onCreateGroupedRow}
                  onCollapsedChange={(collapsed) =>
                    onGroupCollapsedChange(group.id, collapsed)
                  }
                  onPreview={onPreview}
                  onDeletedPreviewItem={onDeletedPreviewItem}
                  onOpenPage={onOpenPage}
                />
              ))
            : items.map((item, index) => (
                <DatabaseListRow
                  key={item.id}
                  item={item}
                  properties={properties}
                  databaseDocumentId={databaseDocumentId}
                  canEdit={canEdit}
                  rowIndex={index}
                  canReorder={rowsAreManuallyOrdered}
                  canMoveUp={rowsAreManuallyOrdered && index > 0}
                  canMoveDown={
                    rowsAreManuallyOrdered && index < items.length - 1
                  }
                  onPreviewItem={onPreview}
                  onDeletedPreviewItem={onDeletedPreviewItem}
                  onPreview={() => onPreview(item)}
                  onOpenPage={() => onOpenPage(item)}
                />
              ))}
          {canEdit && !grouped ? (
            <NewListRow
              disabled={isCreating}
              isPending={isCreating}
              onCreate={onCreateRow}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function DatabaseGroupedListSection({
  group,
  properties,
  databaseDocumentId,
  canEdit,
  isCreating,
  collapsed,
  onCreateRow,
  onCollapsedChange,
  onPreview,
  onDeletedPreviewItem,
  onOpenPage,
}: {
  group: DatabaseBoardGroup;
  properties: DocumentProperty[];
  databaseDocumentId: string;
  canEdit: boolean;
  isCreating: boolean;
  collapsed: boolean;
  onCreateRow: (
    group: DatabaseBoardGroup,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
  onCollapsedChange: (collapsed: boolean) => void;
  onPreview: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onOpenPage: (item: ContentDatabaseItem) => void;
}) {
  return (
    <section>
      <DatabaseGroupHeader
        group={group}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
      />
      {!collapsed ? (
        <>
          {group.items.map((item, index) => (
            <DatabaseListRow
              key={`${group.id}-${item.id}`}
              item={item}
              properties={properties}
              databaseDocumentId={databaseDocumentId}
              canEdit={canEdit}
              rowIndex={index}
              canReorder={false}
              canMoveUp={false}
              canMoveDown={false}
              onPreviewItem={onPreview}
              onDeletedPreviewItem={onDeletedPreviewItem}
              onPreview={() => onPreview(item)}
              onOpenPage={() => onOpenPage(item)}
            />
          ))}
          {canEdit ? (
            <NewListRow
              disabled={isCreating}
              isPending={isCreating}
              onCreate={(title) => onCreateRow(group, title)}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function DatabaseGroupHeader({
  group,
  collapsed,
  onCollapsedChange,
}: {
  group: DatabaseBoardGroup;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="flex min-h-9 w-full items-center gap-2 border-t border-border bg-muted/30 px-2 text-left text-xs text-muted-foreground hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-expanded={!collapsed}
      onClick={() => onCollapsedChange(!collapsed)}
    >
      <IconChevronRight
        className={cn(
          "size-3.5 shrink-0 transition-transform",
          !collapsed && "rotate-90",
        )}
      />
      <span className="min-w-0 truncate font-medium text-foreground">
        {group.label}
      </span>
      <span className="rounded bg-background px-1.5 py-0.5 text-[11px]">
        {group.items.length}
      </span>
    </button>
  );
}

function DatabaseListRow({
  item,
  properties,
  databaseDocumentId,
  canEdit,
  rowIndex,
  canReorder,
  canMoveUp,
  canMoveDown,
  onPreviewItem,
  onDeletedPreviewItem,
  onPreview,
  onOpenPage,
}: {
  item: ContentDatabaseItem;
  properties: DocumentProperty[];
  databaseDocumentId: string;
  canEdit: boolean;
  rowIndex: number;
  canReorder: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPreviewItem: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onPreview: () => void;
  onOpenPage: () => void;
}) {
  const visibleProperties = properties.slice(0, 4);

  return (
    <div className="group flex min-h-10 items-center gap-2 border-t border-border px-1 py-1 hover:bg-muted/40">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onPreview}
      >
        <DatabaseItemPageIcon
          document={item.document}
          className="size-4 text-sm"
          fallbackClassName="size-4"
        />
        <span className="min-w-0 truncate text-sm font-medium">
          {item.document.title || "Untitled"}
        </span>
        {visibleProperties.length > 0 ? (
          <span className="ml-2 hidden min-w-0 flex-wrap items-center gap-1 md:flex">
            {visibleProperties.map((property) => {
              const itemProperty =
                item.properties.find(
                  (candidate) =>
                    candidate.definition.id === property.definition.id,
                ) ?? property;
              return (
                <span
                  key={property.definition.id}
                  className="max-w-36 truncate rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
                >
                  {displayValue(itemProperty)}
                </span>
              );
            })}
          </span>
        ) : null}
      </button>
      {canEdit ? (
        <RowActionsCell
          item={item}
          databaseDocumentId={databaseDocumentId}
          rowIndex={rowIndex}
          canReorder={canReorder}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onPreviewItem={onPreviewItem}
          onDeletedPreviewItem={onDeletedPreviewItem}
          onOpenPage={onOpenPage}
        />
      ) : null}
    </div>
  );
}

function NewListRow({
  disabled,
  isPending,
  onCreate,
}: {
  disabled: boolean;
  isPending: boolean;
  onCreate: CreateDatabaseRowHandler;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");

  async function submitNewRow() {
    if (disabled) return;
    const createdItem = await onCreate(title.trim());
    setTitle("");
    if (!createdItem) inputRef.current?.focus();
  }

  return (
    <form
      className="flex h-10 items-center gap-2 border-t border-border px-2 text-sm text-muted-foreground hover:bg-muted/40 focus-within:bg-muted/40 focus-within:text-foreground"
      onSubmit={(event) => {
        event.preventDefault();
        void submitNewRow();
      }}
    >
      {isPending ? (
        <Spinner className="size-4 shrink-0" />
      ) : (
        <IconPlus className="size-4 shrink-0" />
      )}
      <input
        ref={inputRef}
        value={title}
        disabled={disabled}
        aria-label="New database list item title"
        placeholder="New page"
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submitNewRow();
          }
          if (event.key === "Escape") {
            setTitle("");
            event.currentTarget.blur();
          }
        }}
        className="h-7 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground focus:placeholder:text-muted-foreground/70"
      />
    </form>
  );
}

function DatabaseGalleryView({
  properties,
  groupableProperties,
  items,
  databaseDocumentId,
  canEdit,
  isLoading,
  isCreating,
  activeFilters,
  hasSearch,
  rowsAreManuallyOrdered,
  groupByPropertyId,
  collapsedGroupIds,
  hideEmptyGroups,
  onClearResultConstraints,
  onCreateRow,
  onCreateGroupedRow,
  onGroupCollapsedChange,
  onPreview,
  onDeletedPreviewItem,
  onOpenPage,
}: {
  properties: DocumentProperty[];
  groupableProperties: DocumentProperty[];
  items: ContentDatabaseItem[];
  databaseDocumentId: string;
  canEdit: boolean;
  isLoading: boolean;
  isCreating: boolean;
  activeFilters: DatabaseFilter[];
  hasSearch: boolean;
  rowsAreManuallyOrdered: boolean;
  groupByPropertyId: string | null;
  collapsedGroupIds: string[];
  hideEmptyGroups: boolean;
  onClearResultConstraints: () => void;
  onCreateRow: CreateDatabaseRowHandler;
  onCreateGroupedRow: (
    group: DatabaseBoardGroup,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
  onGroupCollapsedChange: (groupId: string, collapsed: boolean) => void;
  onPreview: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onOpenPage: (item: ContentDatabaseItem) => void;
}) {
  const groups = databaseVisibleGroups(
    databaseViewItemGroups(items, groupableProperties, groupByPropertyId),
    hideEmptyGroups,
  );
  const grouped = !!databaseViewGroupingProperty(
    { type: "gallery", groupByPropertyId },
    groupableProperties,
  );

  return (
    <div className="border-b border-border">
      <div className="flex min-h-9 items-center gap-2 border-t border-border px-1 text-xs text-muted-foreground">
        <IconLayoutGrid className="size-4 shrink-0" />
        <span>Gallery</span>
      </div>
      {isLoading ? (
        <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading gallery
        </div>
      ) : (
        <div className="grid gap-3 px-1 py-3 sm:grid-cols-2 lg:grid-cols-3">
          {databaseViewHasNoMatchingPages(
            items.length,
            hasSearch,
            activeFilters.length,
          ) ? (
            <DatabaseNoMatchingPages
              className="col-span-full"
              onClear={onClearResultConstraints}
            />
          ) : null}
          {grouped
            ? groups.map((group) => (
                <DatabaseGroupedGallerySection
                  key={group.id}
                  group={group}
                  properties={properties}
                  databaseDocumentId={databaseDocumentId}
                  canEdit={canEdit}
                  isCreating={isCreating}
                  collapsed={databaseGroupIsCollapsed(
                    collapsedGroupIds,
                    group.id,
                  )}
                  onCreateRow={onCreateGroupedRow}
                  onCollapsedChange={(collapsed) =>
                    onGroupCollapsedChange(group.id, collapsed)
                  }
                  onPreview={onPreview}
                  onDeletedPreviewItem={onDeletedPreviewItem}
                  onOpenPage={onOpenPage}
                />
              ))
            : items.map((item, index) => (
                <DatabaseGalleryCard
                  key={item.id}
                  item={item}
                  properties={properties}
                  databaseDocumentId={databaseDocumentId}
                  canEdit={canEdit}
                  rowIndex={index}
                  canReorder={rowsAreManuallyOrdered}
                  canMoveUp={rowsAreManuallyOrdered && index > 0}
                  canMoveDown={
                    rowsAreManuallyOrdered && index < items.length - 1
                  }
                  onPreviewItem={onPreview}
                  onDeletedPreviewItem={onDeletedPreviewItem}
                  onPreview={() => onPreview(item)}
                  onOpenPage={() => onOpenPage(item)}
                />
              ))}
          {canEdit && !grouped ? (
            <NewGalleryCard
              disabled={isCreating}
              isPending={isCreating}
              onCreate={onCreateRow}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function DatabaseGroupedGallerySection({
  group,
  properties,
  databaseDocumentId,
  canEdit,
  isCreating,
  collapsed,
  onCreateRow,
  onCollapsedChange,
  onPreview,
  onDeletedPreviewItem,
  onOpenPage,
}: {
  group: DatabaseBoardGroup;
  properties: DocumentProperty[];
  databaseDocumentId: string;
  canEdit: boolean;
  isCreating: boolean;
  collapsed: boolean;
  onCreateRow: (
    group: DatabaseBoardGroup,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
  onCollapsedChange: (collapsed: boolean) => void;
  onPreview: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onOpenPage: (item: ContentDatabaseItem) => void;
}) {
  return (
    <section className="col-span-full grid gap-3">
      <DatabaseGroupHeader
        group={group}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
      />
      {!collapsed ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {group.items.map((item, index) => (
            <DatabaseGalleryCard
              key={`${group.id}-${item.id}`}
              item={item}
              properties={properties}
              databaseDocumentId={databaseDocumentId}
              canEdit={canEdit}
              rowIndex={index}
              canReorder={false}
              canMoveUp={false}
              canMoveDown={false}
              onPreviewItem={onPreview}
              onDeletedPreviewItem={onDeletedPreviewItem}
              onPreview={() => onPreview(item)}
              onOpenPage={() => onOpenPage(item)}
            />
          ))}
          {canEdit ? (
            <NewGalleryCard
              disabled={isCreating}
              isPending={isCreating}
              onCreate={(title) => onCreateRow(group, title)}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DatabaseGalleryCard({
  item,
  properties,
  databaseDocumentId,
  canEdit,
  rowIndex,
  canReorder,
  canMoveUp,
  canMoveDown,
  onPreviewItem,
  onDeletedPreviewItem,
  onPreview,
  onOpenPage,
}: {
  item: ContentDatabaseItem;
  properties: DocumentProperty[];
  databaseDocumentId: string;
  canEdit: boolean;
  rowIndex: number;
  canReorder: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPreviewItem: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onPreview: () => void;
  onOpenPage: () => void;
}) {
  const visibleProperties = properties.slice(0, 4);

  return (
    <div className="group overflow-hidden rounded-md border border-border bg-background shadow-sm transition-colors hover:bg-accent/40">
      <button
        type="button"
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onPreview}
      >
        <div className="flex aspect-[5/3] items-center justify-center border-b border-border bg-muted/45">
          <DatabaseItemPageIcon
            document={item.document}
            className="size-10 text-4xl"
            fallbackClassName="size-8 text-muted-foreground/70"
          />
        </div>
        <div className="grid gap-2 p-3">
          <span className="min-w-0 truncate text-sm font-medium">
            {item.document.title || "Untitled"}
          </span>
          {visibleProperties.length > 0 ? (
            <span className="grid gap-1">
              {visibleProperties.map((property) => {
                const itemProperty =
                  item.properties.find(
                    (candidate) =>
                      candidate.definition.id === property.definition.id,
                  ) ?? property;
                const Icon = TYPE_ICONS[property.definition.type];
                return (
                  <span
                    key={property.definition.id}
                    className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {displayValue(itemProperty)}
                    </span>
                  </span>
                );
              })}
            </span>
          ) : null}
        </div>
      </button>
      {canEdit ? (
        <div className="flex justify-end border-t border-border/70 px-2 py-1">
          <RowActionsCell
            item={item}
            databaseDocumentId={databaseDocumentId}
            rowIndex={rowIndex}
            canReorder={canReorder}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onPreviewItem={onPreviewItem}
            onDeletedPreviewItem={onDeletedPreviewItem}
            onOpenPage={onOpenPage}
          />
        </div>
      ) : null}
    </div>
  );
}

function NewGalleryCard({
  disabled,
  isPending,
  onCreate,
}: {
  disabled: boolean;
  isPending: boolean;
  onCreate: CreateDatabaseRowHandler;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");

  async function submitNewCard() {
    if (disabled) return;
    const createdItem = await onCreate(title.trim());
    setTitle("");
    if (!createdItem) inputRef.current?.focus();
  }

  return (
    <form
      className="flex min-h-40 flex-col justify-between rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground hover:bg-muted/35 focus-within:bg-muted/35"
      onSubmit={(event) => {
        event.preventDefault();
        void submitNewCard();
      }}
    >
      <div className="flex items-center gap-2">
        {isPending ? (
          <Spinner className="size-4 shrink-0" />
        ) : (
          <IconPlus className="size-4 shrink-0" />
        )}
        <input
          ref={inputRef}
          value={title}
          disabled={disabled}
          aria-label="New database gallery card title"
          placeholder="New page"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submitNewCard();
            }
            if (event.key === "Escape") {
              setTitle("");
              event.currentTarget.blur();
            }
          }}
          className="h-7 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground focus:placeholder:text-muted-foreground/70"
        />
      </div>
    </form>
  );
}

function DatabaseCalendarView({
  activeView,
  properties,
  items,
  databaseDocumentId,
  canEdit,
  isLoading,
  isCreating,
  activeFilters,
  hasSearch,
  dateProperty,
  month,
  onClearResultConstraints,
  onMonthChange,
  onDatePropertyChange,
  onCreateCard,
  onPreview,
  onDeletedPreviewItem,
  onOpenPage,
}: {
  activeView: ContentDatabaseView;
  properties: DocumentProperty[];
  items: ContentDatabaseItem[];
  databaseDocumentId: string;
  canEdit: boolean;
  isLoading: boolean;
  isCreating: boolean;
  activeFilters: DatabaseFilter[];
  hasSearch: boolean;
  dateProperty: DocumentProperty | null;
  month: Date;
  onClearResultConstraints: () => void;
  onMonthChange: (month: Date) => void;
  onDatePropertyChange: (propertyId: string | null) => void;
  onCreateCard: (
    dateKey: string,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
  onPreview: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onOpenPage: (item: ContentDatabaseItem) => void;
}) {
  const dateProperties = databaseCalendarDateProperties(properties);
  const monthDays = databaseCalendarMonthDays(month);
  const itemsByDate = databaseCalendarItemsByDate(
    items,
    properties,
    dateProperty?.definition.id ?? null,
  );
  const noDateItems = databaseItemsWithoutDateValue(
    items,
    properties,
    dateProperty?.definition.id ?? null,
  );
  const visibleProperties = properties
    .filter((property) =>
      isDatabasePropertyVisibleInView(property, items, activeView),
    )
    .filter(
      (property) => property.definition.id !== dateProperty?.definition.id,
    );
  const canCreateOnDay =
    canEdit &&
    dateProperty?.editable &&
    dateProperty.definition.type === "date";
  const monthLabel = month.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  function changeMonth(offset: number) {
    onMonthChange(
      startOfMonth(new Date(month.getFullYear(), month.getMonth() + offset)),
    );
  }

  return (
    <div className="min-w-0 max-w-full overflow-hidden border-b border-border">
      <div className="flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border px-1 py-1">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <IconCalendar className="size-4 shrink-0" />
          <span className="truncate">{monthLabel}</span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
          {dateProperties.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 max-w-48 gap-1.5 px-2 text-xs text-muted-foreground"
                >
                  <IconCalendarDue className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {dateProperty?.definition.name ?? "Date"}
                  </span>
                  <IconChevronDown className="size-3.5 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Calendar by
                </DropdownMenuLabel>
                {dateProperties.map((property) => {
                  const Icon = TYPE_ICONS[property.definition.type];
                  return (
                    <DropdownMenuItem
                      key={property.definition.id}
                      onSelect={(event) => {
                        event.preventDefault();
                        onDatePropertyChange(property.definition.id);
                      }}
                    >
                      <Icon className="mr-2 size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {property.definition.name}
                      </span>
                      {dateProperty?.definition.id ===
                      property.definition.id ? (
                        <IconCheck className="size-4 text-muted-foreground" />
                      ) : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => onMonthChange(startOfMonth(new Date()))}
          >
            <IconCalendarEvent className="mr-1 size-3.5" />
            Today
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label="Previous month"
            onClick={() => changeMonth(-1)}
          >
            <IconArrowUp className="size-3.5 -rotate-90" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label="Next month"
            onClick={() => changeMonth(1)}
          >
            <IconArrowUp className="size-3.5 rotate-90" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading calendar
        </div>
      ) : dateProperties.length === 0 ? (
        <div className="flex min-h-24 items-center justify-between gap-3 px-2 py-4 text-sm text-muted-foreground">
          <span>Add a date property to use calendar view.</span>
          {canEdit ? <AddProperty documentId={databaseDocumentId} /> : null}
        </div>
      ) : databaseViewHasNoMatchingPages(
          items.length,
          hasSearch,
          activeFilters.length,
        ) ? (
        <DatabaseNoMatchingPages onClear={onClearResultConstraints} />
      ) : (
        <>
          <div
            data-database-calendar-surface="true"
            className="min-w-0 max-w-full overflow-hidden"
          >
            <div className="w-full min-w-0">
              <div className="grid grid-cols-7 border-t border-border text-xs font-medium text-muted-foreground">
                {CALENDAR_WEEKDAYS.map((weekday) => (
                  <div
                    key={weekday}
                    className="min-w-0 border-r border-border px-2 py-1.5 last:border-r-0"
                  >
                    {weekday}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 border-t border-border">
                {monthDays.map((day) => {
                  const dateKey = calendarDateKey(day);
                  const dayItems = itemsByDate.get(dateKey) ?? [];
                  const inMonth = day.getMonth() === month.getMonth();
                  return (
                    <section
                      key={dateKey}
                      className={cn(
                        "group min-w-0 border-r border-b border-border bg-background p-1.5 last:border-r-0",
                        !inMonth && "bg-muted/25 text-muted-foreground",
                      )}
                      aria-label={`${dateKey} calendar day`}
                    >
                      <div className="mb-1 flex h-6 items-center justify-between gap-1">
                        {dayItems.length > 0 ? (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {dayItems.length}
                          </span>
                        ) : (
                          <span aria-hidden="true" />
                        )}
                        <span className="ml-auto flex items-center gap-1">
                          {canCreateOnDay ? (
                            <NewCalendarCard
                              dateKey={dateKey}
                              disabled={isCreating}
                              isPending={isCreating}
                              onCreate={onCreateCard}
                            />
                          ) : null}
                          <span
                            className={cn(
                              "flex size-6 items-center justify-center rounded-full text-xs font-medium",
                              dateKey === calendarDateKey(new Date()) &&
                                "bg-foreground text-background",
                            )}
                          >
                            {day.getDate()}
                          </span>
                        </span>
                      </div>
                      <div className="grid min-h-28 gap-1">
                        {dayItems.map((item) => (
                          <DatabaseCalendarCard
                            key={item.id}
                            item={item}
                            databaseDocumentId={databaseDocumentId}
                            properties={visibleProperties}
                            canEdit={canEdit}
                            onPreviewItem={onPreview}
                            onDeletedPreviewItem={onDeletedPreviewItem}
                            onPreview={() => onPreview(item)}
                            onOpenPage={() => onOpenPage(item)}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </div>
          <DatabaseDateViewNoDateSection
            items={noDateItems}
            databaseDocumentId={databaseDocumentId}
            properties={visibleProperties}
            canEdit={canEdit}
            onPreview={onPreview}
            onDeletedPreviewItem={onDeletedPreviewItem}
            onOpenPage={onOpenPage}
          />
        </>
      )}
    </div>
  );
}

function DatabaseDateViewNoDateSection({
  items,
  databaseDocumentId,
  properties,
  canEdit,
  onPreview,
  onDeletedPreviewItem,
  onOpenPage,
}: {
  items: ContentDatabaseItem[];
  databaseDocumentId: string;
  properties: DocumentProperty[];
  canEdit: boolean;
  onPreview: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onOpenPage: (item: ContentDatabaseItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section className="border-t border-border bg-muted/20 px-2 py-2">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          <IconCalendarOff className="size-3.5 shrink-0" />
          <span className="truncate">No date</span>
        </span>
        <span className="rounded bg-background px-1.5 py-0.5 text-[11px]">
          {items.length}
        </span>
      </div>
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <DatabaseCalendarCard
            key={item.id}
            item={item}
            databaseDocumentId={databaseDocumentId}
            properties={properties}
            canEdit={canEdit}
            onPreviewItem={onPreview}
            onDeletedPreviewItem={onDeletedPreviewItem}
            onPreview={() => onPreview(item)}
            onOpenPage={() => onOpenPage(item)}
          />
        ))}
      </div>
    </section>
  );
}

function DatabaseCalendarCard({
  item,
  databaseDocumentId,
  properties,
  canEdit,
  onPreviewItem,
  onDeletedPreviewItem,
  onPreview,
  onOpenPage,
}: {
  item: ContentDatabaseItem;
  databaseDocumentId: string;
  properties: DocumentProperty[];
  canEdit: boolean;
  onPreviewItem: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onPreview: () => void;
  onOpenPage: () => void;
}) {
  const visibleProperties = properties.slice(0, 2);

  return (
    <div className="group/card rounded border border-border bg-background px-2 py-1.5 text-xs shadow-sm transition-colors hover:bg-accent/60">
      <div className="flex min-w-0 items-start gap-1">
        <button
          type="button"
          className="grid min-w-0 flex-1 gap-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onPreview}
        >
          <span className="flex min-w-0 items-center gap-1.5 font-medium">
            <DatabaseItemPageIcon
              document={item.document}
              className="size-3.5 text-xs"
              fallbackClassName="size-3.5"
            />
            <span className="truncate">
              {item.document.title || "Untitled"}
            </span>
          </span>
          {visibleProperties.length > 0 ? (
            <span className="grid gap-0.5">
              {visibleProperties.map((property) => {
                const itemProperty =
                  item.properties.find(
                    (candidate) =>
                      candidate.definition.id === property.definition.id,
                  ) ?? property;
                const Icon = TYPE_ICONS[property.definition.type];
                return (
                  <span
                    key={property.definition.id}
                    className="flex min-w-0 items-center gap-1 text-muted-foreground"
                  >
                    <Icon className="size-3 shrink-0" />
                    <span className="truncate">
                      {displayValue(itemProperty)}
                    </span>
                  </span>
                );
              })}
            </span>
          ) : null}
        </button>
        {canEdit ? (
          <RowActionsCell
            item={item}
            databaseDocumentId={databaseDocumentId}
            rowIndex={0}
            canReorder={false}
            canMoveUp={false}
            canMoveDown={false}
            showReorderActions={false}
            onPreviewItem={onPreviewItem}
            onDeletedPreviewItem={onDeletedPreviewItem}
            onOpenPage={onOpenPage}
          />
        ) : null}
      </div>
    </div>
  );
}
function NewCalendarCard({
  dateKey,
  disabled,
  isPending,
  onCreate,
}: {
  dateKey: string;
  disabled: boolean;
  isPending: boolean;
  onCreate: (
    dateKey: string,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
}) {
  async function createCard() {
    if (disabled) return;
    await onCreate(dateKey, "");
  }

  return (
    <button
      type="button"
      aria-label={`Add page for ${dateKey}`}
      disabled={disabled}
      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 group-focus-within:opacity-100 group-hover:opacity-100"
      onClick={() => void createCard()}
    >
      {isPending ? (
        <Spinner className="size-3.5" />
      ) : (
        <IconPlus className="size-3.5" />
      )}
    </button>
  );
}

function DatabaseTimelineView({
  activeView,
  properties,
  items,
  databaseDocumentId,
  canEdit,
  isLoading,
  isCreating,
  activeFilters,
  hasSearch,
  dateProperty,
  month,
  onClearResultConstraints,
  onMonthChange,
  onDatePropertyChange,
  onEndDatePropertyChange,
  onCreateCard,
  onPreview,
  onDeletedPreviewItem,
  onOpenPage,
}: {
  activeView: ContentDatabaseView;
  properties: DocumentProperty[];
  items: ContentDatabaseItem[];
  databaseDocumentId: string;
  canEdit: boolean;
  isLoading: boolean;
  isCreating: boolean;
  activeFilters: DatabaseFilter[];
  hasSearch: boolean;
  dateProperty: DocumentProperty | null;
  month: Date;
  onClearResultConstraints: () => void;
  onMonthChange: (month: Date) => void;
  onDatePropertyChange: (propertyId: string | null) => void;
  onEndDatePropertyChange: (propertyId: string | null) => void;
  onCreateCard: (
    dateKey: string,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
  onPreview: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onOpenPage: (item: ContentDatabaseItem) => void;
}) {
  const dateProperties = databaseCalendarDateProperties(properties);
  const timelineDays = databaseTimelineDays(month);
  const endDateProperty = databaseTimelineEndDateProperty(
    activeView,
    properties,
    dateProperty?.definition.id ?? null,
  );
  const timelineSpans = databaseTimelineItemSpans(
    items,
    properties,
    dateProperty?.definition.id ?? null,
    endDateProperty?.definition.id ?? null,
    timelineDays,
  );
  const noDateItems = databaseItemsWithoutDateValue(
    items,
    properties,
    dateProperty?.definition.id ?? null,
  );
  const visibleProperties = properties
    .filter((property) =>
      isDatabasePropertyVisibleInView(property, items, activeView),
    )
    .filter(
      (property) =>
        property.definition.id !== dateProperty?.definition.id &&
        property.definition.id !== endDateProperty?.definition.id,
    );
  const canCreateOnDay =
    canEdit &&
    dateProperty?.editable &&
    dateProperty.definition.type === "date";
  const rangeLabel = databaseTimelineRangeLabel(timelineDays);

  function changeMonth(offset: number) {
    onMonthChange(
      startOfMonth(new Date(month.getFullYear(), month.getMonth() + offset)),
    );
  }

  return (
    <div className="border-b border-border">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 border-t border-border px-1 py-1">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <IconTimeline className="size-4 shrink-0" />
          <span className="truncate">{rangeLabel}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          {dateProperties.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 max-w-48 gap-1.5 px-2 text-xs text-muted-foreground"
                >
                  <IconCalendarDue className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {dateProperty?.definition.name ?? "Date"}
                  </span>
                  <IconChevronDown className="size-3.5 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Start date
                </DropdownMenuLabel>
                {dateProperties.map((property) => {
                  const Icon = TYPE_ICONS[property.definition.type];
                  return (
                    <DropdownMenuItem
                      key={property.definition.id}
                      onSelect={(event) => {
                        event.preventDefault();
                        onDatePropertyChange(property.definition.id);
                      }}
                    >
                      <Icon className="mr-2 size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {property.definition.name}
                      </span>
                      {dateProperty?.definition.id ===
                      property.definition.id ? (
                        <IconCheck className="size-4 text-muted-foreground" />
                      ) : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {dateProperties.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 max-w-48 gap-1.5 px-2 text-xs text-muted-foreground"
                >
                  <IconTimeline className="size-3.5 shrink-0" />
                  <span className="truncate">
                    End: {endDateProperty?.definition.name ?? "None"}
                  </span>
                  <IconChevronDown className="size-3.5 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  End date
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onEndDatePropertyChange(null);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">No end date</span>
                  {!endDateProperty ? (
                    <IconCheck className="size-4 text-muted-foreground" />
                  ) : null}
                </DropdownMenuItem>
                {dateProperties
                  .filter(
                    (property) =>
                      property.definition.id !== dateProperty?.definition.id,
                  )
                  .map((property) => {
                    const Icon = TYPE_ICONS[property.definition.type];
                    return (
                      <DropdownMenuItem
                        key={property.definition.id}
                        onSelect={(event) => {
                          event.preventDefault();
                          onEndDatePropertyChange(property.definition.id);
                        }}
                      >
                        <Icon className="mr-2 size-4 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">
                          {property.definition.name}
                        </span>
                        {endDateProperty?.definition.id ===
                        property.definition.id ? (
                          <IconCheck className="size-4 text-muted-foreground" />
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => onMonthChange(startOfMonth(new Date()))}
          >
            <IconCalendarEvent className="mr-1 size-3.5" />
            Today
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label="Previous timeline range"
            onClick={() => changeMonth(-1)}
          >
            <IconArrowUp className="size-3.5 -rotate-90" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label="Next timeline range"
            onClick={() => changeMonth(1)}
          >
            <IconArrowUp className="size-3.5 rotate-90" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading timeline
        </div>
      ) : dateProperties.length === 0 ? (
        <div className="flex min-h-24 items-center justify-between gap-3 px-2 py-4 text-sm text-muted-foreground">
          <span>Add a date property to use timeline view.</span>
          {canEdit ? <AddProperty documentId={databaseDocumentId} /> : null}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto border-t border-border">
            <div
              className="grid min-w-max"
              style={{
                gridTemplateColumns: `repeat(${timelineDays.length}, minmax(8rem, 1fr))`,
                gridTemplateRows: `auto repeat(${Math.max(timelineSpans.length, 1)}, minmax(3.25rem, auto)) auto minmax(0.75rem, auto)`,
              }}
            >
              {timelineDays.map((day, index) => {
                const dateKey = calendarDateKey(day);
                const inMonth = day.getMonth() === month.getMonth();
                return (
                  <div
                    key={dateKey}
                    className={cn(
                      "border-r border-border bg-background last:border-r-0",
                      !inMonth && "bg-muted/25",
                    )}
                    style={{
                      gridColumn: index + 1,
                      gridRow: `1 / ${Math.max(timelineSpans.length, 1) + 4}`,
                    }}
                    aria-label={`${dateKey} timeline day`}
                  />
                );
              })}
              {timelineDays.map((day, index) => {
                const dateKey = calendarDateKey(day);
                const inMonth = day.getMonth() === month.getMonth();
                return (
                  <div
                    key={`${dateKey}-header`}
                    className={cn(
                      "sticky top-0 z-10 grid gap-0.5 border-r border-b border-border bg-background/95 px-2 py-2 backdrop-blur last:border-r-0",
                      !inMonth && "bg-muted/70",
                    )}
                    style={{ gridColumn: index + 1, gridRow: 1 }}
                  >
                    <span className="text-[11px] uppercase text-muted-foreground">
                      {day.toLocaleDateString(undefined, { weekday: "short" })}
                    </span>
                    <span
                      className={cn(
                        "w-fit rounded px-1.5 py-0.5 text-sm font-medium",
                        dateKey === calendarDateKey(new Date()) &&
                          "bg-foreground text-background",
                      )}
                    >
                      {day.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                );
              })}
              {timelineSpans.map((span, index) => (
                <div
                  key={span.item.id}
                  className="z-[1] p-1.5"
                  style={{
                    gridColumn: `${span.startIndex + 1} / ${span.endIndex + 2}`,
                    gridRow: index + 2,
                  }}
                >
                  <DatabaseTimelineCard
                    item={span.item}
                    databaseDocumentId={databaseDocumentId}
                    dateLabel={span.label}
                    properties={visibleProperties}
                    canEdit={canEdit}
                    onPreviewItem={onPreview}
                    onDeletedPreviewItem={onDeletedPreviewItem}
                    onPreview={() => onPreview(span.item)}
                    onOpenPage={() => onOpenPage(span.item)}
                  />
                </div>
              ))}
              {databaseViewHasNoMatchingPages(
                items.length,
                hasSearch,
                activeFilters.length,
              ) ? (
                <div
                  className="z-[1] m-1.5"
                  style={{
                    gridColumn: `1 / ${timelineDays.length + 1}`,
                    gridRow: 2,
                  }}
                >
                  <DatabaseNoMatchingPages
                    className="rounded border border-dashed border-border/70 bg-background/80"
                    onClear={onClearResultConstraints}
                  />
                </div>
              ) : null}
              {canCreateOnDay
                ? timelineDays.map((day, index) => {
                    const dateKey = calendarDateKey(day);
                    return (
                      <div
                        key={`${dateKey}-new`}
                        className="z-[1] p-1.5"
                        style={{
                          gridColumn: index + 1,
                          gridRow: Math.max(timelineSpans.length, 1) + 2,
                        }}
                      >
                        <NewTimelineCard
                          dateKey={dateKey}
                          disabled={isCreating}
                          isPending={isCreating}
                          onCreate={onCreateCard}
                        />
                      </div>
                    );
                  })
                : null}
              <div
                className="min-h-3"
                style={{
                  gridColumn: `1 / ${timelineDays.length + 1}`,
                  gridRow: Math.max(timelineSpans.length, 1) + 3,
                }}
              />
            </div>
          </div>
          <DatabaseDateViewNoDateSection
            items={noDateItems}
            databaseDocumentId={databaseDocumentId}
            properties={visibleProperties}
            canEdit={canEdit}
            onPreview={onPreview}
            onDeletedPreviewItem={onDeletedPreviewItem}
            onOpenPage={onOpenPage}
          />
        </>
      )}
    </div>
  );
}

function DatabaseTimelineCard({
  item,
  databaseDocumentId,
  dateLabel,
  properties,
  canEdit,
  onPreviewItem,
  onDeletedPreviewItem,
  onPreview,
  onOpenPage,
}: {
  item: ContentDatabaseItem;
  databaseDocumentId: string;
  dateLabel: string;
  properties: DocumentProperty[];
  canEdit: boolean;
  onPreviewItem: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onPreview: () => void;
  onOpenPage: () => void;
}) {
  const visibleProperties = properties.slice(0, 2);

  return (
    <div className="group/card rounded-md border border-border bg-background px-2 py-2 text-xs shadow-sm transition-colors hover:bg-accent/60">
      <div className="flex min-w-0 items-start gap-1">
        <button
          type="button"
          className="grid min-w-0 flex-1 gap-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onPreview}
        >
          <span className="flex min-w-0 items-center gap-1.5 font-medium">
            <DatabaseItemPageIcon
              document={item.document}
              className="size-3.5 text-xs"
              fallbackClassName="size-3.5"
            />
            <span className="truncate">
              {item.document.title || "Untitled"}
            </span>
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {dateLabel}
          </span>
          {visibleProperties.length > 0 ? (
            <span className="grid gap-0.5">
              {visibleProperties.map((property) => {
                const itemProperty =
                  item.properties.find(
                    (candidate) =>
                      candidate.definition.id === property.definition.id,
                  ) ?? property;
                const Icon = TYPE_ICONS[property.definition.type];
                return (
                  <span
                    key={property.definition.id}
                    className="flex min-w-0 items-center gap-1 text-muted-foreground"
                  >
                    <Icon className="size-3 shrink-0" />
                    <span className="truncate">
                      {displayValue(itemProperty)}
                    </span>
                  </span>
                );
              })}
            </span>
          ) : null}
        </button>
        {canEdit ? (
          <RowActionsCell
            item={item}
            databaseDocumentId={databaseDocumentId}
            rowIndex={0}
            canReorder={false}
            canMoveUp={false}
            canMoveDown={false}
            showReorderActions={false}
            onPreviewItem={onPreviewItem}
            onDeletedPreviewItem={onDeletedPreviewItem}
            onOpenPage={onOpenPage}
          />
        ) : null}
      </div>
    </div>
  );
}

function NewTimelineCard({
  dateKey,
  disabled,
  isPending,
  onCreate,
}: {
  dateKey: string;
  disabled: boolean;
  isPending: boolean;
  onCreate: (
    dateKey: string,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");

  async function submitNewCard() {
    if (disabled) return;
    const createdItem = await onCreate(dateKey, title.trim());
    setTitle("");
    if (!createdItem) inputRef.current?.focus();
  }

  return (
    <form
      className="rounded border border-dashed border-transparent bg-transparent transition-colors focus-within:border-border focus-within:bg-background/80 hover:bg-background/60"
      onSubmit={(event) => {
        event.preventDefault();
        void submitNewCard();
      }}
    >
      <label className="flex h-7 min-w-0 items-center gap-1.5 px-1 text-xs text-muted-foreground">
        {isPending ? (
          <Spinner className="size-3.5 shrink-0" />
        ) : (
          <IconPlus className="size-3.5 shrink-0" />
        )}
        <input
          ref={inputRef}
          value={title}
          disabled={disabled}
          aria-label={`New ${dateKey} timeline card title`}
          placeholder="New page"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submitNewCard();
            }
            if (event.key === "Escape") {
              setTitle("");
              event.currentTarget.blur();
            }
          }}
          className="h-6 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground focus:placeholder:text-muted-foreground/70"
        />
      </label>
    </form>
  );
}

const BOARD_UNGROUPED_VALUE = "__ungrouped__";

export interface DatabaseBoardGroup {
  id: string;
  label: string;
  property: DocumentProperty | null;
  value: DocumentPropertyValue | typeof BOARD_UNGROUPED_VALUE;
  items: ContentDatabaseItem[];
}

function DatabaseBoardView({
  activeView,
  properties,
  items,
  groupProperty,
  databaseDocumentId,
  canEdit,
  isLoading,
  isCreating,
  isMoving,
  hasActiveConstraints,
  collapsedGroupIds,
  hideEmptyGroups,
  onClearResultConstraints,
  onGroupByChange,
  onHideEmptyGroupsChange,
  onCreateCard,
  onMoveCard,
  onGroupCollapsedChange,
  onGroupsCollapsedChange,
  onPreview,
  onDeletedPreviewItem,
  onOpenPage,
}: {
  activeView: ContentDatabaseView;
  properties: DocumentProperty[];
  items: ContentDatabaseItem[];
  groupProperty: DocumentProperty | null;
  databaseDocumentId: string;
  canEdit: boolean;
  isLoading: boolean;
  isCreating: boolean;
  isMoving: boolean;
  hasActiveConstraints: boolean;
  collapsedGroupIds: string[];
  hideEmptyGroups: boolean;
  onClearResultConstraints: () => void;
  onGroupByChange: (propertyId: string | null) => void;
  onHideEmptyGroupsChange: (hideEmptyGroups: boolean) => void;
  onCreateCard: (
    group: DatabaseBoardGroup,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
  onMoveCard: (
    item: ContentDatabaseItem,
    group: DatabaseBoardGroup,
  ) => Promise<void>;
  onGroupCollapsedChange: (groupId: string, collapsed: boolean) => void;
  onGroupsCollapsedChange: (groupIds: string[], collapsed: boolean) => void;
  onPreview: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onOpenPage: (item: ContentDatabaseItem) => void;
}) {
  const groupableProperties = databaseBoardGroupableProperties(properties);
  const groups = databaseVisibleGroups(
    databaseBoardGroups(items, properties, activeView.groupByPropertyId),
    hideEmptyGroups,
  );
  const cardProperties = databaseBoardVisibleCardProperties(
    properties,
    items,
    activeView,
    groupProperty?.definition.id ?? null,
  );
  const [draggedItem, setDraggedItem] = useState<ContentDatabaseItem | null>(
    null,
  );
  const [dropGroupId, setDropGroupId] = useState<string | null>(null);
  const configureProperty = useConfigureDocumentProperty(databaseDocumentId);
  const canCreateGroup =
    canEdit && !!groupProperty && databaseBoardCanCreateGroup(groupProperty);

  async function dropCard(group: DatabaseBoardGroup) {
    if (!draggedItem || !group.property || isMoving) return;
    try {
      await onMoveCard(draggedItem, group);
    } catch (err) {
      toast.error("Failed to move card", {
        description:
          err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      setDraggedItem(null);
      setDropGroupId(null);
    }
  }

  async function createGroup(name: string) {
    if (!groupProperty || !databaseBoardCanCreateGroup(groupProperty)) return;
    const optionName = name.trim();
    if (!optionName) return;
    const options = groupProperty.definition.options.options ?? [];
    const option = nextPropertyOption(optionName, options);
    await configureProperty.mutateAsync({
      id: groupProperty.definition.id,
      documentId: databaseDocumentId,
      name: groupProperty.definition.name,
      type: groupProperty.definition.type,
      visibility: groupProperty.definition.visibility,
      options: { options: [...options, option] },
    });
  }

  async function configureGroupProperty(
    property: DocumentProperty,
    options: DocumentProperty["definition"]["options"],
  ) {
    await configureProperty.mutateAsync({
      id: property.definition.id,
      documentId: databaseDocumentId,
      name: property.definition.name,
      type: property.definition.type,
      visibility: property.definition.visibility,
      options,
    });
  }

  async function renameGroup(group: DatabaseBoardGroup, name: string) {
    const option = databaseBoardOptionForGroup(group);
    if (!group.property || !option) return;
    const options = group.property.definition.options.options ?? [];
    const nextOptions = renamePropertyOption(options, option.id, name);
    if (nextOptions === options) return;
    await configureGroupProperty(group.property, { options: nextOptions });
  }

  async function recolorGroup(
    group: DatabaseBoardGroup,
    color: DocumentPropertyOptionColor,
  ) {
    const option = databaseBoardOptionForGroup(group);
    if (!group.property || !option || option.color === color) return;
    const options = group.property.definition.options.options ?? [];
    const nextOptions = updatePropertyOptionColor(options, option.id, color);
    await configureGroupProperty(group.property, { options: nextOptions });
  }

  async function removeGroup(group: DatabaseBoardGroup) {
    const option = databaseBoardOptionForGroup(group);
    if (!group.property || !option) return;
    const options = group.property.definition.options.options ?? [];
    const nextOptions = removePropertyOption(options, option.id);
    if (nextOptions === options) return;
    await configureGroupProperty(group.property, { options: nextOptions });
  }

  return (
    <div className="border-b border-border">
      <div className="flex min-h-9 items-center justify-between gap-2 border-t border-border px-1 py-1">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <IconLayoutKanban className="size-4 shrink-0" />
          <span className="truncate">
            Grouped by {groupProperty?.definition.name ?? "No property"}
          </span>
        </div>
        {canEdit && groupableProperties.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
              >
                Group
                <IconChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Group by
              </DropdownMenuLabel>
              {groupableProperties.map((property) => {
                const Icon = TYPE_ICONS[property.definition.type];
                return (
                  <DropdownMenuItem
                    key={property.definition.id}
                    onSelect={(event) => {
                      event.preventDefault();
                      onGroupByChange(property.definition.id);
                    }}
                  >
                    <Icon className="mr-2 size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {property.definition.name}
                    </span>
                    {groupProperty?.definition.id === property.definition.id ? (
                      <IconCheck className="size-4 text-muted-foreground" />
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
              {groupProperty ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      onHideEmptyGroupsChange(!hideEmptyGroups);
                    }}
                  >
                    <IconEyeOff className="mr-2 size-4 text-muted-foreground" />
                    <span className="flex-1">Hide empty groups</span>
                    {hideEmptyGroups ? (
                      <IconCheck className="size-4 text-muted-foreground" />
                    ) : null}
                  </DropdownMenuItem>
                </>
              ) : null}
              {groupProperty ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={groups.length === 0}
                    onSelect={(event) => {
                      event.preventDefault();
                      onGroupsCollapsedChange(
                        groups.map((group) => group.id),
                        true,
                      );
                    }}
                  >
                    <IconChevronRight className="mr-2 size-4 text-muted-foreground" />
                    Collapse all groups
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={groups.length === 0}
                    onSelect={(event) => {
                      event.preventDefault();
                      onGroupsCollapsedChange(
                        groups.map((group) => group.id),
                        false,
                      );
                    }}
                  >
                    <IconChevronDown className="mr-2 size-4 text-muted-foreground" />
                    Expand all groups
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading board
        </div>
      ) : groupableProperties.length === 0 ? (
        <div className="flex min-h-24 items-center justify-between gap-3 px-2 py-4 text-sm text-muted-foreground">
          <span>
            Add a status, select, multi-select, or checkbox property to group
            this board.
          </span>
          {canEdit ? <AddProperty documentId={databaseDocumentId} /> : null}
        </div>
      ) : (
        <>
          {groups.every((group) => group.items.length === 0) &&
          hasActiveConstraints ? (
            <DatabaseNoMatchingPages onClear={onClearResultConstraints} />
          ) : null}
          <div className="flex min-h-72 gap-3 overflow-x-auto px-1 py-3">
            {groups.map((group) => {
              const collapsed = databaseGroupIsCollapsed(
                collapsedGroupIds,
                group.id,
              );
              return (
                <section
                  key={group.id}
                  className={cn(
                    "group flex shrink-0 flex-col rounded-md border border-transparent bg-muted/35 transition-[width,background-color,border-color]",
                    collapsed ? "w-12" : "w-72",
                    dropGroupId === group.id && "border-primary/60 bg-muted/70",
                  )}
                  aria-label={`${group.label} board column`}
                  onDragOver={(event) => {
                    if (!canEdit || !group.property || !draggedItem || isMoving)
                      return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropGroupId(group.id);
                  }}
                  onDragLeave={() => setDropGroupId(null)}
                  onDrop={(event) => {
                    event.preventDefault();
                    void dropCard(group);
                  }}
                >
                  <DatabaseBoardColumnHeader
                    group={group}
                    canEdit={canEdit}
                    disabled={configureProperty.isPending}
                    collapsed={collapsed}
                    onCollapsedChange={(nextCollapsed) =>
                      onGroupCollapsedChange(group.id, nextCollapsed)
                    }
                    onRename={renameGroup}
                    onColorChange={recolorGroup}
                    onRemove={removeGroup}
                  />
                  {collapsed ? null : (
                    <div className="grid gap-2 p-2">
                      {group.items.map((item) => (
                        <DatabaseBoardCard
                          key={`${group.id}-${item.id}`}
                          item={item}
                          databaseDocumentId={databaseDocumentId}
                          properties={cardProperties}
                          canEdit={canEdit}
                          draggable={canEdit && !!group.property && !isMoving}
                          isDragging={draggedItem?.id === item.id}
                          onDragStart={(event) => {
                            setDraggedItem(item);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", item.id);
                          }}
                          onDragEnd={() => {
                            setDraggedItem(null);
                            setDropGroupId(null);
                          }}
                          onPreviewItem={onPreview}
                          onDeletedPreviewItem={onDeletedPreviewItem}
                          onPreview={() => onPreview(item)}
                          onOpenPage={() => onOpenPage(item)}
                        />
                      ))}
                      {group.items.length === 0 &&
                      hasActiveConstraints &&
                      !groups.every(
                        (candidate) => candidate.items.length === 0,
                      ) ? (
                        <div className="rounded border border-dashed border-border bg-background/50 px-3 py-4 text-sm text-muted-foreground">
                          No matching pages
                        </div>
                      ) : null}
                      {canEdit ? (
                        <NewBoardCard
                          group={group}
                          disabled={isCreating}
                          isPending={isCreating}
                          onCreate={onCreateCard}
                        />
                      ) : null}
                    </div>
                  )}
                </section>
              );
            })}
            {canCreateGroup ? (
              <NewBoardGroupColumn
                disabled={configureProperty.isPending}
                isPending={configureProperty.isPending}
                onCreate={createGroup}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function DatabaseBoardColumnHeader({
  group,
  canEdit,
  disabled,
  collapsed,
  onCollapsedChange,
  onRename,
  onColorChange,
  onRemove,
}: {
  group: DatabaseBoardGroup;
  canEdit: boolean;
  disabled: boolean;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onRename: (group: DatabaseBoardGroup, name: string) => Promise<void>;
  onColorChange: (
    group: DatabaseBoardGroup,
    color: DocumentPropertyOptionColor,
  ) => Promise<void>;
  onRemove: (group: DatabaseBoardGroup) => Promise<void>;
}) {
  const option = databaseBoardOptionForGroup(group);
  const canManageGroup = canEdit && !!option;
  const [name, setName] = useState(group.label);

  useEffect(() => {
    setName(group.label);
  }, [group.label]);

  async function submitRename() {
    const nextName = name.trim();
    if (!canManageGroup || disabled || !nextName) {
      setName(group.label);
      return;
    }
    if (nextName !== group.label) await onRename(group, nextName);
  }

  if (collapsed) {
    return (
      <div className="flex min-h-72 w-full flex-col items-center gap-2 px-1 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Expand ${group.label} board group`}
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => onCollapsedChange(false)}
        >
          <IconChevronRight className="size-4" />
        </Button>
        {option ? (
          <span
            aria-hidden
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              OPTION_COLOR_CLASSES[option.color],
            )}
          />
        ) : null}
        <span className="[writing-mode:vertical-rl] max-h-44 rotate-180 truncate text-sm font-medium">
          {group.label}
        </span>
        <span className="rounded bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
          {group.items.length}
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-10 items-center justify-between gap-2 border-b border-border/70 px-2">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Collapse ${group.label} board group`}
          className="-ml-1 size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => onCollapsedChange(true)}
        >
          <IconChevronRight className="size-4 rotate-90" />
        </Button>
        {option ? (
          <span
            aria-hidden
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              OPTION_COLOR_CLASSES[option.color],
            )}
          />
        ) : null}
        <span className="truncate text-sm font-medium">{group.label}</span>
        <span className="rounded bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
          {group.items.length}
        </span>
      </div>
      {canManageGroup ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={`Board group menu for ${group.label}`}
              className="size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <IconDots className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="grid gap-1 px-2 py-1.5">
              <DropdownMenuLabel className="px-0 py-0 text-xs text-muted-foreground">
                Group name
              </DropdownMenuLabel>
              <Input
                value={name}
                disabled={disabled}
                aria-label={`Rename board group ${group.label}`}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => void submitRename()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitRename();
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    setName(group.label);
                    event.currentTarget.blur();
                  }
                }}
                className="h-8"
              />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={disabled}>
                <IconPalette className="mr-2 size-4 text-muted-foreground" />
                Color
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                {OPTION_COLORS.map((color) => (
                  <DropdownMenuItem
                    key={color}
                    onSelect={() => void onColorChange(group, color)}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mr-2 size-3 rounded-full",
                        OPTION_COLOR_CLASSES[color],
                      )}
                    />
                    <span className="flex-1 capitalize">{color}</span>
                    {option.color === color ? (
                      <IconCheck className="size-4 text-muted-foreground" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={disabled}
              className="text-destructive focus:text-destructive"
              onSelect={() => void onRemove(group)}
            >
              <IconTrash className="mr-2 size-4" />
              Delete group
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function DatabaseBoardCard({
  item,
  databaseDocumentId,
  properties,
  canEdit,
  draggable,
  isDragging,
  onDragStart,
  onDragEnd,
  onPreviewItem,
  onDeletedPreviewItem,
  onPreview,
  onOpenPage,
}: {
  item: ContentDatabaseItem;
  databaseDocumentId: string;
  properties: DocumentProperty[];
  canEdit: boolean;
  draggable: boolean;
  isDragging: boolean;
  onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onPreviewItem: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onPreview: () => void;
  onOpenPage: () => void;
}) {
  const visibleProperties = properties.slice(0, 3);

  return (
    <div
      className={cn(
        "group/card rounded-md border border-border bg-background p-2 shadow-sm transition-colors hover:bg-accent/60",
        isDragging && "opacity-45",
      )}
    >
      <div className="flex min-w-0 items-start gap-1">
        <button
          type="button"
          draggable={draggable}
          className={cn(
            "grid min-w-0 flex-1 gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            draggable && "cursor-grab active:cursor-grabbing",
          )}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={onPreview}
        >
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <DatabaseItemPageIcon
              document={item.document}
              className="size-4 text-sm"
              fallbackClassName="size-4"
            />
            <span className="min-w-0 truncate">
              {item.document.title || "Untitled"}
            </span>
          </span>
          {visibleProperties.length > 0 ? (
            <span className="grid gap-1">
              {visibleProperties.map((property) => {
                const itemProperty =
                  item.properties.find(
                    (candidate) =>
                      candidate.definition.id === property.definition.id,
                  ) ?? property;
                const Icon = TYPE_ICONS[property.definition.type];
                return (
                  <span
                    key={property.definition.id}
                    className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {displayValue(itemProperty)}
                    </span>
                  </span>
                );
              })}
            </span>
          ) : null}
          {!canEdit ? null : <span className="sr-only">Open page</span>}
        </button>
        {canEdit ? (
          <RowActionsCell
            item={item}
            databaseDocumentId={databaseDocumentId}
            rowIndex={0}
            canReorder={false}
            canMoveUp={false}
            canMoveDown={false}
            showReorderActions={false}
            onPreviewItem={onPreviewItem}
            onDeletedPreviewItem={onDeletedPreviewItem}
            onOpenPage={onOpenPage}
          />
        ) : null}
      </div>
    </div>
  );
}

function NewBoardGroupColumn({
  disabled,
  isPending,
  onCreate,
}: {
  disabled: boolean;
  isPending: boolean;
  onCreate: (name: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");

  async function submitNewGroup() {
    const nextName = name.trim();
    if (disabled || !nextName) return;
    await onCreate(nextName);
    setName("");
    inputRef.current?.focus();
  }

  return (
    <form
      className="flex w-72 shrink-0 flex-col rounded-md border border-dashed border-border/80 bg-background/50 p-2 transition-colors hover:bg-muted/25 focus-within:bg-muted/25"
      onSubmit={(event) => {
        event.preventDefault();
        void submitNewGroup();
      }}
    >
      <label className="flex h-9 min-w-0 items-center gap-2 px-1 text-sm text-muted-foreground">
        {isPending ? (
          <Spinner className="size-4 shrink-0" />
        ) : (
          <IconPlus className="size-4 shrink-0" />
        )}
        <input
          ref={inputRef}
          value={name}
          disabled={disabled}
          aria-label="New board group name"
          placeholder="New group"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submitNewGroup();
            }
            if (event.key === "Escape") {
              setName("");
              event.currentTarget.blur();
            }
          }}
          className="h-7 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground focus:placeholder:text-muted-foreground/70"
        />
      </label>
    </form>
  );
}

function NewBoardCard({
  group,
  disabled,
  isPending,
  onCreate,
}: {
  group: DatabaseBoardGroup;
  disabled: boolean;
  isPending: boolean;
  onCreate: (
    group: DatabaseBoardGroup,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");

  async function submitNewCard() {
    if (disabled) return;
    const createdItem = await onCreate(group, title.trim());
    setTitle("");
    if (!createdItem) inputRef.current?.focus();
  }

  return (
    <form
      className="rounded-md border border-dashed border-transparent bg-transparent p-1 transition-colors focus-within:border-border focus-within:bg-background/80 hover:bg-background/60"
      onSubmit={(event) => {
        event.preventDefault();
        void submitNewCard();
      }}
    >
      <label className="flex h-8 min-w-0 items-center gap-2 px-1 text-sm text-muted-foreground">
        {isPending ? (
          <Spinner className="size-4 shrink-0" />
        ) : (
          <IconPlus className="size-4 shrink-0" />
        )}
        <input
          ref={inputRef}
          value={title}
          disabled={disabled}
          aria-label={`New ${group.label} board card title`}
          placeholder="New page"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submitNewCard();
            }
            if (event.key === "Escape") {
              setTitle("");
              event.currentTarget.blur();
            }
          }}
          className="h-7 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground focus:placeholder:text-muted-foreground/70"
        />
      </label>
    </form>
  );
}

function NewDatabaseRow({
  properties,
  columnWidths,
  rowDensity,
  disabled,
  isPending,
  onCreate,
  actionColumnWidth = ACTION_COLUMN_WIDTH,
}: {
  properties: DocumentProperty[];
  columnWidths: Record<string, number>;
  rowDensity: DatabaseRowDensity;
  disabled: boolean;
  isPending: boolean;
  onCreate: CreateDatabaseRowHandler;
  actionColumnWidth?: number;
}) {
  async function submitNewRow() {
    if (disabled) return;
    await onCreate("");
  }

  return (
    <button
      type="button"
      aria-label="New database row"
      disabled={disabled}
      className={cn(
        "grid w-full border-t border-border/45 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/35 hover:text-foreground focus-visible:bg-muted/35 focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
        databaseTableRowDensityClass(rowDensity),
      )}
      style={{
        gridTemplateColumns: databaseGridColumns(
          properties,
          true,
          columnWidths,
          actionColumnWidth,
        ),
      }}
      onClick={() => void submitNewRow()}
    >
      <span
        className={cn(
          "flex min-w-0 items-center gap-2 border-r border-border/45",
          databaseTableCellDensityClass(rowDensity),
        )}
      >
        {isPending ? (
          <Spinner className="size-4 shrink-0" />
        ) : (
          <IconPlus className="size-4 shrink-0" />
        )}
        <span className="h-7 min-w-0 flex-1 truncate leading-7">New page</span>
      </span>
      {properties.map((property) => (
        <span
          key={property.definition.id}
          className="border-r border-border/45 last:border-r-0"
        />
      ))}
      <span />
    </button>
  );
}

function DatabaseBlankDefaultRows({
  rowCount,
  actionColumnWidth,
}: {
  rowCount: number;
  actionColumnWidth: number;
}) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rowCount }).map((_, index) => (
        <div
          key={index}
          className="grid h-9 border-t border-border/35"
          style={{
            gridTemplateColumns: databaseGridColumns(
              [],
              true,
              {},
              actionColumnWidth,
            ),
          }}
        >
          <span className="border-r border-border/35" />
          <span className="border-r border-border/25" />
        </div>
      ))}
    </div>
  );
}

export function databaseGridColumns(
  properties: Pick<DocumentProperty, "definition">[],
  canEdit: boolean,
  columnWidths: Record<string, number> = {},
  actionColumnWidth = ACTION_COLUMN_WIDTH,
) {
  return [
    `${columnWidth("name", columnWidths)}px`,
    ...properties.map(
      (property) => `${columnWidth(property.definition.id, columnWidths)}px`,
    ),
    canEdit ? `${actionColumnWidth}px` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function columnWidth(key: ColumnKey, columnWidths: Record<string, number>) {
  return clampColumnWidth(
    columnWidths[key] ??
      (key === "name"
        ? DEFAULT_NAME_COLUMN_WIDTH
        : DEFAULT_PROPERTY_COLUMN_WIDTH),
  );
}

function clampColumnWidth(width: number) {
  return Math.min(
    MAX_COLUMN_WIDTH,
    Math.max(MIN_COLUMN_WIDTH, Math.round(width)),
  );
}

export function defaultDatabaseViewConfig(): ContentDatabaseViewConfig {
  const view = createDatabaseView("Table", "default");
  return {
    activeViewId: view.id,
    views: [view],
    sorts: view.sorts,
    filters: view.filters,
    columnWidths: view.columnWidths,
  };
}

export function createDatabaseView(
  name: string,
  id = createDatabaseViewId(),
  values: Partial<Omit<ContentDatabaseView, "id" | "name" | "type">> = {},
  type: ContentDatabaseViewType = "table",
): ContentDatabaseView {
  return {
    id,
    name: name.trim() || databaseViewDefaultName(type),
    type,
    sorts: values.sorts ?? [],
    filters: values.filters ?? [],
    filterMode: normalizeClientDatabaseFilterMode(values.filterMode),
    columnWidths: values.columnWidths ?? {},
    groupByPropertyId: values.groupByPropertyId ?? null,
    datePropertyId: values.datePropertyId ?? null,
    endDatePropertyId: values.endDatePropertyId ?? null,
    hiddenPropertyIds: values.hiddenPropertyIds ?? [],
    propertyOrderIds: values.propertyOrderIds ?? [],
    collapsedGroupIds: values.collapsedGroupIds ?? [],
    hideEmptyGroups: values.hideEmptyGroups === true,
    calculations: values.calculations ?? {},
    wrapCells: values.wrapCells === true,
    rowDensity: normalizeClientDatabaseRowDensity(values.rowDensity),
    openPagesIn: normalizeClientDatabaseOpenPagesIn(values.openPagesIn),
  };
}

export function normalizeClientDatabaseViewConfig(
  value: Partial<ContentDatabaseViewConfig> | null | undefined,
): ContentDatabaseViewConfig {
  const views = Array.isArray(value?.views)
    ? value.views
        .map((view) => normalizeClientDatabaseView(view))
        .filter((view): view is ContentDatabaseView => !!view)
    : [];
  const normalizedViews =
    views.length > 0
      ? views
      : [
          createDatabaseView("Table", "default", {
            sorts: Array.isArray(value?.sorts)
              ? value.sorts.filter(isDatabaseSort)
              : [],
            filters: Array.isArray(value?.filters)
              ? value.filters.filter(isDatabaseFilter)
              : [],
            columnWidths: normalizeClientColumnWidths(value?.columnWidths),
          }),
        ];
  const activeViewId =
    typeof value?.activeViewId === "string" &&
    normalizedViews.some((view) => view.id === value.activeViewId)
      ? value.activeViewId
      : normalizedViews[0].id;
  const activeView =
    normalizedViews.find((view) => view.id === activeViewId) ??
    normalizedViews[0];

  return {
    activeViewId: activeView.id,
    views: normalizedViews,
    sorts: activeView.sorts,
    filters: activeView.filters,
    columnWidths: activeView.columnWidths,
  };
}

export function activeDatabaseView(config: ContentDatabaseViewConfig) {
  return (
    config.views.find((view) => view.id === config.activeViewId) ??
    config.views[0] ??
    createDatabaseView("Table", "default")
  );
}

export function updateActiveDatabaseView(
  config: ContentDatabaseViewConfig,
  update: (view: ContentDatabaseView) => ContentDatabaseView,
) {
  const normalized = normalizeClientDatabaseViewConfig(config);
  const activeView = activeDatabaseView(normalized);
  const views = normalized.views.map((view) =>
    view.id === activeView.id ? update(view) : view,
  );
  return normalizeClientDatabaseViewConfig({
    ...normalized,
    views,
    activeViewId: activeView.id,
  });
}

export function selectDatabaseView(
  config: ContentDatabaseViewConfig,
  viewId: string,
) {
  return normalizeClientDatabaseViewConfig({
    ...config,
    activeViewId: viewId,
  });
}

export function addDatabaseView(
  config: ContentDatabaseViewConfig,
  name: string,
  type: ContentDatabaseViewType = "table",
) {
  const normalized = normalizeClientDatabaseViewConfig(config);
  const view = createDatabaseView(
    uniqueDatabaseViewName(
      normalized.views,
      name.trim() || databaseViewDefaultName(type),
    ),
    createDatabaseViewId(),
    {},
    type,
  );
  return normalizeClientDatabaseViewConfig({
    ...normalized,
    activeViewId: view.id,
    views: [...normalized.views, view],
  });
}

export function renameDatabaseView(
  config: ContentDatabaseViewConfig,
  viewId: string,
  name: string,
) {
  const normalized = normalizeClientDatabaseViewConfig(config);
  return normalizeClientDatabaseViewConfig({
    ...normalized,
    views: normalized.views.map((view) =>
      view.id === viewId
        ? { ...view, name: name.trim() || databaseViewDefaultName(view.type) }
        : view,
    ),
  });
}

export function updateDatabaseViewType(
  config: ContentDatabaseViewConfig,
  viewId: string,
  type: ContentDatabaseViewType,
) {
  return normalizeClientDatabaseViewConfig({
    ...config,
    views: config.views.map((view) =>
      view.id === viewId ? { ...view, type } : view,
    ),
  });
}

export function duplicateDatabaseView(
  config: ContentDatabaseViewConfig,
  viewId: string,
) {
  const normalized = normalizeClientDatabaseViewConfig(config);
  const view = normalized.views.find((candidate) => candidate.id === viewId);
  if (!view) return normalized;
  const copy = createDatabaseView(
    uniqueDatabaseViewName(normalized.views, `${view.name} copy`),
    createDatabaseViewId(),
    {
      sorts: view.sorts,
      filters: view.filters,
      filterMode: view.filterMode,
      columnWidths: view.columnWidths,
      groupByPropertyId: view.groupByPropertyId,
      datePropertyId: view.datePropertyId,
      endDatePropertyId: view.endDatePropertyId,
      hiddenPropertyIds: view.hiddenPropertyIds,
      propertyOrderIds: view.propertyOrderIds,
      collapsedGroupIds: view.collapsedGroupIds,
      hideEmptyGroups: view.hideEmptyGroups,
      calculations: view.calculations,
      wrapCells: view.wrapCells,
      rowDensity: view.rowDensity,
      openPagesIn: view.openPagesIn,
    },
    view.type,
  );
  return normalizeClientDatabaseViewConfig({
    ...normalized,
    activeViewId: copy.id,
    views: [...normalized.views, copy],
  });
}

export type DatabaseViewMoveDirection = "left" | "right";

export function moveDatabaseView(
  config: ContentDatabaseViewConfig,
  viewId: string,
  direction: DatabaseViewMoveDirection,
) {
  const normalized = normalizeClientDatabaseViewConfig(config);
  const index = normalized.views.findIndex((view) => view.id === viewId);
  const targetIndex = direction === "left" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= normalized.views.length) {
    return normalized;
  }

  const views = [...normalized.views];
  const target = views[targetIndex];
  views[targetIndex] = views[index];
  views[index] = target;
  return normalizeClientDatabaseViewConfig({
    ...normalized,
    views,
    activeViewId: normalized.activeViewId,
  });
}

export function reorderDatabaseView(
  config: ContentDatabaseViewConfig,
  sourceViewId: string,
  targetViewId: string,
  side: DatabaseDropSide = "before",
) {
  const normalized = normalizeClientDatabaseViewConfig(config);
  if (sourceViewId === targetViewId) return normalized;
  const sourceIndex = normalized.views.findIndex(
    (view) => view.id === sourceViewId,
  );
  const targetIndex = normalized.views.findIndex(
    (view) => view.id === targetViewId,
  );
  if (sourceIndex < 0 || targetIndex < 0) return normalized;

  const views = [...normalized.views];
  const [source] = views.splice(sourceIndex, 1);
  const nextTargetIndex = views.findIndex((view) => view.id === targetViewId);
  views.splice(
    side === "after" ? nextTargetIndex + 1 : nextTargetIndex,
    0,
    source,
  );
  return normalizeClientDatabaseViewConfig({
    ...normalized,
    views,
    activeViewId: normalized.activeViewId,
  });
}

export function deleteDatabaseView(
  config: ContentDatabaseViewConfig,
  viewId: string,
) {
  const normalized = normalizeClientDatabaseViewConfig(config);
  if (normalized.views.length <= 1) return normalized;
  const views = normalized.views.filter((view) => view.id !== viewId);
  return normalizeClientDatabaseViewConfig({
    ...normalized,
    activeViewId:
      normalized.activeViewId === viewId
        ? views[0].id
        : normalized.activeViewId,
    views,
  });
}

function normalizeClientDatabaseView(
  value: Partial<ContentDatabaseView> | null | undefined,
) {
  if (!value || typeof value.id !== "string" || !value.id.trim()) return null;
  const type =
    value.type === "board" ||
    value.type === "list" ||
    value.type === "gallery" ||
    value.type === "calendar" ||
    value.type === "timeline"
      ? value.type
      : "table";
  return createDatabaseView(
    typeof value.name === "string" ? value.name : databaseViewDefaultName(type),
    value.id,
    {
      sorts: Array.isArray(value.sorts)
        ? value.sorts.filter(isDatabaseSort)
        : [],
      filters: Array.isArray(value.filters)
        ? value.filters.filter(isDatabaseFilter)
        : [],
      filterMode: normalizeClientDatabaseFilterMode(value.filterMode),
      columnWidths: normalizeClientColumnWidths(value.columnWidths),
      groupByPropertyId:
        typeof value.groupByPropertyId === "string" && value.groupByPropertyId
          ? value.groupByPropertyId
          : null,
      datePropertyId:
        typeof value.datePropertyId === "string" && value.datePropertyId
          ? value.datePropertyId
          : null,
      endDatePropertyId:
        typeof value.endDatePropertyId === "string" && value.endDatePropertyId
          ? value.endDatePropertyId
          : null,
      hiddenPropertyIds: normalizeClientStringList(value.hiddenPropertyIds),
      propertyOrderIds: normalizeClientStringList(value.propertyOrderIds),
      collapsedGroupIds: normalizeClientStringList(value.collapsedGroupIds),
      hideEmptyGroups: value.hideEmptyGroups === true,
      calculations: normalizeClientCalculations(value.calculations),
      wrapCells: value.wrapCells === true,
      rowDensity: normalizeClientDatabaseRowDensity(value.rowDensity),
      openPagesIn: normalizeClientDatabaseOpenPagesIn(value.openPagesIn),
    },
    type,
  );
}

function normalizeClientCalculations(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, DatabaseColumnCalculation] =>
        typeof entry[0] === "string" && isDatabaseColumnCalculation(entry[1]),
    ),
  );
}

function normalizeClientColumnWidths(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[0] === "string" &&
        typeof entry[1] === "number" &&
        Number.isFinite(entry[1]),
    ),
  );
}

function normalizeClientStringList(value: unknown) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === "string"),
        ),
      ]
    : [];
}

function isDatabaseSort(value: unknown): value is DatabaseSort {
  if (!value || typeof value !== "object") return false;
  const sort = value as Partial<DatabaseSort>;
  return (
    typeof sort.key === "string" &&
    typeof sort.label === "string" &&
    (sort.direction === "asc" || sort.direction === "desc")
  );
}

function isDatabaseFilter(value: unknown): value is DatabaseFilter {
  if (!value || typeof value !== "object") return false;
  const filter = value as Partial<DatabaseFilter>;
  return (
    typeof filter.key === "string" &&
    typeof filter.label === "string" &&
    typeof filter.operator === "string" &&
    typeof filter.value === "string"
  );
}

function isDatabaseColumnCalculation(
  value: unknown,
): value is DatabaseColumnCalculation {
  return (
    value === "count_all" ||
    value === "count_values" ||
    value === "count_empty" ||
    value === "count_unique" ||
    value === "percent_filled" ||
    value === "percent_empty" ||
    value === "count_checked" ||
    value === "count_unchecked" ||
    value === "percent_checked" ||
    value === "percent_unchecked" ||
    value === "sum" ||
    value === "average" ||
    value === "median" ||
    value === "min" ||
    value === "max" ||
    value === "range" ||
    value === "date_range"
  );
}

function createDatabaseViewId() {
  return `view-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function databaseViewStateKey(
  databaseId: string,
  viewConfig: ContentDatabaseViewConfig,
) {
  return JSON.stringify({ databaseId, viewConfig });
}

function isTablePropertyVisible(
  property: DocumentProperty,
  items: ContentDatabaseItem[],
) {
  const visibility = property.definition.visibility;
  if (visibility === "always_hide") return false;
  if (visibility !== "hide_when_empty") return true;

  return items.some((item) => {
    const itemProperty =
      item.properties.find(
        (candidate) => candidate.definition.id === property.definition.id,
      ) ?? property;
    return !isEmptyPropertyValue(itemProperty.value);
  });
}

function databaseTableCellDisplayValue(property: DocumentProperty) {
  if (isEmptyPropertyValue(property.value)) {
    return <span aria-hidden="true">&nbsp;</span>;
  }

  if (property.definition.type === "checkbox") {
    const checked = property.value === true;
    return (
      <span
        aria-label={checked ? "Checked" : "Unchecked"}
        className={cn(
          "inline-flex size-4 items-center justify-center rounded border",
          checked
            ? "border-foreground bg-foreground text-background"
            : "border-muted-foreground/40 bg-background text-transparent",
        )}
      >
        {checked ? <IconCheck className="size-3" /> : null}
      </span>
    );
  }

  return displayValue(property);
}

export function isDatabasePropertyVisibleInView(
  property: DocumentProperty,
  items: ContentDatabaseItem[],
  view: Pick<ContentDatabaseView, "hiddenPropertyIds">,
) {
  return (
    isTablePropertyVisible(property, items) &&
    !(view.hiddenPropertyIds ?? []).includes(property.definition.id)
  );
}

export function setDatabaseViewHiddenPropertyIds(
  view: ContentDatabaseView,
  propertyIds: string[],
  hidden: boolean,
): ContentDatabaseView {
  const hiddenPropertyIds = new Set(view.hiddenPropertyIds ?? []);
  for (const propertyId of propertyIds) {
    if (hidden) {
      hiddenPropertyIds.add(propertyId);
    } else {
      hiddenPropertyIds.delete(propertyId);
    }
  }
  return { ...view, hiddenPropertyIds: [...hiddenPropertyIds] };
}

export function setDatabaseViewColumnCalculation(
  view: ContentDatabaseView,
  key: ColumnKey,
  calculation: DatabaseColumnCalculation | null,
): ContentDatabaseView {
  const calculations = { ...(view.calculations ?? {}) };
  if (calculation) {
    calculations[key] = calculation;
  } else {
    delete calculations[key];
  }
  return { ...view, calculations };
}

export function setDatabaseViewGroupByProperty(
  view: ContentDatabaseView,
  propertyId: string | null,
): ContentDatabaseView {
  const nextPropertyId = propertyId?.trim() || null;
  if ((view.groupByPropertyId ?? null) === nextPropertyId) return view;

  return {
    ...view,
    groupByPropertyId: nextPropertyId,
    collapsedGroupIds: [],
  };
}

export function setDatabaseViewCollapsedGroup(
  view: ContentDatabaseView,
  groupId: string,
  collapsed: boolean,
): ContentDatabaseView {
  const collapsedGroupIds = new Set(view.collapsedGroupIds ?? []);
  if (collapsed) {
    collapsedGroupIds.add(groupId);
  } else {
    collapsedGroupIds.delete(groupId);
  }
  return { ...view, collapsedGroupIds: [...collapsedGroupIds] };
}

export function setDatabaseViewCollapsedGroups(
  view: ContentDatabaseView,
  groupIds: string[],
  collapsed: boolean,
): ContentDatabaseView {
  const collapsedGroupIds = new Set(view.collapsedGroupIds ?? []);
  for (const groupId of groupIds) {
    const normalizedGroupId = groupId.trim();
    if (!normalizedGroupId) continue;
    if (collapsed) {
      collapsedGroupIds.add(normalizedGroupId);
    } else {
      collapsedGroupIds.delete(normalizedGroupId);
    }
  }
  return { ...view, collapsedGroupIds: [...collapsedGroupIds] };
}

export type DatabasePropertyMoveDirection = "left" | "right";

export function orderDatabasePropertiesForView(
  properties: DocumentProperty[],
  view: Pick<ContentDatabaseView, "propertyOrderIds">,
) {
  const propertyById = new Map(
    properties.map((property) => [property.definition.id, property]),
  );
  const ordered = normalizeClientStringList(view.propertyOrderIds)
    .map((id) => propertyById.get(id))
    .filter((property): property is DocumentProperty => !!property);
  const orderedIds = new Set(ordered.map((property) => property.definition.id));
  return [
    ...ordered,
    ...properties.filter((property) => !orderedIds.has(property.definition.id)),
  ];
}

export function moveDatabaseViewProperty(
  view: ContentDatabaseView,
  propertyId: string,
  direction: DatabasePropertyMoveDirection,
  properties: {
    allProperties: DocumentProperty[];
    visibleProperties: DocumentProperty[];
  },
): ContentDatabaseView {
  const visibleIds = properties.visibleProperties.map(
    (property) => property.definition.id,
  );
  const visibleIndex = visibleIds.indexOf(propertyId);
  const targetVisibleIndex =
    direction === "left" ? visibleIndex - 1 : visibleIndex + 1;
  const targetId = visibleIds[targetVisibleIndex];
  if (visibleIndex < 0 || !targetId) return view;

  const allIds = orderDatabasePropertiesForView(
    properties.allProperties,
    view,
  ).map((property) => property.definition.id);
  const currentIndex = allIds.indexOf(propertyId);
  const targetIndex = allIds.indexOf(targetId);
  if (currentIndex < 0 || targetIndex < 0) return view;

  const nextOrder = [...allIds];
  nextOrder[currentIndex] = targetId;
  nextOrder[targetIndex] = propertyId;
  return { ...view, propertyOrderIds: nextOrder };
}

export function reorderDatabaseViewProperty(
  view: ContentDatabaseView,
  sourcePropertyId: string,
  targetPropertyId: string,
  properties: {
    allProperties: DocumentProperty[];
    visibleProperties: DocumentProperty[];
  },
  side: DatabaseDropSide = "before",
): ContentDatabaseView {
  if (sourcePropertyId === targetPropertyId) return view;
  const visibleIds = properties.visibleProperties.map(
    (property) => property.definition.id,
  );
  if (
    !visibleIds.includes(sourcePropertyId) ||
    !visibleIds.includes(targetPropertyId)
  ) {
    return view;
  }

  const allIds = orderDatabasePropertiesForView(
    properties.allProperties,
    view,
  ).map((property) => property.definition.id);
  const sourceIndex = allIds.indexOf(sourcePropertyId);
  const targetIndex = allIds.indexOf(targetPropertyId);
  if (sourceIndex < 0 || targetIndex < 0) return view;

  const nextOrder = [...allIds];
  const [source] = nextOrder.splice(sourceIndex, 1);
  const nextTargetIndex = nextOrder.indexOf(targetPropertyId);
  nextOrder.splice(
    side === "after" ? nextTargetIndex + 1 : nextTargetIndex,
    0,
    source,
  );
  return { ...view, propertyOrderIds: nextOrder };
}

function databaseViewIcon(type: ContentDatabaseViewType) {
  if (type === "board") return IconLayoutKanban;
  if (type === "list") return IconList;
  if (type === "gallery") return IconLayoutGrid;
  if (type === "calendar") return IconCalendar;
  if (type === "timeline") return IconTimeline;
  return IconTable;
}

function databaseViewDefaultName(type: ContentDatabaseViewType) {
  if (type === "board") return "Board";
  if (type === "list") return "List";
  if (type === "gallery") return "Gallery";
  if (type === "calendar") return "Calendar";
  if (type === "timeline") return "Timeline";
  return "Table";
}

export function uniqueDatabaseViewName(
  views: Array<Pick<ContentDatabaseView, "id" | "name">>,
  preferredName: string,
  ignoreViewId?: string,
) {
  const baseName = preferredName.trim() || "View";
  const existingNames = new Set(
    views
      .filter((view) => view.id !== ignoreViewId)
      .map((view) => view.name.trim().toLowerCase())
      .filter(Boolean),
  );

  if (!existingNames.has(baseName.toLowerCase())) {
    return baseName;
  }

  for (let index = 2; ; index += 1) {
    const candidate = `${baseName} ${index}`;
    if (!existingNames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

function databaseBoardGroupingProperty(
  view: ContentDatabaseView,
  properties: DocumentProperty[],
) {
  const groupable = databaseBoardGroupableProperties(properties);
  return (
    groupable.find(
      (property) => property.definition.id === view.groupByPropertyId,
    ) ??
    groupable.find((property) => property.definition.type === "status") ??
    groupable[0] ??
    null
  );
}

function databaseViewGroupingProperty(
  view: Pick<ContentDatabaseView, "groupByPropertyId" | "type">,
  properties: DocumentProperty[],
) {
  if (
    view.type !== "table" &&
    view.type !== "list" &&
    view.type !== "gallery"
  ) {
    return null;
  }
  if (!view.groupByPropertyId) return null;
  return (
    databaseViewGroupableProperties(properties).find(
      (property) => property.definition.id === view.groupByPropertyId,
    ) ?? null
  );
}

export function databaseViewGroupableProperties(
  properties: DocumentProperty[],
) {
  return databaseBoardGroupableProperties(properties);
}

export function databaseViewItemGroups(
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  groupByPropertyId?: string | null,
): DatabaseBoardGroup[] {
  if (!groupByPropertyId) {
    return [
      {
        id: "all",
        label: "All pages",
        property: null,
        value: BOARD_UNGROUPED_VALUE,
        items,
      },
    ];
  }
  return databaseBoardGroups(items, properties, groupByPropertyId);
}

export function databaseVisibleGroups(
  groups: DatabaseBoardGroup[],
  hideEmptyGroups: boolean,
) {
  return hideEmptyGroups
    ? groups.filter((group) => group.items.length > 0)
    : groups;
}

export function databaseBoardGroupableProperties(
  properties: DocumentProperty[],
) {
  return properties.filter((property) =>
    ["status", "select", "multi_select", "checkbox"].includes(
      property.definition.type,
    ),
  );
}

export function databaseBoardCanCreateGroup(property: DocumentProperty | null) {
  if (!property) return false;
  return ["status", "select", "multi_select"].includes(
    property.definition.type,
  );
}

const CALENDAR_DATE_PROPERTY_TYPES: DocumentPropertyType[] = [
  "date",
  "created_time",
  "last_edited_time",
];

const CALENDAR_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function databaseCalendarDateProperties(properties: DocumentProperty[]) {
  return properties.filter((property) =>
    CALENDAR_DATE_PROPERTY_TYPES.includes(property.definition.type),
  );
}

export function databaseCalendarDateProperty(
  view: Pick<ContentDatabaseView, "datePropertyId">,
  properties: DocumentProperty[],
) {
  const dateProperties = databaseCalendarDateProperties(properties);
  return (
    dateProperties.find(
      (property) => property.definition.id === view.datePropertyId,
    ) ??
    dateProperties.find((property) => property.definition.type === "date") ??
    dateProperties[0] ??
    null
  );
}

export function databaseCalendarMonthDays(anchorDate: Date) {
  const first = startOfMonth(anchorDate);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function databaseTimelineDays(anchorDate: Date) {
  return databaseCalendarMonthDays(anchorDate);
}

function databaseTimelineEndDateProperty(
  view: Pick<ContentDatabaseView, "endDatePropertyId">,
  properties: DocumentProperty[],
  startPropertyId?: string | null,
) {
  if (!view.endDatePropertyId) return null;
  return (
    databaseCalendarDateProperties(properties).find(
      (property) =>
        property.definition.id === view.endDatePropertyId &&
        property.definition.id !== startPropertyId,
    ) ?? null
  );
}

export interface DatabaseTimelineSpan {
  item: ContentDatabaseItem;
  startKey: string;
  endKey: string;
  label: string;
  startIndex: number;
  endIndex: number;
}

export function databaseTimelineItemSpans(
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  startPropertyId: string | null | undefined,
  endPropertyId: string | null | undefined,
  days: Date[],
): DatabaseTimelineSpan[] {
  const visibleKeys = days.map((day) => calendarDateKey(day));
  const firstKey = visibleKeys[0];
  const lastKey = visibleKeys[visibleKeys.length - 1];
  if (!startPropertyId || !firstKey || !lastKey) return [];

  return items
    .map((item) => {
      const startProperty = databaseItemPropertyById(
        item,
        properties,
        startPropertyId,
      );
      const startKey = calendarDateKey(startProperty?.value ?? null);
      if (!startKey) return null;

      const rangeEndKey = calendarDateEndKey(startProperty?.value ?? null);
      const rawEndKey = rangeEndKey
        ? rangeEndKey
        : endPropertyId
          ? calendarDateKey(
              databaseItemPropertyById(item, properties, endPropertyId)
                ?.value ?? null,
            )
          : null;
      const endKey = rawEndKey && rawEndKey >= startKey ? rawEndKey : startKey;
      if (endKey < firstKey || startKey > lastKey) return null;

      const clippedStartKey = startKey < firstKey ? firstKey : startKey;
      const clippedEndKey = endKey > lastKey ? lastKey : endKey;
      const startIndex = visibleKeys.indexOf(clippedStartKey);
      const endIndex = visibleKeys.indexOf(clippedEndKey);
      if (startIndex < 0 || endIndex < 0) return null;

      return {
        item,
        startKey,
        endKey,
        label: startKey === endKey ? startKey : `${startKey} - ${endKey}`,
        startIndex,
        endIndex,
      };
    })
    .filter((span): span is DatabaseTimelineSpan => !!span);
}

function databaseItemPropertyById(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  propertyId: string,
) {
  return (
    item.properties.find(
      (candidate) => candidate.definition.id === propertyId,
    ) ??
    properties.find((candidate) => candidate.definition.id === propertyId) ??
    null
  );
}

function databaseTimelineRangeLabel(days: Date[]) {
  const first = days[0] ?? new Date();
  const last = days[days.length - 1] ?? first;
  const sameYear = first.getFullYear() === last.getFullYear();
  const firstLabel = first.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  const lastLabel = last.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${firstLabel} - ${lastLabel}`;
}

export interface DatabaseDateViewRange {
  start: string;
  end: string;
  label: string;
}

export function databaseDateViewRange(
  viewType: ContentDatabaseViewType,
  anchorDate: Date,
): DatabaseDateViewRange | null {
  if (viewType !== "calendar" && viewType !== "timeline") return null;

  const month = startOfMonth(anchorDate);
  const days =
    viewType === "timeline"
      ? databaseTimelineDays(month)
      : databaseCalendarMonthDays(month);
  const first = days[0] ?? month;
  const last = days[days.length - 1] ?? first;
  return {
    start: calendarDateKey(first),
    end: calendarDateKey(last),
    label:
      viewType === "timeline"
        ? databaseTimelineRangeLabel(days)
        : month.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          }),
  };
}

export function databaseScreenVisibleItems(
  view: Pick<
    ContentDatabaseView,
    "type" | "datePropertyId" | "endDatePropertyId"
  >,
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  dateRange: DatabaseDateViewRange | null,
) {
  if (view.type !== "calendar" && view.type !== "timeline") return items;
  const dateProperty = databaseCalendarDateProperty(view, properties);
  if (!dateProperty || !dateRange) return [];
  const datePropertyId = dateProperty.definition.id;

  return items.filter((item) => {
    const startProperty = databaseItemPropertyById(
      item,
      properties,
      datePropertyId,
    );
    const startKey = calendarDateKey(startProperty?.value ?? null);
    if (!startKey) return true;

    if (view.type === "calendar") {
      const rangeEndKey = calendarDateEndKey(startProperty?.value ?? null);
      const endKey =
        rangeEndKey && rangeEndKey >= startKey ? rangeEndKey : startKey;
      return endKey >= dateRange.start && startKey <= dateRange.end;
    }

    const rangeEndKey = calendarDateEndKey(startProperty?.value ?? null);
    const rawEndKey = rangeEndKey
      ? rangeEndKey
      : view.endDatePropertyId
        ? calendarDateKey(
            databaseItemPropertyById(item, properties, view.endDatePropertyId)
              ?.value ?? null,
          )
        : null;
    const endKey = rawEndKey && rawEndKey >= startKey ? rawEndKey : startKey;
    return endKey >= dateRange.start && startKey <= dateRange.end;
  });
}

export function databaseCalendarItemsByDate(
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  datePropertyId?: string | null,
) {
  const grouped = new Map<string, ContentDatabaseItem[]>();
  if (!datePropertyId) return grouped;

  for (const item of items) {
    const property =
      item.properties.find(
        (candidate) => candidate.definition.id === datePropertyId,
      ) ??
      properties.find(
        (candidate) => candidate.definition.id === datePropertyId,
      );
    if (!property?.value) continue;
    const key = calendarDateKey(property.value);
    if (!key) continue;
    const group = grouped.get(key) ?? [];
    group.push(item);
    grouped.set(key, group);
  }

  return grouped;
}

export function databaseItemsWithoutDateValue(
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  datePropertyId?: string | null,
) {
  if (!datePropertyId) return [];

  return items.filter((item) => {
    const property = databaseItemPropertyById(item, properties, datePropertyId);
    return !calendarDateKey(property?.value ?? null);
  });
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function calendarDateKey(value: Date): string;
export function calendarDateKey(value: DocumentPropertyValue): string | null;
export function calendarDateKey(value: Date | DocumentPropertyValue) {
  if (value instanceof Date) return formatCalendarDateKey(value);
  const dateKey = documentPropertyDateKey(value);
  if (dateKey) return dateKey;
  if (value === null || value === undefined || value === "") return null;

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return formatCalendarDateKey(date);
}

function calendarDateEndKey(value: DocumentPropertyValue) {
  return documentPropertyDateKey(value, "end");
}

function formatCalendarDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function databaseBoardGroups(
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  groupByPropertyId?: string | null,
): DatabaseBoardGroup[] {
  const groupProperty =
    databaseBoardGroupingProperty(
      createDatabaseView("Board", "board", { groupByPropertyId }, "board"),
      properties,
    ) ?? null;

  if (!groupProperty) {
    return [
      {
        id: "all",
        label: "No grouping",
        property: null,
        value: BOARD_UNGROUPED_VALUE,
        items,
      },
    ];
  }

  const groups = databaseBoardGroupDefinitions(groupProperty).map((group) => ({
    ...group,
    property: groupProperty,
    items: [] as ContentDatabaseItem[],
  }));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const optionIds = new Set(
    groupProperty.definition.options.options?.map((option) => option.id) ?? [],
  );

  for (const item of items) {
    const values = databaseBoardItemGroupValues(item, groupProperty, optionIds);
    for (const value of values) {
      const group = groupById.get(databaseBoardGroupId(groupProperty, value));
      if (group) group.items.push(item);
    }
  }

  return groups;
}

function databaseBoardGroupDefinitions(property: DocumentProperty) {
  if (property.definition.type === "checkbox") {
    return [
      {
        id: databaseBoardGroupId(property, false),
        label: "Unchecked",
        value: false,
      },
      {
        id: databaseBoardGroupId(property, true),
        label: "Checked",
        value: true,
      },
    ];
  }

  return [
    ...(property.definition.options.options ?? []).map((option) => ({
      id: databaseBoardGroupId(property, option.id),
      label: option.name,
      value: option.id,
    })),
    {
      id: databaseBoardGroupId(property, BOARD_UNGROUPED_VALUE),
      label: "No " + property.definition.name,
      value: BOARD_UNGROUPED_VALUE,
    },
  ];
}

function databaseBoardItemGroupValues(
  item: ContentDatabaseItem,
  property: DocumentProperty,
  optionIds: Set<string>,
): Array<DocumentPropertyValue | typeof BOARD_UNGROUPED_VALUE> {
  const value =
    item.properties.find(
      (candidate) => candidate.definition.id === property.definition.id,
    )?.value ?? null;

  if (property.definition.type === "checkbox") {
    return [value === true];
  }

  if (property.definition.type === "multi_select") {
    if (!Array.isArray(value) || value.length === 0) {
      return [BOARD_UNGROUPED_VALUE];
    }
    const knownValues = value.filter(
      (item): item is string => typeof item === "string" && optionIds.has(item),
    );
    return knownValues.length > 0 ? knownValues : [BOARD_UNGROUPED_VALUE];
  }

  if (typeof value === "string" && optionIds.has(value)) return [value];
  return [BOARD_UNGROUPED_VALUE];
}

function databaseBoardGroupId(
  property: DocumentProperty,
  value: DocumentPropertyValue | typeof BOARD_UNGROUPED_VALUE,
) {
  return `${property.definition.id}:${String(value)}`;
}

export function boardGroupValueForProperty(
  property: DocumentProperty,
  value: DocumentPropertyValue | typeof BOARD_UNGROUPED_VALUE,
): DocumentPropertyValue {
  if (value === BOARD_UNGROUPED_VALUE) {
    return property.definition.type === "multi_select" ? [] : null;
  }
  if (
    property.definition.type === "multi_select" &&
    typeof value === "string"
  ) {
    return [value];
  }
  if (property.definition.type === "checkbox") {
    return value === true;
  }
  return value;
}

export function databaseBoardCanManageGroup(group: DatabaseBoardGroup) {
  return !!databaseBoardOptionForGroup(group);
}

export function databaseBoardVisibleCardProperties(
  properties: DocumentProperty[],
  items: ContentDatabaseItem[],
  activeView: Pick<ContentDatabaseView, "hiddenPropertyIds">,
  groupPropertyId: string | null,
) {
  return properties.filter(
    (property) =>
      property.definition.id !== groupPropertyId &&
      isDatabasePropertyVisibleInView(property, items, activeView),
  );
}

export function databaseBoardOptionForGroup(group: DatabaseBoardGroup) {
  if (!group.property || typeof group.value !== "string") return null;
  if (group.value === BOARD_UNGROUPED_VALUE) return null;
  if (!databaseBoardCanCreateGroup(group.property)) return null;
  return (
    group.property.definition.options.options?.find(
      (option) => option.id === group.value,
    ) ?? null
  );
}

function DatabaseViewTabs({
  viewConfig,
  canEdit,
  onViewConfigChange,
}: {
  viewConfig: ContentDatabaseViewConfig;
  canEdit: boolean;
  onViewConfigChange: (viewConfig: ContentDatabaseViewConfig) => void;
}) {
  const normalized = normalizeClientDatabaseViewConfig(viewConfig);
  const [newViewName, setNewViewName] = useState("");
  const [addViewOpen, setAddViewOpen] = useState(false);
  const [openViewMenuId, setOpenViewMenuId] = useState<string | null>(null);
  const [renameViewId, setRenameViewId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [draggedViewId, setDraggedViewId] = useState<string | null>(null);
  const [dropTargetView, setDropTargetView] =
    useState<DatabaseDropTargetState | null>(null);
  const [dragPreview, setDragPreview] =
    useState<DatabaseDragPreviewState | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const suppressViewClickRef = useRef(false);

  useEffect(() => {
    if (!renameViewId) return;

    const frame = requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [renameViewId]);

  function createView(type: ContentDatabaseViewType) {
    const defaultName = databaseViewDefaultName(type);
    onViewConfigChange(
      addDatabaseView(normalized, newViewName || defaultName, type),
    );
    setNewViewName("");
    setAddViewOpen(false);
  }

  function startRename(view: ContentDatabaseView) {
    setRenameViewId(view.id);
    setRenameValue(view.name);
  }

  function submitRename(viewId: string) {
    onViewConfigChange(renameDatabaseView(normalized, viewId, renameValue));
    setRenameViewId(null);
    setRenameValue("");
  }

  function clearDraggedView() {
    setDraggedViewId(null);
    setDropTargetView(null);
    setDragPreview(null);
    globalThis.document.body.classList.remove("notion-editor-is-dragging");
  }

  function startViewPointerDrag(
    view: ContentDatabaseView,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (!canEdit || normalized.views.length <= 1) return;

    const viewId = view.id;
    const sourceElement = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    function viewTargetFromPoint(
      clientX: number,
      clientY: number,
    ): DatabaseDropTargetState | null {
      const element = globalThis.document.elementFromPoint(clientX, clientY);
      const tab = element?.closest<HTMLElement>("[data-database-view-id]");
      const targetViewId = tab?.dataset.databaseViewId ?? null;
      if (!tab || !targetViewId) return null;
      return {
        id: targetViewId,
        side: databaseDropSideForElement(tab, clientX),
      };
    }

    function beginDrag(moveEvent: PointerEvent) {
      dragging = true;
      suppressViewClickRef.current = true;
      setDraggedViewId(viewId);
      setDropTargetView(null);
      setDragPreview(
        databaseDragPreviewFromElement(
          sourceElement,
          view.name,
          { kind: "view", type: view.type },
          moveEvent.clientX,
          moveEvent.clientY,
        ),
      );
      setOpenViewMenuId(null);
      globalThis.document.body.style.userSelect = "none";
      globalThis.document.body.style.cursor = "grabbing";
      globalThis.document.body.classList.add("notion-editor-is-dragging");
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (
        !dragging &&
        !databaseDragMoved(startX, startY, moveEvent.clientX, moveEvent.clientY)
      ) {
        return;
      }
      if (!dragging) beginDrag(moveEvent);
      moveEvent.preventDefault();
      setDragPreview((current) =>
        current
          ? { ...current, x: moveEvent.clientX, y: moveEvent.clientY }
          : current,
      );
      const targetView = viewTargetFromPoint(
        moveEvent.clientX,
        moveEvent.clientY,
      );
      setDropTargetView(
        targetView && targetView.id !== viewId ? targetView : null,
      );
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      globalThis.document.body.style.userSelect = "";
      globalThis.document.body.style.cursor = "";
      globalThis.document.body.classList.remove("notion-editor-is-dragging");
      globalThis.document.removeEventListener("pointermove", handlePointerMove);
      globalThis.document.removeEventListener("pointerup", handlePointerUp);

      if (dragging) {
        suppressNextDocumentClick();
        globalThis.setTimeout(() => {
          suppressViewClickRef.current = false;
        }, 50);
        const targetView = viewTargetFromPoint(
          upEvent.clientX,
          upEvent.clientY,
        );
        if (targetView && targetView.id !== viewId) {
          onViewConfigChange(
            reorderDatabaseView(
              normalized,
              viewId,
              targetView.id,
              targetView.side,
            ),
          );
        }
      }

      clearDraggedView();
    };

    globalThis.document.addEventListener("pointermove", handlePointerMove);
    globalThis.document.addEventListener("pointerup", handlePointerUp);
  }

  return (
    <div className="group/viewtabs relative flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      <DatabaseDragPreview preview={dragPreview} />
      {normalized.views.map((view) => {
        const active = view.id === normalized.activeViewId;
        const ViewIcon = databaseViewIcon(view.type);
        const dropSide =
          !!draggedViewId &&
          dropTargetView?.id === view.id &&
          draggedViewId !== view.id
            ? dropTargetView.side
            : null;
        const tabButton = (
          <button
            type="button"
            data-database-view-id={view.id}
            aria-label={
              active && canEdit ? `${view.name} view menu` : view.name
            }
            className={cn(
              "relative flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              canEdit &&
                normalized.views.length > 1 &&
                "cursor-grab active:cursor-grabbing",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              draggedViewId === view.id && "opacity-45",
              dropSide && "bg-accent/40",
            )}
            onClick={(event) => {
              if (suppressViewClickRef.current) {
                event.preventDefault();
                suppressViewClickRef.current = false;
                return;
              }
              if (!active) {
                onViewConfigChange(selectDatabaseView(normalized, view.id));
              }
            }}
            onContextMenu={(event) => {
              if (!canEdit) return;
              event.preventDefault();
              setOpenViewMenuId(view.id);
            }}
            onPointerDown={(event) => startViewPointerDrag(view, event)}
          >
            <DatabaseDropIndicator side={dropSide} />
            <ViewIcon
              className={cn(
                "size-4 shrink-0",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            />
            <span className="max-w-40 truncate">{view.name}</span>
          </button>
        );

        if (!canEdit || !active) {
          return <div key={view.id}>{tabButton}</div>;
        }

        return (
          <DropdownMenu
            key={view.id}
            open={openViewMenuId === view.id}
            onOpenChange={(open) => {
              setOpenViewMenuId(open ? view.id : null);
              if (!open) {
                setRenameViewId(null);
                setRenameValue("");
              }
            }}
          >
            <DropdownMenuTrigger asChild>{tabButton}</DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="truncate text-xs text-muted-foreground">
                {view.name}
              </DropdownMenuLabel>
              {renameViewId === view.id ? (
                <form
                  className="grid gap-2 p-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitRename(view.id);
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Input
                    ref={renameInputRef}
                    autoFocus
                    value={renameValue}
                    aria-label="View name"
                    onChange={(event) => setRenameValue(event.target.value)}
                    className="h-8"
                  />
                  <Button type="submit" size="sm" className="h-8">
                    Rename view
                  </Button>
                </form>
              ) : (
                <>
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      startRename(view);
                    }}
                  >
                    Rename view
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ViewIcon className="mr-2 size-4 text-muted-foreground" />
                      Layout
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-48">
                      {DATABASE_VIEW_TYPES.map((type) => {
                        const LayoutIcon = databaseViewIcon(type);
                        return (
                          <DropdownMenuItem
                            key={type}
                            onSelect={(event) => {
                              event.preventDefault();
                              onViewConfigChange(
                                updateDatabaseViewType(
                                  normalized,
                                  view.id,
                                  type,
                                ),
                              );
                            }}
                          >
                            <LayoutIcon className="mr-2 size-4 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              {databaseViewDefaultName(type)}
                            </span>
                            {view.type === type ? (
                              <IconCheck className="size-4 text-muted-foreground" />
                            ) : null}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      onViewConfigChange(
                        duplicateDatabaseView(normalized, view.id),
                      );
                    }}
                  >
                    <IconCopy className="mr-2 size-4 text-muted-foreground" />
                    Duplicate view
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={normalized.views.length <= 1}
                    className="text-destructive focus:text-destructive"
                    onSelect={(event) => {
                      event.preventDefault();
                      onViewConfigChange(
                        deleteDatabaseView(normalized, view.id),
                      );
                    }}
                  >
                    <IconTrash className="mr-2 size-4" />
                    Delete view
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
      {canEdit ? (
        <DropdownMenu
          open={addViewOpen}
          onOpenChange={(open) => {
            setAddViewOpen(open);
            if (!open) setNewViewName("");
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Add database view"
              className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-focus-within/viewtabs:opacity-100 group-hover/viewtabs:opacity-100 data-[state=open]:opacity-100"
            >
              <IconPlus className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              New view
            </DropdownMenuLabel>
            <form
              className="grid gap-2 p-2"
              onSubmit={(event) => {
                event.preventDefault();
                createView("table");
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <Input
                autoFocus
                value={newViewName}
                placeholder="Table"
                aria-label="New view name"
                onChange={(event) => setNewViewName(event.target.value)}
                className="h-8"
              />
              <div className="grid grid-cols-2 gap-1">
                {DATABASE_VIEW_TYPES.map((type) => {
                  const ViewIcon = databaseViewIcon(type);
                  const label = databaseViewDefaultName(type);
                  return (
                    <Button
                      key={type}
                      type={type === "table" ? "submit" : "button"}
                      size="sm"
                      variant={type === "table" ? "default" : "secondary"}
                      className="h-8 gap-1.5"
                      onClick={
                        type === "table" ? undefined : () => createView(type)
                      }
                    >
                      <ViewIcon className="size-3.5" />
                      {label}
                    </Button>
                  );
                })}
              </div>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function DatabaseNameHeader({
  sorts,
  filters,
  selectedCount,
  selectableCount,
  onSortsChange,
  onFiltersChange,
  onToggleAllRowsSelection,
  onResize,
}: {
  sorts: DatabaseSort[];
  filters: DatabaseFilter[];
  selectedCount: number;
  selectableCount: number;
  onSortsChange: (sorts: DatabaseSort[]) => void;
  onFiltersChange: (filters: DatabaseFilter[]) => void;
  onToggleAllRowsSelection: () => void;
  onResize: (event: ReactPointerEvent) => void;
}) {
  const columnState = databaseColumnHeaderState(sorts, filters, "name");
  const allSelected = selectableCount > 0 && selectedCount === selectableCount;
  const partiallySelected = selectedCount > 0 && !allSelected;

  return (
    <div className="group flex h-8 min-w-0 items-center border-r border-border/45 px-1">
      <DatabaseRowSelectionControl
        checked={allSelected}
        indeterminate={partiallySelected}
        disabled={selectableCount === 0}
        quietUntilHover={selectedCount === 0}
        label={
          allSelected
            ? "Clear selected rows"
            : partiallySelected
              ? "Select all visible rows"
              : "Select all visible rows"
        }
        onToggle={onToggleAllRowsSelection}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Name column menu"
            className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded px-1 text-left hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="shrink-0 text-[13px] leading-none text-muted-foreground">
              Aa
            </span>
            <span className="truncate">Name</span>
            <DatabaseColumnStateIndicators state={columnState} />
            <IconChevronDown className="ml-auto size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-70 data-[state=open]:opacity-100" />
          </button>
        </DropdownMenuTrigger>
        <ColumnHeaderMenuContent
          columnKey="name"
          label="Name"
          sorts={sorts}
          filters={filters}
          onSortsChange={onSortsChange}
          onFiltersChange={onFiltersChange}
        />
      </DropdownMenu>
      <ColumnResizeHandle label="Resize Name column" onPointerDown={onResize} />
    </div>
  );
}

function DatabaseSelectionBar({
  selectedCount,
  canEdit,
  properties,
  duplicateDisabled,
  deleteDisabled,
  updateDisabled,
  onClearSelection,
  onSetPropertyValue,
  onDuplicateSelected,
  onDeleteSelected,
}: {
  selectedCount: number;
  canEdit: boolean;
  properties: DocumentProperty[];
  duplicateDisabled: boolean;
  deleteDisabled: boolean;
  updateDisabled: boolean;
  onClearSelection: () => void;
  onSetPropertyValue: (
    property: DocumentProperty,
    value: DocumentPropertyValue,
  ) => Promise<void>;
  onDuplicateSelected: () => void;
  onDeleteSelected: () => void;
}) {
  return (
    <div className="flex h-8 items-center justify-between gap-2 border-y border-border/45 bg-muted/20 px-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">
        {selectedCount} selected
      </span>
      <div className="flex items-center gap-1">
        {canEdit ? (
          <>
            <DatabaseBulkEditPopover
              properties={properties}
              selectedCount={selectedCount}
              disabled={updateDisabled || properties.length === 0}
              onSetPropertyValue={onSetPropertyValue}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              disabled={duplicateDisabled}
              onClick={onDuplicateSelected}
            >
              <IconCopy className="size-3.5" />
              Duplicate
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={deleteDisabled}
              onClick={onDeleteSelected}
            >
              <IconTrash className="size-3.5" />
              Delete
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onClearSelection}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

function DatabaseBulkEditPopover({
  properties,
  selectedCount,
  disabled,
  onSetPropertyValue,
}: {
  properties: DocumentProperty[];
  selectedCount: number;
  disabled: boolean;
  onSetPropertyValue: (
    property: DocumentProperty,
    value: DocumentPropertyValue,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(
    properties[0]?.definition.id ?? null,
  );
  const selectedProperty =
    properties.find(
      (property) => property.definition.id === selectedPropertyId,
    ) ??
    properties[0] ??
    null;

  useEffect(() => {
    if (!open || selectedProperty || properties.length === 0) return;
    setSelectedPropertyId(properties[0].definition.id);
  }, [open, properties, selectedProperty]);

  async function applyValue(
    property: DocumentProperty,
    value: DocumentPropertyValue,
  ) {
    await onSetPropertyValue(property, value);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={disabled}
        >
          <IconPencil className="size-3.5" />
          Set
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[28rem] p-2">
        <div className="grid gap-2">
          <div className="px-1 text-xs font-medium text-muted-foreground">
            Edit {selectedCount} selected row{selectedCount === 1 ? "" : "s"}
          </div>
          <div className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-2">
            <div className="max-h-64 overflow-auto border-r border-border pr-1">
              {properties.map((property) => {
                const Icon = TYPE_ICONS[property.definition.type];
                const selected =
                  property.definition.id === selectedProperty?.definition.id;
                return (
                  <button
                    key={property.definition.id}
                    type="button"
                    className={cn(
                      "flex h-8 w-full min-w-0 items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent",
                      selected && "bg-accent text-accent-foreground",
                    )}
                    onClick={() =>
                      setSelectedPropertyId(property.definition.id)
                    }
                  >
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{property.definition.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="min-w-0">
              {selectedProperty ? (
                <DatabaseBulkPropertyValueEditor
                  property={selectedProperty}
                  disabled={disabled}
                  onApply={(value) => applyValue(selectedProperty, value)}
                  onCancel={() => setOpen(false)}
                />
              ) : (
                <div className="px-2 py-6 text-sm text-muted-foreground">
                  No editable properties
                </div>
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DatabaseBulkPropertyValueEditor({
  property,
  disabled,
  onApply,
  onCancel,
}: {
  property: DocumentProperty;
  disabled: boolean;
  onApply: (value: DocumentPropertyValue) => Promise<void>;
  onCancel: () => void;
}) {
  const type = property.definition.type;

  if (type === "checkbox") {
    return (
      <div className="grid gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="justify-start"
          disabled={disabled}
          onClick={() => void onApply(true)}
        >
          <IconCheck className="mr-1.5 size-3.5" />
          Checked
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="justify-start"
          disabled={disabled}
          onClick={() => void onApply(false)}
        >
          <IconMinus className="mr-1.5 size-3.5" />
          Unchecked
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="justify-start"
          disabled={disabled}
          onClick={() => void onApply(null)}
        >
          Clear value
        </Button>
      </div>
    );
  }

  if (type === "select" || type === "status" || type === "multi_select") {
    return (
      <DatabaseBulkOptionValueEditor
        property={property}
        disabled={disabled}
        onApply={onApply}
        onCancel={onCancel}
      />
    );
  }

  if (type === "files_media") {
    return (
      <DatabaseBulkFilesValueEditor
        disabled={disabled}
        onApply={onApply}
        onCancel={onCancel}
      />
    );
  }

  return (
    <DatabaseBulkScalarValueEditor
      property={property}
      disabled={disabled}
      onApply={onApply}
      onCancel={onCancel}
    />
  );
}

function DatabaseBulkScalarValueEditor({
  property,
  disabled,
  onApply,
  onCancel,
}: {
  property: DocumentProperty;
  disabled: boolean;
  onApply: (value: DocumentPropertyValue) => Promise<void>;
  onCancel: () => void;
}) {
  const type = property.definition.type;
  const [value, setValue] = useState("");
  const valueState = databaseBulkScalarInputState(type, value);
  const inputType =
    type === "number"
      ? "number"
      : type === "date"
        ? "date"
        : type === "email"
          ? "email"
          : type === "url"
            ? "url"
            : type === "phone"
              ? "tel"
              : "text";

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valueState.isValid) return;
        void onApply(valueState.value);
      }}
    >
      {type === "date" ? (
        <div className="grid grid-cols-2 gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 justify-start gap-1.5"
            disabled={disabled}
            onClick={() =>
              void onApply({
                start: dateInputValueForOffset(new Date(), 0),
                includeTime: false,
              })
            }
          >
            <IconCalendar className="size-3.5" />
            Today
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 justify-start gap-1.5"
            disabled={disabled}
            onClick={() =>
              void onApply({
                start: dateInputValueForOffset(new Date(), 1),
                includeTime: false,
              })
            }
          >
            <IconCalendar className="size-3.5" />
            Tomorrow
          </Button>
        </div>
      ) : null}
      <Input
        autoFocus
        value={value}
        type={inputType}
        aria-label={`Set ${property.definition.name} for selected rows`}
        placeholder="Value"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {!valueState.isValid ? (
        <div className="px-1 text-xs text-destructive">
          Enter a valid number.
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => void onApply(null)}
        >
          Clear
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={disabled || !valueState.isValid}
        >
          Apply
        </Button>
      </div>
    </form>
  );
}

function DatabaseBulkFilesValueEditor({
  disabled,
  onApply,
  onCancel,
}: {
  disabled: boolean;
  onApply: (value: DocumentPropertyValue) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const items = filesMediaItems(value);
        void onApply(items.length > 0 ? items : null);
      }}
    >
      <textarea
        autoFocus
        aria-label="Set files for selected rows"
        value={value}
        placeholder="One file or media link per line"
        rows={4}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => void onApply(null)}
        >
          Clear
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={disabled}>
          Apply
        </Button>
      </div>
    </form>
  );
}

function DatabaseBulkOptionValueEditor({
  property,
  disabled,
  onApply,
  onCancel,
}: {
  property: DocumentProperty;
  disabled: boolean;
  onApply: (value: DocumentPropertyValue) => Promise<void>;
  onCancel: () => void;
}) {
  const options = property.definition.options.options ?? [];
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const multi = property.definition.type === "multi_select";

  if (options.length === 0) {
    return (
      <div className="grid gap-2">
        <div className="rounded bg-muted/40 px-2 py-3 text-sm text-muted-foreground">
          This property has no options yet.
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="justify-start"
          disabled={disabled}
          onClick={() => void onApply(multi ? [] : null)}
        >
          Clear value
        </Button>
      </div>
    );
  }

  if (multi) {
    return (
      <div className="grid gap-2">
        <div className="max-h-52 overflow-auto">
          {options.map((option) => {
            const checked = selectedIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() =>
                  setSelectedIds((current) =>
                    current.includes(option.id)
                      ? current.filter((id) => id !== option.id)
                      : [...current, option.id],
                  )
                }
              >
                <DatabaseBulkOptionPill option={option} />
                {checked ? (
                  <IconCheck className="size-4 text-muted-foreground" />
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => void onApply([])}
          >
            Clear
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => void onApply(selectedIds)}
          >
            Apply
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="max-h-52 overflow-auto">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
            disabled={disabled}
            onClick={() => void onApply(option.id)}
          >
            <DatabaseBulkOptionPill option={option} />
          </button>
        ))}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="justify-start"
        disabled={disabled}
        onClick={() => void onApply(null)}
      >
        Clear value
      </Button>
    </div>
  );
}

function DatabaseBulkOptionPill({
  option,
}: {
  option: DocumentPropertyOption;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded px-1.5 py-0.5 text-xs font-medium",
        OPTION_COLOR_CLASSES[option.color],
      )}
    >
      <span className="truncate">{option.name}</span>
    </span>
  );
}

function DatabaseRowSelectionControl({
  checked,
  indeterminate = false,
  disabled = false,
  quietUntilHover = false,
  label,
  onToggle,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  quietUntilHover?: boolean;
  label: string;
  onToggle: () => void;
}) {
  const quiet = quietUntilHover && !checked && !indeterminate;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-all hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30",
        (checked || indeterminate) && "text-foreground",
        quiet &&
          "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-hover/name:opacity-100 group-focus-within/name:opacity-100",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-4 items-center justify-center rounded border",
          checked || indeterminate
            ? "border-foreground bg-foreground text-background"
            : "border-muted-foreground/40 bg-background text-transparent",
        )}
      >
        {indeterminate ? (
          <IconMinus className="size-3" />
        ) : checked ? (
          <IconCheck className="size-3" />
        ) : null}
      </span>
    </button>
  );
}

function DatabasePropertyHeader({
  property,
  documentId,
  canEdit,
  isDragging,
  dropSide,
  sorts,
  filters,
  onPointerDown,
  onResize,
}: {
  property: DocumentProperty;
  documentId: string;
  canEdit: boolean;
  isDragging: boolean;
  dropSide: DatabaseDropSide | null;
  sorts: DatabaseSort[];
  filters: DatabaseFilter[];
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onResize: (event: ReactPointerEvent) => void;
}) {
  const Icon = TYPE_ICONS[property.definition.type];
  const columnState = databaseColumnHeaderState(
    sorts,
    filters,
    property.definition.id,
  );

  return (
    <div
      data-database-property-id={property.definition.id}
      className={cn(
        "group relative flex h-8 min-w-0 items-center border-r border-border/45 px-1 transition-colors",
        canEdit && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-45",
        dropSide && "bg-accent/40",
      )}
      onPointerDown={onPointerDown}
    >
      <DatabaseDropIndicator side={dropSide} />
      {canEdit ? (
        <PropertyManagementPopover
          property={property}
          documentId={documentId}
          icon={Icon}
          triggerClassName="h-full min-w-0 flex-1 rounded-none text-xs text-muted-foreground"
          onTriggerPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onPointerDown(event);
          }}
          triggerTrailing={
            <DatabaseColumnStateIndicators state={columnState} />
          }
        />
      ) : (
        <div className="flex h-7 min-w-0 flex-1 items-center gap-2 px-1">
          <Icon className="size-4 shrink-0" />
          <span className="truncate">{property.definition.name}</span>
          <DatabaseColumnStateIndicators state={columnState} />
        </div>
      )}
      <ColumnResizeHandle
        label={`Resize ${property.definition.name} column`}
        onPointerDown={onResize}
      />
    </div>
  );
}

function DatabaseColumnStateIndicators({
  state,
}: {
  state: ReturnType<typeof databaseColumnHeaderState>;
}) {
  if (!state.sortDirection && state.activeFilterCount === 0) return null;
  const SortIcon =
    state.sortDirection === "asc"
      ? IconArrowUp
      : state.sortDirection === "desc"
        ? IconArrowDown
        : null;

  return (
    <span
      className="flex shrink-0 items-center gap-0.5 text-muted-foreground"
      aria-label={databaseColumnHeaderStateLabel(state)}
    >
      {SortIcon ? <SortIcon className="size-3.5" /> : null}
      {state.activeFilterCount > 0 ? (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-muted px-1 text-[10px] leading-none">
          <IconFilter className="size-3" />
          {state.activeFilterCount > 1 ? (
            <span className="ml-0.5">{state.activeFilterCount}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

function ColumnResizeHandle({
  label,
  onPointerDown,
}: {
  label: string;
  onPointerDown: (event: ReactPointerEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-column-resize-handle=""
      className="-mr-1 h-full w-2 cursor-col-resize rounded-sm opacity-0 transition-opacity hover:bg-primary/60 hover:opacity-100 focus-visible:bg-primary/60 focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-60"
      onPointerDown={onPointerDown}
    />
  );
}

function ColumnHeaderMenuContent({
  columnKey,
  label,
  propertyType,
  sorts,
  filters,
  onSortsChange,
  onFiltersChange,
  onHide,
  hideDisabled,
}: {
  columnKey: ColumnKey;
  label: string;
  propertyType?: DocumentPropertyType;
  sorts: DatabaseSort[];
  filters: DatabaseFilter[];
  onSortsChange: (sorts: DatabaseSort[]) => void;
  onFiltersChange: (filters: DatabaseFilter[]) => void;
  onHide?: () => void | Promise<void>;
  hideDisabled?: boolean;
}) {
  const columnSort = sorts.find((sort) => sort.key === columnKey) ?? null;
  const columnFilterCount = filters.filter(
    (filter) => filter.key === columnKey,
  ).length;
  const quickFilters = databaseQuickFilterOptionsForColumn(propertyType);

  return (
    <DropdownMenuContent align="start" className="w-56">
      <DropdownMenuLabel className="truncate text-xs text-muted-foreground">
        {label}
      </DropdownMenuLabel>
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          onSortsChange(upsertDatabaseSort(sorts, columnKey, label, "asc"));
        }}
      >
        <IconArrowUp className="mr-2 size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1">Sort ascending</span>
        {columnSort?.direction === "asc" ? (
          <IconCheck className="size-4 text-muted-foreground" />
        ) : null}
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          onSortsChange(upsertDatabaseSort(sorts, columnKey, label, "desc"));
        }}
      >
        <IconArrowDown className="mr-2 size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1">Sort descending</span>
        {columnSort?.direction === "desc" ? (
          <IconCheck className="size-4 text-muted-foreground" />
        ) : null}
      </DropdownMenuItem>
      {columnSort ? (
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onSortsChange(clearDatabaseSort(sorts, columnKey));
          }}
        >
          <IconX className="mr-2 size-4 text-muted-foreground" />
          Clear sort
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      {quickFilters.map((quickFilter) => (
        <DropdownMenuItem
          key={quickFilter.operator}
          onSelect={(event) => {
            event.preventDefault();
            onFiltersChange(
              upsertDatabaseQuickFilter(
                filters,
                columnKey,
                label,
                quickFilter.operator,
              ),
            );
          }}
        >
          <IconFilter className="mr-2 size-4 text-muted-foreground" />
          {quickFilter.label}
        </DropdownMenuItem>
      ))}
      {columnFilterCount > 0 ? (
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onFiltersChange(clearDatabaseFiltersForColumn(filters, columnKey));
          }}
        >
          <IconX className="mr-2 size-4 text-muted-foreground" />
          Clear {columnFilterCount === 1 ? "filter" : "filters"}
        </DropdownMenuItem>
      ) : null}
      {onHide ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={hideDisabled}
            onSelect={(event) => {
              event.preventDefault();
              void onHide();
            }}
          >
            <IconEyeOff className="mr-2 size-4 text-muted-foreground" />
            Hide in view
          </DropdownMenuItem>
        </>
      ) : null}
    </DropdownMenuContent>
  );
}

function DatabasePropertiesMenu({
  documentId,
  properties,
  hiddenCount,
  activeView,
  items,
  onPropertyHiddenChange,
  onPropertiesHiddenChange,
}: {
  documentId: string;
  properties: DocumentProperty[];
  hiddenCount: number;
  activeView: ContentDatabaseView;
  items: ContentDatabaseItem[];
  onPropertyHiddenChange: (propertyId: string, hidden: boolean) => void;
  onPropertiesHiddenChange: (propertyIds: string[], hidden: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredProperties = normalizedQuery
    ? properties.filter((property) =>
        property.definition.name.toLowerCase().includes(normalizedQuery),
      )
    : properties;
  const visibleCount = properties.filter((property) =>
    isDatabasePropertyVisibleInView(property, items, activeView),
  ).length;
  const propertyIds = properties.map((property) => property.definition.id);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={
            hiddenCount > 0
              ? `${hiddenCount} hidden properties`
              : "Property visibility"
          }
          title="Property visibility"
          className={cn(
            databaseToolbarIconButtonClass(hiddenCount > 0),
            "relative",
          )}
        >
          <IconEye className="size-3.5" />
          {hiddenCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-foreground text-[9px] leading-none text-background">
              {hiddenCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80"
        onCloseAutoFocus={() => setQuery("")}
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Properties
        </DropdownMenuLabel>
        <div
          className="grid gap-2 p-2 pt-1"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="flex h-8 items-center gap-1 rounded border border-border bg-background px-2">
            <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
            <Input
              value={query}
              placeholder="Search properties"
              aria-label="Search properties"
              onChange={(event) => setQuery(event.target.value)}
              className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {visibleCount} shown, {properties.length - visibleCount} hidden
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={hiddenCount === 0}
                onClick={() => onPropertiesHiddenChange(propertyIds, false)}
              >
                <IconEye className="mr-1 size-3.5" />
                Show all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={visibleCount === 0}
                onClick={() => onPropertiesHiddenChange(propertyIds, true)}
              >
                <IconEyeOff className="mr-1 size-3.5" />
                Hide all
              </Button>
            </div>
          </div>
        </div>
        {filteredProperties.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            No matching properties
          </div>
        ) : null}
        {filteredProperties.map((property) => {
          const Icon = TYPE_ICONS[property.definition.type];
          const visible = isDatabasePropertyVisibleInView(
            property,
            items,
            activeView,
          );
          return (
            <DropdownMenuItem
              key={property.definition.id}
              onSelect={(event) => {
                event.preventDefault();
                onPropertyHiddenChange(property.definition.id, visible);
              }}
            >
              <Icon className="mr-2 size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {property.definition.name}
              </span>
              <span className="mr-2 text-xs text-muted-foreground">
                {visible ? "Shown" : "Hidden"}
              </span>
              {visible ? (
                <IconCheck className="size-4 text-muted-foreground" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
        <div
          className="border-t border-border p-2"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <AddProperty documentId={documentId} label="New property" />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function applyDatabaseView(
  items: ContentDatabaseItem[],
  properties: DocumentProperty[],
  searchQuery: string,
  filters: DatabaseFilter[],
  sorts: DatabaseSort[],
  filterMode: DatabaseFilterMode = "and",
) {
  const query = searchQuery.trim().toLowerCase();
  const searched = query
    ? items.filter((item) =>
        databaseItemSearchText(item, properties).toLowerCase().includes(query),
      )
    : items;
  const activeFilters = filters.filter(isActiveFilter);
  const filtered = activeFilters.length
    ? searched.filter((item) =>
        filterMode === "or"
          ? activeFilters.some((filter) =>
              databaseItemMatchesFilter(item, properties, filter),
            )
          : activeFilters.every((filter) =>
              databaseItemMatchesFilter(item, properties, filter),
            ),
      )
    : searched;

  if (sorts.length === 0) return filtered;

  return [...filtered].sort((a, b) => {
    for (const sort of sorts) {
      const comparison = compareDatabaseSortValues(
        databaseItemSortValue(a, properties, sort.key),
        databaseItemSortValue(b, properties, sort.key),
      );
      if (comparison !== 0) {
        return sort.direction === "asc" ? comparison : -comparison;
      }
    }
    return 0;
  });
}

function defaultDatabaseSort(): DatabaseSort {
  return {
    key: "name",
    label: "Name",
    direction: "asc",
  };
}

function defaultDatabaseFilter(): DatabaseFilter {
  return {
    key: "name",
    label: "Name",
    operator: "contains",
    value: "",
  };
}

export function upsertDatabaseSort(
  sorts: DatabaseSort[],
  key: ColumnKey,
  label: string,
  direction: SortDirection,
) {
  return [
    { key, label, direction },
    ...sorts.filter((sort) => sort.key !== key),
  ];
}

export function clearDatabaseSort(sorts: DatabaseSort[], key: ColumnKey) {
  return sorts.filter((sort) => sort.key !== key);
}

export type DatabaseConditionMoveDirection = "up" | "down";

export function moveDatabaseSort(
  sorts: DatabaseSort[],
  index: number,
  direction: DatabaseConditionMoveDirection,
) {
  return moveDatabaseCondition(sorts, index, direction);
}

export function appendDatabaseFilter(
  filters: DatabaseFilter[],
  key: ColumnKey,
  label: string,
  operator: FilterOperator,
  value = "",
) {
  return [...filters, { key, label, operator, value }];
}

export function moveDatabaseFilter(
  filters: DatabaseFilter[],
  index: number,
  direction: DatabaseConditionMoveDirection,
) {
  return moveDatabaseCondition(filters, index, direction);
}

function moveDatabaseCondition<T>(
  items: T[],
  index: number,
  direction: DatabaseConditionMoveDirection,
) {
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= items.length) {
    return items;
  }

  const next = [...items];
  next[index] = items[targetIndex];
  next[targetIndex] = items[index];
  return next;
}

const DATABASE_QUICK_FILTER_OPERATORS: FilterOperator[] = [
  "is_empty",
  "is_not_empty",
  "is_checked",
  "is_unchecked",
];

type DatabaseQuickFilterOperator = Extract<
  FilterOperator,
  "is_empty" | "is_not_empty" | "is_checked" | "is_unchecked"
>;

export function databaseQuickFilterOptionsForColumn(
  propertyType?: DocumentPropertyType,
): Array<{ operator: DatabaseQuickFilterOperator; label: string }> {
  if (propertyType === "checkbox") {
    return [
      { operator: "is_checked", label: "Filter checked" },
      { operator: "is_unchecked", label: "Filter unchecked" },
    ];
  }
  return [
    { operator: "is_empty", label: "Filter empty" },
    { operator: "is_not_empty", label: "Filter not empty" },
  ];
}

export function upsertDatabaseQuickFilter(
  filters: DatabaseFilter[],
  key: ColumnKey,
  label: string,
  operator: DatabaseQuickFilterOperator,
) {
  return [
    ...filters.filter(
      (filter) =>
        filter.key !== key ||
        !DATABASE_QUICK_FILTER_OPERATORS.includes(filter.operator),
    ),
    { key, label, operator, value: "" },
  ];
}

export function clearDatabaseFiltersForColumn(
  filters: DatabaseFilter[],
  key: ColumnKey,
) {
  return filters.filter((filter) => filter.key !== key);
}

export function databaseColumnHeaderState(
  sorts: DatabaseSort[],
  filters: DatabaseFilter[],
  key: ColumnKey,
) {
  const sort = sorts.find((candidate) => candidate.key === key);
  return {
    sortDirection: sort?.direction ?? null,
    activeFilterCount: filters.filter(
      (filter) => filter.key === key && isActiveFilter(filter),
    ).length,
  };
}

function databaseColumnHeaderStateLabel(
  state: ReturnType<typeof databaseColumnHeaderState>,
) {
  const parts = [
    state.sortDirection
      ? `Sorted ${state.sortDirection === "asc" ? "ascending" : "descending"}`
      : "",
    state.activeFilterCount > 0
      ? `${state.activeFilterCount} active filter${state.activeFilterCount === 1 ? "" : "s"}`
      : "",
  ].filter(Boolean);
  return parts.join(", ");
}

export function activeDatabaseConstraintCount(
  searchQuery: string,
  sorts: DatabaseSort[],
  filters: DatabaseFilter[],
) {
  return (
    (searchQuery.trim() ? 1 : 0) +
    sorts.length +
    filters.filter(isActiveFilter).length
  );
}

function isActiveFilter(
  filter: DatabaseFilter | null,
): filter is DatabaseFilter {
  if (!filter) return false;
  if (filterOperatorNeedsValue(filter.operator)) {
    return filter.value.trim().length > 0;
  }
  return true;
}

export function databasePropertyValuesForNewItem(
  filters: DatabaseFilter[],
  properties: DocumentProperty[],
  filterMode: DatabaseFilterMode = "and",
): Record<string, DocumentPropertyValue> {
  const propertyValues: Record<string, DocumentPropertyValue> = {};
  const activeFilters = filters.filter(isActiveFilter);
  if (filterMode === "or" && activeFilters.length > 1) {
    return propertyValues;
  }

  for (const filter of activeFilters) {
    if (filter.key === "name") continue;

    const property = properties.find(
      (candidate) => candidate.definition.id === filter.key,
    );
    if (!property?.editable) continue;
    if (isComputedPropertyType(property.definition.type)) continue;
    if (propertyValues[property.definition.id] !== undefined) continue;

    const value = databaseFilterDefaultValueForNewItem(filter, property);
    if (value !== undefined) {
      propertyValues[property.definition.id] = value;
    }
  }

  return propertyValues;
}

function databaseFilterDefaultValueForNewItem(
  filter: DatabaseFilter,
  property: DocumentProperty,
): DocumentPropertyValue | undefined {
  if (filter.operator === "is_checked") {
    return property.definition.type === "checkbox" ? true : undefined;
  }
  if (filter.operator === "is_unchecked") {
    return property.definition.type === "checkbox" ? false : undefined;
  }
  if (filter.operator !== "equals") return undefined;

  const value = filter.value.trim();
  if (!value) return undefined;

  const optionValue = databasePropertyOptionIdForFilterValue(property, value);
  if (property.definition.type === "multi_select") {
    return [optionValue ?? value];
  }
  if (
    property.definition.type === "select" ||
    property.definition.type === "status"
  ) {
    return optionValue ?? value;
  }
  if (property.definition.type === "date") {
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? { start: value, includeTime: false }
      : undefined;
  }
  if (property.definition.type === "checkbox") return undefined;

  return value;
}

function databasePropertyOptionIdForFilterValue(
  property: DocumentProperty,
  value: string,
) {
  return property.definition.options.options?.find(
    (option) =>
      option.id === value ||
      option.name.trim().toLowerCase() === value.trim().toLowerCase(),
  )?.id;
}

function databaseItemMatchesFilter(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  filter: DatabaseFilter,
) {
  const value = databaseItemFilterValue(item, properties, filter.key);
  const property = databaseItemFilterProperty(item, properties, filter.key);

  if (filter.operator === "is_empty") return !value.trim();
  if (filter.operator === "is_not_empty") return !!value.trim();

  if (filter.operator === "is_checked") return property?.value === true;
  if (filter.operator === "is_unchecked") return property?.value !== true;

  if (filter.operator === "greater_than" || filter.operator === "less_than") {
    const current = propertyNumberValue(property);
    const target = Number(filter.value.trim());
    if (!Number.isFinite(current) || !Number.isFinite(target)) return false;
    return filter.operator === "greater_than"
      ? current > target
      : current < target;
  }

  if (filter.operator === "before" || filter.operator === "after") {
    const current = propertyDateValue(property);
    const target = new Date(filter.value.trim()).getTime();
    if (!Number.isFinite(current) || !Number.isFinite(target)) return false;
    return filter.operator === "before" ? current < target : current > target;
  }

  const candidateValues = databaseItemFilterCandidateValues(
    item,
    properties,
    filter.key,
  ).map((candidate) => candidate.trim().toLowerCase());
  const normalizedValue = value.trim().toLowerCase();
  const normalizedFilter = filter.value.trim().toLowerCase();
  if (filter.operator === "equals") {
    return candidateValues.includes(normalizedFilter);
  }
  if (filter.operator === "does_not_equal") {
    return !candidateValues.includes(normalizedFilter);
  }
  return normalizedValue.includes(normalizedFilter);
}

function databaseItemSearchText(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
) {
  return [
    item.document.title || "Untitled",
    ...properties.map((property) =>
      propertyValueText(
        item.properties.find(
          (candidate) => candidate.definition.id === property.definition.id,
        ) ?? property,
      ),
    ),
  ].join(" ");
}

function databaseItemSortValue(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  key: string,
) {
  if (key === "name") return item.document.title || "";
  const property = properties.find(
    (candidate) => candidate.definition.id === key,
  );
  const itemProperty = item.properties.find(
    (candidate) => candidate.definition.id === key,
  );
  return propertyValueText(itemProperty ?? property ?? null);
}

function databaseItemFilterValue(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  key: string,
) {
  if (key === "name") return item.document.title || "";
  return propertyValueText(databaseItemFilterProperty(item, properties, key));
}

function databaseItemFilterProperty(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  key: string,
) {
  if (key === "name") return null;
  const property = properties.find(
    (candidate) => candidate.definition.id === key,
  );
  const itemProperty = item.properties.find(
    (candidate) => candidate.definition.id === key,
  );
  return itemProperty ?? property ?? null;
}

function databaseItemFilterCandidateValues(
  item: ContentDatabaseItem,
  properties: DocumentProperty[],
  key: string,
) {
  if (key === "name") return [item.document.title || ""];
  const property = databaseItemFilterProperty(item, properties, key);
  if (!property) return [""];
  const value = property.value;

  if (value === null || value === undefined || value === "") return [""];

  if (Array.isArray(value)) {
    return value.flatMap((id) => {
      const optionName =
        property.definition.options.options?.find((option) => option.id === id)
          ?.name ?? id;
      return [id, optionName];
    });
  }

  if (
    property.definition.type === "select" ||
    property.definition.type === "status"
  ) {
    const id = String(value);
    const optionName =
      property.definition.options.options?.find((option) => option.id === id)
        ?.name ?? id;
    return [id, optionName];
  }

  return [propertyValueText(property)];
}

function propertyValueText(property: DocumentProperty | null | undefined) {
  if (!property) return "";
  const value = property.value;
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) {
    return value
      .map(
        (id) =>
          property.definition.options.options?.find(
            (option) => option.id === id,
          )?.name ?? id,
      )
      .join(" ");
  }
  if (
    property.definition.type === "select" ||
    property.definition.type === "status"
  ) {
    return (
      property.definition.options.options?.find(
        (option) => option.id === String(value),
      )?.name ?? String(value)
    );
  }
  if (property.definition.type === "checkbox") {
    return value ? "Checked" : "Unchecked";
  }
  if (property.definition.type === "date") {
    return formulaValueText(value);
  }
  return formulaValueText(value);
}

function compareDatabaseSortValues(left: string, right: string) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (
    left.trim() &&
    right.trim() &&
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber)
  ) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function propertyNumberValue(property: DocumentProperty | null | undefined) {
  if (!property) return Number.NaN;
  if (
    property.value === null ||
    property.value === undefined ||
    property.value === ""
  ) {
    return Number.NaN;
  }
  const value =
    typeof property.value === "number"
      ? property.value
      : Number(String(property.value).trim());
  return Number.isFinite(value) ? value : Number.NaN;
}

function propertyDateValue(property: DocumentProperty | null | undefined) {
  if (!property || !property.value) return Number.NaN;
  const value = new Date(
    documentPropertyDatePart(property.value, "start") || String(property.value),
  ).getTime();
  return Number.isFinite(value) ? value : Number.NaN;
}

function SortMenu({
  properties,
  sorts,
  onSortsChange,
}: {
  properties: DocumentProperty[];
  sorts: DatabaseSort[];
  onSortsChange: (sorts: DatabaseSort[]) => void;
}) {
  const displayedSorts = sorts.length > 0 ? sorts : [defaultDatabaseSort()];

  function updateSort(index: number, next: Partial<DatabaseSort>) {
    const baseSorts = sorts.length > 0 ? [...sorts] : [defaultDatabaseSort()];
    baseSorts[index] = {
      ...(baseSorts[index] ?? defaultDatabaseSort()),
      ...next,
    };
    onSortsChange(baseSorts);
  }

  function selectSort(index: number, key: "name" | string, label: string) {
    updateSort(index, { key, label });
  }

  function toggleDirection(index: number) {
    const current = displayedSorts[index] ?? defaultDatabaseSort();
    updateSort(index, {
      direction: current.direction === "asc" ? "desc" : "asc",
    });
  }

  function addSort() {
    onSortsChange([...sorts, defaultDatabaseSort()]);
  }

  function removeSort(index: number) {
    onSortsChange(sorts.filter((_, sortIndex) => sortIndex !== index));
  }

  function moveSort(index: number, direction: DatabaseConditionMoveDirection) {
    onSortsChange(moveDatabaseSort(sorts, index, direction));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={
            sorts.length > 0 ? `${sorts.length} active sorts` : "Sort"
          }
          title="Sort"
          className={cn(
            databaseToolbarIconButtonClass(sorts.length > 0),
            "relative",
          )}
        >
          <IconArrowsSort className="size-3.5" />
          {sorts.length > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-foreground text-[9px] leading-none text-background">
              {sorts.length}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[340px]">
        <div className="grid gap-2 p-2">
          <div className="text-xs font-medium text-muted-foreground">
            Sort rows by
          </div>
          <div className="grid gap-2">
            {displayedSorts.map((sort, index) => (
              <div
                key={`${index}-${sort.key}`}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-1 rounded border border-border/70 bg-background p-1.5"
              >
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="min-w-0">
                    <SortFieldIcon sort={sort} properties={properties} />
                    <span className="min-w-0 flex-1 truncate">
                      {sort.label}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DatabasePropertyPickerSubContent
                    properties={properties}
                    selectedKey={sort.key}
                    includeName
                    onSelect={(key, label) => selectSort(index, key, label)}
                  />
                </DropdownMenuSub>
                <button
                  type="button"
                  className="flex h-8 items-center rounded px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => toggleDirection(index)}
                >
                  {sort.direction === "asc" ? "Asc" : "Desc"}
                </button>
                <div className="flex items-center">
                  <button
                    type="button"
                    aria-label={`Move sort ${index + 1} earlier`}
                    className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    disabled={sorts.length <= 1 || index === 0}
                    onClick={() => moveSort(index, "up")}
                  >
                    <IconArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move sort ${index + 1} later`}
                    className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    disabled={
                      sorts.length <= 1 || index >= displayedSorts.length - 1
                    }
                    onClick={() => moveSort(index, "down")}
                  >
                    <IconArrowDown className="size-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  aria-label={`Remove sort ${index + 1}`}
                  className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                  disabled={sorts.length === 0}
                  onClick={() => removeSort(index)}
                >
                  <IconX className="size-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex justify-between gap-2 border-t pt-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              onClick={addSort}
            >
              <IconPlus className="mr-1 size-3.5" />
              Add sort
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              disabled={sorts.length === 0}
              onClick={() => onSortsChange([])}
            >
              Clear sorts
            </Button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortFieldIcon({
  sort,
  properties,
}: {
  sort: DatabaseSort;
  properties: DocumentProperty[];
}) {
  if (sort.key === "name") {
    return <IconFileText className="mr-2 size-4 text-muted-foreground" />;
  }
  const property = properties.find(
    (candidate) => candidate.definition.id === sort.key,
  );
  const Icon = property ? TYPE_ICONS[property.definition.type] : IconFileText;
  return <Icon className="mr-2 size-4 text-muted-foreground" />;
}

function FilterMenu({
  documentId,
  properties,
  filters,
  filterMode,
  onFiltersChange,
  onFilterModeChange,
}: {
  documentId: string;
  properties: DocumentProperty[];
  filters: DatabaseFilter[];
  filterMode: DatabaseFilterMode;
  onFiltersChange: (filters: DatabaseFilter[]) => void;
  onFilterModeChange: (filterMode: DatabaseFilterMode) => void;
}) {
  const activeFilters = filters.filter(isActiveFilter);
  const active = activeFilters.length > 0;
  const displayedFilters =
    filters.length > 0 ? filters : [defaultDatabaseFilter()];

  function updateFilter(index: number, next: Partial<DatabaseFilter>) {
    const baseFilters =
      filters.length > 0 ? [...filters] : [defaultDatabaseFilter()];
    const currentFilter = baseFilters[index] ?? defaultDatabaseFilter();
    const nextOperator = next.operator ?? currentFilter.operator;
    baseFilters[index] = {
      ...currentFilter,
      ...next,
      value: filterOperatorNeedsValue(nextOperator)
        ? (next.value ?? currentFilter.value)
        : "",
    };
    onFiltersChange(baseFilters);
  }

  function selectField(index: number, key: "name" | string, label: string) {
    updateFilter(index, {
      key,
      label,
      operator: defaultFilterOperatorForKey(key, properties),
      value: "",
    });
  }

  function selectOperator(index: number, operator: FilterOperator) {
    updateFilter(index, { operator });
  }

  function addFilter() {
    onFiltersChange([...filters, defaultDatabaseFilter()]);
  }

  function removeFilter(index: number) {
    onFiltersChange(filters.filter((_, filterIndex) => filterIndex !== index));
  }

  function moveFilter(
    index: number,
    direction: DatabaseConditionMoveDirection,
  ) {
    onFiltersChange(moveDatabaseFilter(filters, index, direction));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={
            active ? `${activeFilters.length} active filters` : "Filter"
          }
          title="Filter"
          className={cn(databaseToolbarIconButtonClass(active), "relative")}
        >
          <IconFilter className="size-3.5" />
          {active ? (
            <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-foreground text-[9px] leading-none text-background">
              {activeFilters.length}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[360px]">
        <div
          className="grid gap-2 p-2"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="text-xs font-medium text-muted-foreground">
            Filter rows where
          </div>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="h-8 rounded border border-border/70 bg-background px-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-left">
                Match {databaseFilterModePhrase(filterMode)}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              {DATABASE_FILTER_MODES.map((mode) => (
                <DropdownMenuItem
                  key={mode}
                  onSelect={(event) => {
                    event.preventDefault();
                    onFilterModeChange(mode);
                  }}
                >
                  <span className="flex-1">
                    {databaseFilterModeLabel(mode)}
                  </span>
                  {filterMode === mode ? (
                    <IconCheck className="size-4 text-muted-foreground" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <div className="grid gap-2">
            {displayedFilters.map((currentFilter, index) => (
              <div
                key={`${index}-${currentFilter.key}`}
                className="grid gap-1 rounded border border-border/70 bg-background p-1.5"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-1">
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="min-w-0">
                      <FilterFieldIcon
                        filter={currentFilter}
                        properties={properties}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {currentFilter.label}
                      </span>
                    </DropdownMenuSubTrigger>
                    <DatabasePropertyPickerSubContent
                      properties={properties}
                      selectedKey={currentFilter.key}
                      includeName
                      onSelect={(key, label) => selectField(index, key, label)}
                    />
                  </DropdownMenuSub>

                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="min-w-0">
                      <IconFilter className="mr-2 size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {FILTER_OPERATOR_LABELS[currentFilter.operator] ??
                          "Contains"}
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-44">
                      {filterOperatorsForKey(currentFilter.key, properties).map(
                        (operator) => (
                          <DropdownMenuItem
                            key={operator}
                            onSelect={(event) => {
                              event.preventDefault();
                              selectOperator(index, operator);
                            }}
                          >
                            <span className="flex-1">
                              {FILTER_OPERATOR_LABELS[operator]}
                            </span>
                            {currentFilter.operator === operator ? (
                              <IconCheck className="size-4 text-muted-foreground" />
                            ) : null}
                          </DropdownMenuItem>
                        ),
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <div className="flex items-center">
                    <button
                      type="button"
                      aria-label={`Move filter ${index + 1} earlier`}
                      className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      disabled={filters.length <= 1 || index === 0}
                      onClick={() => moveFilter(index, "up")}
                    >
                      <IconArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move filter ${index + 1} later`}
                      className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      disabled={
                        filters.length <= 1 ||
                        index >= displayedFilters.length - 1
                      }
                      onClick={() => moveFilter(index, "down")}
                    >
                      <IconArrowDown className="size-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    aria-label={`Remove filter ${index + 1}`}
                    className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    disabled={filters.length === 0}
                    onClick={() => removeFilter(index)}
                  >
                    <IconX className="size-4" />
                  </button>
                </div>

                {filterOperatorNeedsValue(currentFilter.operator) ? (
                  <DatabaseFilterValueControl
                    autoFocus={index === displayedFilters.length - 1}
                    documentId={documentId}
                    filter={currentFilter}
                    properties={properties}
                    onValueChange={(value) => updateFilter(index, { value })}
                  />
                ) : null}
              </div>
            ))}
          </div>

          <div className="flex justify-between gap-2 border-t pt-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              onClick={addFilter}
            >
              <IconPlus className="mr-1 size-3.5" />
              Add filter
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              disabled={filters.length === 0}
              onClick={() => onFiltersChange([])}
            >
              Clear filters
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">
            {active ? `${activeFilters.length} active` : "Set a value to apply"}
          </span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DatabaseFilterValueControl({
  documentId,
  filter,
  properties,
  autoFocus,
  onValueChange,
}: {
  documentId: string;
  filter: DatabaseFilter;
  properties: DocumentProperty[];
  autoFocus?: boolean;
  onValueChange: (value: string) => void;
}) {
  const configureProperty = useConfigureDocumentProperty(documentId);
  const options = databaseFilterOptionChoices(filter.key, properties);
  const type = filterPropertyTypeForKey(filter.key, properties);
  const [optionQuery, setOptionQuery] = useState("");
  const filteredOptions = filterPropertyOptions(options, optionQuery);
  const optionProperty = databaseFilterOptionPropertyForKey(
    filter.key,
    properties,
  );
  const canCreateOption =
    !!optionProperty && canCreatePropertyOption(options, optionQuery);

  async function createFilterOption() {
    if (!optionProperty || !canCreateOption) return;
    const option = nextPropertyOption(optionQuery, options);
    await configureProperty.mutateAsync({
      id: optionProperty.definition.id,
      documentId,
      name: optionProperty.definition.name,
      type: optionProperty.definition.type,
      visibility: optionProperty.definition.visibility,
      options: { options: [...options, option] },
    });
    setOptionQuery("");
    onValueChange(option.id);
  }

  if (optionProperty) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="h-8 rounded border border-input bg-background px-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-left">
            {databaseFilterValueLabel(filter, properties)}
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-72 w-56 overflow-auto">
          <div
            className="sticky top-0 z-10 border-b border-border bg-popover p-2"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div className="flex h-8 items-center gap-1 rounded border border-border bg-background px-2">
              <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
              <Input
                autoFocus={autoFocus}
                value={optionQuery}
                placeholder="Search options"
                aria-label={`Search ${filter.label} filter options`}
                onChange={(event) => setOptionQuery(event.target.value)}
                className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
              />
            </div>
          </div>
          {filter.value ? (
            <>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onValueChange("");
                }}
              >
                <IconX className="mr-2 size-4 text-muted-foreground" />
                Clear value
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {filteredOptions.length === 0 && !canCreateOption ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              No matching options
            </div>
          ) : null}
          {filteredOptions.map((option) => (
            <DropdownMenuItem
              key={option.id}
              onSelect={(event) => {
                event.preventDefault();
                onValueChange(option.id);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{option.name}</span>
              {filter.value === option.id || filter.value === option.name ? (
                <IconCheck className="size-4 text-muted-foreground" />
              ) : null}
            </DropdownMenuItem>
          ))}
          {canCreateOption ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={configureProperty.isPending}
                onSelect={(event) => {
                  event.preventDefault();
                  void createFilterOption();
                }}
              >
                <IconPlus className="mr-2 size-4 text-muted-foreground" />
                Create &ldquo;{optionQuery.trim()}&rdquo;
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  return (
    <Input
      autoFocus={autoFocus}
      type={filterValueInputType(type)}
      inputMode={type === "number" ? "decimal" : undefined}
      value={filter.value}
      placeholder={filterValuePlaceholder(filter.key, properties)}
      onChange={(event) => onValueChange(event.target.value)}
      className="h-8"
    />
  );
}

function FilterFieldIcon({
  filter,
  properties,
}: {
  filter: DatabaseFilter;
  properties: DocumentProperty[];
}) {
  if (filter.key === "name") {
    return <IconFileText className="mr-2 size-4 text-muted-foreground" />;
  }
  const property = properties.find(
    (candidate) => candidate.definition.id === filter.key,
  );
  const Icon = property ? TYPE_ICONS[property.definition.type] : IconFileText;
  return <Icon className="mr-2 size-4 text-muted-foreground" />;
}

const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: "Contains",
  equals: "Is",
  does_not_equal: "Is not",
  greater_than: "Greater than",
  less_than: "Less than",
  before: "Before",
  after: "After",
  is_checked: "Checked",
  is_unchecked: "Unchecked",
  is_empty: "Is empty",
  is_not_empty: "Is not empty",
};

function filterOperatorsForKey(
  key: string,
  properties: DocumentProperty[],
): FilterOperator[] {
  const type = filterPropertyTypeForKey(key, properties);

  if (type === "checkbox") {
    return ["is_checked", "is_unchecked"];
  }

  if (type === "select" || type === "status" || type === "multi_select") {
    return ["equals", "does_not_equal", "is_empty", "is_not_empty"];
  }

  if (type === "number") {
    return [
      "equals",
      "does_not_equal",
      "greater_than",
      "less_than",
      "is_empty",
      "is_not_empty",
    ];
  }

  if (
    type === "date" ||
    type === "created_time" ||
    type === "last_edited_time"
  ) {
    return [
      "equals",
      "does_not_equal",
      "before",
      "after",
      "is_empty",
      "is_not_empty",
    ];
  }

  return ["contains", "equals", "does_not_equal", "is_empty", "is_not_empty"];
}

function defaultFilterOperatorForKey(
  key: string,
  properties: DocumentProperty[],
): FilterOperator {
  return filterOperatorsForKey(key, properties)[0] ?? "contains";
}

function filterPropertyTypeForKey(
  key: string,
  properties: DocumentProperty[],
): DocumentPropertyType {
  if (key === "name") return "text";
  return (
    properties.find((property) => property.definition.id === key)?.definition
      .type ?? "text"
  );
}

function filterOperatorNeedsValue(operator: FilterOperator) {
  return !["is_empty", "is_not_empty", "is_checked", "is_unchecked"].includes(
    operator,
  );
}

function filterValuePlaceholder(key: string, properties: DocumentProperty[]) {
  const type = filterPropertyTypeForKey(key, properties);
  if (type === "number") return "Number";
  if (type === "person") return "Person or email";
  if (type === "place") return "City, venue, or address";
  if (type === "files_media") return "File or media link";
  if (type === "date" || type === "created_time" || type === "last_edited_time")
    return "YYYY-MM-DD";
  return "Value";
}

function filterValueInputType(type: DocumentPropertyType) {
  if (type === "number") return "number";
  if (type === "date" || type === "created_time" || type === "last_edited_time")
    return "date";
  return "text";
}

export function databaseFilterOptionChoices(
  key: string,
  properties: DocumentProperty[],
) {
  const property = databaseFilterOptionPropertyForKey(key, properties);
  return property?.definition.options.options ?? [];
}

export function databaseFilterOptionPropertyForKey(
  key: string,
  properties: DocumentProperty[],
) {
  const property = databaseFilterPropertyForKey(key, properties);
  if (!property) return null;
  if (
    property.definition.type !== "select" &&
    property.definition.type !== "status" &&
    property.definition.type !== "multi_select"
  ) {
    return null;
  }
  return property;
}

function databaseFilterValueLabel(
  filter: DatabaseFilter,
  properties: DocumentProperty[],
) {
  const option = databaseFilterOptionChoices(filter.key, properties).find(
    (candidate) =>
      candidate.id === filter.value || candidate.name === filter.value,
  );
  return (option?.name ?? filter.value) || "Choose option";
}

function databaseFilterChipLabel(
  filter: DatabaseFilter,
  properties: DocumentProperty[],
) {
  const operator = FILTER_OPERATOR_LABELS[filter.operator] ?? "Contains";
  if (!filterOperatorNeedsValue(filter.operator)) {
    return `${filter.label} ${operator.toLowerCase()}`;
  }
  return `${filter.label} ${operator.toLowerCase()} ${databaseFilterValueLabel(
    filter,
    properties,
  )}`;
}

function databaseFilterPropertyForKey(
  key: string,
  properties: DocumentProperty[],
) {
  if (key === "name") return null;
  return properties.find((property) => property.definition.id === key) ?? null;
}

export function normalizeClientDatabaseRowDensity(
  value: unknown,
): DatabaseRowDensity {
  if (value === "compact" || value === "comfortable") return value;
  return "default";
}

export function normalizeClientDatabaseOpenPagesIn(
  value: unknown,
): ContentDatabaseOpenPagesIn {
  return value === "full_page" ? "full_page" : "preview";
}

export function normalizeClientDatabaseFilterMode(
  value: unknown,
): DatabaseFilterMode {
  return value === "or" ? "or" : "and";
}

export function databaseTableRowDensityClass(rowDensity: DatabaseRowDensity) {
  if (rowDensity === "compact") return "min-h-8";
  if (rowDensity === "comfortable") return "min-h-12";
  return "min-h-9";
}

export function databaseTableCellDensityClass(rowDensity: DatabaseRowDensity) {
  if (rowDensity === "compact") return "px-2 py-0.5";
  if (rowDensity === "comfortable") return "px-2.5 py-2";
  return "px-2 py-1";
}

function databaseRowNameCellDensityClass(rowDensity: DatabaseRowDensity) {
  if (rowDensity === "compact") return "px-1 py-0.5";
  if (rowDensity === "comfortable") return "px-1.5 py-2";
  return "px-1 py-1";
}

function databaseTitleButtonDensityClass(
  rowDensity: DatabaseRowDensity,
  wrapCells: boolean,
) {
  if (wrapCells) {
    if (rowDensity === "compact") return "min-h-6 py-0.5";
    if (rowDensity === "comfortable") return "min-h-9 py-1.5";
    return "min-h-7 py-1";
  }
  if (rowDensity === "compact") return "h-6";
  if (rowDensity === "comfortable") return "h-8";
  return "h-7";
}

export function databaseGroupIsCollapsed(
  collapsedGroupIds: string[] | null | undefined,
  groupId: string,
) {
  return (collapsedGroupIds ?? []).includes(groupId);
}

function DatabaseGroupedTableSection({
  group,
  properties,
  columnWidths,
  databaseDocumentId,
  canEdit,
  selectedIdSet,
  wrapCells,
  rowDensity,
  isCreating,
  focusedTitleDocumentId,
  collapsed,
  onCreateRow,
  onTitleFocusHandled,
  onCollapsedChange,
  onToggleCheckbox,
  onToggleRowSelection,
  onPreview,
  onDeletedPreviewItem,
  onOpenPage,
}: {
  group: DatabaseBoardGroup;
  properties: DocumentProperty[];
  columnWidths: Record<string, number>;
  databaseDocumentId: string;
  canEdit: boolean;
  selectedIdSet: Set<string>;
  wrapCells: boolean;
  rowDensity: DatabaseRowDensity;
  isCreating: boolean;
  focusedTitleDocumentId: string | null;
  collapsed: boolean;
  onCreateRow: (
    group: DatabaseBoardGroup,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
  onTitleFocusHandled: () => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onToggleCheckbox: (
    item: ContentDatabaseItem,
    property: DocumentProperty,
  ) => Promise<void>;
  onToggleRowSelection: (itemId: string) => void;
  onPreview: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onOpenPage: (item: ContentDatabaseItem) => void;
}) {
  return (
    <section>
      <DatabaseGroupHeader
        group={group}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
      />
      {!collapsed ? (
        <>
          {group.items.map((item, index) => (
            <DatabaseTableRow
              key={`${group.id}-${item.id}`}
              item={item}
              properties={properties}
              columnWidths={columnWidths}
              databaseDocumentId={databaseDocumentId}
              canEdit={canEdit}
              rowIndex={index}
              canReorder={false}
              canDragRow={false}
              canMoveUp={false}
              canMoveDown={false}
              selected={selectedIdSet.has(item.id)}
              isDragging={false}
              isDropTarget={false}
              startEditingTitle={focusedTitleDocumentId === item.document.id}
              wrapCells={wrapCells}
              rowDensity={rowDensity}
              onDragHandlePointerDown={() => undefined}
              onToggleCheckbox={(property) =>
                void onToggleCheckbox(item, property)
              }
              onToggleSelected={() => onToggleRowSelection(item.id)}
              onPreviewItem={onPreview}
              onDeletedPreviewItem={onDeletedPreviewItem}
              onTitleEditStarted={onTitleFocusHandled}
              onPreview={() => onPreview(item)}
              onOpenPage={() => onOpenPage(item)}
            />
          ))}
          {canEdit ? (
            <NewDatabaseRow
              properties={properties}
              columnWidths={columnWidths}
              rowDensity={rowDensity}
              disabled={isCreating}
              isPending={isCreating}
              onCreate={(title) => onCreateRow(group, title)}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function DatabaseTableRow({
  item,
  properties,
  columnWidths,
  databaseDocumentId,
  canEdit,
  rowIndex,
  canReorder,
  canDragRow,
  canMoveUp,
  canMoveDown,
  selected,
  isDragging,
  isDropTarget,
  startEditingTitle,
  wrapCells,
  rowDensity,
  onDragHandlePointerDown,
  onToggleCheckbox,
  onToggleSelected,
  onPreviewItem,
  onDeletedPreviewItem,
  onTitleEditStarted,
  onPreview,
  onOpenPage,
}: {
  item: ContentDatabaseItem;
  properties: ContentDatabaseItem["properties"];
  columnWidths: Record<string, number>;
  databaseDocumentId: string;
  canEdit: boolean;
  rowIndex: number;
  canReorder: boolean;
  canDragRow: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  selected: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  startEditingTitle: boolean;
  wrapCells: boolean;
  rowDensity: DatabaseRowDensity;
  onDragHandlePointerDown: (event: ReactPointerEvent) => void;
  onToggleCheckbox: (property: DocumentProperty) => void;
  onToggleSelected: () => void;
  onPreviewItem: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onTitleEditStarted: () => void;
  onPreview: () => void;
  onOpenPage: () => void;
}) {
  return (
    <div
      className={cn(
        "group grid border-t border-border/45 transition-colors",
        databaseTableRowDensityClass(rowDensity),
        selected && "bg-muted/20",
        isDragging && "opacity-50",
        isDropTarget && "bg-accent/50 ring-1 ring-inset ring-ring/50",
      )}
      data-database-row-id={item.id}
      style={{
        gridTemplateColumns: databaseGridColumns(
          properties,
          canEdit,
          columnWidths,
        ),
      }}
    >
      <RowNameCell
        item={item}
        databaseDocumentId={databaseDocumentId}
        canEdit={canEdit}
        canDragRow={canDragRow}
        selected={selected}
        startEditingTitle={startEditingTitle}
        wrapCells={wrapCells}
        rowDensity={rowDensity}
        onDragHandlePointerDown={onDragHandlePointerDown}
        onToggleSelected={onToggleSelected}
        onTitleEditStarted={onTitleEditStarted}
        onPreview={onPreview}
      />
      {properties.map((property) => {
        const itemProperty =
          item.properties.find(
            (candidate) => candidate.definition.id === property.definition.id,
          ) ?? property;

        const value = (
          <div
            className={cn(
              "min-h-5 min-w-0 text-sm",
              wrapCells
                ? "whitespace-normal break-words"
                : "truncate whitespace-nowrap",
              isEmptyPropertyValue(itemProperty.value) && "text-transparent",
            )}
          >
            {databaseTableCellDisplayValue(itemProperty)}
          </div>
        );
        const isEditableCheckbox =
          canEdit &&
          itemProperty.editable &&
          itemProperty.definition.type === "checkbox";

        return (
          <div
            key={property.definition.id}
            className={cn(
              "flex min-w-0 border-r border-border/55 last:border-r-0 hover:bg-muted/30",
              databaseTableCellDensityClass(rowDensity),
              wrapCells ? "items-start" : "items-center",
            )}
          >
            {isEditableCheckbox ? (
              <button
                type="button"
                aria-label={`${itemProperty.value === true ? "Uncheck" : "Check"} ${
                  itemProperty.definition.name
                }`}
                className="flex min-h-6 w-full min-w-0 items-center rounded px-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onToggleCheckbox(itemProperty)}
              >
                {value}
              </button>
            ) : canEdit && itemProperty.editable ? (
              <PropertyValuePopover
                property={itemProperty}
                documentId={item.document.id}
              >
                {value}
              </PropertyValuePopover>
            ) : (
              value
            )}
          </div>
        );
      })}
      {canEdit ? (
        <RowActionsCell
          item={item}
          databaseDocumentId={databaseDocumentId}
          rowIndex={rowIndex}
          canReorder={canReorder}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onPreviewItem={onPreviewItem}
          onDeletedPreviewItem={onDeletedPreviewItem}
          onOpenPage={onOpenPage}
        />
      ) : null}
    </div>
  );
}

function RowActionsCell({
  item,
  databaseDocumentId,
  onPreviewItem,
  onDeletedPreviewItem,
  onOpenPage,
}: {
  item: ContentDatabaseItem;
  databaseDocumentId: string;
  rowIndex: number;
  canReorder: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  showReorderActions?: boolean;
  onPreviewItem?: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem?: (item: ContentDatabaseItem) => boolean;
  onOpenPage: () => void;
}) {
  const queryClient = useQueryClient();
  const deleteDocument = useDeleteDocument();
  const duplicateItem = useDuplicateDatabaseItem(databaseDocumentId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const title = item.document.title || "Untitled";

  async function duplicateRow() {
    setMenuOpen(false);
    try {
      const response = await duplicateItem.mutateAsync({ itemId: item.id });
      const duplicatedItem = databaseDuplicatedItemFromResponse(response);
      if (duplicatedItem) onPreviewItem?.(duplicatedItem);
    } catch (err) {
      toast.error("Failed to duplicate row", {
        description:
          err instanceof Error ? err.message : "Something went wrong",
      });
    }
  }

  async function deleteRow() {
    const previewMoved = onDeletedPreviewItem?.(item) ?? false;
    try {
      await deleteDocument.mutateAsync({ id: item.document.id });
      await queryClient.invalidateQueries({
        queryKey: [
          "action",
          "get-content-database",
          { documentId: databaseDocumentId },
        ],
      });
      await queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
    } catch (err) {
      if (previewMoved) onPreviewItem?.(item);
      toast.error("Failed to delete row", {
        description:
          err instanceof Error ? err.message : "Something went wrong",
      });
    }
  }

  return (
    <div className="flex items-center justify-center">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Row actions for ${title}`}
            className="flex size-7 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
          >
            <IconDots className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setMenuOpen(false);
              onOpenPage();
            }}
          >
            <IconExternalLink className="mr-2 size-4 text-muted-foreground" />
            Open page
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={duplicateItem.isPending}
            onSelect={(event) => {
              event.preventDefault();
              void duplicateRow();
            }}
          >
            <IconCopy className="mr-2 size-4 text-muted-foreground" />
            Duplicate row
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            onSelect={(event) => {
              event.preventDefault();
              setMenuOpen(false);
              setConfirmDeleteOpen(true);
            }}
          >
            <IconTrash className="mr-2 size-4" />
            Delete row
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete row?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{title}&rdquo; and any sub-pages will be permanently
              deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteDocument.isPending}
              onClick={() => void deleteRow()}
            >
              {deleteDocument.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RowNameCell({
  item,
  databaseDocumentId,
  canEdit,
  canDragRow,
  selected,
  startEditingTitle,
  wrapCells,
  rowDensity,
  onDragHandlePointerDown,
  onToggleSelected,
  onTitleEditStarted,
  onPreview,
}: {
  item: ContentDatabaseItem;
  databaseDocumentId: string;
  canEdit: boolean;
  canDragRow: boolean;
  selected: boolean;
  startEditingTitle: boolean;
  wrapCells: boolean;
  rowDensity: DatabaseRowDensity;
  onDragHandlePointerDown: (event: ReactPointerEvent) => void;
  onToggleSelected: () => void;
  onTitleEditStarted: () => void;
  onPreview: () => void;
}) {
  const queryClient = useQueryClient();
  const updateDocument = useUpdateDocument();
  const [title, setTitle] = useState(item.document.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const rowTitleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle(item.document.title);
    setEditingTitle(false);
  }, [item.document.id, item.document.title]);

  useEffect(() => {
    if (!startEditingTitle) return;
    setEditingTitle(true);
    onTitleEditStarted();
  }, [onTitleEditStarted, startEditingTitle]);

  useEffect(() => {
    if (!editingTitle) return;
    const frame = requestAnimationFrame(() => {
      rowTitleInputRef.current?.focus();
      rowTitleInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editingTitle]);

  async function saveTitle(nextTitle: string) {
    if (!canEdit) return;
    setEditingTitle(false);
    if (nextTitle === item.document.title) return;
    await updateDocument.mutateAsync({
      id: item.document.id,
      title: nextTitle,
    });
    await queryClient.invalidateQueries({
      queryKey: [
        "action",
        "get-content-database",
        { documentId: databaseDocumentId },
      ],
    });
    await queryClient.invalidateQueries({
      queryKey: ["action", "list-documents"],
    });
  }

  function cancelTitleEdit() {
    setTitle(item.document.title);
    setEditingTitle(false);
  }

  return (
    <div
      className={cn(
        "group group/name flex min-w-0 gap-1 border-r border-border/55 hover:bg-muted/30",
        databaseRowNameCellDensityClass(rowDensity),
        wrapCells ? "items-start" : "items-center",
      )}
    >
      <DatabaseRowSelectionControl
        checked={selected}
        quietUntilHover
        label={`${selected ? "Deselect" : "Select"} ${item.document.title || "Untitled"}`}
        onToggle={onToggleSelected}
      />
      {canDragRow ? (
        <button
          type="button"
          aria-label={`Drag ${item.document.title || "Untitled"}`}
          className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground active:cursor-grabbing group-hover/name:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={onDragHandlePointerDown}
        >
          <IconGripVertical className="size-3.5" />
        </button>
      ) : (
        <span className="size-6 shrink-0" aria-hidden="true" />
      )}
      <DatabaseItemPageIcon
        document={item.document}
        className="size-4 text-sm"
        fallbackClassName="size-4"
      />
      {canEdit && editingTitle ? (
        <input
          ref={rowTitleInputRef}
          aria-label={`Inline title for ${item.document.title || "Untitled"}`}
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={(event) => void saveTitle(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void saveTitle(event.currentTarget.value);
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelTitleEdit();
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-sm bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground/70 focus:bg-background focus:ring-1 focus:ring-ring"
          placeholder="Untitled"
        />
      ) : (
        <button
          type="button"
          className={cn(
            "flex min-w-0 flex-1 items-center rounded-sm px-1 text-left text-sm hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            databaseTitleButtonDensityClass(rowDensity, wrapCells),
          )}
          onClick={onPreview}
          aria-label={`Open ${item.document.title || "Untitled"} preview`}
        >
          <span
            className={cn(
              "min-w-0",
              wrapCells
                ? "whitespace-normal break-words"
                : "truncate whitespace-nowrap",
              !item.document.title && "text-muted-foreground/70",
            )}
          >
            {item.document.title || "Untitled"}
          </span>
        </button>
      )}
      {canEdit && !editingTitle ? (
        <button
          type="button"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/name:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setEditingTitle(true)}
          aria-label={`Edit title for ${item.document.title || "Untitled"}`}
        >
          <IconPencil className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
