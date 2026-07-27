// i18n-raw-literal-disable-file
// Navigation context state helpers exposed to the agent.
// Pure logic — no React, no icons.
import type {
  ContentDatabaseItem,
  ContentDatabaseResponse,
  ContentDatabaseSource,
  ContentDatabaseView,
  Document,
  DocumentProperty,
  DocumentPropertyType,
  DocumentPropertyValue,
} from "@shared/api";
import { isComputedPropertyType } from "@shared/properties";

import { databaseCalculationSummaries } from "./calculations";
import { propertyValueText } from "./filter-sort";
import { databaseCalendarDateProperty } from "./grouping";
import type {
  DatabaseSort,
  DatabaseFilter,
  DatabaseDateViewRange,
} from "./types";

export function databaseItemPreviewTitle(
  item: Pick<ContentDatabaseItem, "document"> | null | undefined,
) {
  return item?.document.title?.trim() || "Untitled";
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

export function databaseNavigationState({
  document,
  databaseId,
  databaseDocumentId,
  hostDocumentId,
  renderMode,
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
  databaseDocumentId?: string;
  hostDocumentId?: string;
  renderMode?: "page" | "inline";
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
    | "formQuestions"
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
  const navigationInstanceHostId =
    hostDocumentId ?? databaseDocumentId ?? document.id;

  return {
    view: "editor",
    documentId: document.id,
    title: document.title,
    databaseId,
    databaseDocumentId,
    databaseHostDocumentId: hostDocumentId,
    databaseRenderMode: renderMode,
    databaseNavigationInstanceId:
      databaseDocumentId || hostDocumentId || renderMode
        ? `${navigationInstanceHostId}:${databaseId}`
        : undefined,
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
    databaseFormQuestions:
      activeView.type === "form" ? activeView.formQuestions : undefined,
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
    Pick<
      Partial<ContentDatabaseResponse>,
      "duplicatedItemId" | "duplicatedItemIds"
    >,
) {
  const duplicatedItemIds = response.duplicatedItemIds ?? [];
  const duplicatedItemId =
    duplicatedItemIds.length > 0
      ? duplicatedItemIds[duplicatedItemIds.length - 1]
      : response.duplicatedItemId;
  return response.items.find((item) => item.id === duplicatedItemId) ?? null;
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
