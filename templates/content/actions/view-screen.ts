import { defineAction } from "@agent-native/core";
import {
  readAppState,
  readAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, asc, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  documentDiscoveryFilter,
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import type {
  ContentDatabaseColumnCalculation,
  ContentDatabaseFilterMode,
  ContentDatabaseItem,
  ContentDatabaseOpenPagesIn,
  ContentDatabaseResponse,
  ContentDatabaseRowDensity,
  ContentDatabaseView,
  ContentDatabaseViewType,
  DocumentProperty,
} from "../shared/api.js";
import {
  documentPropertyDateKey,
  formulaValueText,
  isEmptyPropertyValue,
} from "../shared/properties.js";
import {
  filterDatabaseContainedDocuments,
  getContentDatabaseResponse,
  getDatabaseByDocumentId,
  getDatabaseItemByDocumentId,
  getDocumentContextPath,
  serializeDatabaseMembership,
} from "./_database-utils.js";
import { serializeDocumentSource } from "./_document-source.js";
import {
  getLocalFileDocument,
  getLocalDocumentContextPath,
  isContentLocalFileMode,
  isLocalDocumentId,
  localContentViewScreenSummary,
} from "./_local-file-documents.js";
import {
  listPropertiesForDocument,
  serializeDatabase,
} from "./_property-utils.js";

type ScreenTreeDocument = Pick<
  typeof schema.documents.$inferSelect,
  | "id"
  | "parentId"
  | "title"
  | "icon"
  | "isFavorite"
  | "hideFromSearch"
  | "visibility"
>;

type ScreenTreeDatabase = Parameters<typeof serializeDatabase>[0];

export function serializeDocumentTreeItemForScreen(
  document: ScreenTreeDocument,
  database?: ScreenTreeDatabase | null,
) {
  return {
    id: document.id,
    parentId: document.parentId,
    title: document.title || "Untitled",
    icon: document.icon || undefined,
    isFavorite: parseDocumentFavorite(document.isFavorite),
    hideFromSearch: parseDocumentHideFromSearch(document.hideFromSearch),
    visibility: document.visibility,
    database: database ? serializeDatabase(database) : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function rowDensityValue(
  value: unknown,
): ContentDatabaseRowDensity | undefined {
  if (value === "compact" || value === "default" || value === "comfortable") {
    return value;
  }
  return undefined;
}

function openPagesInValue(
  value: unknown,
): ContentDatabaseOpenPagesIn | undefined {
  if (value === "preview" || value === "full_page") return value;
  return undefined;
}

function filterModeValue(
  value: unknown,
): ContentDatabaseFilterMode | undefined {
  if (value === "and" || value === "or") return value;
  return undefined;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : undefined;
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : undefined;
}

function databaseViewTypeValue(
  value: unknown,
): ContentDatabaseViewType | undefined {
  if (
    value === "table" ||
    value === "board" ||
    value === "list" ||
    value === "gallery" ||
    value === "calendar" ||
    value === "timeline" ||
    value === "form"
  ) {
    return value;
  }
  return undefined;
}

function isDatabaseColumnCalculation(
  value: unknown,
): value is ContentDatabaseColumnCalculation {
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

function propertyValueTextForScreen(
  property: ContentDatabaseResponse["properties"][number],
) {
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
  return formulaValueText(value);
}

export const DATABASE_CURRENT_VIEW_VISIBLE_ITEM_LIMIT = 50;

function propertyForDatabaseItem(
  item: ContentDatabaseItem,
  property: DocumentProperty,
) {
  return (
    item.properties.find(
      (candidate) => candidate.definition.id === property.definition.id,
    ) ?? property
  );
}

function calculationRecord(value: unknown) {
  const record = recordValue(value);
  if (!record) return undefined;
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, ContentDatabaseColumnCalculation] =>
        typeof entry[0] === "string" && isDatabaseColumnCalculation(entry[1]),
    ),
  );
}

function orderDatabasePropertiesForScreen(
  properties: DocumentProperty[],
  view: Pick<ContentDatabaseView, "propertyOrderIds"> | null,
) {
  const propertyById = new Map(
    properties.map((property) => [property.definition.id, property]),
  );
  const ordered = (view?.propertyOrderIds ?? [])
    .map((id) => propertyById.get(id))
    .filter((property): property is DocumentProperty => !!property);
  const orderedIds = new Set(ordered.map((property) => property.definition.id));
  return [
    ...ordered,
    ...properties.filter((property) => !orderedIds.has(property.definition.id)),
  ];
}

function isDatabasePropertyVisibleForScreen(
  property: DocumentProperty,
  items: ContentDatabaseItem[],
  view: Pick<ContentDatabaseView, "hiddenPropertyIds"> | null,
) {
  if (property.definition.visibility === "always_hide") return false;
  if ((view?.hiddenPropertyIds ?? []).includes(property.definition.id)) {
    return false;
  }
  if (property.definition.visibility !== "hide_when_empty") return true;

  return items.some(
    (item) =>
      !isEmptyPropertyValue(propertyForDatabaseItem(item, property).value),
  );
}

function visibleDatabasePropertiesForScreen(
  response: ContentDatabaseResponse,
  activeView: ContentDatabaseView | null,
) {
  return orderDatabasePropertiesForScreen(
    response.properties,
    activeView,
  ).filter((property) =>
    isDatabasePropertyVisibleForScreen(property, response.items, activeView),
  );
}

function databaseDatePropertyForScreen(
  view: Pick<ContentDatabaseView, "type" | "datePropertyId"> | null,
  properties: DocumentProperty[],
) {
  if (!view || (view.type !== "calendar" && view.type !== "timeline")) {
    return null;
  }
  const dateProperties = properties.filter(
    (property) =>
      property.definition.type === "date" ||
      property.definition.type === "created_time" ||
      property.definition.type === "last_edited_time",
  );
  return (
    dateProperties.find(
      (property) => property.definition.id === view.datePropertyId,
    ) ??
    dateProperties.find((property) => property.definition.type === "date") ??
    dateProperties[0] ??
    null
  );
}

function databaseViewSummariesForScreen(
  navigation: unknown,
  response: ContentDatabaseResponse,
) {
  const navigationViews = arrayValue(navigation)
    ?.map((view) => {
      const record = recordValue(view);
      const id = stringValue(record?.id);
      const name = stringValue(record?.name);
      const type = databaseViewTypeValue(record?.type);
      if (!id || !name || !type) return null;
      return { id, name, type };
    })
    .filter((view): view is Pick<ContentDatabaseView, "id" | "name" | "type"> =>
      Boolean(view),
    );

  if (navigationViews && navigationViews.length > 0) {
    return navigationViews;
  }

  return response.database.viewConfig.views.map((view) => ({
    id: view.id,
    name: view.name,
    type: view.type,
  }));
}

function databaseCalculationSummariesForScreen(
  calculations: Record<string, ContentDatabaseColumnCalculation>,
  items: ContentDatabaseItem[],
  visibleProperties: DocumentProperty[],
) {
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
        result: databaseColumnCalculationResultForScreen(
          calculation,
          items,
          property,
        ),
      },
    ];
  });
}

function databaseColumnCalculationResultForScreen(
  calculation: ContentDatabaseColumnCalculation,
  items: ContentDatabaseItem[],
  property: DocumentProperty,
) {
  const itemProperties = items.map((item) =>
    propertyForDatabaseItem(item, property),
  );
  const filledCount = itemProperties.filter(
    (itemProperty) => !isEmptyPropertyValue(itemProperty.value),
  ).length;

  if (calculation === "count_all") {
    return `${items.length} row${items.length === 1 ? "" : "s"}`;
  }
  if (calculation === "count_values") {
    return `${filledCount} value${filledCount === 1 ? "" : "s"}`;
  }
  if (calculation === "count_empty") {
    return `${items.length - filledCount} empty`;
  }
  if (calculation === "count_unique") {
    const values = new Set<string>();
    for (const itemProperty of itemProperties) {
      if (isEmptyPropertyValue(itemProperty.value)) continue;
      if (Array.isArray(itemProperty.value)) {
        for (const item of itemProperty.value) values.add(item);
      } else {
        values.add(propertyValueTextForScreen(itemProperty));
      }
    }
    return `${values.size} unique`;
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
      (itemProperty) => itemProperty.value === true,
    ).length;
    if (calculation === "count_checked") return `${checkedCount} checked`;
    if (calculation === "count_unchecked") {
      return `${items.length - checkedCount} unchecked`;
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
      .map((itemProperty) => propertyNumberValueForScreen(itemProperty))
      .filter(Number.isFinite);
    if (numbers.length === 0) return "Empty";
    if (calculation === "sum") {
      return `Sum ${formatDatabaseCalculationNumberForScreen(
        numbers.reduce((sum, value) => sum + value, 0),
      )}`;
    }
    if (calculation === "average") {
      return `Avg ${formatDatabaseCalculationNumberForScreen(
        numbers.reduce((sum, value) => sum + value, 0) / numbers.length,
      )}`;
    }
    if (calculation === "median") {
      return `Median ${formatDatabaseCalculationNumberForScreen(
        medianDatabaseCalculationNumberForScreen(numbers),
      )}`;
    }
    if (calculation === "min") {
      return `Min ${formatDatabaseCalculationNumberForScreen(Math.min(...numbers))}`;
    }
    if (calculation === "max") {
      return `Max ${formatDatabaseCalculationNumberForScreen(Math.max(...numbers))}`;
    }
    if (calculation === "range") {
      return `Range ${formatDatabaseCalculationNumberForScreen(
        Math.max(...numbers) - Math.min(...numbers),
      )}`;
    }
  }

  if (property.definition.type === "date") {
    const dateKeys = itemProperties
      .map((itemProperty) => calendarDateKeyForScreen(itemProperty.value))
      .filter((value): value is string => !!value)
      .sort();
    if (dateKeys.length === 0) return "Empty";
    if (calculation === "min") return `Earliest ${dateKeys[0]}`;
    if (calculation === "max") return `Latest ${dateKeys[dateKeys.length - 1]}`;
    if (calculation === "date_range") {
      const days = databaseDateRangeDaysForScreen(
        dateKeys[0],
        dateKeys[dateKeys.length - 1],
      );
      return `Range ${days} day${days === 1 ? "" : "s"}`;
    }
  }

  return "Calculate";
}

function propertyNumberValueForScreen(property: DocumentProperty) {
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

function calendarDateKeyForScreen(value: unknown) {
  return documentPropertyDateKey(value);
}

function formatDatabaseCalculationNumberForScreen(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function medianDatabaseCalculationNumberForScreen(numbers: number[]) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function databaseDateRangeDaysForScreen(startKey: string, endKey: string) {
  const start = new Date(`${startKey}T00:00:00.000Z`).getTime();
  const end = new Date(`${endKey}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function databaseCurrentViewSnapshot(
  navigation: unknown,
  response: ContentDatabaseResponse,
) {
  const nav = isRecord(navigation) ? navigation : {};
  const activeViewId =
    stringValue(nav.databaseViewId) ??
    response.database.viewConfig.activeViewId;
  const activeView =
    response.database.viewConfig.views.find(
      (view) => view.id === activeViewId,
    ) ??
    response.database.viewConfig.views[0] ??
    null;
  const visibleProperties = visibleDatabasePropertiesForScreen(
    response,
    activeView,
  );
  const fallbackVisibleItems = response.items
    .slice(0, DATABASE_CURRENT_VIEW_VISIBLE_ITEM_LIMIT)
    .map((item) => ({
      itemId: item.id,
      documentId: item.document.id,
      title: item.document.title?.trim() || "Untitled",
      position: item.position,
      properties: visibleProperties.map((property) => {
        const itemProperty = propertyForDatabaseItem(item, property);
        return {
          propertyId: property.definition.id,
          name: property.definition.name,
          type: property.definition.type,
          value: itemProperty.value,
          text: propertyValueTextForScreen(itemProperty),
        };
      }),
    }));
  const calculations =
    calculationRecord(nav.databaseCalculations) ??
    activeView?.calculations ??
    {};
  const calculationResults =
    arrayValue(nav.databaseCalculationResults) ??
    databaseCalculationSummariesForScreen(
      calculations,
      response.items,
      visibleProperties,
    );
  const groupByPropertyId =
    stringValue(nav.databaseGroupByPropertyId) ??
    activeView?.groupByPropertyId ??
    undefined;
  const groupProperty = groupByPropertyId
    ? response.properties.find(
        (property) => property.definition.id === groupByPropertyId,
      )
    : null;
  const navigationDatePropertyId = stringValue(nav.databaseDatePropertyId);
  const savedDatePropertyId = activeView?.datePropertyId ?? undefined;
  const dateProperty =
    (navigationDatePropertyId || savedDatePropertyId
      ? response.properties.find(
          (property) =>
            property.definition.id ===
            (navigationDatePropertyId ?? savedDatePropertyId),
        )
      : null) ?? databaseDatePropertyForScreen(activeView, response.properties);
  const datePropertyId =
    dateProperty?.definition.id ??
    navigationDatePropertyId ??
    savedDatePropertyId;
  const endDatePropertyId =
    stringValue(nav.databaseEndDatePropertyId) ??
    activeView?.endDatePropertyId ??
    undefined;
  const endDateProperty = endDatePropertyId
    ? response.properties.find(
        (property) => property.definition.id === endDatePropertyId,
      )
    : null;

  return {
    id: activeViewId,
    name: stringValue(nav.databaseViewName) ?? activeView?.name ?? "Table",
    type: stringValue(nav.databaseViewType) ?? activeView?.type ?? "table",
    views: databaseViewSummariesForScreen(nav.databaseViews, response),
    searchQuery: stringValue(nav.databaseSearchQuery),
    sorts: arrayValue(nav.databaseSorts) ?? activeView?.sorts ?? [],
    filterMode:
      filterModeValue(nav.databaseFilterMode) ??
      activeView?.filterMode ??
      "and",
    filters: arrayValue(nav.databaseActiveFilters) ?? activeView?.filters ?? [],
    groupByPropertyId,
    groupByPropertyName:
      stringValue(nav.databaseGroupByPropertyName) ??
      groupProperty?.definition.name,
    collapsedGroupIds:
      arrayValue(nav.databaseCollapsedGroupIds) ??
      activeView?.collapsedGroupIds ??
      [],
    hideEmptyGroups:
      typeof nav.databaseHideEmptyGroups === "boolean"
        ? nav.databaseHideEmptyGroups
        : activeView?.hideEmptyGroups === true,
    datePropertyId,
    datePropertyName:
      stringValue(nav.databaseDatePropertyName) ??
      dateProperty?.definition.name,
    endDatePropertyId,
    endDatePropertyName:
      stringValue(nav.databaseEndDatePropertyName) ??
      endDateProperty?.definition.name,
    dateRangeStart: stringValue(nav.databaseDateRangeStart),
    dateRangeEnd: stringValue(nav.databaseDateRangeEnd),
    dateRangeLabel: stringValue(nav.databaseDateRangeLabel),
    calculations,
    calculationResults,
    wrapCells:
      typeof nav.databaseWrapCells === "boolean"
        ? nav.databaseWrapCells
        : activeView?.wrapCells === true,
    rowDensity:
      rowDensityValue(nav.databaseRowDensity) ??
      activeView?.rowDensity ??
      "default",
    openPagesIn:
      openPagesInValue(nav.databaseOpenPagesIn) ??
      activeView?.openPagesIn ??
      "preview",
    formQuestions:
      arrayValue(nav.databaseFormQuestions) ?? activeView?.formQuestions ?? [],
    visibleItemCount:
      numberValue(nav.databaseVisibleItemCount) ?? response.items.length,
    totalItemCount:
      numberValue(nav.databaseTotalItemCount) ?? response.items.length,
    visibleItems: arrayValue(nav.databaseVisibleItems) ?? fallbackVisibleItems,
    visibleItemLimit:
      numberValue(nav.databaseVisibleItemLimit) ??
      DATABASE_CURRENT_VIEW_VISIBLE_ITEM_LIMIT,
    selectedItemCount: numberValue(nav.databaseSelectedItemCount) ?? 0,
    selectedItems: arrayValue(nav.databaseSelectedItems) ?? [],
  };
}

interface NavigationState {
  view?: string;
  documentId?: string;
  databasePreviewDocumentId?: string;
}

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Reads navigation state and fetches matching data.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const navigation = await readAppStateForCurrentTab("navigation");
    const localFilesState = await readAppState("local-files");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    const nav = navigation as NavigationState | null;
    if (await isContentLocalFileMode()) {
      screen.localFiles = {
        ...(await localContentViewScreenSummary()),
        actions: [
          "list-documents",
          "get-document",
          "create-document",
          "update-document",
          "delete-document",
          "share-local-file-document",
        ],
      };
      if (nav?.documentId && isLocalDocumentId(nav.documentId)) {
        screen.document = {
          ...(await getLocalFileDocument(nav.documentId)),
          contextPath: await getLocalDocumentContextPath(nav.documentId),
        };
      } else if (nav?.documentId) {
        const access = await resolveAccess("document", nav.documentId);
        if (access) {
          const doc = access.resource;
          screen.document = {
            id: doc.id,
            parentId: doc.parentId,
            title: doc.title,
            content: doc.content,
            description: doc.description,
            icon: doc.icon,
            position: doc.position,
            isFavorite: parseDocumentFavorite(doc.isFavorite),
            hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
            visibility: doc.visibility,
            source: serializeDocumentSource(doc),
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            contextPath: await getDocumentContextPath(doc),
          };
        }
      }
      return screen;
    }

    const db = getDb();

    if (nav?.view === "local-files") {
      screen.localFiles = {
        view: "local-files",
        actions: ["export-content-source", "import-content-source"],
        sourceRoot: "content/",
        fileTypes: [".md", ".mdx"],
        selectedFolders:
          localFilesState && typeof localFilesState === "object"
            ? localFilesState
            : undefined,
      };
    }

    if (nav?.documentId) {
      const access = await resolveAccess("document", nav.documentId);
      if (access) {
        const doc = access.resource;
        const database = await getDatabaseByDocumentId(doc.id);
        const databaseMembership = await getDatabaseItemByDocumentId(doc.id);
        screen.document = {
          id: doc.id,
          parentId: doc.parentId,
          title: doc.title,
          content: doc.content,
          description: doc.description,
          icon: doc.icon,
          position: doc.position,
          isFavorite: parseDocumentFavorite(doc.isFavorite),
          hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
          visibility: doc.visibility,
          database: database
            ? serializeDatabase(database, doc.description)
            : undefined,
          databaseMembership: databaseMembership
            ? serializeDatabaseMembership(databaseMembership)
            : undefined,
          properties: await listPropertiesForDocument(doc),
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          contextPath: await getDocumentContextPath(doc),
        };
        if (database) {
          const databaseResponse = await getContentDatabaseResponse(
            database.id,
          );
          screen.database = databaseResponse;
          screen.databaseCurrentView = databaseCurrentViewSnapshot(
            nav,
            databaseResponse,
          );

          const previewDocumentId =
            typeof nav?.databasePreviewDocumentId === "string"
              ? nav.databasePreviewDocumentId
              : null;
          if (previewDocumentId) {
            const previewAccess = await resolveAccess(
              "document",
              previewDocumentId,
            );
            const previewMembership =
              await getDatabaseItemByDocumentId(previewDocumentId);
            if (
              previewAccess &&
              previewMembership?.database.id === database.id
            ) {
              const previewDoc = previewAccess.resource;
              screen.databasePreview = {
                itemId: previewMembership.item.id,
                databaseId: previewMembership.database.id,
                databaseDocumentId: previewMembership.database.documentId,
                position: previewMembership.item.position,
                document: {
                  id: previewDoc.id,
                  parentId: previewDoc.parentId,
                  title: previewDoc.title,
                  content: previewDoc.content,
                  description: previewDoc.description,
                  icon: previewDoc.icon,
                  position: previewDoc.position,
                  isFavorite: parseDocumentFavorite(previewDoc.isFavorite),
                  hideFromSearch: parseDocumentHideFromSearch(
                    previewDoc.hideFromSearch,
                  ),
                  visibility: previewDoc.visibility,
                  databaseMembership:
                    serializeDatabaseMembership(previewMembership),
                  properties: await listPropertiesForDocument(previewDoc),
                  createdAt: previewDoc.createdAt,
                  updatedAt: previewDoc.updatedAt,
                  contextPath: await getDocumentContextPath(previewDoc),
                },
              };
            }
          }
        }
      }
    }

    const docs = await db
      .select()
      .from(schema.documents)
      .where(
        and(
          accessFilter(schema.documents, schema.documentShares),
          documentDiscoveryFilter(),
        ),
      )
      .orderBy(asc(schema.documents.position));

    if (docs.length > 0) {
      const databaseItems = await db
        .select({ documentId: schema.contentDatabaseItems.documentId })
        .from(schema.contentDatabaseItems)
        .where(
          inArray(
            schema.contentDatabaseItems.documentId,
            docs.map((doc) => doc.id),
          ),
        );
      const treeDocs = filterDatabaseContainedDocuments(
        docs,
        databaseItems.map((item) => item.documentId),
      );
      const treeDatabases =
        treeDocs.length > 0
          ? await db
              .select()
              .from(schema.contentDatabases)
              .where(
                inArray(
                  schema.contentDatabases.documentId,
                  treeDocs.map((doc) => doc.id),
                ),
              )
          : [];
      const treeDatabaseByDocumentId = new Map(
        treeDatabases.map((database) => [database.documentId, database]),
      );
      screen.documentTree = {
        count: treeDocs.length,
        containedDatabaseItemCount: docs.length - treeDocs.length,
        items: treeDocs.map((d) =>
          serializeDocumentTreeItemForScreen(
            d,
            treeDatabaseByDocumentId.get(d.id) ?? null,
          ),
        ),
      };
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }

    return screen;
  },
});
