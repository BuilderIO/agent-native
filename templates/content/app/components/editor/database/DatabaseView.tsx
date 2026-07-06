import { agentNativePath, getBrowserTabId } from "@agent-native/core/client";
import {
  type ContentDatabaseItem,
  type ContentDatabaseResponse,
  type ContentDatabaseSource,
  type ContentDatabaseSourceReviewPayload,
  type ContentDatabaseView,
  type ContentDatabaseViewConfig,
  type ContentDatabaseColumnCalculation,
  type ContentDatabaseFilter,
  type ContentDatabaseFilterMode,
  type ContentDatabaseFilterOperator,
  type ContentDatabaseOpenPagesIn,
  type ContentDatabaseRowDensity,
  type ContentDatabaseSort,
  type ContentDatabaseSortDirection,
  type ContentDatabaseViewType,
  type Document,
  type DocumentProperty,
  type DocumentPropertyOption,
  type DocumentPropertyType,
  type DocumentPropertyValue,
} from "@shared/api";
import {
  type DocumentPropertyOptionColor,
  countWords,
  documentPropertyDateKey,
  documentPropertyDatePart,
  evaluateNormalizationFormula,
  formatWordCount,
  formulaValueText,
  isComputedPropertyType,
  isEmptyPropertyValue,
} from "@shared/properties";
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconAdjustmentsHorizontal,
  IconArrowsDiagonal,
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
  IconLock,
  IconMinus,
  IconPlus,
  IconPlugConnected,
  IconPalette,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconTable,
  IconTimeline,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useAddDatabaseItem,
  useAttachContentDatabaseSource,
  useChangeContentDatabaseSourceRole,
  useContentDatabase,
  contentDatabaseQueryKey,
  useDeleteDatabaseItems,
  useDisconnectContentDatabaseSource,
  useDuplicateDatabaseItem,
  useDuplicateDatabaseItems,
  useExecuteBuilderSourceExecution,
  useMoveDatabaseItem,
  usePrepareBuilderSourceReview,
  useProcessBuilderBodyHydration,
  useRefreshContentDatabaseSource,
  useSetContentDatabaseSourceWriteMode,
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

import {
  BuilderSourceReviewDialog,
  type BuilderReviewPublicationTransitions,
} from "../database-sources/BuilderSourceReviewDialog";
import { DocumentBlockFields } from "../DocumentBlockFields";
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
} from "../DocumentProperties";
import { EmojiPicker } from "../EmojiPicker";
import { createPreviewDocumentSaveController } from "../previewDocumentSaveController";
import {
  acquirePreviewDocumentSaveController,
  peekPreviewDocumentSaveController,
  releasePreviewDocumentSaveController,
} from "../previewDocumentSaveRegistry";
import { VisualEditor } from "../VisualEditor";
import {
  databaseCalculationOptionsForProperty,
  databaseColumnCalculationResult,
  databaseFooterVisibleCount,
  databaseResultCountLabel,
  databaseViewHasNoMatchingPages,
} from "./calculations";
import {
  calendarDateKey,
  startOfMonth,
  databaseCalendarItemsByDate,
  databaseCalendarMonthDays,
  databaseDateViewRange,
  databaseItemsWithoutDateValue,
  databaseScreenVisibleItems,
  databaseTimelineDays,
  databaseTimelineEndDateProperty,
  databaseTimelineItemSpans,
  databaseTimelineRangeLabel,
  type DatabaseDateViewRange,
} from "./calendar-timeline";
import {
  activeDatabaseConstraintCount,
  appendDatabaseFilter,
  applyDatabaseView,
  clearDatabaseFiltersForColumn,
  clearDatabaseSort,
  FILTER_OPERATOR_LABELS,
  databaseColumnHeaderState,
  databaseColumnHeaderStateLabel,
  databaseFilterChipLabel,
  databaseFilterOptionChoices,
  databaseFilterOptionPropertyForKey,
  databaseFilterValueLabel,
  databasePropertyValuesForNewItem,
  databaseQuickFilterOptionsForColumn,
  databaseRowNameCellDensityClass,
  databaseTableCellDensityClass,
  databaseTableRowDensityClass,
  databaseTitleButtonDensityClass,
  defaultDatabaseFilter,
  defaultDatabaseSort,
  defaultFilterOperatorForKey,
  filterOperatorNeedsValue,
  filterOperatorsForKey,
  filterPropertyTypeForKey,
  filterValueInputType,
  filterValuePlaceholder,
  isActiveFilter,
  moveDatabaseFilter,
  moveDatabaseSort,
  upsertDatabaseQuickFilter,
  upsertDatabaseSort,
  type DatabaseConditionMoveDirection,
} from "./filter-sort";
import {
  CALENDAR_WEEKDAYS,
  boardGroupValueForProperty,
  databaseBoardCanCreateGroup,
  databaseBoardCanManageGroup,
  databaseBoardGroupableProperties,
  databaseBoardGroupingProperty,
  databaseBoardGroups,
  databaseBoardOptionForGroup,
  databaseBoardVisibleCardProperties,
  databaseCalendarDateProperties,
  databaseCalendarDateProperty,
  databaseViewGroupableProperties,
  databaseViewGroupingProperty,
  databaseViewItemGroups,
  databaseVisibleGroups,
} from "./grouping";
import {
  databaseBulkEditableProperties,
  databaseBulkScalarInputState,
  databaseDuplicatedItemFromResponse,
  databaseItemPreviewFallbackAfterBulkDelete,
  databaseItemPreviewFallbackAfterDelete,
  databaseItemPreviewNeighbor,
  databaseItemPreviewPosition,
  databaseItemPreviewTitle,
  databaseNavigationState,
  databaseSelectedItems,
  pruneDatabaseRowSelection,
  toggleAllDatabaseRowSelection,
  toggleDatabaseRowSelection,
} from "./navigation-state";
import {
  DatabaseGroupMenu,
  DatabasePropertyPickerSubContent,
  DatabaseSettingsPanelSheet,
  buildClientBuilderReviewPayload,
  builderReviewExecutableRows,
  builderReviewableChangeSets,
  databaseFilterModeLabel,
  databaseFilterModePhrase,
  formatSourceTimestamp,
  sourceFieldMappingForColumn,
  type DatabaseSettingsPanel,
} from "./settings";
import {
  DatabaseDragPreview,
  DatabaseDropIndicator,
  DatabaseItemPageIcon,
  databaseItemPageIconText,
  databasePropertyPickerItems,
  databaseToolbarIconButtonClass,
  databaseViewIcon,
} from "./shared";
import { dbText } from "./text";
import {
  activeDatabaseView,
  addDatabaseView,
  databaseViewDefaultName,
  databaseViewStateKey,
  defaultDatabaseViewConfig,
  deleteDatabaseView,
  duplicateDatabaseView,
  normalizeClientDatabaseViewConfig,
  renameDatabaseView,
  reorderDatabaseView,
  selectDatabaseView,
  updateActiveDatabaseView,
  updateDatabaseViewType,
} from "./view-config";
import {
  databaseGroupIsCollapsed,
  isDatabasePropertyVisibleInView,
  moveDatabaseViewProperty,
  orderDatabasePropertiesForView,
  reorderDatabaseViewProperty,
  setDatabaseViewCollapsedGroup,
  setDatabaseViewCollapsedGroups,
  setDatabaseViewColumnCalculation,
  setDatabaseViewGroupByProperty,
  setDatabaseViewHiddenPropertyIds,
  type DatabasePropertyMoveDirection,
} from "./view-state";

export {
  calendarDateKey,
  databaseCalendarItemsByDate,
  databaseCalendarMonthDays,
  databaseDateViewRange,
  databaseItemsWithoutDateValue,
  databaseScreenVisibleItems,
  databaseTimelineDays,
  databaseTimelineItemSpans,
} from "./calendar-timeline";
export type {
  DatabaseDateViewRange,
  DatabaseTimelineSpan,
} from "./calendar-timeline";
export {
  databaseCalculationOptionsForProperty,
  databaseCalculationSummaries,
  databaseColumnCalculationResult,
  databaseFooterVisibleCount,
  databaseResultCountLabel,
  databaseViewHasNoMatchingPages,
} from "./calculations";
export {
  activeDatabaseConstraintCount,
  appendDatabaseFilter,
  applyDatabaseView,
  clearDatabaseFiltersForColumn,
  clearDatabaseSort,
  databaseColumnHeaderState,
  databaseFilterOptionChoices,
  databaseFilterOptionPropertyForKey,
  databasePropertyValuesForNewItem,
  databaseQuickFilterOptionsForColumn,
  databaseTableCellDensityClass,
  databaseTableRowDensityClass,
  moveDatabaseFilter,
  moveDatabaseSort,
  upsertDatabaseQuickFilter,
  upsertDatabaseSort,
} from "./filter-sort";
export type { DatabaseConditionMoveDirection } from "./filter-sort";
export {
  boardGroupValueForProperty,
  databaseBoardCanCreateGroup,
  databaseBoardCanManageGroup,
  databaseBoardGroups,
  databaseBoardOptionForGroup,
  databaseBoardVisibleCardProperties,
  databaseCalendarDateProperties,
  databaseCalendarDateProperty,
  databaseViewGroupableProperties,
  databaseViewItemGroups,
  databaseVisibleGroups,
} from "./grouping";
export {
  DATABASE_NAVIGATION_VISIBLE_ITEM_LIMIT,
  databaseBulkEditableProperties,
  databaseBulkScalarInputState,
  databaseDuplicatedItemFromResponse,
  databaseItemPreviewFallbackAfterBulkDelete,
  databaseItemPreviewFallbackAfterDelete,
  databaseItemPreviewNeighbor,
  databaseItemPreviewPosition,
  databaseItemPreviewTitle,
  databaseNavigationState,
  databaseSelectedItems,
  databaseViewSummaries,
  databaseVisibleItemSummaries,
  pruneDatabaseRowSelection,
  toggleAllDatabaseRowSelection,
  toggleDatabaseRowSelection,
} from "./navigation-state";
export type { DatabasePreviewNeighborDirection } from "./navigation-state";
export {
  databaseItemPageIconText,
  databasePropertyPickerItems,
} from "./shared";
export {
  DatabaseGroupMenu,
  DatabasePropertyPickerSubContent,
  DatabaseSettingsPanelSheet,
  buildClientBuilderReviewPayload,
  builderReviewExecutableRows,
  builderReviewableChangeSets,
  builderSourceLiveWriteControlState,
  databaseFilterModeLabel,
  databaseFilterModePhrase,
} from "./settings";
export type { DatabaseSettingsPanel } from "./settings";
export {
  activeDatabaseView,
  addDatabaseView,
  createDatabaseView,
  defaultDatabaseViewConfig,
  deleteDatabaseView,
  duplicateDatabaseView,
  moveDatabaseView,
  normalizeClientDatabaseFilterMode,
  normalizeClientDatabaseOpenPagesIn,
  normalizeClientDatabaseRowDensity,
  normalizeClientDatabaseViewConfig,
  renameDatabaseView,
  reorderDatabaseView,
  selectDatabaseView,
  uniqueDatabaseViewName,
  updateActiveDatabaseView,
  updateDatabaseViewType,
} from "./view-config";
export type { DatabaseViewMoveDirection } from "./view-config";
export {
  databaseGroupIsCollapsed,
  isDatabasePropertyVisibleInView,
  moveDatabaseViewProperty,
  orderDatabasePropertiesForView,
  reorderDatabaseViewProperty,
  setDatabaseViewCollapsedGroup,
  setDatabaseViewCollapsedGroups,
  setDatabaseViewColumnCalculation,
  setDatabaseViewGroupByProperty,
  setDatabaseViewHiddenPropertyIds,
} from "./view-state";
export type { DatabasePropertyMoveDirection } from "./view-state";

export interface DatabaseViewProps {
  databaseId: string;
  databaseDocumentId: string;
  hostDocumentId?: string;
  renderMode?: "page" | "inline";
  canEdit?: boolean;
  isActive?: boolean;
  documentOverride?: Document;
}

const CONTENT_DATABASE_PAGE_SIZE = 100;
const CONTENT_DATABASE_MAX_ITEM_LIMIT = 5_000;

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

export function DatabaseView({
  databaseId,
  databaseDocumentId,
  hostDocumentId = databaseDocumentId,
  renderMode = "page",
  canEdit = true,
  isActive,
  documentOverride,
}: DatabaseViewProps) {
  const { data: loadedDocument } = useDocument(
    documentOverride ? null : databaseDocumentId,
  );
  const document = documentOverride ?? loadedDocument;

  if (!document?.database || document.database.id !== databaseId) return null;

  return (
    <DatabaseTable
      document={document}
      databaseDocumentId={databaseDocumentId}
      databaseId={databaseId}
      hostDocumentId={hostDocumentId}
      renderMode={renderMode}
      canEdit={canEdit}
      isActive={isActive ?? renderMode === "page"}
    />
  );
}

function DatabaseTable({
  document,
  databaseId: expectedDatabaseId,
  databaseDocumentId,
  hostDocumentId,
  renderMode,
  canEdit,
  isActive,
}: {
  document: Document;
  databaseId: string;
  databaseDocumentId: string;
  hostDocumentId: string;
  renderMode: "page" | "inline";
  canEdit: boolean;
  isActive: boolean;
}) {
  const navigate = useNavigate();
  const [databaseItemLimit, setDatabaseItemLimit] = useState(
    CONTENT_DATABASE_PAGE_SIZE,
  );
  const database = useContentDatabase(document.id, databaseItemLimit);
  const addItem = useAddDatabaseItem(document.id);
  const attachSource = useAttachContentDatabaseSource(document.id);
  const changeSourceRole = useChangeContentDatabaseSourceRole(document.id);
  const refreshSource = useRefreshContentDatabaseSource(document.id);
  const disconnectSource = useDisconnectContentDatabaseSource(document.id);
  const processBuilderBodies = useProcessBuilderBodyHydration(document.id);
  const prepareBuilderReview = usePrepareBuilderSourceReview(document.id);
  const executeBuilderExecution = useExecuteBuilderSourceExecution(document.id);
  const setSourceWriteMode = useSetContentDatabaseSourceWriteMode(document.id);
  const setProperty = useSetDocumentProperty(document.id, document.id);
  const updateView = useUpdateContentDatabaseView(document.id);
  const data = database.data;
  const properties = data?.properties ?? [];
  const items = data?.items ?? [];
  const totalItemCount = data?.pagination?.totalItems ?? items.length;
  const hasMoreItems =
    data?.pagination?.hasMore === true &&
    databaseItemLimit < CONTENT_DATABASE_MAX_ITEM_LIMIT;
  const isLoadingMoreItems =
    database.isFetching && data?.pagination?.limit !== databaseItemLimit;
  const databaseId = data?.database.id ?? expectedDatabaseId;
  const source = data?.source ?? null;
  const sources = data?.sources ?? (source ? [source] : []);
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
  const [builderReviewOpen, setBuilderReviewOpen] = useState(false);
  const [builderReviewResult, setBuilderReviewResult] =
    useState<ContentDatabaseSourceReviewPayload | null>(null);
  const [builderReviewCheckedAt, setBuilderReviewCheckedAt] = useState<
    string | null
  >(null);
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
  const builderReviewChangeSets = useMemo(
    () => builderReviewableChangeSets(source),
    [source],
  );
  const builderReviewPreview = useMemo(
    () =>
      source?.sourceType === "builder-cms" && builderReviewChangeSets.length > 0
        ? buildClientBuilderReviewPayload(source, builderReviewChangeSets)
        : null,
    [builderReviewChangeSets, source],
  );
  const activeBuilderReview = builderReviewResult ?? builderReviewPreview;

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
    if (!databaseId || !isActive) return;
    const state = databaseNavigationState({
      document,
      databaseId,
      databaseDocumentId: document.id,
      hostDocumentId,
      renderMode,
      source,
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
      totalItemCount,
      selectedItems,
      previewItem,
    });
    fetch(
      agentNativePath(
        `/_agent-native/application-state/navigation:${getBrowserTabId()}`,
      ),
      {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      },
    ).catch(() => {});
  }, [
    activeView,
    activeFilters.length,
    databaseId,
    dateViewRange,
    document,
    hostDocumentId,
    isActive,
    renderMode,
    activeFilters,
    totalItemCount,
    orderedProperties,
    previewItem,
    searchQuery,
    selectedItems,
    source,
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

  async function handleBuilderReviewPush(
    transitions: BuilderReviewPublicationTransitions = {},
  ) {
    setBuilderReviewResult(null);
    setBuilderReviewCheckedAt(null);
    try {
      const prepared = await prepareBuilderReview.mutateAsync({
        documentId: document.id,
        pushModeConfirmation: "autosave",
      });
      let nextReview = prepared.review;

      if (
        nextReview.liveWritesEnabled &&
        nextReview.result.status === "validated"
      ) {
        const executableRows = builderReviewExecutableRows(nextReview);
        let executedResponse: ContentDatabaseResponse | null = null;
        for (const row of executableRows) {
          if (!row.execution?.idempotencyKey) continue;
          const transition = transitions[row.changeSetId];
          executedResponse = await executeBuilderExecution.mutateAsync({
            documentId: document.id,
            changeSetId: row.changeSetId,
            idempotencyKey: row.execution.idempotencyKey,
            pushModeConfirmation: nextReview.pushMode,
            publicationTransition: transition?.publicationTransition,
            confirmUnpublish: transition?.confirmUnpublish,
          });
        }
        const executedSource = executedResponse?.source ?? null;
        if (executedSource) {
          const reviewedIds = new Set(
            nextReview.rows.map((row) => row.changeSetId),
          );
          const reviewedChangeSets = executedSource.changeSets.filter(
            (changeSet) => reviewedIds.has(changeSet.id),
          );
          if (reviewedChangeSets.length > 0) {
            nextReview = buildClientBuilderReviewPayload(
              executedSource,
              reviewedChangeSets,
            );
          }
        }
      }

      setBuilderReviewResult(nextReview);
      setBuilderReviewCheckedAt(new Date().toISOString());
      toast.success(
        nextReview.result.status === "succeeded"
          ? "Builder update pushed"
          : "Builder update checked",
        {
          description: nextReview.result.message,
        },
      );
    } catch (error) {
      toast.error(dbText("builderUpdateFailed"), {
        description:
          error instanceof Error ? error.message : dbText("tryAgain"),
      });
    }
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
    const nextKey = databaseViewStateKey(data.database.id, nextViewConfig);
    if (hydratedViewRef.current === nextKey) return;
    hydratedViewRef.current = nextKey;
    setViewConfig((current) =>
      databaseViewStateKey(data.database.id, current) === nextKey
        ? current
        : nextViewConfig,
    );
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
                aria-label={dbText("closeSearch")}
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
          {renderMode === "inline" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={dbText("openAsFullPage")}
                  className={databaseToolbarIconButtonClass()}
                  onClick={() => navigate(`/page/${databaseDocumentId}`)}
                >
                  <IconArrowsDiagonal className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{dbText("openAsFullPage")}</TooltipContent>
            </Tooltip>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={
              builderReviewChangeSets.length > 0
                ? `Database settings, ${builderReviewChangeSets.length} Builder update pending`
                : "Database settings"
            }
            title={
              builderReviewChangeSets.length > 0
                ? `${builderReviewChangeSets.length} Builder update pending`
                : "Database settings"
            }
            className={cn(
              databaseToolbarIconButtonClass(
                settingsOpen ||
                  activeView.wrapCells === true ||
                  hiddenProperties.length > 0 ||
                  Boolean(activeView.groupByPropertyId) ||
                  builderReviewChangeSets.length > 0,
              ),
              "relative",
            )}
            onClick={() => {
              setSettingsPanel("main");
              setSettingsOpen((open) => !open);
            }}
          >
            <IconAdjustmentsHorizontal className="size-3.5" />
            {builderReviewChangeSets.length > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-foreground text-[9px] leading-none text-background">
                {builderReviewChangeSets.length}
              </span>
            ) : null}
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
          source={source}
          sources={sources}
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
          totalCount={totalItemCount}
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

      {hasMoreItems ? (
        <div className="flex items-center justify-center border-t border-border/45 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isLoadingMoreItems}
            onClick={() =>
              setDatabaseItemLimit((current) =>
                Math.min(
                  current + CONTENT_DATABASE_PAGE_SIZE,
                  totalItemCount,
                  CONTENT_DATABASE_MAX_ITEM_LIMIT,
                ),
              )
            }
          >
            {isLoadingMoreItems
              ? "Loading..."
              : `Load more rows (${items.length} of ${totalItemCount})`}
          </Button>
        </div>
      ) : null}

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

      <DatabaseSettingsPanelSheet
        open={settingsOpen}
        panel={settingsPanel}
        documentId={document.id}
        canEdit={canEdit}
        activeView={activeView}
        properties={orderedProperties}
        items={items}
        source={source}
        sources={sources}
        hiddenCount={hiddenProperties.length}
        groupIds={toolbarGroups.map((group) => group.id)}
        onClose={() => setSettingsOpen(false)}
        onPanelChange={setSettingsPanel}
        onAttachBuilderSource={(model, relationshipMode) =>
          attachSource.mutateAsync({
            documentId: document.id,
            sourceType: "builder-cms",
            sourceName: model.displayName,
            sourceTable: model.name,
            relationshipMode,
            mode:
              relationshipMode === "items"
                ? "add"
                : sources.length > 0 || source
                  ? undefined
                  : "replace",
          })
        }
        onFederateSource={(candidate, join) =>
          attachSource.mutateAsync({
            documentId: document.id,
            sourceType: candidate.sourceType,
            sourceName: candidate.sourceName,
            sourceTable: candidate.sourceTable,
            relationshipMode: "details",
            join,
          })
        }
        onChangeSourceRole={(sourceId, relationshipMode, join) =>
          changeSourceRole.mutateAsync({
            documentId: document.id,
            sourceId,
            relationshipMode,
            join,
          })
        }
        onDisconnectSecondary={(sourceId) =>
          disconnectSource.mutate({ documentId: document.id, sourceId })
        }
        onRefreshSource={(sourceId) =>
          refreshSource.mutate({
            documentId: document.id,
            sourceId,
          })
        }
        onHydrateBuilderBodies={(sourceId) =>
          processBuilderBodies.mutate({ sourceId })
        }
        onDisconnectSource={(sourceId) =>
          disconnectSource.mutate(
            {
              documentId: document.id,
              sourceId,
            },
            {
              onSuccess: () => {
                setSettingsPanel("source");
                setBuilderReviewOpen(false);
                setBuilderReviewResult(null);
                setBuilderReviewCheckedAt(null);
                toast.success(dbText("sourceDisconnected"), {
                  description: dbText(
                    "databaseRowsAndLocalPropertiesWereKeptIntact",
                  ),
                });
              },
              onError: (error) => {
                toast.error(dbText("sourceWasNotDisconnected"), {
                  description:
                    error instanceof Error ? error.message : dbText("tryAgain"),
                });
              },
            },
          )
        }
        onReviewBuilderUpdate={() => {
          setBuilderReviewResult(null);
          setBuilderReviewCheckedAt(null);
          setBuilderReviewOpen(true);
        }}
        onSetBuilderLiveWrites={(enabled) =>
          setSourceWriteMode.mutate(
            {
              documentId: document.id,
              liveWritesEnabled: enabled,
              allowedWriteModes: enabled ? ["autosave"] : [],
            },
            {
              onSuccess: () => {
                toast.success(
                  enabled
                    ? "Builder live writes enabled"
                    : "Builder live writes disabled",
                  {
                    description: enabled
                      ? "Only autosave writes to the Agent Native test collection can run."
                      : "Push will return to local validation only.",
                  },
                );
              },
              onError: (error) => {
                toast.error(dbText("builderWriteModeWasNotChanged"), {
                  description:
                    error instanceof Error ? error.message : dbText("tryAgain"),
                });
              },
            },
          )
        }
        sourceActionPending={
          attachSource.isPending ||
          changeSourceRole.isPending ||
          refreshSource.isPending ||
          processBuilderBodies.isPending ||
          disconnectSource.isPending ||
          prepareBuilderReview.isPending ||
          executeBuilderExecution.isPending ||
          setSourceWriteMode.isPending
        }
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

      <BuilderSourceReviewDialog
        open={builderReviewOpen}
        review={activeBuilderReview}
        source={source}
        canEdit={canEdit}
        pending={
          prepareBuilderReview.isPending || executeBuilderExecution.isPending
        }
        checkedAt={builderReviewCheckedAt}
        onClose={() => setBuilderReviewOpen(false)}
        onValidate={(transitions) => void handleBuilderReviewPush(transitions)}
      />

      {!database.isLoading ? (
        activeView.type === "table" ? null : (
          <DatabaseResultCountFooter
            visibleCount={databaseFooterVisibleCount(
              activeView.type,
              visibleItems,
              screenVisibleItems,
            )}
            totalCount={totalItemCount}
            constrained={hasResultConstraints}
          />
        )
      ) : null}
    </div>
  );
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
            databaseDocumentId={databaseDocumentId}
            previousItem={previousItem}
            nextItem={nextItem}
            position={position}
            focusTitle={focusTitle}
            onPreviewItem={onPreviewItem}
            onTitleFocused={onTitleFocused}
            onClose={() => onOpenChange(false)}
            onOpenPage={() => onOpenPage(item)}
          />
        ) : (
          <SheetHeader className="sr-only">
            <SheetTitle>{dbText("databasePagePreview")}</SheetTitle>
            <SheetDescription>
              {dbText("noDatabasePageSelected")}
            </SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function previewPayloadsEqual(
  a: { title: string; content: string },
  b: { title: string; content: string },
) {
  return a.title === b.title && a.content === b.content;
}

function retainedPreviewPayload(
  documentId: string,
  serverPayload: { title: string; content: string },
) {
  const controller = peekPreviewDocumentSaveController(documentId);
  if (!controller) return null;
  const dirty = !previewPayloadsEqual(controller.pending, controller.lastSaved);
  const savedAheadOfServer =
    controller.hasSavedLocally &&
    !previewPayloadsEqual(controller.lastSaved, serverPayload);
  return dirty || savedAheadOfServer ? controller.pending : null;
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
  // Seed the displayed title/content from a RETAINED dirty controller's pending
  // edit if one exists for this doc (reopen-before-evict), so an unsaved peek
  // edit is restored on remount instead of showing stale server content; else
  // from the server/item value.
  const [localTitle, setLocalTitle] = useState(() => {
    const retained = retainedPreviewPayload(item.document.id, {
      title: item.document.title,
      content: item.document.content,
    });
    return retained?.title ?? item.document.title;
  });
  const [localContent, setLocalContent] = useState(() => {
    const retained = retainedPreviewPayload(item.document.id, {
      title: item.document.title,
      content: item.document.content,
    });
    return retained?.content ?? item.document.content;
  });
  const [localIcon, setLocalIcon] = useState(item.document.icon);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);

  // The peek's primary title+body save runs through a flush-on-release controller
  // so a pending debounced edit is PERSISTED — not dropped — when the row
  // switches, the editor unmounts, or the sheet closes / Open-page navigates.
  //
  // ONE CONTROLLER PER DOCUMENT ID (mirrors the additional Blocks fields): the
  // peek is a SINGLE component instance whose `item` prop changes on row-switch.
  // Rather than rebasing one controller's target id across rows (which produced a
  // class of timing races), we ACQUIRE a per-doc controller for the current row
  // and RELEASE it on switch. A controller's doc id is fixed for its life, so a
  // flush always lands on the correct document and a stale completion can only
  // ever touch its own row's state. See previewDocumentSaveRegistry.
  const updateDocumentRef = useRef(updateDocument);
  updateDocumentRef.current = updateDocument;
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
  // Doc ids that have been deleted in this peek's lifetime. A pending save must
  // never resurrect a deleted document, so dispatch is suppressed for these.
  const deletedIdsRef = useRef<Set<string>>(new Set());

  const documentId = item.document.id;

  // Build the factory for THIS row's controller. It closes over the stable
  // component-scoped refs (updateDocument, queryClient, deletedIds), so the
  // freshest mutation impl is always used while the controller's save TARGET
  // (`documentId`) is fixed by the registry key.
  const makeController = () =>
    createPreviewDocumentSaveController({
      documentId,
      initial: {
        title: item.document.title,
        content: item.document.content,
      },
      save: (id, payload) =>
        new Promise((resolve, reject) => {
          // A just-deleted doc must not be re-dispatched (resurrection guard).
          if (deletedIdsRef.current.has(id)) {
            resolve(undefined);
            return;
          }
          updateDocumentRef.current.mutate(
            { id, title: payload.title, content: payload.content },
            { onSuccess: () => resolve(undefined), onError: reject },
          );
        }),
      onSaved: () => {
        void queryClientRef.current.invalidateQueries({
          queryKey: contentDatabaseQueryKey(databaseDocumentId),
        });
        void queryClientRef.current.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
      },
      onError: (err) => {
        toast.error(dbText("failedToSavePagePreview"), {
          description:
            err instanceof Error ? err.message : dbText("somethingWentWrong"),
        });
      },
    });

  // Acquire the controller for the current row, and release it on row-switch /
  // unmount. Release flush-then-evicts: the OLD row's latest dirty payload is
  // dispatched SYNCHRONOUSLY (bound to the OLD doc id) before the new row's
  // controller takes over, so a pending edit is persisted, not dropped, and never
  // retargeted. A quick reopen before the flush settles reuses the live instance.
  // The current controller is held in a ref so the change handlers reach it
  // synchronously.
  const saveControllerRef = useRef<ReturnType<typeof makeController> | null>(
    null,
  );
  useEffect(() => {
    saveControllerRef.current = acquirePreviewDocumentSaveController(
      documentId,
      makeController,
    );
    return () => {
      saveControllerRef.current = null;
      releasePreviewDocumentSaveController(documentId);
    };
    // makeController is rebuilt every render but intentionally not a dep: the
    // registry only invokes it on the FIRST acquire of a doc id, and the doc id
    // (the registry key) is the only thing that should drive re-acquire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // Sync displayed state to the current row, and adopt fresh server content
  // (e.g. an agent edit) as the controller's new confirmed baseline. mark()
  // touches only THIS row's controller — never another row's — because the
  // controller's doc id is fixed. The acquire effect above runs first, so the
  // controller for `documentId` is registered before this fires.
  useEffect(() => {
    const nextTitle = document?.title ?? item.document.title;
    const nextContent = document?.content ?? item.document.content;
    const nextIcon = document?.icon ?? item.document.icon;
    // Icon isn't tracked by the title/content save controller, so it can always
    // follow the server.
    setLocalIcon(nextIcon);
    const controller = peekPreviewDocumentSaveController(documentId);
    const serverPayload = { title: nextTitle, content: nextContent };
    const dirty =
      !!controller &&
      !previewPayloadsEqual(controller.pending, controller.lastSaved);
    const savedAheadOfServer =
      !!controller &&
      controller.hasSavedLocally &&
      !previewPayloadsEqual(controller.lastSaved, serverPayload);
    // Only adopt the server's title/content — into BOTH the displayed editor
    // state and the controller baseline — when the user hasn't typed something
    // newer on this row. If a dirty in-progress edit exists, preserve it: don't
    // clobber the visible text (the controller already holds the unsaved edit,
    // so nothing is lost, but the editor must keep showing what the user typed).
    if (!dirty && !savedAheadOfServer) {
      setLocalTitle(nextTitle);
      setLocalContent(nextContent);
      controller?.mark(serverPayload);
    } else if (controller) {
      // A dirty in-progress edit or a clean local save that the query has not
      // echoed yet is newer than stale server props.
      setLocalTitle(controller.pending.title);
      setLocalContent(controller.pending.content);
    }
  }, [
    documentId,
    document?.id,
    document?.title,
    document?.content,
    document?.icon,
    item.document.title,
    item.document.content,
    item.document.icon,
  ]);

  useEffect(() => {
    if (!focusTitle || !canEdit || isLoading || !document) return;

    const frame = requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
      onTitleFocused?.();
    });

    return () => cancelAnimationFrame(frame);
  }, [canEdit, document, focusTitle, isLoading, onTitleFocused]);

  function handleTitleChange(nextTitle: string) {
    setLocalTitle(nextTitle);
    if (!canEdit || !document) return;
    saveControllerRef.current?.changeTitle(nextTitle);
  }

  function handleContentChange(nextContent: string) {
    setLocalContent(nextContent);
    if (!canEdit || !document) return;
    saveControllerRef.current?.changeContent(nextContent);
  }

  function handleIconChange(nextIcon: string | null) {
    if (!canEdit || !document) return;
    setLocalIcon(nextIcon);
    updateDocument.mutate(
      { id: document.id, icon: nextIcon },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: contentDatabaseQueryKey(databaseDocumentId),
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
          toast.error(dbText("failedToSavePageIcon"), {
            description:
              err instanceof Error ? err.message : dbText("somethingWentWrong"),
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
      toast.error(dbText("failedToDuplicateRow"), {
        description:
          err instanceof Error ? err.message : dbText("somethingWentWrong"),
      });
    }
  }

  async function deletePreviewRow() {
    // Cancel (do NOT flush) before any row switch/close: we're deleting this
    // document, so a pending save must not resurrect it. Reset pending onto the
    // last-saved baseline so the controller's release flush is a no-op, and
    // record the id so any save already in flight is a no-op too (the
    // controller's save impl skips deleted ids).
    deletedIdsRef.current.add(item.document.id);
    const controller = saveControllerRef.current;
    if (controller) {
      controller.cancel();
      controller.mark(controller.lastSaved);
    }

    const nextPreviewItem = nextItem ?? previousItem;
    if (nextPreviewItem) {
      onPreviewItem?.(nextPreviewItem);
    } else {
      onClose();
    }

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
      deletedIdsRef.current.delete(item.document.id);
      onPreviewItem?.(item);
      toast.error(dbText("failedToDeleteRow"), {
        description:
          err instanceof Error ? err.message : dbText("somethingWentWrong"),
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
              aria-label={dbText("previousDatabasePage")}
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
              aria-label={dbText("nextDatabasePage")}
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
              {dbText("openPage")}
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
                      {dbText("duplicateRow")}
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
                      {dbText("deleteRow")}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
        <SheetDescription className="sr-only">
          {dbText("previewThisDatabasePageWithoutLeavingTheDatabase")}
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
                aria-label={dbText("previewPageTitle")}
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
              {(() => {
                // The peek's primary "Content" Blocks field is the document body.
                // No collab in the peek (ydoc=null), so it's a plain rich-text
                // editor saving through the preview document save path.
                const primaryEditor = (
                  <VisualEditor
                    key={document.id}
                    documentId={document.id}
                    content={localContent}
                    onChange={handleContentChange}
                    ydoc={null}
                    editable={canEdit}
                  />
                );

                // Render the peek body through the SAME component the full page
                // uses so ALL Blocks fields (Content + any others) appear with
                // identical loading/empty/solo/multi behavior — including the
                // empty state (no editable body when there are zero Blocks
                // fields). Only database rows have Blocks fields.
                if (document.databaseMembership) {
                  return (
                    <DocumentBlockFields
                      documentId={document.id}
                      canEdit={canEdit}
                      primaryEditor={primaryEditor}
                    />
                  );
                }

                return primaryEditor;
              })()}
            </div>
          </div>
        </div>
      )}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dbText("deleteRow2")}</AlertDialogTitle>
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
  source,
  sources,
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
  source: ContentDatabaseSource | null;
  sources: ContentDatabaseSource[];
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
  const duplicateItems = useDuplicateDatabaseItems(databaseDocumentId);
  const setProperty = useSetDocumentProperty(databaseDocumentId);
  const deleteItems = useDeleteDatabaseItems(databaseDocumentId);
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
      toast.error(dbText("failedToMoveRow"), {
        description:
          err instanceof Error ? err.message : dbText("somethingWentWrong"),
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
      toast.error(dbText("failedToUpdateCheckbox"), {
        description:
          err instanceof Error ? err.message : dbText("somethingWentWrong"),
      });
    }
  }

  async function deleteSelectedRows() {
    if (selectedItems.length === 0) return;
    const selectedSnapshot = selectedItems;
    setConfirmDeleteSelectedOpen(false);

    try {
      await deleteItems.mutateAsync({
        documentId: databaseDocumentId,
        itemIds: selectedSnapshot.map((item) => item.id),
      });
      onClearSelection();
      onDeletedPreviewItems(selectedSnapshot);
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
      toast.error(dbText("failedToDeleteSelectedRows"), {
        description:
          err instanceof Error ? err.message : dbText("somethingWentWrong"),
      });
    }
  }

  async function duplicateSelectedRows() {
    if (selectedItems.length === 0 || isDuplicatingSelected) return;
    const selectedSnapshot = selectedItems;
    setIsDuplicatingSelected(true);

    try {
      const response = await duplicateItems.mutateAsync({
        documentId: databaseDocumentId,
        itemIds: selectedSnapshot.map((item) => item.id),
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

      const duplicatedPreviewItem =
        databaseDuplicatedItemFromResponse(response);
      if (duplicatedPreviewItem) onPreview(duplicatedPreviewItem);
      onClearSelection();
    } catch (err) {
      toast.error(dbText("failedToDuplicateEverySelectedRow"), {
        description:
          err instanceof Error ? err.message : dbText("somethingWentWrong"),
      });
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
      toast.error(dbText("failedToUpdateEverySelectedRow"), {
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
              isDuplicatingSelected ||
              duplicateItems.isPending ||
              deleteItems.isPending
            }
            deleteDisabled={deleteItems.isPending}
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
            source={source}
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
                source={source}
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
                label={dbText("addProperty")}
                source={source}
                sources={sources}
              />
            </div>
          ) : null}
        </div>

        {isLoading ? (
          <div className="flex h-16 items-center gap-2 border-t border-border px-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {dbText("loadingDatabase")}
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
                label={dbText("noRowsMatchThisView")}
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
                    databaseDocumentId={databaseDocumentId}
                    properties={properties}
                    columnWidths={columnWidths}
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
            <AlertDialogTitle>{dbText("deleteSelectedRows")}</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedCount} selected row{selectedCount === 1 ? "" : "s"} and
              any sub-pages will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteItems.isPending}
              onClick={() => void deleteSelectedRows()}
            >
              {deleteItems.isPending ? "Deleting..." : "Delete"}
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
        {dbText("clearAll")}
      </Button>
    </div>
  );
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
        {dbText("clearSearchAndFilters")}
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
          {dbText("loadingList")}
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
        aria-label={dbText("newDatabaseListItemTitle")}
        placeholder={dbText("newPage")}
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
          {dbText("loadingGallery")}
        </div>
      ) : (
        <div className="content-database-gallery-grid grid gap-3 px-1 py-3">
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
        <div className="content-database-gallery-grid grid gap-3">
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
          aria-label={dbText("newDatabaseGalleryCardTitle")}
          placeholder={dbText("newPage")}
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
                  {dbText("calendarBy")}
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
            aria-label={dbText("previousMonth")}
            onClick={() => changeMonth(-1)}
          >
            <IconArrowUp className="size-3.5 -rotate-90" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label={dbText("nextMonth")}
            onClick={() => changeMonth(1)}
          >
            <IconArrowUp className="size-3.5 rotate-90" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {dbText("loadingCalendar")}
        </div>
      ) : dateProperties.length === 0 ? (
        <div className="flex min-h-24 items-center justify-between gap-3 px-2 py-4 text-sm text-muted-foreground">
          <span>{dbText("addADatePropertyToUseCalendarView")}</span>
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
          <span className="truncate">{dbText("noDate")}</span>
        </span>
        <span className="rounded bg-background px-1.5 py-0.5 text-[11px]">
          {items.length}
        </span>
      </div>
      <div className="content-database-calendar-undated-grid grid gap-1">
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
                  {dbText("startDate")}
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
                  {dbText("endDate")}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onEndDatePropertyChange(null);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {dbText("noEndDate")}
                  </span>
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
            aria-label={dbText("previousTimelineRange")}
            onClick={() => changeMonth(-1)}
          >
            <IconArrowUp className="size-3.5 -rotate-90" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label={dbText("nextTimelineRange")}
            onClick={() => changeMonth(1)}
          >
            <IconArrowUp className="size-3.5 rotate-90" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {dbText("loadingTimeline")}
        </div>
      ) : dateProperties.length === 0 ? (
        <div className="flex min-h-24 items-center justify-between gap-3 px-2 py-4 text-sm text-muted-foreground">
          <span>{dbText("addADatePropertyToUseTimelineView")}</span>
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
                      "sticky top-0 z-10 grid gap-0.5 border-r border-b border-border bg-background px-2 py-2 last:border-r-0",
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
          placeholder={dbText("newPage")}
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
      toast.error(dbText("failedToMoveCard"), {
        description:
          err instanceof Error ? err.message : dbText("somethingWentWrong"),
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
                {dbText("groupBy")}
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
                    <span className="flex-1">{dbText("hideEmptyGroups")}</span>
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
                    {dbText("collapseAllGroups")}
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
                    {dbText("expandAllGroups")}
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
          {dbText("loadingBoard")}
        </div>
      ) : groupableProperties.length === 0 ? (
        <div className="flex min-h-24 items-center justify-between gap-3 px-2 py-4 text-sm text-muted-foreground">
          <span>{dbText("addAStatusSelectMultiSelectOrCheckbox2")}</span>
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
                          {dbText("noMatchingPages")}
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
                {dbText("groupName")}
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
              {dbText("deleteGroup")}
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
          {!canEdit ? null : (
            <span className="sr-only">{dbText("openPage")}</span>
          )}
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
          aria-label={dbText("newBoardGroupName")}
          placeholder={dbText("newGroup")}
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
          placeholder={dbText("newPage")}
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
      aria-label={dbText("newDatabaseRow")}
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
        <span className="h-7 min-w-0 flex-1 truncate leading-7">
          {dbText("newPage")}
        </span>
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
                    aria-label={dbText("viewName")}
                    onChange={(event) => setRenameValue(event.target.value)}
                    className="h-8"
                  />
                  <Button type="submit" size="sm" className="h-8">
                    {dbText("renameView")}
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
                    {dbText("renameView")}
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
                    {dbText("duplicateView")}
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
                    {dbText("deleteView")}
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
              aria-label={dbText("addDatabaseView")}
              className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-focus-within/viewtabs:opacity-100 group-hover/viewtabs:opacity-100 data-[state=open]:opacity-100"
            >
              <IconPlus className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {dbText("newView")}
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
                aria-label={dbText("newViewName")}
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
  source,
  selectedCount,
  selectableCount,
  onSortsChange,
  onFiltersChange,
  onToggleAllRowsSelection,
  onResize,
}: {
  sorts: DatabaseSort[];
  filters: DatabaseFilter[];
  source: ContentDatabaseSource | null;
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
            aria-label={dbText("nameColumnMenu")}
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
          source={source}
          sourceField={sourceFieldMappingForColumn(source, "name")}
        />
      </DropdownMenu>
      <ColumnResizeHandle
        label={dbText("resizeNameColumn")}
        onPointerDown={onResize}
      />
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
                  {dbText("noEditableProperties")}
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
          {dbText("clearValue")}
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
          {dbText("enterAValidNumber")}
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
        placeholder={dbText("oneFileOrMediaLinkPerLine")}
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
          {dbText("thisPropertyHasNoOptionsYet")}
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="justify-start"
          disabled={disabled}
          onClick={() => void onApply(multi ? [] : null)}
        >
          {dbText("clearValue")}
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
        {dbText("clearValue")}
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
  source,
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
  source: ContentDatabaseSource | null;
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
          sourceField={sourceFieldMappingForColumn(
            source,
            property.definition.id,
          )}
          sourceAttached={!!source}
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
  source,
  sourceField,
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
  source?: ContentDatabaseSource | null;
  sourceField?: ContentDatabaseSource["fields"][number] | null;
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
        <span className="min-w-0 flex-1">{dbText("sortAscending")}</span>
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
        <span className="min-w-0 flex-1">{dbText("sortDescending")}</span>
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
          {dbText("clearSort")}
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
            {dbText("hideInView")}
          </DropdownMenuItem>
        </>
      ) : null}
      {source ? (
        <>
          <DropdownMenuSeparator />
          <div className="grid gap-1 px-2 py-1.5 text-xs">
            <div className="font-medium text-foreground">Source</div>
            {sourceField ? (
              <>
                <div className="min-w-0 break-words text-muted-foreground">
                  {sourceField.sourceFieldLabel} ({sourceField.sourceFieldKey})
                </div>
                <div className="text-muted-foreground">
                  {sourceField.readOnly
                    ? "Read-only"
                    : sourceField.writeOwner === "source"
                      ? "Source-owned"
                      : "Local edits allowed"}
                  {sourceField.lastSyncedAt
                    ? ` • synced ${formatSourceTimestamp(sourceField.lastSyncedAt)}`
                    : ""}
                </div>
              </>
            ) : (
              <div className="text-muted-foreground">
                {dbText("notMappedToBuilder")}
              </div>
            )}
          </div>
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
          title={dbText("propertyVisibility")}
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
              placeholder={dbText("searchProperties")}
              aria-label={dbText("searchProperties")}
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
                {dbText("showAll")}
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
                {dbText("hideAll")}
              </Button>
            </div>
          </div>
        </div>
        {filteredProperties.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            {dbText("noMatchingProperties")}
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
          <AddProperty documentId={documentId} label={dbText("newProperty")} />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
            {dbText("sortRowsBy")}
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
              {dbText("addSort")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              disabled={sorts.length === 0}
              onClick={() => onSortsChange([])}
            >
              {dbText("clearSorts")}
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
            {dbText("filterRowsWhere")}
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
              {dbText("addFilter")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              disabled={filters.length === 0}
              onClick={() => onFiltersChange([])}
            >
              {dbText("clearFilters")}
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
                placeholder={dbText("searchOptions")}
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
                {dbText("clearValue")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {filteredOptions.length === 0 && !canCreateOption ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              {dbText("noMatchingOptions")}
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

function databaseTableCellDisplayValue(property: DocumentProperty) {
  // Blocks columns show a word count, never the dumped body content.
  if (property.definition.type === "blocks") {
    const content = typeof property.value === "string" ? property.value : "";
    const words = countWords(content);
    if (words === 0) return <span aria-hidden="true">&nbsp;</span>;
    return (
      <span className="text-muted-foreground">{formatWordCount(content)}</span>
    );
  }

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
              databaseDocumentId={databaseDocumentId}
              properties={properties}
              columnWidths={columnWidths}
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
            ) : itemProperty.definition.type === "blocks" ? (
              // Blocks cells are a read-only word count in the table; the body
              // is edited on the page, not inline.
              value
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
      toast.error(dbText("failedToDuplicateRow"), {
        description:
          err instanceof Error ? err.message : dbText("somethingWentWrong"),
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
      toast.error(dbText("failedToDeleteRow"), {
        description:
          err instanceof Error ? err.message : dbText("somethingWentWrong"),
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
            {dbText("openPage")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={duplicateItem.isPending}
            onSelect={(event) => {
              event.preventDefault();
              void duplicateRow();
            }}
          >
            <IconCopy className="mr-2 size-4 text-muted-foreground" />
            {dbText("duplicateRow")}
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
            {dbText("deleteRow")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dbText("deleteRow2")}</AlertDialogTitle>
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
