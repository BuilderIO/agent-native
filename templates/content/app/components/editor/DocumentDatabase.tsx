import {
  agentNativePath,
  getBrowserTabId,
  useBuilderConnectFlow,
  useBuilderStatus,
  useCodeMode,
  useT,
} from "@agent-native/core/client";
import {
  BUILDER_CMS_SAFE_WRITE_MODEL,
  type BuilderCmsModelSummary,
  type BuilderCmsWriteEffect,
  type ContentDatabaseItem,
  type ContentDatabaseResponse,
  type ContentDatabaseSource,
  type ContentDatabaseSourceChangeSet,
  type ContentDatabaseSourceJoinRequest,
  type ContentDatabaseSourceReviewPayload,
  type ContentDatabaseSourceWriteMode,
  type ExecuteBuilderSourceBatchResponse,
  type SourceJoinSuggestion,
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
import { useLocation, useNavigate } from "react-router";
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
  useAddDatabaseItem,
  useAddContentDatabaseSourceFieldProperty,
  useAttachContentDatabaseSource,
  useBuilderCmsModels,
  useChangeContentDatabaseSourceRole,
  useContentDatabase,
  useContentDatabases,
  useDeleteDatabaseItems,
  useDisconnectContentDatabaseSource,
  useDuplicateDatabaseItem,
  useDuplicateDatabaseItems,
  useExecuteBuilderSourceBatch,
  useMoveDatabaseItem,
  usePrepareBuilderSourceReview,
  useRefreshContentDatabaseSource,
  useSetContentDatabaseSourceWriteMode,
  useSuggestSourceJoinKey,
  useUpdateContentDatabaseView,
} from "@/hooks/use-content-database";
import {
  useConfigureDocumentProperty,
  useSetDocumentProperty,
} from "@/hooks/use-document-properties";
import {
  useDeleteDocument,
  useDocument,
  seedDatabaseItemDocumentCaches,
  useUpdateDocument,
} from "@/hooks/use-documents";
import { cn } from "@/lib/utils";

import { resolveBuilderCmsWriteEffect } from "../../../actions/_builder-cms-write-adapter.js";
import { BuilderSourceReviewDialog } from "./database-sources/BuilderSourceReviewDialog";
import { type BuilderReviewPublicationTransitions } from "./database-sources/BuilderSourceReviewDialog";
import { DocumentBlockFields } from "./DocumentBlockFields";
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
import { createPreviewDocumentSaveController } from "./previewDocumentSaveController";
import {
  acquirePreviewDocumentSaveController,
  peekPreviewDocumentSaveController,
  releasePreviewDocumentSaveController,
} from "./previewDocumentSaveRegistry";
import { VisualEditor } from "./VisualEditor";

type BuilderSourceWriteSettingsInput = {
  writeMode: ContentDatabaseSourceWriteMode;
  allowPublicationTransitions?: boolean;
};

interface DocumentDatabaseProps {
  document: Document;
  canEdit: boolean;
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
const BUILDER_SOURCE_CONTINUATION_STALL_MS = 45_000;
const BUILDER_SOURCE_CONTINUATION_MAX_WATCHDOG_REFIRES = 2;
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

type DatabaseT = ReturnType<typeof useDatabaseT>;

function useDatabaseT() {
  const t = useT();
  return (key: string, options?: Record<string, unknown>) =>
    t(`database.${key}`, options);
}

function DatabaseText({
  k,
  values,
}: {
  k: string;
  values?: Record<string, unknown>;
}) {
  const db = useDatabaseT();
  return <>{db(k, values)}</>;
}

function databaseGroupLabels(db: DatabaseT) {
  return {
    allPages: db("allPages"),
    noGrouping: db("noGrouping"),
    checked: db("checked"),
    unchecked: db("unchecked"),
  };
}

function defaultDatabaseT(key: string) {
  const labels: Record<string, string> = {
    allPages: "All pages",
    average: "Average",
    checked: "Checked",
    countAll: "Count all",
    countEmpty: "Count empty",
    countUnique: "Count unique",
    countValues: "Count values",
    dateRange: "Date range",
    earliest: "Earliest",
    filterChecked: "Filter checked",
    filterEmpty: "Filter empty",
    filterNotEmpty: "Filter not empty",
    filterUnchecked: "Filter unchecked",
    latest: "Latest",
    max: "Max",
    median: "Median",
    min: "Min",
    noGrouping: "No grouping",
    percentChecked: "Percent checked",
    percentEmpty: "Percent empty",
    percentFilled: "Percent filled",
    percentUnchecked: "Percent unchecked",
    range: "Range",
    sum: "Sum",
    unchecked: "Unchecked",
  };
  return labels[key] ?? key;
}

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
  const db = useDatabaseT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [databaseItemLimit, setDatabaseItemLimit] = useState(
    CONTENT_DATABASE_PAGE_SIZE,
  );
  const database = useContentDatabase(document.id, databaseItemLimit);
  const addItem = useAddDatabaseItem(document.id);
  const attachSource = useAttachContentDatabaseSource(document.id);
  const changeSourceRole = useChangeContentDatabaseSourceRole(document.id);
  const refreshSource = useRefreshContentDatabaseSource(document.id);
  const disconnectSource = useDisconnectContentDatabaseSource(document.id);
  const prepareBuilderReview = usePrepareBuilderSourceReview(document.id);
  const executeBuilderBatch = useExecuteBuilderSourceBatch(document.id);
  const setSourceWriteMode = useSetContentDatabaseSourceWriteMode(document.id);
  const setProperty = useSetDocumentProperty(document.id);
  const updateView = useUpdateContentDatabaseView(document.id);
  const data = database.data;
  const isDatabaseInitialLoading = database.isLoading && !data;
  const properties = data?.properties ?? [];
  const items = data?.items ?? [];
  const totalItemCount = data?.pagination?.totalItems ?? items.length;
  const hasMoreItems =
    data?.pagination?.hasMore === true &&
    databaseItemLimit < CONTENT_DATABASE_MAX_ITEM_LIMIT;
  const isLoadingMoreItems =
    database.isFetching && data?.pagination?.limit !== databaseItemLimit;
  const databaseId = data?.database.id ?? null;
  const source = data?.source ?? null;
  const sources = data?.sources ?? (source ? [source] : []);
  // New-row source picker (row-union): when a database has 2+ sources, the auto
  // -created "Source" select tags which collection a row belongs to. Surface a
  // picker on "New" so a row is created already tagged for its collection (the
  // backend then routes its create_draft to that source). Mirrors the server's
  // SOURCE_PROPERTY_NAME ("Source", a select).
  const sourceTagPicker = useMemo(() => {
    if (sources.length < 2) return null;
    const property = properties.find(
      (item) =>
        item.definition.name === "Source" && item.definition.type === "select",
    );
    if (!property) return null;
    // Each Source option's id IS the source id (and "local" is the Local
    // sentinel), so a collection always resolves to a valid tag — never a
    // missing option that would silently create an untagged row.
    const optionIds = new Set(
      (property.definition.options.options ?? []).map((option) => option.id),
    );
    const collections = sources
      .filter(
        (item) => item.sourceType === "builder-cms" && optionIds.has(item.id),
      )
      .map((item) => ({ label: item.sourceName, optionId: item.id }));
    return {
      propertyId: property.definition.id,
      collections,
      localOptionId: optionIds.has("local") ? "local" : null,
    };
  }, [properties, sources]);
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
  const [builderBatchResult, setBuilderBatchResult] =
    useState<ExecuteBuilderSourceBatchResponse | null>(null);
  const [builderReviewCheckedAt, setBuilderReviewCheckedAt] = useState<
    string | null
  >(null);
  // Which Builder source the review dialog / push targets. null ⇒ the primary
  // source (single-source behavior). Set when opening a non-primary source's
  // writable leaf so review/push/write-mode scope to that collection.
  const [builderReviewSourceId, setBuilderReviewSourceId] = useState<
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
  const autoContinueBuilderSourceRef = useRef<string | null>(null);
  const builderContinuationWatchdogRef = useRef<{
    key: string | null;
    refires: number;
  }>({ key: null, refires: 0 });
  const [
    builderContinuationClientErrorKey,
    setBuilderContinuationClientErrorKey,
  ] = useState<string | null>(null);
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
  // The review dialog operates on the source the user opened, which may be a
  // non-primary row-union collection. Fall back to the primary when no
  // explicit target is set (single-source behavior).
  const activeReviewSource = useMemo(
    () =>
      builderReviewSourceId
        ? (sources.find((item) => item.id === builderReviewSourceId) ?? source)
        : source,
    [builderReviewSourceId, sources, source],
  );
  const builderReviewChangeSets = useMemo(
    () => builderReviewableChangeSets(activeReviewSource),
    [activeReviewSource],
  );
  const builderReviewPreview = useMemo(
    () =>
      activeReviewSource?.sourceType === "builder-cms" &&
      builderReviewChangeSets.length > 0
        ? buildClientBuilderReviewPayload(
            activeReviewSource,
            builderReviewChangeSets,
          )
        : null,
    [builderReviewChangeSets, activeReviewSource],
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
    if (
      !canEdit ||
      !source ||
      source.sourceType !== "builder-cms" ||
      sourceAddsDetails(source) ||
      refreshSource.isPending
    ) {
      return;
    }
    const sourceStatus = builderSourceRowFetchStatus(source);
    if (
      sourceStatus !== "fetching" ||
      source.metadata.lastReadHasMore !== true
    ) {
      return;
    }
    const continuationKey = builderSourceContinuationKey(source);
    if (!continuationKey) return;
    if (builderContinuationClientErrorKey === continuationKey) return;
    if (autoContinueBuilderSourceRef.current === continuationKey) return;
    autoContinueBuilderSourceRef.current = continuationKey;
    refreshSource.mutate(
      {
        documentId: document.id,
        sourceId: source.id,
      },
      {
        onError: () => setBuilderContinuationClientErrorKey(continuationKey),
      },
    );
  }, [
    builderContinuationClientErrorKey,
    canEdit,
    document.id,
    refreshSource.mutate,
    refreshSource.isPending,
    source,
  ]);

  useEffect(() => {
    const continuationKey =
      source?.sourceType === "builder-cms"
        ? builderSourceContinuationKey(source)
        : null;
    if (
      !canEdit ||
      !source ||
      source.sourceType !== "builder-cms" ||
      sourceAddsDetails(source) ||
      refreshSource.isPending ||
      builderSourceRowFetchStatus(source) !== "fetching" ||
      source.metadata.lastReadHasMore !== true ||
      !continuationKey ||
      builderContinuationClientErrorKey === continuationKey
    ) {
      return;
    }
    if (builderContinuationWatchdogRef.current.key !== continuationKey) {
      builderContinuationWatchdogRef.current = {
        key: continuationKey,
        refires: 0,
      };
    }
    const timer = window.setTimeout(() => {
      const watchdog = builderContinuationWatchdogRef.current;
      if (watchdog.key !== continuationKey) return;
      if (
        builderSourceContinuationWatchdogDecision(watchdog.refires) === "error"
      ) {
        setBuilderContinuationClientErrorKey(continuationKey);
        return;
      }
      builderContinuationWatchdogRef.current = {
        key: continuationKey,
        refires: watchdog.refires + 1,
      };
      autoContinueBuilderSourceRef.current = null;
      refreshSource.mutate(
        {
          documentId: document.id,
          sourceId: source.id,
        },
        {
          onError: () => setBuilderContinuationClientErrorKey(continuationKey),
        },
      );
    }, BUILDER_SOURCE_CONTINUATION_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [
    builderContinuationClientErrorKey,
    canEdit,
    document.id,
    refreshSource.mutate,
    refreshSource.isPending,
    source,
  ]);

  useEffect(() => {
    if (!databaseId) return;
    const state = databaseNavigationState({
      document,
      databaseId,
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
    seedDatabaseItemDocumentCaches(queryClient, item);
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
    seedDatabaseItemDocumentCaches(queryClient, item);
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
    setBuilderBatchResult(null);
    setBuilderReviewCheckedAt(null);
    // Target the SAME source the dialog renders. activeReviewSource falls back
    // to the primary if the selected source was disconnected/refetched out, so
    // the backend never receives a stale id that the UI no longer reflects.
    const targetSourceId =
      activeReviewSource && activeReviewSource.id !== source?.id
        ? activeReviewSource.id
        : undefined;
    try {
      const prepared = await prepareBuilderReview.mutateAsync({
        documentId: document.id,
        sourceId: targetSourceId,
      });
      let nextReview = prepared.review;
      let batchResult: ExecuteBuilderSourceBatchResponse | null = null;

      if (
        nextReview.liveWritesEnabled &&
        nextReview.result.status === "validated"
      ) {
        const changeSetIds = nextReview.rows.map((row) => row.changeSetId);
        const scopedTransitions = Object.fromEntries(
          changeSetIds.flatMap((changeSetId) =>
            transitions[changeSetId]
              ? [[changeSetId, transitions[changeSetId]]]
              : [],
          ),
        );
        batchResult = await executeBuilderBatch.mutateAsync({
          documentId: document.id,
          sourceId: targetSourceId,
          changeSetIds,
          transitions:
            Object.keys(scopedTransitions).length > 0
              ? scopedTransitions
              : undefined,
        });
        setBuilderBatchResult(batchResult);
      }

      setBuilderReviewResult(nextReview);
      setBuilderReviewCheckedAt(new Date().toISOString());
      toast.success(
        builderBatchSucceeded(batchResult)
          ? "Builder updates pushed"
          : "Builder update checked",
        {
          description: builderBatchToastMessage(batchResult, nextReview),
        },
      );
    } catch (error) {
      toast.error(db("builderUpdateFailed"), {
        description: error instanceof Error ? error.message : db("tryAgain"),
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
        databaseGroupLabels(db),
      ),
      activeView.hideEmptyGroups === true,
    );
  }, [
    activeView.groupByPropertyId,
    activeView.hideEmptyGroups,
    databaseGroupProperty,
    db,
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
                placeholder={db("search")}
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
                aria-label={db("closeSearch")}
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
              aria-label={db("search")}
              title={db("search")}
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
            sourceTagPicker ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 rounded-md bg-foreground px-2.5 text-xs font-medium text-background hover:bg-foreground/90"
                    disabled={addItem.isPending || !databaseId}
                  >
                    {addItem.isPending ? (
                      <Spinner className="mr-1.5 size-3.5" />
                    ) : null}
                    New
                    <IconChevronDown className="ml-1 size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>{db("addARowTo")}</DropdownMenuLabel>
                  {sourceTagPicker.collections.map((collection) => (
                    <DropdownMenuItem
                      key={collection.label}
                      onClick={() =>
                        void createRow(
                          "",
                          collection.optionId
                            ? {
                                [sourceTagPicker.propertyId]:
                                  collection.optionId,
                              }
                            : {},
                        )
                      }
                    >
                      <BuilderLogoMark className="mr-2 size-3.5 shrink-0" />
                      <span className="truncate">{collection.label}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() =>
                      void createRow(
                        "",
                        sourceTagPicker.localOptionId
                          ? {
                              [sourceTagPicker.propertyId]:
                                sourceTagPicker.localOptionId,
                            }
                          : {},
                      )
                    }
                  >
                    <IconLayoutGrid className="mr-2 size-3.5 shrink-0" />
                    <span className="truncate">{db("localNoCollection")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
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
            )
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

      <BuilderSourceContinuationBar
        source={source}
        canEdit={canEdit}
        pending={refreshSource.isPending}
        clientError={
          source
            ? builderContinuationClientErrorKey ===
              builderSourceContinuationKey(source)
            : false
        }
        onContinue={() => {
          if (!source) return;
          const continuationKey = builderSourceContinuationKey(source);
          setBuilderContinuationClientErrorKey(null);
          autoContinueBuilderSourceRef.current = null;
          builderContinuationWatchdogRef.current = {
            key: continuationKey,
            refires: 0,
          };
          refreshSource.mutate(
            {
              documentId: document.id,
              sourceId: source.id,
            },
            {
              onError: () => {
                if (continuationKey) {
                  setBuilderContinuationClientErrorKey(continuationKey);
                }
              },
            },
          );
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
          isLoading={isDatabaseInitialLoading}
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
          isLoading={isDatabaseInitialLoading}
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
          isLoading={isDatabaseInitialLoading}
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
          isLoading={isDatabaseInitialLoading}
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
          isLoading={isDatabaseInitialLoading}
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
          isLoading={isDatabaseInitialLoading}
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
          disconnectSource.mutate(
            { documentId: document.id, sourceId },
            {
              onSuccess: () => {
                setBuilderReviewSourceId((current) =>
                  current === sourceId ? null : current,
                );
              },
            },
          )
        }
        onRefreshSource={(sourceId) =>
          refreshSource.mutate({
            documentId: document.id,
            sourceId,
          })
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
                setBuilderBatchResult(null);
                setBuilderReviewCheckedAt(null);
                setBuilderReviewSourceId(null);
                toast.success(db("sourceDisconnected"), {
                  description: db(
                    "databaseRowsAndLocalPropertiesWereKeptIntact",
                  ),
                });
              },
              onError: (error) => {
                toast.error(db("sourceWasNotDisconnected"), {
                  description:
                    error instanceof Error ? error.message : db("tryAgain"),
                });
              },
            },
          )
        }
        onReviewBuilderUpdate={(sourceId) => {
          setBuilderReviewResult(null);
          setBuilderBatchResult(null);
          setBuilderReviewCheckedAt(null);
          setBuilderReviewSourceId(sourceId ?? null);
          setBuilderReviewOpen(true);
        }}
        onSetBuilderLiveWrites={(settings, sourceId) =>
          setSourceWriteMode.mutate(
            {
              documentId: document.id,
              sourceId,
              writeMode: settings.writeMode,
              allowPublicationTransitions:
                settings.writeMode === "publish_updates" &&
                settings.allowPublicationTransitions === true,
            },
            {
              onSuccess: () => {
                const enabled = settings.writeMode !== "read_only";
                toast.success(db("builderWriteModeUpdated"), {
                  description:
                    settings.writeMode === "publish_updates"
                      ? "Approved updates can write through to Builder while preserving publication state."
                      : enabled
                        ? "Approved updates will stage Builder autosave revisions."
                        : "Builder writes are disabled for this source.",
                });
              },
              onError: (error) => {
                toast.error(db("builderWriteModeWasNotChanged"), {
                  description:
                    error instanceof Error ? error.message : db("tryAgain"),
                });
              },
            },
          )
        }
        sourceActionPending={
          attachSource.isPending ||
          changeSourceRole.isPending ||
          refreshSource.isPending ||
          disconnectSource.isPending ||
          prepareBuilderReview.isPending ||
          executeBuilderBatch.isPending ||
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
        source={activeReviewSource}
        canEdit={canEdit}
        pending={
          prepareBuilderReview.isPending || executeBuilderBatch.isPending
        }
        batchResult={builderBatchResult}
        checkedAt={builderReviewCheckedAt}
        onClose={() => setBuilderReviewOpen(false)}
        onValidate={(transitions) => void handleBuilderReviewPush(transitions)}
      />

      {!isDatabaseInitialLoading ? (
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

export function databaseItemPreviewTitle(
  item: Pick<ContentDatabaseItem, "document"> | null | undefined,
) {
  return item?.document.title?.trim() || "Untitled";
}

export function databaseNavigationState({
  document,
  databaseId,
  source = null,
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
  source?: ContentDatabaseSource | null;
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
  const outboundSourceChangeCount =
    source?.changeSets.filter((changeSet) => changeSet.direction === "outbound")
      .length ?? 0;

  return {
    view: "editor",
    documentId: document.id,
    title: document.title,
    databaseId,
    databaseSourceType: source?.sourceType,
    databaseSourceName: source?.sourceName,
    databaseSourceTable: source?.sourceTable,
    databaseSourceSyncState: source?.syncState,
    databaseSourceFreshness: source?.freshness,
    databaseSourcePendingChangeCount: source?.changeSets.length,
    databaseSourceLocalChangeCount: source
      ? outboundSourceChangeCount
      : undefined,
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
  response: Pick<ContentDatabaseResponse, "items"> & // i18n-ignore type expression
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
  const nextSelectedItemIds = selectedItemIds.filter((id) =>
    visibleIds.has(id),
  );
  return nextSelectedItemIds.length === selectedItemIds.length
    ? selectedItemIds
    : nextSelectedItemIds;
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
  const db = useDatabaseT();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        showOverlay={false}
        onInteractOutside={(event) => event.preventDefault()}
        className="flex w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:w-[min(72vw,720px)] sm:!max-w-none lg:w-[50vw] lg:!max-w-[860px]"
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
            <SheetTitle>
              <DatabaseText k="databasePagePreview" />
            </SheetTitle>
            <SheetDescription>
              <DatabaseText k="noDatabasePageSelected" />
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
  const db = useDatabaseT();
  const queryClient = useQueryClient();
  const updateDocument = useUpdateDocument();
  const deleteDocument = useDeleteDocument();
  const duplicateItem = useDuplicateDatabaseItem(databaseDocumentId);
  const { data: document, isLoading } = useDocument(item.document.id);
  const previewDocument = document ?? item.document;
  const previewTitle = databaseItemPreviewTitle(item);
  const canEdit = document?.canEdit ?? item.document.canEdit ?? true;
  const canManage = document?.canManage ?? item.document.canManage ?? false;
  const location = useLocation();
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
  const [openingFullPage, setOpeningFullPage] = useState(false);
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
          queryKey: ["action", "get-content-database"],
        });
        void queryClientRef.current.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
      },
      onError: (err) => {
        toast.error(db("failedToSavePagePreview"), {
          description:
            err instanceof Error ? err.message : db("somethingWentWrong"),
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
    seedDatabaseItemDocumentCaches(queryClient, item);
  }, [item, queryClient]);

  useEffect(() => {
    setOpeningFullPage(false);
  }, [location.key]);

  useEffect(() => {
    if (!openingFullPage) return;
    const timer = window.setTimeout(() => {
      setOpeningFullPage(false);
      toast.error(db("somethingWentWrong"));
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [db, openingFullPage]);

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
          toast.error(db("failedToSavePageIcon"), {
            description:
              err instanceof Error ? err.message : db("somethingWentWrong"),
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
      toast.error(db("failedToDuplicateRow"), {
        description:
          err instanceof Error ? err.message : db("somethingWentWrong"),
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
      toast.error(db("failedToDeleteRow"), {
        description:
          err instanceof Error ? err.message : db("somethingWentWrong"),
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
              aria-label={db("previousDatabasePage")}
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
              aria-label={db("nextDatabasePage")}
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
              disabled={openingFullPage}
              onClick={() => {
                setOpeningFullPage(true);
                onOpenPage();
              }}
            >
              {openingFullPage ? (
                <Spinner className="size-3.5" />
              ) : (
                <IconExternalLink className="size-3.5" />
              )}
              {openingFullPage ? (
                <DatabaseText k="opening" />
              ) : (
                <DatabaseText k="openPage" />
              )}
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
                      <DatabaseText k="duplicateRow" />
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
                      <DatabaseText k="deleteRow" />
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
        <SheetDescription className="sr-only">
          <DatabaseText k="previewThisDatabasePageWithoutLeavingTheDatabase" />
        </SheetDescription>
      </SheetHeader>

      {!previewDocument ? (
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
                  document={previewDocument}
                  className="mt-2 size-5 text-xl"
                  fallbackClassName="mt-2 size-5"
                />
              )}
              <textarea
                ref={titleInputRef}
                rows={1}
                value={localTitle}
                readOnly={!canEdit}
                aria-label={db("previewPageTitle")}
                placeholder={db("untitled")}
                onChange={(event) => handleTitleChange(event.target.value)}
                style={{ fieldSizing: "content" } as any}
                className="min-w-0 flex-1 resize-none overflow-hidden break-words border-0 bg-transparent p-0 text-3xl font-bold leading-tight text-foreground outline-none placeholder:text-muted-foreground/40"
              />
            </div>
            {previewDocument.databaseMembership ? (
              <DocumentProperties
                documentId={previewDocument.id}
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
                    key={previewDocument.id}
                    documentId={previewDocument.id}
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
                if (previewDocument.databaseMembership) {
                  return (
                    <DocumentBlockFields
                      documentId={previewDocument.id}
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
            <AlertDialogTitle>
              <DatabaseText k="deleteRow2" />
            </AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{previewTitle}&rdquo; and any sub-pages will be permanently
              deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <DatabaseText k="cancel" />
            </AlertDialogCancel>
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
  const db = useDatabaseT();
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
    databaseViewItemGroups(
      items,
      groupableProperties,
      groupByPropertyId,
      databaseGroupLabels(db),
    ),
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
      toast.error(db("failedToMoveRow"), {
        description:
          err instanceof Error ? err.message : db("somethingWentWrong"),
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
      toast.error(db("failedToUpdateCheckbox"), {
        description:
          err instanceof Error ? err.message : db("somethingWentWrong"),
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
      toast.error(db("failedToDeleteSelectedRows"), {
        description:
          err instanceof Error ? err.message : db("somethingWentWrong"),
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
      toast.error(db("failedToDuplicateEverySelectedRow"), {
        description:
          err instanceof Error ? err.message : db("somethingWentWrong"),
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
      toast.error(db("failedToUpdateEverySelectedRow"), {
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
                sources={sources}
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
                label={db("addProperty")}
                source={source}
                sources={sources}
              />
            </div>
          ) : null}
        </div>

        {isLoading ? (
          <div className="flex h-16 items-center gap-2 border-t border-border px-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            <DatabaseText k="loadingDatabase" />
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
                label={db("noRowsMatchThisView")}
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
            <AlertDialogTitle>
              <DatabaseText k="deleteSelectedRows" />
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectedCount} selected row{selectedCount === 1 ? "" : "s"} and
              any sub-pages will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <DatabaseText k="cancel" />
            </AlertDialogCancel>
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
  const db = useDatabaseT();
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
        <DatabaseText k="clearAll" />
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
  | "source"
  | "layout"
  | "property_visibility"
  | "group";

// One step in the Sources drill-down: Sources (root, empty stack) → provider
// (Builder) → space → model leaf. The model step carries the full summary so
// the leaf can attach without re-fetching.
// A second source being added, awaiting the canonical-key confirm step.
type PendingSourceCandidate = {
  sourceType: "mock-local" | "builder-cms" | "local-table";
  sourceName: string;
  sourceTable: string;
  displayName: string;
  existingSourceId?: string;
};

type SourceNavStep =
  | { kind: "provider"; providerId: "builder" }
  | { kind: "space"; spaceId: string; spaceName: string }
  | { kind: "model"; model: BuilderCmsModelSummary }
  | { kind: "addSource" }
  | { kind: "secondarySource"; sourceId: string; sourceName: string }
  | { kind: "keyConfirm"; candidate: PendingSourceCandidate }
  | { kind: "fieldPicker"; sourceId: string; sourceName: string };

function sourceNavTitle(stack: SourceNavStep[], db: DatabaseT): string {
  const top = stack[stack.length - 1];
  if (!top) return db("sources");
  if (top.kind === "provider") return "Builder";
  if (top.kind === "space") return top.spaceName;
  if (top.kind === "addSource") return db("addASource");
  if (top.kind === "secondarySource") return top.sourceName;
  if (top.kind === "keyConfirm") return db("matchExistingItemsToDetails");
  if (top.kind === "fieldPicker") return db("chooseFields");
  return top.model.displayName;
}

// The Builder "B" brand mark (first glyph of the wordmark), drawn with
// currentColor so it themes against the panel background.
function BuilderLogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 71 80"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M70.86 24C70.86 10.69 60.06 0 46.86 0H6.31995C2.81995 0 0 2.84031 0 6.32031C0 12.8003 13.71 17.71 13.71 40C13.71 62.29 0 67.2102 0 73.6802C0 77.1602 2.81995 80 6.31995 80H46.86C60.06 80 70.86 69.31 70.86 56C70.86 46.22 64.98 40.25 64.75 40C64.98 39.75 70.86 33.78 70.86 24ZM8.37 6.86035H46.87C51.45 6.86035 55.75 8.64037 58.99 11.8804C62.23 15.1204 64.01 19.42 64.01 24C64.01 28.58 62.3199 32.62 59.3199 35.79L8.37 6.86035ZM58.99 68.1304C55.75 71.3704 51.45 73.1504 46.87 73.1504H8.37L59.3199 44.2202C62.3199 47.3902 64.01 51.5703 64.01 56.0103C64.01 60.4503 62.23 64.8904 58.99 68.1304ZM15.83 61.02C16.24 60.17 20.58 51.74 20.58 40C20.58 28.26 16.24 19.83 15.83 18.98L52.85 40L15.83 61.02Z" />
    </svg>
  );
}

// The Notion logo, reusing the shared `.notion-logo-icon` styling (same mark as
// the sidebar's Notion button) so it themes consistently.
function NotionLogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("notion-logo-icon", className)}
      aria-hidden="true"
    >
      <path
        className="notion-logo-icon-face"
        d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z"
      />
      <path
        className="notion-logo-icon-mark"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z"
      />
    </svg>
  );
}

function DatabaseSettingsPanelSheet({
  open,
  panel,
  documentId,
  canEdit,
  activeView,
  properties,
  items,
  source,
  sources,
  hiddenCount,
  groupIds,
  onClose,
  onPanelChange,
  onAttachBuilderSource,
  onFederateSource,
  onChangeSourceRole,
  onDisconnectSecondary,
  onRefreshSource,
  onDisconnectSource,
  onReviewBuilderUpdate,
  onSetBuilderLiveWrites,
  sourceActionPending,
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
  canEdit: boolean;
  activeView: ContentDatabaseView;
  properties: DocumentProperty[];
  items: ContentDatabaseItem[];
  source: ContentDatabaseSource | null;
  sources: ContentDatabaseSource[];
  hiddenCount: number;
  groupIds: string[];
  onClose: () => void;
  onPanelChange: (panel: DatabaseSettingsPanel) => void;
  onAttachBuilderSource: (
    model: BuilderCmsModelSummary,
    relationshipMode?: "items" | "details",
  ) => Promise<ContentDatabaseResponse>;
  onFederateSource: (
    candidate: PendingSourceCandidate,
    join: ContentDatabaseSourceJoinRequest,
  ) => Promise<ContentDatabaseResponse>;
  onChangeSourceRole: (
    sourceId: string,
    relationshipMode: "items" | "details",
    join?: ContentDatabaseSourceJoinRequest,
  ) => Promise<ContentDatabaseResponse>;
  onDisconnectSecondary: (sourceId: string) => void;
  onRefreshSource: (sourceId?: string) => void;
  onDisconnectSource: (sourceId?: string) => void;
  onReviewBuilderUpdate: (sourceId?: string) => void;
  onSetBuilderLiveWrites: (
    settings: BuilderSourceWriteSettingsInput,
    sourceId?: string,
  ) => void;
  sourceActionPending: boolean;
  onViewTypeChange: (type: ContentDatabaseViewType) => void;
  onWrapCellsChange: (wrapCells: boolean) => void;
  onOpenPagesInChange: (openPagesIn: ContentDatabaseOpenPagesIn) => void;
  onPropertyHiddenChange: (propertyId: string, hidden: boolean) => void;
  onPropertiesHiddenChange: (propertyIds: string[], hidden: boolean) => void;
  onGroupByChange: (propertyId: string | null) => void;
  onHideEmptyGroupsChange: (hideEmptyGroups: boolean) => void;
  onGroupsCollapsedChange: (groupIds: string[], collapsed: boolean) => void;
}) {
  const db = useDatabaseT();
  // Local drill-down path *within* the Source(s) panel. Kept here (not in the
  // flat panel enum) because the levels are dynamic — space/model names aren't
  // known at compile time. The sheet's back button pops this stack first.
  const [sourceNavStack, setSourceNavStack] = useState<SourceNavStep[]>([]);
  useEffect(() => {
    // Always re-enter the Sources panel at its root, and don't retain a path
    // across close/reopen.
    if (!open || panel !== "source") setSourceNavStack([]);
  }, [open, panel]);

  if (!open) return null;

  const title =
    panel === "main"
      ? "Database settings"
      : panel === "source"
        ? sourceNavTitle(sourceNavStack, db)
        : databaseSettingsPanelTitle(panel);

  const handleBack = () => {
    if (panel === "source" && sourceNavStack.length > 0) {
      setSourceNavStack((stack) => stack.slice(0, -1));
      return;
    }
    onPanelChange("main");
  };

  return (
    <aside
      className="fixed bottom-0 right-0 top-12 z-40 flex w-[320px] max-w-[calc(100vw-1rem)] flex-col border-l border-border bg-background shadow-[-12px_0_32px_rgba(15,23,42,0.06)]"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        {panel === "main" ? null : (
          <button
            type="button"
            aria-label={db("back")}
            className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={handleBack}
          >
            <IconArrowLeft className="size-4" />
          </button>
        )}
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
        </div>
        <button
          type="button"
          aria-label={db("closeDatabaseSettings")}
          className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onClose}
        >
          <IconX className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3">
        {panel === "main" ? (
          <DatabaseSettingsMainPanel
            activeView={activeView}
            source={source}
            sources={sources}
            sourceCount={sources.length || (source ? 1 : 0)}
            propertyCount={properties.length}
            hiddenCount={hiddenCount}
            onPanelChange={onPanelChange}
          />
        ) : panel === "source" ? (
          <DatabaseSettingsSourcePanel
            source={source}
            sources={sources}
            documentId={documentId}
            itemCount={items.length}
            canEdit={canEdit}
            nav={sourceNavStack}
            onNavPush={(step) => setSourceNavStack((stack) => [...stack, step])}
            onNavReplace={setSourceNavStack}
            onAttachBuilderSource={onAttachBuilderSource}
            onFederateSource={onFederateSource}
            onChangeSourceRole={onChangeSourceRole}
            onDisconnectSecondary={(sourceId) => {
              onDisconnectSecondary(sourceId);
              setSourceNavStack([]);
            }}
            onRefreshSource={onRefreshSource}
            onDisconnectSource={onDisconnectSource}
            onReviewBuilderUpdate={onReviewBuilderUpdate}
            onSetBuilderLiveWrites={onSetBuilderLiveWrites}
            sourceActionPending={sourceActionPending}
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
            source={source}
            sources={sources}
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
  if (panel === "source") return "Source";
  if (panel === "layout") return "Layout";
  if (panel === "property_visibility") return "Property visibility";
  if (panel === "group") return "Group";
  return "Database settings";
}

function DatabaseSettingsMainPanel({
  activeView,
  source,
  sources,
  sourceCount,
  propertyCount,
  hiddenCount,
  onPanelChange,
}: {
  activeView: ContentDatabaseView;
  source: ContentDatabaseSource | null;
  sources: ContentDatabaseSource[];
  sourceCount: number;
  propertyCount: number;
  hiddenCount: number;
  onPanelChange: (panel: DatabaseSettingsPanel) => void;
}) {
  const db = useDatabaseT();
  const groupLabel = activeView.groupByPropertyId ? "On" : "";
  // Sum reviewable changes across EVERY source (row-union) so the collapsed
  // Sources row badges pending pushes even when they're only on a secondary.
  const sourceBadgeCount = (
    sources.length > 0 ? sources : source ? [source] : []
  ).reduce(
    (total, item) => total + builderReviewableChangeSets(item).length,
    0,
  );
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
          aria-label={db("viewName")}
          className="h-7 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="grid gap-1">
        <DatabaseSettingsRow
          icon={<IconPlugConnected className="size-4" />}
          label={db("sources")}
          value={sourceCount > 0 ? `${sourceCount} connected` : "None"}
          badgeCount={sourceBadgeCount}
          onClick={() => onPanelChange("source")}
        />
        <DatabaseSettingsRow
          icon={databaseViewIconElement(activeView.type)}
          label={db("layout")}
          value={databaseViewDefaultName(activeView.type)}
          onClick={() => onPanelChange("layout")}
        />
        <DatabaseSettingsRow
          icon={<IconEye className="size-4" />}
          label={db("propertyVisibility")}
          value={propertyCount > 0 ? String(propertyCount - hiddenCount) : ""}
          onClick={() => onPanelChange("property_visibility")}
        />
        <DatabaseSettingsRow
          icon={<IconLayoutKanban className="size-4" />}
          label={db("group")}
          value={groupLabel}
          onClick={() => onPanelChange("group")}
        />
      </div>
    </div>
  );
}

export function builderReviewableChangeSets(
  source: ContentDatabaseSource | null,
) {
  if (source?.sourceType !== "builder-cms") return [];
  return source.changeSets.filter(
    (changeSet) =>
      changeSet.direction === "outbound" &&
      (changeSet.state === "pending_push" ||
        changeSet.state === "staged_revision" ||
        changeSet.state === "approved"),
  );
}

function sourceReviewRiskRank(
  risk: ContentDatabaseSourceReviewPayload["riskLevel"],
) {
  if (risk === "high") return 3;
  if (risk === "medium") return 2;
  return 1;
}

function maxSourceReviewRisk(
  current: ContentDatabaseSourceReviewPayload["riskLevel"],
  next: ContentDatabaseSourceReviewPayload["riskLevel"],
) {
  return sourceReviewRiskRank(next) > sourceReviewRiskRank(current)
    ? next
    : current;
}

export function builderReviewExecutableRows(
  review: ContentDatabaseSourceReviewPayload,
) {
  if (!review.liveWritesEnabled || review.result.status !== "validated") {
    return [];
  }
  return review.rows.filter(
    (row) => row.execution?.state === "ready" && row.execution.idempotencyKey,
  );
}

function builderBatchSucceeded(
  result: ExecuteBuilderSourceBatchResponse | null,
) {
  return (
    !!result &&
    result.summary.total > 0 &&
    result.summary.blocked === 0 &&
    result.summary.failed === 0
  );
}

function builderBatchToastMessage(
  result: ExecuteBuilderSourceBatchResponse | null,
  review: ContentDatabaseSourceReviewPayload,
) {
  if (!result) return review.result.message;
  const { succeeded, blocked, failed } = result.summary;
  return `${succeeded} succeeded, ${blocked} blocked, ${failed} failed.`;
}

export function builderSourceLiveWriteControlState(
  source: ContentDatabaseSource | null,
) {
  const isBuilderSource = source?.sourceType === "builder-cms";
  const safeTarget =
    isBuilderSource && source?.sourceTable === BUILDER_CMS_SAFE_WRITE_MODEL;
  const legacyAllowedWriteModes = source?.metadata.allowedWriteModes ?? [];
  const writeMode =
    source?.metadata.writeMode ??
    (source?.capabilities.liveWritesEnabled === true
      ? legacyAllowedWriteModes.some((mode) => mode !== "autosave")
        ? "publish_updates"
        : "stage_only"
      : "read_only");
  const enabled = writeMode !== "read_only";
  return {
    safeTarget,
    enabled,
    writeMode,
    allowPublicationTransitions:
      writeMode === "publish_updates" &&
      source?.metadata.allowPublicationTransitions === true,
    showAction: safeTarget,
    actionLabel: enabled ? "Disable" : "Enable",
    description: enabled
      ? writeMode === "publish_updates"
        ? "Approved updates can write through to Builder while preserving publication state."
        : "Enabled for autosave writes to the Agent Native test collection."
      : safeTarget
        ? "Off by default. Choose a write tier only when this source should send guarded Builder writes."
        : isBuilderSource
          ? "Unavailable here; live writes are locked to the Agent Native test collection."
          : "Live writes are not available for this source.",
  };
}

const BUILDER_WRITE_MODE_OPTIONS: Array<{
  mode: ContentDatabaseSourceWriteMode;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    mode: "read_only",
    labelKey: "readOnly",
    descriptionKey: "noBuilderWrites",
  },
  {
    mode: "stage_only",
    labelKey: "stageOnly",
    descriptionKey: "savesDraftsNeverPublishes",
  },
  {
    mode: "publish_updates",
    labelKey: "publishUpdates",
    descriptionKey: "writesUpdatesToLiveEntries",
  },
];

function builderWriteModeSummary(
  mode: ContentDatabaseSourceWriteMode,
  db: DatabaseT,
) {
  const option = BUILDER_WRITE_MODE_OPTIONS.find(
    (candidate) => candidate.mode === mode,
  );
  return db(option?.descriptionKey ?? "noBuilderWrites");
}

export function buildClientBuilderReviewPayload(
  source: ContentDatabaseSource,
  changeSets: ContentDatabaseSourceChangeSet[],
): ContentDatabaseSourceReviewPayload {
  let riskLevel: ContentDatabaseSourceReviewPayload["riskLevel"] = "low";
  const riskReasons = new Set<string>();
  const rows = changeSets.map((changeSet) => {
    riskLevel = maxSourceReviewRisk(riskLevel, changeSet.riskLevel);
    changeSet.riskReasons.forEach((reason) => riskReasons.add(reason));
    if (changeSet.conflictState === "source_changed") {
      riskLevel = maxSourceReviewRisk(riskLevel, "medium");
      riskReasons.add("source changed");
    }
    const sourceRow =
      source.rows.find(
        (row) =>
          row.documentId === changeSet.documentId ||
          row.databaseItemId === changeSet.databaseItemId,
      ) ?? null;
    const latestExecution =
      changeSet.executions[changeSet.executions.length - 1] ?? null;
    const titleChange = changeSet.fieldChanges.find(
      (field) => field.localFieldKey === "title",
    );
    const proposedTitle = titleChange?.proposedValue;

    return {
      changeSetId: changeSet.id,
      databaseItemId: changeSet.databaseItemId,
      documentId: changeSet.documentId,
      title:
        typeof proposedTitle === "string" && proposedTitle.trim()
          ? proposedTitle
          : sourceRow?.sourceDisplayKey || "Untitled",
      fieldChanges: changeSet.fieldChanges,
      bodyChange: changeSet.bodyChange,
      riskLevel: changeSet.riskLevel,
      riskReasons: changeSet.riskReasons,
      conflictState: changeSet.conflictState,
      effect: resolveBuilderCmsWriteEffect({ source, changeSet }),
      execution: latestExecution,
    };
  });
  const statuses = rows
    .map((row) => builderExecutionDryRunStatus(row.execution?.payload ?? {}))
    .filter(
      (
        status,
      ): status is {
        status: "validated" | "stale" | "blocked";
        validatedAt: string | null;
      } => !!status,
    );
  const executionStates = rows
    .map((row) => row.execution?.state)
    .filter(Boolean);
  const hasExecutionEvidence =
    statuses.length > 0 || executionStates.length > 0;
  const resultStatus =
    executionStates.length > 0 &&
    executionStates.every((state) => state === "succeeded")
      ? "succeeded"
      : executionStates.includes("failed")
        ? "failed"
        : executionStates.includes("running")
          ? "running"
          : statuses.some((status) => status.status === "stale")
            ? "stale"
            : statuses.some((status) => status.status === "blocked")
              ? "blocked"
              : statuses.some((status) => status.status === "validated")
                ? "validated"
                : source.capabilities.liveWritesEnabled
                  ? "validated"
                  : "write_disabled";

  return {
    summary:
      rows.length === 1
        ? "1 Builder row has changes ready to review."
        : `${rows.length} Builder rows have changes ready to review.`,
    sourceName: source.sourceName,
    sourceTable: source.sourceTable,
    pushMode: source.metadata.pushMode ?? "autosave",
    dryRunOnly: !source.capabilities.liveWritesEnabled,
    liveWritesEnabled: source.capabilities.liveWritesEnabled,
    riskLevel,
    riskReasons: Array.from(riskReasons),
    rows,
    result: {
      status: resultStatus,
      message:
        resultStatus === "succeeded"
          ? "Pushed to Builder and reconciled locally."
          : resultStatus === "failed"
            ? "Builder push failed. The change remains retryable."
            : resultStatus === "running"
              ? "Builder push is running."
              : resultStatus === "validated"
                ? source.capabilities.liveWritesEnabled
                  ? hasExecutionEvidence
                    ? "Push checked successfully. Ready to send to Builder."
                    : "Ready to send to Builder."
                  : "Push checked successfully. Nothing was sent to Builder."
                : resultStatus === "blocked"
                  ? "Push needs attention before anything can be sent to Builder."
                  : resultStatus === "stale"
                    ? "Push needs a fresh review because the plan changed."
                    : "Builder writes are off in this local build. Push will check the update only.",
    },
  };
}

function DatabaseSettingsSourcePanel({
  source,
  sources,
  documentId,
  itemCount,
  canEdit,
  nav,
  onNavPush,
  onNavReplace,
  onAttachBuilderSource,
  onFederateSource,
  onChangeSourceRole,
  onDisconnectSecondary,
  onRefreshSource,
  onDisconnectSource,
  onReviewBuilderUpdate,
  onSetBuilderLiveWrites,
  sourceActionPending,
}: {
  source: ContentDatabaseSource | null;
  sources: ContentDatabaseSource[];
  documentId: string;
  itemCount: number;
  canEdit: boolean;
  nav: SourceNavStep[];
  onNavPush: (step: SourceNavStep) => void;
  onNavReplace: (stack: SourceNavStep[]) => void;
  onAttachBuilderSource: (
    model: BuilderCmsModelSummary,
    relationshipMode?: "items" | "details",
  ) => Promise<ContentDatabaseResponse>;
  onFederateSource: (
    candidate: PendingSourceCandidate,
    join: ContentDatabaseSourceJoinRequest,
  ) => Promise<ContentDatabaseResponse>;
  onChangeSourceRole: (
    sourceId: string,
    relationshipMode: "items" | "details",
    join?: ContentDatabaseSourceJoinRequest,
  ) => Promise<ContentDatabaseResponse>;
  onDisconnectSecondary: (sourceId: string) => void;
  onRefreshSource: (sourceId?: string) => void;
  onDisconnectSource: (sourceId?: string) => void;
  onReviewBuilderUpdate: (sourceId?: string) => void;
  onSetBuilderLiveWrites: (
    settings: BuilderSourceWriteSettingsInput,
    sourceId?: string,
  ) => void;
  sourceActionPending: boolean;
}) {
  const db = useDatabaseT();
  const { isCodeMode } = useCodeMode();
  const isBuilderSource = source?.sourceType === "builder-cms";
  const builderStatus = useBuilderStatus();
  const builderConfigured = builderStatus.status?.configured === true;
  const builderOrgName = builderStatus.status?.orgName ?? null;
  // Real space name(s) from the Admin API, falling back to the generic org
  // name (then a constant) so the drill-down never renders a blank label.
  const builderSpaces =
    builderStatus.status?.spaces && builderStatus.status.spaces.length > 0
      ? builderStatus.status.spaces
      : builderOrgName
        ? [{ id: "builder-space", name: builderOrgName }]
        : [{ id: "builder-space", name: db("builderSpace") }];
  const builderSpaceLabel = builderSpaces[0]?.name ?? builderOrgName;
  const connect = useBuilderConnectFlow({
    trackingSource: "database_source_panel",
    onConnected: () => {
      void builderStatus.refetch();
    },
  });
  // Auto-sync: the manual Refresh button is gone, so pull the read-only
  // snapshot when the panel opens and whenever the window regains focus.
  // Throttled so rapid focus changes don't hammer Builder; the refresh
  // mutation is silent (no toast), so this stays quiet in the background.
  const refreshSourceRef = useRef(onRefreshSource);
  refreshSourceRef.current = onRefreshSource;
  const lastAutoSyncRef = useRef<{ at: number; sourceId?: string }>({ at: 0 });
  const autoSyncEnabled = Boolean(source) && isBuilderSource && canEdit;
  const top = nav[nav.length - 1];
  // When a non-primary Builder source's leaf is open, auto-sync should refresh
  // THAT source, not the primary. At the root/list (no model leaf) we fall back
  // to the primary (undefined ⇒ primary in the refresh action).
  const autoSyncSourceId =
    top?.kind === "model"
      ? sources.find(
          (item) =>
            item.sourceType === "builder-cms" &&
            item.sourceTable === top.model.name,
        )?.id
      : undefined;
  useEffect(() => {
    if (!autoSyncEnabled) return;
    const maybeSync = () => {
      const now = Date.now();
      const last = lastAutoSyncRef.current;
      // Throttle repeated syncs of the SAME source, but always sync when the
      // viewed source changes (so opening a secondary leaf refreshes it).
      if (last.sourceId === autoSyncSourceId && now - last.at < 15_000) return;
      lastAutoSyncRef.current = { at: now, sourceId: autoSyncSourceId };
      refreshSourceRef.current(autoSyncSourceId);
    };
    maybeSync();
    const onFocus = () => maybeSync();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [autoSyncEnabled, autoSyncSourceId]);

  // ── Sources list (root) ───────────────────────────────────────────────
  if (!top) {
    return (
      <SourcesListView
        source={source}
        sources={sources}
        onOpenConnectedBuilder={(connected) =>
          onNavPush({
            kind: "model",
            model: builderModelSummaryFromSource(connected),
          })
        }
        onOpenSecondary={(secondary) =>
          onNavPush({
            kind: "secondarySource",
            sourceId: secondary.id,
            sourceName: secondary.sourceName,
          })
        }
        onAddSource={() => onNavPush({ kind: "addSource" })}
      />
    );
  }

  // ── Add a source → local tables picker ────────────────────────────────
  if (top.kind === "addSource") {
    return (
      <AddSourceView
        excludeDatabaseIds={[
          ...(source?.databaseId ? [source.databaseId] : []),
          ...sources
            .filter((item) => item.sourceType === "local-table")
            .map((item) => item.sourceTable),
        ]}
        canEdit={canEdit}
        builderConfigured={builderConfigured}
        builderSpaceLabel={builderSpaceLabel}
        onOpenBuilder={() =>
          onNavPush({ kind: "provider", providerId: "builder" })
        }
        onPickLocalTable={(table) =>
          onNavPush({
            kind: "keyConfirm",
            candidate: {
              sourceType: "local-table",
              sourceName: table.title,
              sourceTable: table.databaseId,
              displayName: table.title,
            },
          })
        }
      />
    );
  }

  // ── Secondary (federated) source leaf ─────────────────────────────────
  if (top.kind === "secondarySource") {
    const secondary = sources.find((item) => item.id === top.sourceId) ?? null;
    return (
      <SecondarySourceLeaf
        source={secondary}
        canEdit={canEdit}
        pending={sourceActionPending}
        onAddDetails={() =>
          secondary
            ? onNavPush({
                kind: "keyConfirm",
                candidate: {
                  sourceType: secondary.sourceType,
                  sourceName: secondary.sourceName,
                  sourceTable: secondary.sourceTable,
                  displayName: secondary.sourceName,
                  existingSourceId: secondary.id,
                },
              })
            : undefined
        }
        onAddItems={async () => {
          if (!secondary) return;
          await onChangeSourceRole(secondary.id, "items");
          onNavReplace([]);
        }}
        onChooseFields={() =>
          secondary
            ? onNavPush({
                kind: "fieldPicker",
                sourceId: secondary.id,
                sourceName: secondary.sourceName,
              })
            : undefined
        }
        onDisconnect={() => onDisconnectSecondary(top.sourceId)}
      />
    );
  }

  // ── Canonical-key confirm (adding a second source) ────────────────────
  if (top.kind === "keyConfirm") {
    return (
      <CanonicalKeyConfirmView
        documentId={documentId}
        candidate={top.candidate}
        canEdit={canEdit}
        pending={sourceActionPending}
        onCommit={async (join) => {
          const result = top.candidate.existingSourceId
            ? await onChangeSourceRole(
                top.candidate.existingSourceId,
                "details",
                join,
              )
            : await onFederateSource(top.candidate, join);
          const detailsSource = findDetailsSource(result, top.candidate);
          onNavReplace(
            detailsSource
              ? [
                  {
                    kind: "fieldPicker",
                    sourceId: detailsSource.id,
                    sourceName: detailsSource.sourceName,
                  },
                ]
              : [],
          );
        }}
      />
    );
  }

  if (top.kind === "fieldPicker") {
    const pickerSource =
      sources.find((item) => item.id === top.sourceId) ?? null;
    return (
      <SourceDetailsFieldPicker
        documentId={documentId}
        source={pickerSource}
        canEdit={canEdit}
        pending={sourceActionPending}
        onDone={() => onNavReplace([])}
      />
    );
  }

  // ── Builder provider → space list ─────────────────────────────────────
  if (top.kind === "provider") {
    if (!builderConfigured) {
      // Don't flash "Connect Builder" at an already-connected user while the
      // status is still loading — show a checking state until we actually know.
      if (!builderStatus.status && builderStatus.loading) {
        return (
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            <DatabaseText k="checkingBuilderConnection" />
          </div>
        );
      }
      return (
        <div className="grid min-w-0 gap-3">
          <div className="min-w-0 break-words text-xs text-muted-foreground">
            <DatabaseText k="connectYourBuilderAccountToBrowseItsSpaces" />
          </div>
          <div>
            <Button
              type="button"
              size="sm"
              disabled={!canEdit || connect.connecting}
              onClick={() => connect.start()}
            >
              {connect.connecting ? (
                <Spinner className="mr-1.5 size-3.5" />
              ) : (
                <IconExternalLink className="mr-1.5 size-3.5" />
              )}
              Connect Builder
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="grid min-w-0 gap-1.5">
        {builderSpaces.map((space) => (
          <DatabaseSettingsRow
            key={space.id}
            icon={<IconLayoutGrid className="size-4" />}
            label={space.name}
            onClick={() =>
              onNavPush({
                kind: "space",
                spaceId: space.id,
                spaceName: space.name,
              })
            }
          />
        ))}
      </div>
    );
  }

  // ── Space → model list ────────────────────────────────────────────────
  if (top.kind === "space") {
    return (
      <BuilderSpaceModelsView
        attachedModelNames={sources
          .filter((item) => item.sourceType === "builder-cms")
          .map((item) => item.sourceTable)}
        onOpenModel={(model) => onNavPush({ kind: "model", model })}
      />
    );
  }

  // ── Model leaf ────────────────────────────────────────────────────────
  const model = top.model;
  // Resolve the source this leaf operates on by the model being viewed, NOT by
  // assuming the primary — a row-union database has multiple writable Builder
  // sources, and opening any of them must land on its own writable leaf.
  // Collection names are unique per database (duplicate-attach is guarded), so
  // matching on sourceTable is unambiguous.
  const leafSource =
    sources.find(
      (item) =>
        item.sourceType === "builder-cms" && item.sourceTable === model.name,
    ) ?? null;
  const isAttachedModel = Boolean(leafSource);

  // Unattached model → the attach affordance (the model is already chosen by
  // drilling in, so there's no model picker here).
  if (!isAttachedModel || !leafSource) {
    return (
      <div className="grid min-w-0 gap-3">
        <div className="grid min-w-0 gap-1.5 rounded-lg border border-border bg-background p-3 text-sm">
          <div className="truncate font-medium" title={model.displayName}>
            {model.displayName}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded border border-border px-1.5 py-0.5">
              {model.name}
            </span>
            <span className="rounded border border-border px-1.5 py-0.5">
              {model.fields.length} fields
            </span>
            <span className="rounded border border-border px-1.5 py-0.5">
              read-only
            </span>
          </div>
        </div>
        {sources.length > 0 || source ? (
          <SourceRelationshipChoice
            documentId={documentId}
            candidate={{
              sourceType: "builder-cms",
              sourceName: model.displayName,
              sourceTable: model.name,
              displayName: model.displayName,
            }}
            canEdit={canEdit}
            pending={sourceActionPending}
            onAddDetails={() =>
              onNavPush({
                kind: "keyConfirm",
                candidate: {
                  sourceType: "builder-cms",
                  sourceName: model.displayName,
                  sourceTable: model.name,
                  displayName: model.displayName,
                },
              })
            }
            onAddItems={async () => {
              await onAttachBuilderSource(model, "items");
              onNavReplace([]);
            }}
          />
        ) : (
          <div>
            <Button
              type="button"
              size="sm"
              disabled={!canEdit || sourceActionPending}
              onClick={async () => {
                await onAttachBuilderSource(model);
                onNavReplace([]);
              }}
            >
              {sourceActionPending ? (
                <Spinner className="mr-1.5 size-3.5" />
              ) : (
                <IconPlugConnected className="mr-1.5 size-3.5" />
              )}
              Attach
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Attached model → the writable leaf panel for THIS source (primary or a
  // row-union secondary). All derived state below is scoped to `leafSource`,
  // never the component-level primary `source`.
  const liveWriteControl = builderSourceLiveWriteControlState(leafSource);
  const builderLiveWritesDisabled = !canEdit || sourceActionPending;
  const builderWriteMode = liveWriteControl.writeMode;
  const leafOutboundChangeSets = leafSource.changeSets.filter(
    (changeSet) => changeSet.direction === "outbound",
  );
  const leafReviewableChangeSets = leafOutboundChangeSets.filter(
    (changeSet) =>
      changeSet.state === "pending_push" ||
      changeSet.state === "staged_revision" ||
      changeSet.state === "approved",
  );
  const leafPendingChangeSets = leafOutboundChangeSets.filter(
    (changeSet) => changeSet.state !== "applied",
  );
  const leafAppliedChangeSets = leafOutboundChangeSets.filter(
    (changeSet) => changeSet.state === "applied",
  );
  const leafSyncFailed =
    leafSource.syncState === "error" || Boolean(leafSource.lastError);

  return (
    <div className="grid min-w-0 gap-4">
      <>
        <div className="grid min-w-0 gap-1.5 rounded-lg border border-border bg-background p-3 text-sm">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span
              className="truncate font-medium"
              title={leafSource.sourceName}
            >
              {leafSource.sourceName}
            </span>
            {!liveWriteControl.safeTarget ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <IconLock className="size-3" />
                <DatabaseText k="readOnly" />
              </span>
            ) : null}
          </div>
          {!liveWriteControl.safeTarget ? (
            <div className="text-[11px] text-muted-foreground">
              {db("liveWritesTestCollectionOnly")}
            </div>
          ) : null}
          <div className="min-w-0 break-words text-xs text-muted-foreground">
            {leafSyncFailed ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-destructive hover:underline disabled:opacity-60"
                disabled={!canEdit || sourceActionPending}
                onClick={() => onRefreshSource(leafSource.id)}
              >
                <IconRefresh className="size-3" />
                <DatabaseText k="couldntSyncRetry" />
              </button>
            ) : (
              [
                builderConfigured ? (builderSpaceLabel ?? "Connected") : null,
                leafSource.lastRefreshedAt
                  ? `synced ${
                      formatRelativeSyncTime(leafSource.lastRefreshedAt) ??
                      leafSource.freshness
                    }`
                  : leafSource.freshness,
              ]
                .filter(Boolean)
                .join(" · ")
            )}
          </div>
          {liveWriteControl.safeTarget ? (
            <div className="grid min-w-0 gap-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-foreground">
                  {db("builderWriteMode")}
                </span>
                <span>{builderWriteModeSummary(builderWriteMode, db)}</span>
              </div>
              <div
                className="grid grid-cols-3 gap-0.5 rounded-md border border-border bg-muted/35 p-0.5"
                aria-label={db("builderWriteMode")}
              >
                {BUILDER_WRITE_MODE_OPTIONS.map((option) => {
                  const selected = builderWriteMode === option.mode;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      aria-pressed={selected}
                      title={db(option.descriptionKey)}
                      disabled={builderLiveWritesDisabled}
                      className={cn(
                        "min-w-0 rounded px-2 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60",
                        selected
                          ? "bg-[#2383e2] text-white shadow-sm"
                          : "text-muted-foreground hover:bg-background hover:text-foreground",
                      )}
                      onClick={() =>
                        onSetBuilderLiveWrites(
                          {
                            writeMode: option.mode,
                            allowPublicationTransitions:
                              option.mode === "publish_updates"
                                ? liveWriteControl.allowPublicationTransitions
                                : false,
                          },
                          leafSource.id,
                        )
                      }
                    >
                      <span className="block truncate">
                        {db(option.labelKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {builderWriteMode === "publish_updates" ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={liveWriteControl.allowPublicationTransitions}
                  disabled={builderLiveWritesDisabled}
                  className="flex min-w-0 items-start gap-2 rounded px-1 py-1 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
                  onClick={() =>
                    onSetBuilderLiveWrites(
                      {
                        writeMode: "publish_updates",
                        allowPublicationTransitions:
                          !liveWriteControl.allowPublicationTransitions,
                      },
                      leafSource.id,
                    )
                  }
                >
                  <span
                    className={cn(
                      "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded border",
                      liveWriteControl.allowPublicationTransitions
                        ? "border-[#2383e2] bg-[#2383e2] text-white"
                        : "border-muted-foreground/40 bg-background text-transparent",
                    )}
                  >
                    {liveWriteControl.allowPublicationTransitions ? (
                      <IconCheck className="size-3" />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-foreground">
                      {db("allowPublishUnpublishPerItem")}
                    </span>
                    <span className="block break-words">
                      Requires explicit item intent; unpublish still needs
                      confirmation.
                    </span>
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {leafPendingChangeSets.length > 0 ||
        leafAppliedChangeSets.length > 0 ||
        isCodeMode ? (
          <div className="grid min-w-0 gap-2 rounded-lg border border-border bg-background p-3 text-sm">
            <div className="font-medium">{db("builderChanges")}</div>
            <div className="text-xs text-muted-foreground">
              {leafSource.capabilities.liveWritesEnabled
                ? db("reviewLocalEditsBeforeBuilder")
                : db("liveWritesOffStagedForReview")}
            </div>

            {leafPendingChangeSets.length > 0 ? (
              <div className="grid min-w-0 gap-2">
                {leafPendingChangeSets.slice(0, 6).map((changeSet) => (
                  <SourceChangeSetReviewCard
                    key={changeSet.id}
                    changeSet={changeSet}
                    source={leafSource}
                    showDetails={isCodeMode}
                  />
                ))}
              </div>
            ) : isCodeMode ? (
              <div className="text-xs text-muted-foreground">
                {db("noPendingChangesEditASourceBackedRow")}
              </div>
            ) : null}

            {leafReviewableChangeSets.length > 0 ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={!canEdit || sourceActionPending}
                  onClick={() => onReviewBuilderUpdate(leafSource.id)}
                >
                  <IconCheck className="mr-1.5 size-3.5" />
                  {db("reviewChanges")}
                </Button>
              </div>
            ) : null}

            {leafAppliedChangeSets.length > 0 ? (
              <div className="mt-1 grid min-w-0 gap-1.5 border-t border-border/60 pt-2">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {db("recentlyPushed")}
                </div>
                {leafAppliedChangeSets.slice(0, 3).map((changeSet) => (
                  <SourceChangeSetReviewCard
                    key={changeSet.id}
                    changeSet={changeSet}
                    source={leafSource}
                    showDetails={isCodeMode}
                  />
                ))}
                {leafAppliedChangeSets.length > 3 ? (
                  <div className="text-[11px] text-muted-foreground">
                    +{leafAppliedChangeSets.length - 3} more
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <SourceRoleCard
          source={leafSource}
          canAddDetails={sources.some(
            (item) => item.id !== leafSource.id && !sourceAddsDetails(item),
          )}
          canEdit={canEdit}
          pending={sourceActionPending}
          onAddDetails={() =>
            onNavPush({
              kind: "keyConfirm",
              candidate: {
                sourceType: leafSource.sourceType,
                sourceName: leafSource.sourceName,
                sourceTable: leafSource.sourceTable,
                displayName: leafSource.sourceName,
                existingSourceId: leafSource.id,
              },
            })
          }
          onAddItems={async () => {
            await onChangeSourceRole(leafSource.id, "items");
            onNavReplace([]);
          }}
          onChooseFields={() =>
            onNavPush({
              kind: "fieldPicker",
              sourceId: leafSource.id,
              sourceName: leafSource.sourceName,
            })
          }
        />

        <div className="rounded-lg border border-border bg-background p-3">
          <div className="text-xs font-medium">
            <DatabaseText k="disconnectSource" />
          </div>
          <div className="mt-0.5 break-words text-xs text-muted-foreground">
            <DatabaseText k="keepTheDatabaseRowsAndLocalPropertiesButRemoveSource" />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 h-8 text-xs text-destructive hover:text-destructive"
            disabled={!canEdit || sourceActionPending}
            onClick={() => onDisconnectSource(leafSource.id)}
          >
            {sourceActionPending ? (
              <Spinner className="mr-1 size-3.5" />
            ) : (
              <IconX className="mr-1 size-3.5" />
            )}
            Disconnect
          </Button>
        </div>
      </>
    </div>
  );
}

// Root of the Sources drill-down: third-party integrations + Agent-Native apps,
// each provider a row. Builder is live; the rest are disabled "coming soon".
function builderModelSummaryFromSource(
  source: ContentDatabaseSource,
): BuilderCmsModelSummary {
  return {
    id: source.sourceTable,
    name: source.sourceTable,
    displayName: source.sourceName,
    kind: "data",
    fields: [],
  };
}

function reviewableCountForSource(source: ContentDatabaseSource): number {
  return source.changeSets.filter(
    (changeSet) =>
      changeSet.direction === "outbound" &&
      (changeSet.state === "pending_push" ||
        changeSet.state === "staged_revision" ||
        changeSet.state === "approved"),
  ).length;
}

function SourcesListView({
  source,
  sources,
  onOpenConnectedBuilder,
  onOpenSecondary,
  onAddSource,
}: {
  source: ContentDatabaseSource | null;
  sources: ContentDatabaseSource[];
  onOpenConnectedBuilder: (source: ContentDatabaseSource) => void;
  onOpenSecondary: (source: ContentDatabaseSource) => void;
  onAddSource: () => void;
}) {
  const db = useDatabaseT();
  const connectedSources =
    sources.length > 0 ? sources : source ? [source] : [];

  // A brand-new database has no sources — the only action is to add one.
  // Integrations (Builder, Notion, …) live inside the "Add a source" flow.
  if (connectedSources.length === 0) {
    return (
      <div className="grid min-w-0 gap-2">
        <div className="min-w-0 break-words px-2 text-xs text-muted-foreground">
          {db("connectABuilderCollectionToMapRows")}
        </div>
        <DatabaseSettingsRow
          icon={<IconPlus className="size-4" />}
          label={db("addASource")}
          onClick={onAddSource}
        />
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {db("connectedSources")}
      </div>
      {connectedSources.map((connected, index) => (
        <DatabaseSettingsRow
          key={connected.id}
          icon={
            connected.sourceType === "builder-cms" ? (
              <BuilderLogoMark className="size-4" />
            ) : (
              <IconLayoutGrid className="size-4" />
            )
          }
          label={connected.sourceName}
          value={sourceRoleLabel(db, connected, index)}
          badgeCount={
            connected.metadata.federation?.role !== "secondary" &&
            connected.sourceType === "builder-cms"
              ? reviewableCountForSource(connected)
              : 0
          }
          onClick={
            connected.metadata.federation?.role === "secondary"
              ? () => onOpenSecondary(connected)
              : connected.sourceType === "builder-cms"
                ? () => onOpenConnectedBuilder(connected)
                : undefined
          }
          disabled={
            connected.metadata.federation?.role !== "secondary" &&
            connected.sourceType !== "builder-cms"
          }
        />
      ))}
      <DatabaseSettingsRow
        icon={<IconPlus className="size-4" />}
        label={db("addAnotherSource")}
        onClick={onAddSource}
      />
    </div>
  );
}

// Confirm the canonical-key join before federating a second source. The
// heuristic proposes a key field + normalization formula per side; the user can
// tweak the formulas and watch a live sample-match preview before committing.
function CanonicalKeyConfirmView({
  documentId,
  candidate,
  canEdit,
  pending,
  onCommit,
}: {
  documentId: string;
  candidate: PendingSourceCandidate;
  canEdit: boolean;
  pending: boolean;
  onCommit: (join: ContentDatabaseSourceJoinRequest) => void | Promise<void>;
}) {
  const db = useDatabaseT();
  const suggestionQuery = useSuggestSourceJoinKey({
    documentId,
    candidateSourceType: candidate.sourceType,
    candidateSourceTable: candidate.sourceTable,
    enabled: true,
  });
  const suggestion: SourceJoinSuggestion | null =
    suggestionQuery.data?.suggestion ?? null;

  const [primaryFormula, setPrimaryFormula] = useState("");
  const [secondaryFormula, setSecondaryFormula] = useState("");
  const [primaryKeyField, setPrimaryKeyField] = useState("");
  const [secondaryKeyField, setSecondaryKeyField] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (suggestion && !hydrated) {
      setPrimaryFormula(suggestion.primary.normalizationFormula);
      setSecondaryFormula(suggestion.secondary.normalizationFormula);
      setPrimaryKeyField(suggestion.primary.keyField);
      setSecondaryKeyField(suggestion.secondary.keyField);
      setHydrated(true);
    }
  }, [suggestion, hydrated]);

  const previewRows = useMemo(() => {
    if (!suggestion) return [];
    return suggestion.sampleMatches.map((sample) => {
      const primaryNorm = evaluateNormalizationFormula(primaryFormula, {
        [primaryKeyField]: sample.primaryRaw,
      });
      const secondaryNorm = sample.secondaryRaw
        ? evaluateNormalizationFormula(secondaryFormula, {
            [secondaryKeyField]: sample.secondaryRaw,
          })
        : null;
      return {
        primaryRaw: sample.primaryRaw,
        normalized: primaryNorm,
        matched: primaryNorm !== null && primaryNorm === secondaryNorm,
      };
    });
  }, [
    suggestion,
    primaryFormula,
    secondaryFormula,
    primaryKeyField,
    secondaryKeyField,
  ]);

  const matchedCount = previewRows.filter((row) => row.matched).length;

  if (suggestionQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        <DatabaseText k="checkingHowTheseRecordsMatch" />
      </div>
    );
  }

  if (!suggestion) {
    return (
      <div className="min-w-0 break-words text-xs text-muted-foreground">
        {suggestionQuery.data?.message ??
          "Couldn't find a match field automatically."}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid min-w-0 gap-1.5 rounded-lg border border-border bg-background p-3 text-sm">
        <div className="truncate font-medium" title={candidate.displayName}>
          {candidate.displayName}
        </div>
        <div className="min-w-0 break-words text-xs text-muted-foreground">
          Match existing items to details. Suggested match:{" "}
          <span className="font-medium text-foreground">
            {suggestion.canonicalKey.label}
          </span>
          .
        </div>
      </div>

      <div className="grid min-w-0 gap-1.5">
        <label className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <DatabaseText k="existingSourceNormalize" />
        </label>
        <Input
          value={primaryFormula}
          onChange={(event) => setPrimaryFormula(event.target.value)}
          disabled={!canEdit}
          className="font-mono text-xs"
        />
      </div>
      <div className="grid min-w-0 gap-1.5">
        <label className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <DatabaseText k="newSourceNormalize" />
        </label>
        <Input
          value={secondaryFormula}
          onChange={(event) => setSecondaryFormula(event.target.value)}
          disabled={!canEdit}
          className="font-mono text-xs"
        />
      </div>

      <div className="grid min-w-0 gap-1.5 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">
            <DatabaseText k="sampleMatches" />
          </span>
          <span className="text-muted-foreground">
            {matchedCount} of {previewRows.length} match
          </span>
        </div>
        <div className="grid min-w-0 gap-1">
          {previewRows.map((row, index) => (
            <div
              key={index}
              className="flex min-w-0 items-center gap-1.5 text-[11px]"
            >
              {row.matched ? (
                <IconCheck className="size-3 shrink-0 text-foreground" />
              ) : (
                <IconX className="size-3 shrink-0 text-muted-foreground" />
              )}
              <span
                className="truncate text-muted-foreground"
                title={row.primaryRaw}
              >
                {row.primaryRaw}
              </span>
              <span className="shrink-0 text-muted-foreground">→</span>
              <span
                className="truncate font-medium"
                title={row.normalized ?? ""}
              >
                {row.normalized ?? "—"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        disabled={!canEdit || pending || matchedCount === 0}
        onClick={() =>
          onCommit({
            canonicalKey: suggestion.canonicalKey,
            primary: {
              keyField: primaryKeyField,
              normalizationFormula: primaryFormula,
            },
            secondary: {
              keyField: secondaryKeyField,
              normalizationFormula: secondaryFormula,
            },
          })
        }
      >
        {pending ? (
          <Spinner className="mr-1.5 size-3.5" />
        ) : (
          <IconPlugConnected className="mr-1.5 size-3.5" />
        )}
        Add details
      </Button>
    </div>
  );
}

// Pick a second source to federate. NEXT supports local tables (any other
// workspace database); integrations beyond Builder are coming soon.
function AddSourceView({
  excludeDatabaseIds,
  canEdit,
  builderConfigured,
  builderSpaceLabel,
  onOpenBuilder,
  onPickLocalTable,
}: {
  excludeDatabaseIds: string[];
  canEdit: boolean;
  builderConfigured: boolean;
  builderSpaceLabel: string | null;
  onOpenBuilder: () => void;
  onPickLocalTable: (table: {
    databaseId: string;
    documentId: string;
    title: string;
  }) => void;
}) {
  const db = useDatabaseT();
  const query = useContentDatabases({ enabled: true });
  // Exclude this database (no self-reference) and any table already federated
  // onto it — those live in the "Connected sources" group above.
  const excluded = new Set(excludeDatabaseIds);
  const tables = (query.data?.databases ?? []).filter(
    (table) => !excluded.has(table.databaseId),
  );
  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 gap-1.5">
        <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <DatabaseText k="localTables" />
        </div>
        {query.isLoading ? (
          <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            <DatabaseText k="loadingTables" />
          </div>
        ) : tables.length === 0 ? (
          <div className="min-w-0 break-words px-2 text-xs text-muted-foreground">
            <DatabaseText k="noOtherDatabasesAvailableToAdd" />
          </div>
        ) : (
          tables.map((table) => (
            <DatabaseSettingsRow
              key={table.databaseId}
              icon={<IconLayoutGrid className="size-4" />}
              label={table.title}
              onClick={canEdit ? () => onPickLocalTable(table) : undefined}
              disabled={!canEdit}
            />
          ))
        )}
      </div>
      <div className="grid min-w-0 gap-1.5">
        <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <DatabaseText k="integrations" />
        </div>
        <DatabaseSettingsRow
          icon={<BuilderLogoMark className="size-4" />}
          label="Builder"
          value={
            builderSpaceLabel ?? (builderConfigured ? "Connected" : undefined)
          }
          onClick={canEdit ? onOpenBuilder : undefined}
          disabled={!canEdit}
        />
        <DatabaseSettingsRow
          icon={<NotionLogoMark className="size-4" />}
          label="Notion"
          value="Coming soon"
          disabled
        />
      </div>
      <div className="grid min-w-0 gap-1.5">
        <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <DatabaseText k="agentNativeApps" />
        </div>
        <DatabaseSettingsRow
          icon={<IconTimeline className="size-4" />}
          label="Analytics"
          value="Coming soon"
          disabled
        />
      </div>
    </div>
  );
}

// A connected federated (secondary) source: read-only details + remove.
function SecondarySourceLeaf({
  source,
  canEdit,
  pending,
  onAddDetails,
  onAddItems,
  onChooseFields,
  onDisconnect,
}: {
  source: ContentDatabaseSource | null;
  canEdit: boolean;
  pending: boolean;
  onAddDetails: () => void;
  onAddItems: () => void | Promise<void>;
  onChooseFields: () => void;
  onDisconnect: () => void;
}) {
  const db = useDatabaseT();
  if (!source) {
    return (
      <div className="min-w-0 break-words text-xs text-muted-foreground">
        <DatabaseText k="thisSourceIsNoLongerConnected" />
      </div>
    );
  }
  const federation = source.metadata.federation;
  const fieldCount = source.fields.length;
  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 gap-1.5 rounded-lg border border-border bg-background p-3 text-sm">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate font-medium" title={source.sourceName}>
            {source.sourceName}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <IconLock className="size-3" />
            <DatabaseText k="readOnly" />
          </span>
        </div>
        <div className="min-w-0 break-words text-xs text-muted-foreground">
          {`${sourceRoleLabel(db, source, 0)} · ${fieldCount} field${
            fieldCount === 1 ? "" : "s"
          }`}
          {federation?.canonicalKey?.label
            ? ` · joined on ${federation.canonicalKey.label}`
            : ""}
        </div>
      </div>
      <SourceRoleCard
        source={source}
        canEdit={canEdit}
        pending={pending}
        onAddDetails={onAddDetails}
        onAddItems={onAddItems}
        onChooseFields={onChooseFields}
      />
      {federation ? (
        <div className="grid min-w-0 gap-1 rounded-lg border border-border bg-background p-3 text-xs">
          <div className="font-medium">
            <DatabaseText k="matchFormula" />
          </div>
          <code className="block min-w-0 break-words rounded bg-muted px-1.5 py-1 font-mono text-[11px]">
            {federation.normalizationFormula}
          </code>
        </div>
      ) : null}
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="text-xs font-medium">
          <DatabaseText k="removeThisSource" />
        </div>
        <div className="mt-0.5 break-words text-xs text-muted-foreground">
          Removes the federated columns&rsquo; link to this source. Your local
          rows and columns stay.
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2 h-8 text-xs text-destructive hover:text-destructive"
          disabled={!canEdit || pending}
          onClick={onDisconnect}
        >
          {pending ? (
            <Spinner className="mr-1 size-3.5" />
          ) : (
            <IconX className="mr-1 size-3.5" />
          )}
          Remove
        </Button>
      </div>
    </div>
  );
}

function sourceAddsDetails(source: ContentDatabaseSource | null | undefined) {
  return source?.metadata.federation?.role === "secondary";
}

function builderSourceRowFetchStatus(
  source: Pick<ContentDatabaseSource, "metadata">,
): "fetching" | "error" | null {
  if (source.metadata.sourceFetchState === "error") return "error";
  if (
    source.metadata.sourceFetchState === "fetching" ||
    source.metadata.lastReadPartial
  ) {
    return "fetching";
  }
  return null;
}

function builderSourceContinuationKey(
  source: Pick<ContentDatabaseSource, "id" | "metadata">,
) {
  const offset =
    typeof source.metadata.lastReadNextOffset === "number"
      ? source.metadata.lastReadNextOffset
      : null;
  return offset === null ? null : `${source.id}:${offset}`;
}

function builderSourceContinuationProgressPercent(
  source: Pick<ContentDatabaseSource, "metadata">,
) {
  const fetched = source.metadata.lastReadFetchedEntryCount;
  const limit = source.metadata.lastReadLimit;
  if (typeof fetched !== "number" || typeof limit !== "number" || limit <= 0) {
    return null;
  }
  const rawPercent = Math.max(0, Math.min(100, (fetched / limit) * 100));
  return source.metadata.lastReadHasMore === true
    ? Math.min(95, rawPercent)
    : rawPercent;
}

function builderSourceContinuationWatchdogDecision(refires: number) {
  return refires >= BUILDER_SOURCE_CONTINUATION_MAX_WATCHDOG_REFIRES
    ? "error"
    : "refire";
}

function sourceRoleLabel(
  db: DatabaseT,
  source: ContentDatabaseSource | null | undefined,
  index: number,
) {
  if (sourceAddsDetails(source)) return db("addingDetails");
  return index === 0 ? db("addingItems") : db("addingItems");
}

function detailsReasonText(
  db: DatabaseT,
  suggestion: SourceJoinSuggestion | null,
) {
  if (!suggestion) return db("recommendedWhenCollectionDescribesExistingRows");
  const percent = Math.round(suggestion.confidence * 100);
  return db("recommendedBecauseSampledRowsMatchOn", {
    field: suggestion.canonicalKey.label,
    percent,
  });
}

function findDetailsSource(
  response: ContentDatabaseResponse,
  candidate: PendingSourceCandidate,
) {
  return (
    (response.sources ?? []).find((source) => {
      if (!sourceAddsDetails(source)) return false;
      if (candidate.existingSourceId)
        return source.id === candidate.existingSourceId;
      return (
        source.sourceType === candidate.sourceType &&
        source.sourceTable === candidate.sourceTable
      );
    }) ?? null
  );
}

function SourceRelationshipChoice({
  documentId,
  candidate,
  canEdit,
  pending,
  onAddDetails,
  onAddItems,
}: {
  documentId: string;
  candidate: PendingSourceCandidate;
  canEdit: boolean;
  pending: boolean;
  onAddDetails: () => void;
  onAddItems: () => void | Promise<void>;
}) {
  const db = useDatabaseT();
  const suggestionQuery = useSuggestSourceJoinKey({
    documentId,
    candidateSourceType: candidate.sourceType,
    candidateSourceTable: candidate.sourceTable,
    enabled: true,
  });
  const suggestion = suggestionQuery.data?.suggestion ?? null;
  const detailsRecommended = Boolean(suggestion);
  return (
    <div className="grid min-w-0 gap-2">
      <button
        type="button"
        disabled={!canEdit || pending}
        className={cn(
          "grid min-w-0 gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60",
          detailsRecommended
            ? "border-foreground/30 bg-muted/30"
            : "border-border bg-background hover:bg-muted/50",
        )}
        onClick={onAddDetails}
      >
        <span className="grid min-w-0 gap-1">
          <span className="break-words text-sm font-medium leading-snug">
            <DatabaseText k="addDetailsToExistingItems" />
          </span>
          {detailsRecommended ? (
            <span className="w-fit rounded-full bg-foreground px-2 py-0.5 text-[10px] font-medium text-background">
              <DatabaseText k="recommended" />
            </span>
          ) : null}
        </span>
        <span className="break-words text-xs text-muted-foreground">
          {suggestionQuery.isLoading
            ? db("checkingForMatchingFields")
            : detailsReasonText(db, suggestion)}
        </span>
      </button>
      <button
        type="button"
        disabled={!canEdit || pending}
        className="grid min-w-0 gap-1 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
        onClick={onAddItems}
      >
        <span className="truncate text-sm font-medium">
          <DatabaseText k="addMoreItemsToThisList" />
        </span>
        <span className="break-words text-xs text-muted-foreground">
          <DatabaseText k="bestWhenSameKindAdditionalRows" />
        </span>
      </button>
    </div>
  );
}

function BuilderSourceContinuationBar({
  source,
  canEdit,
  pending,
  clientError,
  onContinue,
}: {
  source: ContentDatabaseSource | null;
  canEdit: boolean;
  pending: boolean;
  clientError: boolean;
  onContinue: () => void;
}) {
  if (
    !source ||
    source.sourceType !== "builder-cms" ||
    sourceAddsDetails(source)
  ) {
    return null;
  }
  const status = clientError ? "error" : builderSourceRowFetchStatus(source);
  if (!status) return null;
  const fetchedCount =
    typeof source.metadata.lastReadFetchedEntryCount === "number"
      ? source.metadata.lastReadFetchedEntryCount
      : typeof source.metadata.lastReadEntryCount === "number"
        ? source.metadata.lastReadEntryCount
        : null;
  const hasMore = source.metadata.lastReadHasMore === true;
  const progressPercent = builderSourceContinuationProgressPercent(source);
  const label =
    status === "error" ? (
      <DatabaseText k="builderRowsLoadingHitSnag" />
    ) : hasMore ? (
      <DatabaseText k="builderRowsLoadingBackground" />
    ) : (
      <DatabaseText k="builderRowsFinishingUp" />
    );
  const detail =
    fetchedCount === null ? null : (
      <DatabaseText
        k="builderRowsFetchedSoFar"
        values={{ count: fetchedCount }}
      />
    );

  return (
    <div
      className={cn(
        "mx-6 mb-3 grid gap-2 rounded-lg border p-3 text-xs",
        status === "error"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-border bg-muted/35 text-foreground",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{label}</div>
          {detail ? (
            <div
              className={cn(
                "mt-0.5 break-words",
                status === "error"
                  ? "text-destructive/80"
                  : "text-muted-foreground",
              )}
            >
              {detail}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0 px-2 text-xs"
          disabled={pending || !canEdit}
          onClick={onContinue}
        >
          {pending ? (
            <Spinner className="mr-1 size-3.5" />
          ) : (
            <IconRefresh className="mr-1 size-3.5" />
          )}
          {status === "error" ? (
            <DatabaseText k="retry" />
          ) : (
            <DatabaseText k="continue" />
          )}
        </Button>
      </div>
      {status === "fetching" ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-background">
          <div
            className={cn(
              "h-full rounded-full bg-foreground/70 transition-[width]",
              progressPercent === null ? "w-full animate-pulse" : null,
            )}
            style={
              progressPercent === null
                ? undefined
                : { width: `${progressPercent}%` }
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function SourceRoleCard({
  source,
  canAddDetails = true,
  canEdit,
  pending,
  onAddDetails,
  onAddItems,
  onChooseFields,
}: {
  source: ContentDatabaseSource;
  canAddDetails?: boolean;
  canEdit: boolean;
  pending: boolean;
  onAddDetails: () => void;
  onAddItems: () => void | Promise<void>;
  onChooseFields: () => void;
}) {
  const db = useDatabaseT();
  const addingDetails = sourceAddsDetails(source);
  return (
    <div className="grid min-w-0 gap-2 rounded-lg border border-border bg-background p-3">
      <div className="grid min-w-0 gap-0.5">
        <div className="text-xs font-medium">
          <DatabaseText k="sourceRole" />
        </div>
        <div className="break-words text-xs text-muted-foreground">
          {addingDetails
            ? db("addingDetailsMatchedOn", {
                field:
                  source.metadata.federation?.canonicalKey?.label ??
                  db("aField"),
              })
            : db("addingItemsAsRows")}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        {addingDetails ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={!canEdit || pending}
              onClick={onChooseFields}
            >
              <DatabaseText k="chooseFields" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={!canEdit || pending}
              onClick={onAddItems}
            >
              <DatabaseText k="addAsItems" />
            </Button>
          </>
        ) : canAddDetails ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={!canEdit || pending}
            onClick={onAddDetails}
          >
            <DatabaseText k="addDetailsInstead" />
          </Button>
        ) : (
          <div className="break-words text-xs text-muted-foreground">
            <DatabaseText k="addAnotherItemSourceBeforeChangingToDetails" />
          </div>
        )}
      </div>
    </div>
  );
}

const DETAIL_FIELD_NAME_HINTS = [
  "name",
  "title",
  "bio",
  "description",
  "image",
  "photo",
  "avatar",
  "url",
  "handle",
  "email",
];

function shouldPreselectDetailField(
  field: ContentDatabaseSource["fields"][number],
) {
  const key = `${field.sourceFieldKey} ${field.sourceFieldLabel}`.toLowerCase();
  if (
    field.propertyId ||
    field.mappingType === "system" ||
    field.mappingType === "title"
  ) {
    return false;
  }
  if (/(\b|\.|_)(id|created|updated|published|rev)(\b|\.|_)/i.test(key)) {
    return false;
  }
  return DETAIL_FIELD_NAME_HINTS.some((hint) => key.includes(hint));
}

function SourceDetailsFieldPicker({
  documentId,
  source,
  canEdit,
  pending,
  onDone,
}: {
  documentId: string;
  source: ContentDatabaseSource | null;
  canEdit: boolean;
  pending: boolean;
  onDone: () => void;
}) {
  const db = useDatabaseT();
  const addField = useAddContentDatabaseSourceFieldProperty(documentId);
  const fields = useMemo(
    () =>
      (source?.fields ?? []).filter(
        (field) =>
          !field.propertyId &&
          field.mappingType !== "system" &&
          field.mappingType !== "title",
      ),
    [source],
  );
  const defaultSelectedIds = useMemo(
    () =>
      fields
        .filter(shouldPreselectDetailField)
        .slice(0, 8)
        .map((field) => field.id),
    [fields],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedIds(defaultSelectedIds);
  }, [defaultSelectedIds]);

  if (!source) {
    return (
      <div className="min-w-0 break-words text-xs text-muted-foreground">
        <DatabaseText k="thisSourceIsNoLongerConnected" />
      </div>
    );
  }

  const selected = new Set(selectedIds);
  const toggleField = (fieldId: string) => {
    setSelectedIds((current) =>
      current.includes(fieldId)
        ? current.filter((id) => id !== fieldId)
        : [...current, fieldId],
    );
  };
  const addSelected = async () => {
    const sourceFieldIds = fields
      .filter((field) => selected.has(field.id))
      .map((field) => field.id);
    if (sourceFieldIds.length === 0) {
      onDone();
      return;
    }
    try {
      for (const sourceFieldId of sourceFieldIds) {
        await addField.mutateAsync({ documentId, sourceFieldId });
      }
      toast.success(db("detailFieldsAdded"), {
        description:
          sourceFieldIds.length === 1
            ? db("addedOneFieldFromSource")
            : db("addedFieldsFromSource", { count: sourceFieldIds.length }),
      });
      onDone();
    } catch (error) {
      toast.error(db("fieldsWereNotAdded"), {
        description: error instanceof Error ? error.message : db("tryAgain"),
      });
    }
  };

  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid min-w-0 gap-1 rounded-lg border border-border bg-background p-3">
        <div className="truncate text-sm font-medium" title={source.sourceName}>
          {source.sourceName}
        </div>
        <div className="break-words text-xs text-muted-foreground">
          <DatabaseText k="pickDetailsBecomeColumns" />
        </div>
      </div>
      {fields.length === 0 ? (
        <div className="break-words text-xs text-muted-foreground">
          <DatabaseText k="allAvailableDetailFieldsAlreadyVisible" />
        </div>
      ) : (
        <div className="grid min-w-0 gap-1">
          {fields.map((field) => (
            <button
              key={field.id}
              type="button"
              className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => toggleField(field.id)}
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border",
                  selected.has(field.id)
                    ? "border-[#2383e2] bg-[#2383e2] text-white"
                    : "border-muted-foreground/40 text-transparent",
                )}
              >
                <IconCheck className="size-3" />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {field.sourceFieldLabel}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {field.sourceFieldType}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={addField.isPending}
          onClick={onDone}
        >
          Done
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!canEdit || pending || addField.isPending}
          onClick={addSelected}
        >
          {addField.isPending ? (
            <Spinner className="mr-1.5 size-3.5" />
          ) : (
            <IconPlus className="mr-1.5 size-3.5" />
          )}
          Add selected
        </Button>
      </div>
    </div>
  );
}

// A Builder space's data models, as drill-in rows. The attached model (if any)
// is marked; selecting a row opens that model's leaf.
function BuilderSpaceModelsView({
  attachedModelNames,
  onOpenModel,
}: {
  attachedModelNames: string[];
  onOpenModel: (model: BuilderCmsModelSummary) => void;
}) {
  const attachedModelNameSet = new Set(attachedModelNames);
  const db = useDatabaseT();
  const modelsQuery = useBuilderCmsModels(true);
  const models = modelsQuery.data?.models ?? [];
  const [query, setQuery] = useState("");

  if (modelsQuery.isLoading) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        <DatabaseText k="loadingBuilderModels" />
      </div>
    );
  }

  if (modelsQuery.data?.state === "unconfigured") {
    return (
      <div className="min-w-0 break-words text-xs text-muted-foreground">
        <DatabaseText k="builderIsntConnectedGoBackToConnectYour" />
      </div>
    );
  }

  if (modelsQuery.data?.state === "error") {
    return (
      <div className="grid min-w-0 gap-2">
        <div className="text-xs text-destructive">
          {modelsQuery.data.message ?? "Builder models could not be loaded."}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => modelsQuery.refetch()}
        >
          <IconRefresh className="mr-1.5 size-3.5" />
          <DatabaseText k="retry" />
        </Button>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="grid min-w-0 gap-2">
        <div className="text-xs text-muted-foreground">
          <DatabaseText k="noBuilderModelsWereFoundInThisSpace" />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={modelsQuery.isFetching}
          onClick={() => modelsQuery.refetch()}
        >
          {modelsQuery.isFetching ? (
            <Spinner className="mr-1.5 size-3.5" />
          ) : (
            <IconRefresh className="mr-1.5 size-3.5" />
          )}
          Refresh
        </Button>
      </div>
    );
  }

  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (model: BuilderCmsModelSummary) =>
    !normalizedQuery ||
    model.displayName.toLowerCase().includes(normalizedQuery) ||
    model.name.toLowerCase().includes(normalizedQuery);
  const filtered = models.filter(matchesQuery);
  const attachedModels = filtered.filter((model) =>
    attachedModelNameSet.has(model.name),
  );
  const otherModels = filtered.filter(
    (model) => !attachedModelNameSet.has(model.name),
  );

  const renderRow = (model: BuilderCmsModelSummary) => {
    const isAttached = attachedModelNameSet.has(model.name);
    return (
      <button
        key={model.id}
        type="button"
        className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onOpenModel(model)}
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
          <IconList className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate" title={model.displayName}>
          {model.displayName}
        </span>
        {isAttached ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-foreground">
            <IconCheck className="size-3" />
            <DatabaseText k="attached" />
          </span>
        ) : null}
        <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    );
  };

  return (
    <div className="grid min-w-0 gap-2">
      <div className="relative min-w-0">
        <IconSearch className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={db("searchModels")}
          aria-label={db("searchBuilderModels")}
          className="h-8 min-w-0 pl-7 text-sm"
        />
      </div>

      {attachedModels.length > 0 ? (
        <div className="grid min-w-0 gap-1.5">
          <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <DatabaseText k="alreadyAttached" />
          </div>
          {attachedModels.map(renderRow)}
        </div>
      ) : null}

      <div className="grid min-w-0 gap-1.5">
        {attachedModels.length > 0 && otherModels.length > 0 ? (
          <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <DatabaseText k="allModels" />
          </div>
        ) : null}
        {otherModels.map(renderRow)}
        {filtered.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            No models match “{query.trim()}”.
          </div>
        ) : null}
      </div>
    </div>
  );
}

const BUILDER_DEV_EFFECT_LABEL: Record<
  BuilderCmsWriteEffect,
  { pending: string; done: string }
> = {
  create_draft: { pending: "Create draft", done: "Created draft" },
  update_in_place: { pending: "Update entry", done: "Updated entry" },
  autosave: { pending: "Save draft", done: "Saved draft" },
  publish: { pending: "Publish", done: "Published" },
  unpublish: { pending: "Unpublish", done: "Unpublished" },
};

function changeSetDisplayTitle(changeSet: ContentDatabaseSourceChangeSet) {
  const titleChange = changeSet.fieldChanges.find(
    (field) => field.localFieldKey === "title",
  );
  if (
    typeof titleChange?.proposedValue === "string" &&
    titleChange.proposedValue.trim()
  ) {
    return titleChange.proposedValue.trim();
  }
  return changeSet.summary;
}

function SourceChangeSetReviewCard({
  changeSet,
  source,
  showDetails = false,
}: {
  changeSet: ContentDatabaseSourceChangeSet;
  source: ContentDatabaseSource;
  showDetails?: boolean;
}) {
  const db = useDatabaseT();
  const latestReview =
    changeSet.reviewEvents[changeSet.reviewEvents.length - 1] ?? null;
  const latestExecution =
    changeSet.executions[changeSet.executions.length - 1] ?? null;
  const dryRunStatus = latestExecution
    ? builderExecutionDryRunStatus(latestExecution.payload)
    : null;
  const effect = resolveBuilderCmsWriteEffect({ source, changeSet });
  const effectLabel = BUILDER_DEV_EFFECT_LABEL[effect];
  const title = changeSetDisplayTitle(changeSet);

  // A change that already pushed is done — collapse it to a one-line
  // confirmation instead of repeating the full diff + gate ceremony.
  if (changeSet.state === "applied") {
    // Report the SUCCEEDED execution (a later blocked/stale gate row could
    // otherwise overwrite the pushed result). Use the effect that actually ran
    // (recorded in the payload) — the live resolver would now report
    // update_in_place because the row is matched to its new entry, mislabeling
    // a completed create as an update.
    const succeededExecution =
      [...changeSet.executions]
        .reverse()
        .find((execution) => execution.state === "succeeded") ??
      latestExecution;
    const appliedEffect =
      (succeededExecution &&
        builderExecutionEffect(succeededExecution.payload)) ??
      effect;
    const when =
      formatRelativeSyncTime(
        succeededExecution?.updatedAt ?? changeSet.updatedAt,
      ) ?? formatSourceTimestamp(changeSet.updatedAt);
    return (
      <div className="flex min-w-0 items-start gap-2 rounded-md border border-border/70 px-2 py-1.5 text-xs">
        <IconCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="min-w-0">
          <div className="min-w-0 break-words font-medium leading-snug">
            {title}
          </div>
          <div className="text-muted-foreground">
            {BUILDER_DEV_EFFECT_LABEL[appliedEffect].done} · pushed {when}
          </div>
        </div>
      </div>
    );
  }

  const blockers = latestExecution
    ? builderExecutionBlockers(latestExecution.payload)
    : [];

  return (
    <div className="min-w-0 rounded-md border border-border/70 px-2 py-1.5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span
          className="min-w-0 break-words font-medium leading-snug"
          title={changeSet.summary}
        >
          {title}
        </span>
        <span className="shrink-0 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {effectLabel.pending}
        </span>
      </div>

      {changeSet.riskLevel !== "low" ||
      changeSet.conflictState === "source_changed" ||
      !changeSet.localOnly ? (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {changeSet.riskLevel !== "low" ? (
            <span className={sourceRiskClass(changeSet.riskLevel)}>
              {changeSet.riskLevel} risk
            </span>
          ) : null}
          {changeSet.conflictState === "source_changed" ? (
            <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              source changed
            </span>
          ) : null}
          {!changeSet.localOnly ? (
            <span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">
              external write
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-1.5 text-xs text-muted-foreground">
        {changeSet.fieldChanges.length} field change
        {changeSet.fieldChanges.length === 1 ? "" : "s"}
        {changeSet.bodyChange ? " · body diff" : ""} · “Review changes” to see
        the diff
      </div>

      {blockers.length > 0 ? (
        <div className="mt-2 grid gap-1 text-xs text-amber-700 dark:text-amber-300">
          {blockers.slice(0, 2).map((blocker) => (
            <div key={blocker} className="break-words">
              Blocked: {blocker}
            </div>
          ))}
        </div>
      ) : null}
      {latestExecution?.lastError ? (
        <div className="mt-2 break-words text-xs text-destructive">
          {latestExecution.lastError}
        </div>
      ) : null}

      {showDetails ? (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer text-[11px] hover:text-foreground">
            Details
          </summary>
          <div className="mt-1 grid gap-1">
            <div className="break-words">
              {changeSet.riskReasons.join(", ")}
              {" • "}
              {formatSourceTimestamp(changeSet.updatedAt)}
            </div>
            {latestReview ? (
              <div className="break-words">
                {latestReview.decision} by {latestReview.reviewerEmail}
                {" • "}
                {formatSourceTimestamp(latestReview.createdAt)}
              </div>
            ) : null}
            {latestExecution ? (
              <>
                <div className="break-words">
                  Execution gate: {latestExecution.state.replace(/_/g, " ")}
                  {dryRunStatus ? ` · dry run ${dryRunStatus.status}` : ""}
                </div>
                {builderExecutionRequestLine(latestExecution.payload) ? (
                  <div className="break-words">
                    {builderExecutionRequestLine(latestExecution.payload)}
                  </div>
                ) : null}
                <div className="break-all">
                  {latestExecution.idempotencyKey}
                </div>
              </>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function SourceMetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className="min-w-0 max-w-[65%] break-words text-right"
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function sourceRiskClass(risk: ContentDatabaseSourceChangeSet["riskLevel"]) {
  return cn(
    "rounded border px-1.5 py-0.5",
    risk === "high"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : risk === "medium"
        ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
        : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
  );
}

function sourceValueText(value: DocumentPropertyValue) {
  if (value === null || value === undefined || value === "") return "empty";
  if (Array.isArray(value)) return value.join(", ") || "empty";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function builderExecutionRequestLine(payload: Record<string, unknown>) {
  const request =
    payload.request &&
    typeof payload.request === "object" &&
    !Array.isArray(payload.request)
      ? (payload.request as Record<string, unknown>)
      : null;
  const method =
    typeof request?.method === "string" ? request.method.toUpperCase() : null;
  const path = typeof request?.path === "string" ? request.path : null;
  if (!request || !method || !path) return null;

  const query =
    request.query && typeof request.query === "object"
      ? (request.query as Record<string, unknown>)
      : null;
  const queryText = query
    ? Object.entries(query)
        .filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        )
        .map(([key, value]) => `${key}=${value}`)
        .join("&")
    : "";
  return `${method} ${path}${queryText ? `?${queryText}` : ""}`;
}

function builderExecutionEffect(
  payload: Record<string, unknown>,
): BuilderCmsWriteEffect | null {
  const effect = payload.effect;
  return effect === "create_draft" ||
    effect === "update_in_place" ||
    effect === "autosave" ||
    effect === "publish" ||
    effect === "unpublish"
    ? effect
    : null;
}

function builderExecutionBlockers(payload: Record<string, unknown>) {
  const safety =
    payload.safety &&
    typeof payload.safety === "object" &&
    !Array.isArray(payload.safety)
      ? (payload.safety as Record<string, unknown>)
      : null;
  const blockers = safety?.blockers;
  return Array.isArray(blockers)
    ? blockers.filter(
        (blocker): blocker is string => typeof blocker === "string",
      )
    : [];
}

function builderExecutionDryRunStatus(payload: Record<string, unknown>) {
  const dryRun =
    payload.dryRun &&
    typeof payload.dryRun === "object" &&
    !Array.isArray(payload.dryRun)
      ? (payload.dryRun as Record<string, unknown>)
      : null;
  const status =
    dryRun?.status === "validated" ||
    dryRun?.status === "stale" ||
    dryRun?.status === "blocked"
      ? dryRun.status
      : null;
  if (!status) return null;
  return {
    status,
    validatedAt:
      typeof dryRun?.validatedAt === "string" ? dryRun.validatedAt : null,
  };
}

function formatSourceTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatRelativeSyncTime(value: string | null): string | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function sourceBuilderReadModeSummary(source: ContentDatabaseSource) {
  if (source.metadata.liveReadConfigured) return "Builder API read-only";
  if (source.metadata.readMode === "fixture") {
    return "Local fixture; Builder credentials unavailable";
  }
  return "Local fixture";
}

function sourceFieldMappingForColumn(
  source: ContentDatabaseSource | null,
  columnKey: ColumnKey,
) {
  if (!source) return null;
  if (columnKey === "name") {
    return (
      source.fields.find((field) => field.mappingType === "title") ??
      source.fields.find((field) => field.localFieldKey === "title") ??
      null
    );
  }
  return (
    source.fields.find((field) => field.propertyId === columnKey) ??
    source.fields.find((field) => field.localFieldKey === columnKey) ??
    null
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
  badgeCount = 0,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  badgeCount?: number;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || !onClick}
      className={cn(
        "flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled || !onClick
          ? "cursor-default text-muted-foreground/60"
          : "text-foreground hover:bg-muted",
      )}
      onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value ? (
        <span className="max-w-28 shrink-0 truncate text-xs text-muted-foreground">
          {value}
        </span>
      ) : null}
      {badgeCount > 0 ? (
        <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-foreground text-[9px] leading-none text-background">
          {badgeCount}
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
  const db = useDatabaseT();
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
          label={db("wrapAllContent")}
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
  const db = useDatabaseT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between rounded-md px-2 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">
            <DatabaseText k="openPagesIn" />
          </span>
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
  source,
  sources,
  hiddenCount,
  onPropertyHiddenChange,
  onPropertiesHiddenChange,
}: {
  documentId: string;
  properties: DocumentProperty[];
  activeView: ContentDatabaseView;
  items: ContentDatabaseItem[];
  source: ContentDatabaseSource | null;
  sources: ContentDatabaseSource[];
  hiddenCount: number;
  onPropertyHiddenChange: (propertyId: string, hidden: boolean) => void;
  onPropertiesHiddenChange: (propertyIds: string[], hidden: boolean) => void;
}) {
  const db = useDatabaseT();
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
          placeholder={db("searchProperties")}
          aria-label={db("searchProperties")}
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
            <DatabaseText k="showAll" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={visibleCount === 0}
            onClick={() => onPropertiesHiddenChange(propertyIds, true)}
          >
            <DatabaseText k="hideAll" />
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
            <DatabaseText k="noMatchingProperties" />
          </div>
        ) : null}
      </div>
      <div className="border-t border-border/70 pt-3">
        <AddProperty
          documentId={documentId}
          label={db("newProperty")}
          source={source}
          sources={sources}
        />
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
  const db = useDatabaseT();
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
          placeholder={db("searchProperties")}
          aria-label={db("searchGroupProperties")}
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
          <span className="flex-1">
            <DatabaseText k="none" />
          </span>
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
          <DatabaseText k="addAStatusSelectMultiSelectOrCheckbox2" />
        </div>
      ) : null}
      {groupProperty ? (
        <div className="grid gap-1 border-t border-border/70 pt-3">
          <DatabaseSettingsSwitch
            label={db("hideEmptyGroups")}
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
              <DatabaseText k="collapseAll" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 flex-1 text-xs"
              disabled={groupIds.length === 0}
              onClick={() => onGroupsCollapsedChange(groupIds, false)}
            >
              <DatabaseText k="expandAll" />
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
  const db = useDatabaseT();
  return (
    <div className="border-b border-border/70 p-1">
      <div className="flex h-8 items-center gap-2 rounded border border-input bg-background px-2">
        <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder={db("searchProperties")}
          aria-label={db("searchProperties")}
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
  const db = useDatabaseT();
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
          <DatabaseText k="noPropertiesFound" />
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
  const db = useDatabaseT();
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
          title={db("group")}
          className={cn(databaseToolbarIconButtonClass(Boolean(groupProperty)))}
        >
          <IconLayoutKanban className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          <DatabaseText k="groupBy" />
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onGroupByChange(null);
          }}
        >
          <span className="flex-1">
            <DatabaseText k="none" />
          </span>
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
            <DatabaseText k="noPropertiesFound" />
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
              <span className="flex-1">
                <DatabaseText k="hideEmptyGroups" />
              </span>
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
              <DatabaseText k="collapseAllGroups" />
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={groupIds.length === 0}
              onSelect={(event) => {
                event.preventDefault();
                onGroupsCollapsedChange(groupIds, false);
              }}
            >
              <IconChevronDown className="mr-2 size-4 text-muted-foreground" />
              <DatabaseText k="expandAllGroups" />
            </DropdownMenuItem>
          </>
        ) : null}
        {groupableProperties.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            <DatabaseText k="addAStatusSelectMultiSelectOrCheckbox2" />
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
  const db = useDatabaseT();
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
        const options = databaseCalculationOptionsForProperty(property, db);
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
                  <DropdownMenuLabel>
                    <DatabaseText k="calculate" />
                  </DropdownMenuLabel>
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
                    <DatabaseText k="clear" />
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
  db: DatabaseT = defaultDatabaseT,
): Array<{ value: DatabaseColumnCalculation; label: string }> {
  const options: Array<{ value: DatabaseColumnCalculation; label: string }> = [
    { value: "count_all", label: db("countAll") },
    { value: "count_values", label: db("countValues") },
    { value: "count_empty", label: db("countEmpty") },
    { value: "count_unique", label: db("countUnique") },
    { value: "percent_filled", label: db("percentFilled") },
    { value: "percent_empty", label: db("percentEmpty") },
  ];
  if (property.definition.type === "checkbox") {
    options.push(
      { value: "count_checked", label: db("checked") },
      { value: "count_unchecked", label: db("unchecked") },
      { value: "percent_checked", label: db("percentChecked") },
      { value: "percent_unchecked", label: db("percentUnchecked") },
    );
  }
  if (property.definition.type === "number") {
    options.push(
      { value: "sum", label: db("sum") },
      { value: "average", label: db("average") },
      { value: "median", label: db("median") },
      { value: "min", label: db("min") },
      { value: "max", label: db("max") },
      { value: "range", label: db("range") },
    );
  }
  if (property.definition.type === "date") {
    options.push(
      { value: "min", label: db("earliest") },
      { value: "max", label: db("latest") },
      { value: "date_range", label: db("dateRange") },
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
  const db = useDatabaseT();
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
        <DatabaseText k="clearSearchAndFilters" />
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
  const db = useDatabaseT();
  const groups = databaseVisibleGroups(
    databaseViewItemGroups(
      items,
      groupableProperties,
      groupByPropertyId,
      databaseGroupLabels(db),
    ),
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
        <span>
          <DatabaseText k="list" />
        </span>
      </div>
      {isLoading ? (
        <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          <DatabaseText k="loadingList" />
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
  const db = useDatabaseT();
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
        aria-label={db("newDatabaseListItemTitle")}
        placeholder={db("newPage")}
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
  const db = useDatabaseT();
  const groups = databaseVisibleGroups(
    databaseViewItemGroups(
      items,
      groupableProperties,
      groupByPropertyId,
      databaseGroupLabels(db),
    ),
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
        <span>
          <DatabaseText k="gallery" />
        </span>
      </div>
      {isLoading ? (
        <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          <DatabaseText k="loadingGallery" />
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
  const db = useDatabaseT();
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
          aria-label={db("newDatabaseGalleryCardTitle")}
          placeholder={db("newPage")}
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
  const db = useDatabaseT();
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
                  <DatabaseText k="calendarBy" />
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
            <DatabaseText k="today" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label={db("previousMonth")}
            onClick={() => changeMonth(-1)}
          >
            <IconArrowUp className="size-3.5 -rotate-90" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label={db("nextMonth")}
            onClick={() => changeMonth(1)}
          >
            <IconArrowUp className="size-3.5 rotate-90" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          <DatabaseText k="loadingCalendar" />
        </div>
      ) : dateProperties.length === 0 ? (
        <div className="flex min-h-24 items-center justify-between gap-3 px-2 py-4 text-sm text-muted-foreground">
          <span>
            <DatabaseText k="addADatePropertyToUseCalendarView" />
          </span>
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
  const db = useDatabaseT();
  if (items.length === 0) return null;

  return (
    <section className="border-t border-border bg-muted/20 px-2 py-2">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          <IconCalendarOff className="size-3.5 shrink-0" />
          <span className="truncate">
            <DatabaseText k="noDate" />
          </span>
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
  const db = useDatabaseT();
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
                  <DatabaseText k="startDate" />
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
                  <DatabaseText k="endDate" />
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onEndDatePropertyChange(null);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <DatabaseText k="noEndDate" />
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
            <DatabaseText k="today" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label={db("previousTimelineRange")}
            onClick={() => changeMonth(-1)}
          >
            <IconArrowUp className="size-3.5 -rotate-90" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label={db("nextTimelineRange")}
            onClick={() => changeMonth(1)}
          >
            <IconArrowUp className="size-3.5 rotate-90" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          <DatabaseText k="loadingTimeline" />
        </div>
      ) : dateProperties.length === 0 ? (
        <div className="flex min-h-24 items-center justify-between gap-3 px-2 py-4 text-sm text-muted-foreground">
          <span>
            <DatabaseText k="addADatePropertyToUseTimelineView" />
          </span>
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
  const db = useDatabaseT();
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
          placeholder={db("newPage")}
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
const DEFAULT_DATABASE_GROUP_LABELS = {
  allPages: "All pages",
  noGrouping: "No grouping",
  checked: "Checked",
  unchecked: "Unchecked",
};

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
  const db = useDatabaseT();
  const groupableProperties = databaseBoardGroupableProperties(properties);
  const groups = databaseVisibleGroups(
    databaseBoardGroups(
      items,
      properties,
      activeView.groupByPropertyId,
      databaseGroupLabels(db),
    ),
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
      toast.error(db("failedToMoveCard"), {
        description:
          err instanceof Error ? err.message : db("somethingWentWrong"),
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
                <DatabaseText k="group" />
                <IconChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                <DatabaseText k="groupBy" />
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
                    <span className="flex-1">
                      <DatabaseText k="hideEmptyGroups" />
                    </span>
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
                    <DatabaseText k="collapseAllGroups" />
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
                    <DatabaseText k="expandAllGroups" />
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
          <DatabaseText k="loadingBoard" />
        </div>
      ) : groupableProperties.length === 0 ? (
        <div className="flex min-h-24 items-center justify-between gap-3 px-2 py-4 text-sm text-muted-foreground">
          <span>
            <DatabaseText k="addAStatusSelectMultiSelectOrCheckbox2" />
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
                          <DatabaseText k="noMatchingPages" />
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
  const db = useDatabaseT();
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
                <DatabaseText k="groupName" />
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
                <DatabaseText k="color" />
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
              <DatabaseText k="deleteGroup" />
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
  const db = useDatabaseT();
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
            <span className="sr-only">
              <DatabaseText k="openPage" />
            </span>
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
  const db = useDatabaseT();
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
          aria-label={db("newBoardGroupName")}
          placeholder={db("newGroup")}
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
  const db = useDatabaseT();
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
          placeholder={db("newPage")}
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
  const db = useDatabaseT();
  async function submitNewRow() {
    if (disabled) return;
    await onCreate("");
  }

  return (
    <button
      type="button"
      aria-label={db("newDatabaseRow")}
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
          <DatabaseText k="newPage" />
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
  labels: {
    allPages: string;
    noGrouping: string;
    checked: string;
    unchecked: string;
  } = DEFAULT_DATABASE_GROUP_LABELS,
): DatabaseBoardGroup[] {
  if (!groupByPropertyId) {
    return [
      {
        id: "all",
        label: labels.allPages,
        property: null,
        value: BOARD_UNGROUPED_VALUE,
        items,
      },
    ];
  }
  return databaseBoardGroups(items, properties, groupByPropertyId, labels);
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
  labels: {
    noGrouping: string;
    checked: string;
    unchecked: string;
  } = DEFAULT_DATABASE_GROUP_LABELS,
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
        label: labels.noGrouping,
        property: null,
        value: BOARD_UNGROUPED_VALUE,
        items,
      },
    ];
  }

  const groups = databaseBoardGroupDefinitions(groupProperty, labels).map(
    (group) => ({
      ...group,
      property: groupProperty,
      items: [] as ContentDatabaseItem[],
    }),
  );
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

function databaseBoardGroupDefinitions(
  property: DocumentProperty,
  labels: { noGrouping: string; checked: string; unchecked: string },
) {
  if (property.definition.type === "checkbox") {
    return [
      {
        id: databaseBoardGroupId(property, false),
        label: labels.unchecked,
        value: false,
      },
      {
        id: databaseBoardGroupId(property, true),
        label: labels.checked,
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
  const db = useDatabaseT();
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
                    aria-label={db("viewName")}
                    onChange={(event) => setRenameValue(event.target.value)}
                    className="h-8"
                  />
                  <Button type="submit" size="sm" className="h-8">
                    <DatabaseText k="renameView" />
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
                    <DatabaseText k="renameView" />
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ViewIcon className="mr-2 size-4 text-muted-foreground" />
                      <DatabaseText k="layout" />
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
                    <DatabaseText k="duplicateView" />
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
                    <DatabaseText k="deleteView" />
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
              aria-label={db("addDatabaseView")}
              className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-focus-within/viewtabs:opacity-100 group-hover/viewtabs:opacity-100 data-[state=open]:opacity-100"
            >
              <IconPlus className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              <DatabaseText k="newView" />
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
                placeholder={db("table")}
                aria-label={db("newViewName")}
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
  const db = useDatabaseT();
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
            aria-label={db("nameColumnMenu")}
            className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded px-1 text-left hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="shrink-0 text-[13px] leading-none text-muted-foreground">
              Aa
            </span>
            <span className="truncate">
              <DatabaseText k="name" />
            </span>
            <DatabaseColumnStateIndicators state={columnState} />
            <IconChevronDown className="ml-auto size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-70 data-[state=open]:opacity-100" />
          </button>
        </DropdownMenuTrigger>
        <ColumnHeaderMenuContent
          columnKey="name"
          label={db("name")}
          sorts={sorts}
          filters={filters}
          onSortsChange={onSortsChange}
          onFiltersChange={onFiltersChange}
          source={source}
          sourceField={sourceFieldMappingForColumn(source, "name")}
        />
      </DropdownMenu>
      <ColumnResizeHandle
        label={db("resizeNameColumn")}
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
  const db = useDatabaseT();
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
              <DatabaseText k="duplicate" />
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
              <DatabaseText k="delete" />
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
          <DatabaseText k="clear" />
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
  const db = useDatabaseT();
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
                  <DatabaseText k="noEditableProperties" />
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
  const db = useDatabaseT();
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
          <DatabaseText k="checked" />
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
          <DatabaseText k="unchecked" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="justify-start"
          disabled={disabled}
          onClick={() => void onApply(null)}
        >
          <DatabaseText k="clearValue" />
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
  const db = useDatabaseT();
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
            <DatabaseText k="today" />
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
            <DatabaseText k="tomorrow" />
          </Button>
        </div>
      ) : null}
      <Input
        autoFocus
        value={value}
        type={inputType}
        aria-label={`Set ${property.definition.name} for selected rows`}
        placeholder={db("value")}
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
          <DatabaseText k="enterAValidNumber" />
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
          <DatabaseText k="clear" />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <DatabaseText k="cancel" />
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={disabled || !valueState.isValid}
        >
          <DatabaseText k="apply" />
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
  const db = useDatabaseT();
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
        placeholder={db("oneFileOrMediaLinkPerLine")}
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
          <DatabaseText k="clear" />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <DatabaseText k="cancel" />
        </Button>
        <Button type="submit" size="sm" disabled={disabled}>
          <DatabaseText k="apply" />
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
  const db = useDatabaseT();
  const options = property.definition.options.options ?? [];
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const multi = property.definition.type === "multi_select";

  if (options.length === 0) {
    return (
      <div className="grid gap-2">
        <div className="rounded bg-muted/40 px-2 py-3 text-sm text-muted-foreground">
          <DatabaseText k="thisPropertyHasNoOptionsYet" />
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="justify-start"
          disabled={disabled}
          onClick={() => void onApply(multi ? [] : null)}
        >
          <DatabaseText k="clearValue" />
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
            <DatabaseText k="clear" />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            <DatabaseText k="cancel" />
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => void onApply(selectedIds)}
          >
            <DatabaseText k="apply" />
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
        <DatabaseText k="clearValue" />
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
  sources,
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
  sources: ContentDatabaseSource[];
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
          sources={sources}
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
  const db = useDatabaseT();
  const columnSort = sorts.find((sort) => sort.key === columnKey) ?? null;
  const columnFilterCount = filters.filter(
    (filter) => filter.key === columnKey,
  ).length;
  const quickFilters = databaseQuickFilterOptionsForColumn(db, propertyType);

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
        <span className="min-w-0 flex-1">
          <DatabaseText k="sortAscending" />
        </span>
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
        <span className="min-w-0 flex-1">
          <DatabaseText k="sortDescending" />
        </span>
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
          <DatabaseText k="clearSort" />
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
            <DatabaseText k="hideInView" />
          </DropdownMenuItem>
        </>
      ) : null}
      {source ? (
        <>
          <DropdownMenuSeparator />
          <div className="grid gap-1 px-2 py-1.5 text-xs">
            <div className="font-medium text-foreground">
              <DatabaseText k="source" />
            </div>
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
                <DatabaseText k="notMappedToBuilder" />
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
  const db = useDatabaseT();
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
          title={db("propertyVisibility")}
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
          <DatabaseText k="properties" />
        </DropdownMenuLabel>
        <div
          className="grid gap-2 p-2 pt-1"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="flex h-8 items-center gap-1 rounded border border-border bg-background px-2">
            <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
            <Input
              value={query}
              placeholder={db("searchProperties")}
              aria-label={db("searchProperties")}
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
                <DatabaseText k="showAll" />
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
                <DatabaseText k="hideAll" />
              </Button>
            </div>
          </div>
        </div>
        {filteredProperties.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            <DatabaseText k="noMatchingProperties" />
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
          <AddProperty documentId={documentId} label={db("newProperty")} />
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
  dbOrPropertyType: DatabaseT | DocumentPropertyType,
  propertyType?: DocumentPropertyType,
): Array<{ operator: DatabaseQuickFilterOperator; label: string }> {
  const db =
    typeof dbOrPropertyType === "function"
      ? dbOrPropertyType
      : defaultDatabaseT;
  const type =
    typeof dbOrPropertyType === "function" ? propertyType : dbOrPropertyType;
  if (type === "checkbox") {
    return [
      { operator: "is_checked", label: db("filterChecked") },
      { operator: "is_unchecked", label: db("filterUnchecked") },
    ];
  }
  return [
    { operator: "is_empty", label: db("filterEmpty") },
    { operator: "is_not_empty", label: db("filterNotEmpty") },
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
  const db = useDatabaseT();
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
          title={db("sort")}
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
            <DatabaseText k="sortRowsBy" />
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
              <DatabaseText k="addSort" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              disabled={sorts.length === 0}
              onClick={() => onSortsChange([])}
            >
              <DatabaseText k="clearSorts" />
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
  const db = useDatabaseT();
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
          title={db("filter")}
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
            <DatabaseText k="filterRowsWhere" />
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
              <DatabaseText k="addFilter" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              disabled={filters.length === 0}
              onClick={() => onFiltersChange([])}
            >
              <DatabaseText k="clearFilters" />
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
  const db = useDatabaseT();
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
                placeholder={db("searchOptions")}
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
                <DatabaseText k="clearValue" />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {filteredOptions.length === 0 && !canCreateOption ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              <DatabaseText k="noMatchingOptions" />
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
  const db = useDatabaseT();
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
      toast.error(db("failedToDuplicateRow"), {
        description:
          err instanceof Error ? err.message : db("somethingWentWrong"),
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
      toast.error(db("failedToDeleteRow"), {
        description:
          err instanceof Error ? err.message : db("somethingWentWrong"),
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
            <DatabaseText k="openPage" />
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={duplicateItem.isPending}
            onSelect={(event) => {
              event.preventDefault();
              void duplicateRow();
            }}
          >
            <IconCopy className="mr-2 size-4 text-muted-foreground" />
            <DatabaseText k="duplicateRow" />
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
            <DatabaseText k="deleteRow" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <DatabaseText k="deleteRow2" />
            </AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{title}&rdquo; and any sub-pages will be permanently
              deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <DatabaseText k="cancel" />
            </AlertDialogCancel>
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
  const db = useDatabaseT();
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
          placeholder={db("untitled")}
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
