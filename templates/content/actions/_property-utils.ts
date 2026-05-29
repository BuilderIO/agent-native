import { and, asc, eq, type InferSelectModel } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  defaultPropertyOptions,
  evaluatePropertyFormula,
  isComputedPropertyType,
  normalizePropertyValue,
  normalizePropertyVisibility,
  parsePropertyOptions,
  parsePropertyValue,
  serializePropertyOptions,
  serializePropertyValue,
  type DocumentPropertyOptions,
  type DocumentPropertyType,
  type DocumentPropertyValue,
} from "../shared/properties.js";
import type {
  ContentDatabaseFilter,
  ContentDatabaseFilterMode,
  ContentDatabaseSort,
  ContentDatabaseView,
  ContentDatabaseViewConfig,
  ContentDatabaseColumnCalculation,
  ContentDatabaseRowDensity,
} from "../shared/api.js";

type DocumentRow = InferSelectModel<typeof schema.documents>;
type ContentDatabaseRow = InferSelectModel<typeof schema.contentDatabases>;
type ContentDatabaseItemRow = InferSelectModel<
  typeof schema.contentDatabaseItems
>;

export function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

export function computedPropertyValue(
  type: DocumentPropertyType,
  document: DocumentRow,
): DocumentPropertyValue {
  switch (type) {
    case "id":
      return document.id;
    case "created_time":
      return document.createdAt;
    case "created_by":
      return document.ownerEmail;
    case "last_edited_time":
      return document.updatedAt;
    case "last_edited_by":
      return document.ownerEmail;
    default:
      return null;
  }
}

export async function getDatabaseForDocument(
  documentId: string,
): Promise<ContentDatabaseRow | null> {
  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.documentId, documentId));
  return database ?? null;
}

export async function getDatabaseMembershipForDocument(
  documentId: string,
): Promise<{
  item: ContentDatabaseItemRow;
  database: ContentDatabaseRow;
} | null> {
  const db = getDb();
  const [row] = await db
    .select({
      item: schema.contentDatabaseItems,
      database: schema.contentDatabases,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .where(eq(schema.contentDatabaseItems.documentId, documentId));
  return row ?? null;
}

export async function resolvePropertyDatabaseForDocument(
  document: DocumentRow,
): Promise<ContentDatabaseRow | null> {
  const ownedDatabase = await getDatabaseForDocument(document.id);
  if (ownedDatabase) return ownedDatabase;
  const membership = await getDatabaseMembershipForDocument(document.id);
  return membership?.database ?? null;
}

export async function getDatabaseById(
  databaseId: string,
): Promise<ContentDatabaseRow | null> {
  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  return database ?? null;
}

export function serializeDatabase(database: ContentDatabaseRow) {
  return {
    id: database.id,
    documentId: database.documentId,
    title: database.title,
    viewConfig: parseDatabaseViewConfig(database.viewConfigJson),
    createdAt: database.createdAt,
    updatedAt: database.updatedAt,
  };
}

export function parseDatabaseViewConfig(
  value: string | null | undefined,
): ContentDatabaseViewConfig {
  if (!value) return defaultDatabaseViewConfig();
  try {
    const parsed = JSON.parse(value) as Partial<ContentDatabaseViewConfig>;
    return normalizeDatabaseViewConfig(parsed);
  } catch {
    return defaultDatabaseViewConfig();
  }
}

export function serializeDatabaseViewConfig(
  value: Partial<ContentDatabaseViewConfig>,
) {
  return JSON.stringify(normalizeDatabaseViewConfig(value));
}

function defaultDatabaseViewConfig(): ContentDatabaseViewConfig {
  const view = defaultDatabaseView();
  return {
    activeViewId: view.id,
    views: [view],
    sorts: view.sorts,
    filters: view.filters,
    columnWidths: view.columnWidths,
  };
}

function normalizeDatabaseViewConfig(
  value: Partial<ContentDatabaseViewConfig> | null | undefined,
): ContentDatabaseViewConfig {
  const legacySorts = Array.isArray(value?.sorts)
    ? value.sorts.filter(isDatabaseSort)
    : [];
  const legacyFilters = Array.isArray(value?.filters)
    ? value.filters.filter(isDatabaseFilter)
    : [];
  const legacyColumnWidths = normalizeColumnWidths(value?.columnWidths);
  const views = Array.isArray(value?.views)
    ? value.views
        .map((view) => normalizeDatabaseView(view))
        .filter((view): view is ContentDatabaseView => !!view)
    : [];
  const normalizedViews =
    views.length > 0
      ? views
      : [
          defaultDatabaseView({
            sorts: legacySorts,
            filters: legacyFilters,
            columnWidths: legacyColumnWidths,
          }),
        ];
  const activeViewId =
    typeof value?.activeViewId === "string" &&
    normalizedViews.some((view) => view.id === value.activeViewId)
      ? value.activeViewId
      : normalizedViews[0]?.id;
  const activeView =
    normalizedViews.find((view) => view.id === activeViewId) ??
    normalizedViews[0] ??
    defaultDatabaseView();

  return {
    activeViewId: activeView.id,
    views: normalizedViews,
    sorts: activeView.sorts,
    filters: activeView.filters,
    columnWidths: activeView.columnWidths,
  };
}

function defaultDatabaseView(
  values: Partial<Omit<ContentDatabaseView, "id" | "name" | "type">> = {},
  type: ContentDatabaseView["type"] = "table",
): ContentDatabaseView {
  return {
    id: "default",
    name:
      type === "board"
        ? "Board"
        : type === "list"
          ? "List"
          : type === "gallery"
            ? "Gallery"
            : type === "calendar"
              ? "Calendar"
              : type === "timeline"
                ? "Timeline"
                : "Table",
    type,
    sorts: values.sorts ?? [],
    filters: values.filters ?? [],
    filterMode: normalizeDatabaseFilterMode(values.filterMode),
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
    rowDensity: normalizeDatabaseRowDensity(values.rowDensity),
  };
}

function normalizeDatabaseView(value: unknown): ContentDatabaseView | null {
  if (!value || typeof value !== "object") return null;
  const view = value as Partial<ContentDatabaseView>;
  if (typeof view.id !== "string" || !view.id.trim()) return null;
  const type =
    view.type === "board" ||
    view.type === "list" ||
    view.type === "gallery" ||
    view.type === "calendar" ||
    view.type === "timeline"
      ? view.type
      : "table";
  return {
    id: view.id,
    name:
      typeof view.name === "string" && view.name.trim()
        ? view.name.trim()
        : defaultDatabaseView({}, type).name,
    type,
    sorts: Array.isArray(view.sorts) ? view.sorts.filter(isDatabaseSort) : [],
    filters: Array.isArray(view.filters)
      ? view.filters.filter(isDatabaseFilter)
      : [],
    filterMode: normalizeDatabaseFilterMode(view.filterMode),
    columnWidths: normalizeColumnWidths(view.columnWidths),
    groupByPropertyId:
      typeof view.groupByPropertyId === "string" && view.groupByPropertyId
        ? view.groupByPropertyId
        : null,
    datePropertyId:
      typeof view.datePropertyId === "string" && view.datePropertyId
        ? view.datePropertyId
        : null,
    endDatePropertyId:
      typeof view.endDatePropertyId === "string" && view.endDatePropertyId
        ? view.endDatePropertyId
        : null,
    hiddenPropertyIds: normalizeStringList(view.hiddenPropertyIds),
    propertyOrderIds: normalizeStringList(view.propertyOrderIds),
    collapsedGroupIds: normalizeStringList(view.collapsedGroupIds),
    hideEmptyGroups: view.hideEmptyGroups === true,
    calculations: normalizeCalculations(view.calculations),
    wrapCells: view.wrapCells === true,
    rowDensity: normalizeDatabaseRowDensity(view.rowDensity),
  };
}

function normalizeDatabaseFilterMode(
  value: unknown,
): ContentDatabaseFilterMode {
  return value === "or" ? "or" : "and";
}

function normalizeDatabaseRowDensity(
  value: unknown,
): ContentDatabaseRowDensity {
  if (value === "compact" || value === "comfortable") return value;
  return "default";
}

function normalizeCalculations(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter(
    (entry): entry is [string, ContentDatabaseColumnCalculation] =>
      typeof entry[0] === "string" && isDatabaseColumnCalculation(entry[1]),
  );
  return Object.fromEntries(entries);
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

function isDatabaseSort(value: unknown): value is ContentDatabaseSort {
  if (!value || typeof value !== "object") return false;
  const sort = value as Partial<ContentDatabaseSort>;
  return (
    typeof sort.key === "string" &&
    typeof sort.label === "string" &&
    (sort.direction === "asc" || sort.direction === "desc")
  );
}

function isDatabaseFilter(value: unknown): value is ContentDatabaseFilter {
  if (!value || typeof value !== "object") return false;
  const filter = value as Partial<ContentDatabaseFilter>;
  return (
    typeof filter.key === "string" &&
    typeof filter.label === "string" &&
    typeof filter.operator === "string" &&
    typeof filter.value === "string"
  );
}

function normalizeColumnWidths(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => {
      const [key, width] = entry;
      return (
        typeof key === "string" &&
        typeof width === "number" &&
        Number.isFinite(width)
      );
    },
  );
  return Object.fromEntries(entries);
}

function normalizeStringList(value: unknown) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === "string"),
        ),
      ]
    : [];
}

export async function listPropertiesForDocument(document: DocumentRow) {
  const database = await resolvePropertyDatabaseForDocument(document);
  if (!database) return [];
  return listPropertiesForDatabase(database.id, document);
}

export async function listPropertiesForDatabase(
  databaseId: string,
  valueDocument?: DocumentRow,
) {
  const db = getDb();
  const definitions = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, databaseId))
    .orderBy(asc(schema.documentPropertyDefinitions.position));

  if (definitions.length === 0) return [];

  const values = valueDocument
    ? await db
        .select()
        .from(schema.documentPropertyValues)
        .where(eq(schema.documentPropertyValues.documentId, valueDocument.id))
    : [];

  const valueByPropertyId = new Map(
    values.map((value) => [value.propertyId, value]),
  );

  const properties = definitions.map((definition) => {
    const type = definition.type as DocumentPropertyType;
    const storedValue = valueByPropertyId.get(definition.id);
    const options = parsePropertyOptions(definition.optionsJson);
    return {
      definition: {
        id: definition.id,
        databaseId: definition.databaseId,
        name: definition.name,
        type,
        visibility: normalizePropertyVisibility(definition.visibility),
        options,
        position: definition.position,
        createdAt: definition.createdAt,
        updatedAt: definition.updatedAt,
      },
      value:
        valueDocument && isComputedPropertyType(type) && type !== "formula"
          ? computedPropertyValue(type, valueDocument)
          : parsePropertyValue(storedValue?.valueJson),
      editable: !isComputedPropertyType(type),
    };
  });

  if (!valueDocument) return properties;

  const valuesByName = Object.fromEntries(
    properties
      .filter((property) => property.definition.type !== "formula")
      .map((property) => [property.definition.name, property.value]),
  );

  return properties.map((property) =>
    property.definition.type === "formula"
      ? {
          ...property,
          value: evaluatePropertyFormula(
            property.definition.options.formula,
            valuesByName,
          ),
        }
      : property,
  );
}

export function optionsForNewProperty(
  type: DocumentPropertyType,
  options?: DocumentPropertyOptions,
) {
  return serializePropertyOptions(options ?? defaultPropertyOptions(type));
}

export function normalizedValueJson(
  type: DocumentPropertyType,
  value: unknown,
) {
  return serializePropertyValue(normalizePropertyValue(type, value));
}
