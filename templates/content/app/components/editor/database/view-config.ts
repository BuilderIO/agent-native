// View config CRUD: create, normalize, update, add, rename, duplicate, delete, move views.
// Pure logic — no React, no icons.
import type {
  ContentDatabaseView,
  ContentDatabaseViewConfig,
  ContentDatabaseViewType,
} from "@shared/api";

import {
  type DatabaseColumnCalculation,
  type DatabaseDropSide,
  type DatabaseFilter,
  type DatabaseSort,
  type DatabaseViewMoveDirection,
} from "./types";

export { type DatabaseViewMoveDirection };

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

export function normalizeClientStringList(value: unknown) {
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

export function createDatabaseViewId() {
  return `view-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function databaseViewStateKey(
  databaseId: string,
  viewConfig: ContentDatabaseViewConfig,
) {
  return JSON.stringify({ databaseId, viewConfig });
}

export function databaseViewDefaultName(type: ContentDatabaseViewType) {
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

// Normalize helpers used by normalizeClientDatabaseView and createDatabaseView.
export function normalizeClientDatabaseFilterMode(
  value: unknown,
): import("./types").DatabaseFilterMode {
  return value === "or" ? "or" : "and";
}

export function normalizeClientDatabaseRowDensity(
  value: unknown,
): import("./types").DatabaseRowDensity {
  if (value === "compact" || value === "comfortable") return value;
  return "default";
}

export function normalizeClientDatabaseOpenPagesIn(
  value: unknown,
): import("@shared/api").ContentDatabaseOpenPagesIn {
  return value === "full_page" ? "full_page" : "preview";
}
