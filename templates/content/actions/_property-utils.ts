import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  sql,
  type InferSelectModel,
} from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseFilter,
  ContentDatabaseFilterMode,
  ContentDatabaseSort,
  ContentDatabaseView,
  ContentDatabaseViewConfig,
  ContentDatabaseColumnCalculation,
  ContentDatabaseRowDensity,
  ContentDatabaseOpenPagesIn,
  DocumentProperty,
} from "../shared/api.js";
import {
  DEFAULT_BLOCKS_FIELD_NAME,
  defaultPropertyOptions,
  evaluatePropertyFormula,
  formulaValueText,
  isBlocksPropertyType,
  isComputedPropertyType,
  isEmptyPropertyValue,
  isPrimaryBlocksField,
  normalizePropertyValue,
  resolveBlocksFieldValue,
  normalizePropertyVisibility,
  parsePropertyOptions,
  parsePropertyValue,
  serializePropertyOptions,
  serializePropertyValue,
  type DocumentPropertyOptions,
  type DocumentPropertyType,
  type DocumentPropertyValue,
} from "../shared/properties.js";
import { chunks } from "./_batch-utils.js";
import {
  propertyDefinitionsPositionScope,
  withPositionLock,
} from "./_position-utils.js";

type DocumentRow = InferSelectModel<typeof schema.documents>;
type ContentDatabaseRow = InferSelectModel<typeof schema.contentDatabases>;
type ContentDatabaseItemRow = InferSelectModel<
  typeof schema.contentDatabaseItems
>;
type DbClient = ReturnType<typeof getDb>;

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
  context: { databaseRowNumber?: number | null } = {},
): DocumentPropertyValue {
  switch (type) {
    case "id":
      return context.databaseRowNumber ?? document.id;
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
    .where(
      and(
        eq(schema.contentDatabases.documentId, documentId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
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
    .where(
      and(
        eq(schema.contentDatabaseItems.documentId, documentId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
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
    .where(
      and(
        eq(schema.contentDatabases.id, databaseId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
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
                : type === "form"
                  ? "Form"
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
    openPagesIn: normalizeDatabaseOpenPagesIn(values.openPagesIn),
    formQuestions: normalizeDatabaseFormQuestions(values.formQuestions),
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
    view.type === "timeline" ||
    view.type === "form"
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
    openPagesIn: normalizeDatabaseOpenPagesIn(view.openPagesIn),
    formQuestions: normalizeDatabaseFormQuestions(view.formQuestions),
  };
}

function normalizeDatabaseFormQuestions(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const question = candidate as {
      key?: unknown;
      enabled?: unknown;
      required?: unknown;
    };
    const key = typeof question.key === "string" ? question.key.trim() : "";
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [
      {
        key,
        enabled: question.enabled !== false,
        required: question.required === true,
      },
    ];
  });
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

function normalizeDatabaseOpenPagesIn(
  value: unknown,
): ContentDatabaseOpenPagesIn {
  return value === "full_page" ? "full_page" : "preview";
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
  // Read path: PURE read. Seeding the primary Blocks field happens at create
  // time and via the one-time startup repair (repairUnseededBlocksFields) —
  // never here. A viewer opening a shared/legacy row must not trigger writes on
  // another owner's database.
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
  const rowNumberByDocumentId = valueDocument
    ? await databaseRowNumbersByDocumentId(databaseId)
    : new Map<string, number>();

  // Additional (non-primary) Blocks fields keep their content in their own
  // store, keyed by (documentId, propertyId). Load this row's contents up front
  // so each Blocks field resolves to its OWN independent content.
  const blockContentByPropertyId = valueDocument
    ? await blockFieldContentsForDocument(valueDocument.id)
    : new Map<string, string>();

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
          ? computedPropertyValue(type, valueDocument, {
              databaseRowNumber: rowNumberByDocumentId.get(valueDocument.id),
            })
          : valueDocument && isBlocksPropertyType(type)
            ? // Each Blocks field reads from exactly one place: the primary from
              // the document body, additional fields from their own store.
              resolveBlocksFieldValue({
                options,
                documentBody: valueDocument.content,
                blockFieldContent: blockContentByPropertyId.get(definition.id),
              })
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

  const evaluatedProperties = properties.map((property) =>
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

  const nextProperties = [];
  for (const property of evaluatedProperties) {
    if (property.definition.type === "rollup") {
      nextProperties.push({
        ...property,
        value: await evaluatePropertyRollup(property, evaluatedProperties),
      });
    } else {
      nextProperties.push(property);
    }
  }

  return nextProperties;
}

function serializePropertyDefinition(
  definition: typeof schema.documentPropertyDefinitions.$inferSelect,
) {
  const type = definition.type as DocumentPropertyType;
  return {
    id: definition.id,
    databaseId: definition.databaseId,
    name: definition.name,
    type,
    visibility: normalizePropertyVisibility(definition.visibility),
    options: parsePropertyOptions(definition.optionsJson),
    position: definition.position,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}

function propertyValueKey(documentId: string, propertyId: string) {
  return `${documentId}\0${propertyId}`;
}

export async function listPropertiesForDatabaseDocuments(
  databaseId: string,
  valueDocuments: DocumentRow[],
): Promise<Map<string, DocumentProperty[]>> {
  const db = getDb();
  const definitions = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, databaseId))
    .orderBy(asc(schema.documentPropertyDefinitions.position));
  const result = new Map<string, DocumentProperty[]>();
  if (valueDocuments.length === 0) return result;
  if (definitions.length === 0) {
    for (const document of valueDocuments) result.set(document.id, []);
    return result;
  }

  const documentIds = valueDocuments.map((document) => document.id);
  const propertyIds = definitions.map((definition) => definition.id);
  const values: Array<typeof schema.documentPropertyValues.$inferSelect> = [];
  for (const documentIdChunk of chunks(documentIds, 200)) {
    for (const propertyIdChunk of chunks(propertyIds, 200)) {
      values.push(
        ...(await db
          .select()
          .from(schema.documentPropertyValues)
          .where(
            and(
              inArray(
                schema.documentPropertyValues.documentId,
                documentIdChunk,
              ),
              inArray(
                schema.documentPropertyValues.propertyId,
                propertyIdChunk,
              ),
            ),
          )),
      );
    }
  }
  const valueByDocumentAndProperty = new Map(
    values.map((value) => [
      propertyValueKey(value.documentId, value.propertyId),
      value,
    ]),
  );

  const rowNumberByDocumentId = definitions.some((definition) =>
    isComputedPropertyType(definition.type as DocumentPropertyType),
  )
    ? await databaseRowNumbersByDocumentId(databaseId)
    : new Map<string, number>();

  const blockContentByDocumentAndProperty = new Map<string, string>();
  const hasAdditionalBlocksFields = definitions.some((definition) => {
    const type = definition.type as DocumentPropertyType;
    return (
      isBlocksPropertyType(type) &&
      !isPrimaryBlocksField(parsePropertyOptions(definition.optionsJson))
    );
  });
  if (hasAdditionalBlocksFields) {
    for (const documentIdChunk of chunks(documentIds, 200)) {
      const rows = await db
        .select({
          documentId: schema.documentBlockFieldContents.documentId,
          propertyId: schema.documentBlockFieldContents.propertyId,
          content: schema.documentBlockFieldContents.content,
        })
        .from(schema.documentBlockFieldContents)
        .where(
          inArray(
            schema.documentBlockFieldContents.documentId,
            documentIdChunk,
          ),
        );
      for (const row of rows) {
        blockContentByDocumentAndProperty.set(
          propertyValueKey(row.documentId, row.propertyId),
          row.content ?? "",
        );
      }
    }
  }

  for (const document of valueDocuments) {
    const properties = definitions.map((definition) => {
      const propertyDefinition = serializePropertyDefinition(definition);
      const storedValue = valueByDocumentAndProperty.get(
        propertyValueKey(document.id, definition.id),
      );
      return {
        definition: propertyDefinition,
        value:
          isComputedPropertyType(propertyDefinition.type) &&
          propertyDefinition.type !== "formula"
            ? computedPropertyValue(propertyDefinition.type, document, {
                databaseRowNumber: rowNumberByDocumentId.get(document.id),
              })
            : isBlocksPropertyType(propertyDefinition.type)
              ? resolveBlocksFieldValue({
                  options: propertyDefinition.options,
                  documentBody: document.content,
                  blockFieldContent: blockContentByDocumentAndProperty.get(
                    propertyValueKey(document.id, definition.id),
                  ),
                })
              : parsePropertyValue(storedValue?.valueJson),
        editable: !isComputedPropertyType(propertyDefinition.type),
      };
    });

    const valuesByName = Object.fromEntries(
      properties
        .filter((property) => property.definition.type !== "formula")
        .map((property) => [property.definition.name, property.value]),
    );
    const evaluatedProperties = properties.map((property) =>
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
    const nextProperties = [];
    for (const property of evaluatedProperties) {
      if (property.definition.type === "rollup") {
        nextProperties.push({
          ...property,
          value: await evaluatePropertyRollup(property, evaluatedProperties),
        });
      } else {
        nextProperties.push(property);
      }
    }
    result.set(document.id, nextProperties);
  }

  return result;
}

async function evaluatePropertyRollup(
  property: DocumentProperty,
  properties: DocumentProperty[],
): Promise<DocumentPropertyValue> {
  const config = property.definition.options.rollup;
  const relationPropertyId = config?.relationPropertyId ?? null;
  const targetPropertyId = config?.targetPropertyId ?? null;
  const aggregation = config?.aggregation ?? "count";
  const relationProperty = relationPropertyId
    ? properties.find(
        (candidate) => candidate.definition.id === relationPropertyId,
      )
    : null;
  const linkedDocumentIds = relationValueIds(relationProperty?.value);

  if (aggregation === "count") return linkedDocumentIds.length;
  if (linkedDocumentIds.length === 0) return null;

  const targetProperty = targetPropertyId
    ? properties.find(
        (candidate) => candidate.definition.id === targetPropertyId,
      )
    : null;
  if (!targetProperty) return null;

  const values = await propertyValuesForLinkedDocuments(
    linkedDocumentIds,
    targetProperty,
  );
  const filledValues = values.filter((value) => !isEmptyPropertyValue(value));

  if (aggregation === "count_values") return filledValues.length;
  if (aggregation === "count_unique") {
    return new Set(filledValues.map((value) => formulaValueText(value))).size;
  }

  const numbers = filledValues
    .map((value) => Number(formulaValueText(value)))
    .filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  if (aggregation === "sum") {
    return numbers.reduce((total, value) => total + value, 0);
  }
  if (aggregation === "average") {
    return numbers.reduce((total, value) => total + value, 0) / numbers.length;
  }
  if (aggregation === "min") return Math.min(...numbers);
  if (aggregation === "max") return Math.max(...numbers);
  return null;
}

function relationValueIds(value: DocumentPropertyValue | undefined) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

async function propertyValuesForLinkedDocuments(
  documentIds: string[],
  property: DocumentProperty,
) {
  const db = getDb();
  const docs = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        inArray(schema.documents.id, documentIds),
        accessFilter(schema.documents, schema.documentShares),
      ),
    );
  const docById = new Map(docs.map((doc) => [doc.id, doc]));
  const accessibleDocumentIds = docs.map((doc) => doc.id);

  if (isComputedPropertyType(property.definition.type)) {
    const rowNumberByDocumentId = property.definition.databaseId
      ? await databaseRowNumbersByDocumentId(property.definition.databaseId)
      : new Map<string, number>();
    return documentIds.map((documentId) => {
      const doc = docById.get(documentId);
      return doc
        ? computedPropertyValue(property.definition.type, doc, {
            databaseRowNumber: rowNumberByDocumentId.get(documentId),
          })
        : null;
    });
  }

  if (accessibleDocumentIds.length === 0) {
    return documentIds.map(() => null);
  }

  if (isBlocksPropertyType(property.definition.type)) {
    const blockFieldRows = isPrimaryBlocksField(property.definition.options)
      ? []
      : await db
          .select({
            documentId: schema.documentBlockFieldContents.documentId,
            content: schema.documentBlockFieldContents.content,
          })
          .from(schema.documentBlockFieldContents)
          .where(
            and(
              inArray(
                schema.documentBlockFieldContents.documentId,
                accessibleDocumentIds,
              ),
              eq(
                schema.documentBlockFieldContents.propertyId,
                property.definition.id,
              ),
            ),
          );
    const blockFieldContentByDocumentId = new Map(
      blockFieldRows.map((row) => [row.documentId, row.content]),
    );
    return documentIds.map((documentId) => {
      const doc = docById.get(documentId);
      return doc
        ? resolveBlocksFieldValue({
            options: property.definition.options,
            documentBody: doc.content,
            blockFieldContent: blockFieldContentByDocumentId.get(documentId),
          })
        : null;
    });
  }

  const storedValues = await db
    .select()
    .from(schema.documentPropertyValues)
    .where(
      and(
        inArray(
          schema.documentPropertyValues.documentId,
          accessibleDocumentIds,
        ),
        eq(schema.documentPropertyValues.propertyId, property.definition.id),
      ),
    );
  const valueByDocumentId = new Map(
    storedValues.map((value) => [
      value.documentId,
      parsePropertyValue(value.valueJson),
    ]),
  );
  return documentIds.map(
    (documentId) => valueByDocumentId.get(documentId) ?? null,
  );
}

async function databaseRowNumbersByDocumentId(databaseId: string) {
  const db = getDb();
  const items = await db
    .select({
      documentId: schema.contentDatabaseItems.documentId,
    })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId))
    .orderBy(
      asc(schema.contentDatabaseItems.position),
      asc(schema.contentDatabaseItems.createdAt),
      asc(schema.contentDatabaseItems.id),
    );
  return new Map(
    items.map((item, index) => [item.documentId, index + 1] as const),
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

// --- Blocks fields ---------------------------------------------------------
//
// Storage model: the default/primary "Content" Blocks field is backed by
// `documents.content`. Every ADDITIONAL Blocks field stores its content in its
// own row in `document_block_field_contents`, keyed by (documentId,
// propertyId). This guarantees independence — no two Blocks fields ever share
// content.

// Load all additional-Blocks-field contents for a single document, keyed by
// propertyId. The primary field is intentionally absent here (its content lives
// on the document itself).
export async function blockFieldContentsForDocument(
  documentId: string,
): Promise<Map<string, string>> {
  const db = getDb();
  const rows = await db
    .select({
      propertyId: schema.documentBlockFieldContents.propertyId,
      content: schema.documentBlockFieldContents.content,
    })
    .from(schema.documentBlockFieldContents)
    .where(eq(schema.documentBlockFieldContents.documentId, documentId));
  return new Map(rows.map((row) => [row.propertyId, row.content ?? ""]));
}

export async function readBlockFieldContent(
  documentId: string,
  propertyId: string,
): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ content: schema.documentBlockFieldContents.content })
    .from(schema.documentBlockFieldContents)
    .where(
      and(
        eq(schema.documentBlockFieldContents.documentId, documentId),
        eq(schema.documentBlockFieldContents.propertyId, propertyId),
      ),
    );
  return row?.content ?? "";
}

// Upsert the content for an additional (non-primary) Blocks field.
//
// Atomic insert-or-update on the UNIQUE (document_id, property_id) index — no
// read-then-write window. Two concurrent first-saves can no longer race into a
// duplicate-key throw: the loser falls through to the conflict UPDATE branch.
export async function writeBlockFieldContent(args: {
  documentId: string;
  propertyId: string;
  ownerEmail: string;
  content: string;
  now: string;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.documentBlockFieldContents)
    .values({
      id: nanoid(),
      ownerEmail: args.ownerEmail,
      documentId: args.documentId,
      propertyId: args.propertyId,
      content: args.content,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoUpdate({
      target: [
        schema.documentBlockFieldContents.documentId,
        schema.documentBlockFieldContents.propertyId,
      ],
      set: { content: args.content, updatedAt: args.now },
    });
}

// Write the primary Blocks field's content — i.e. the document body.
export async function writePrimaryBlocksContent(args: {
  documentId: string;
  content: string;
  now: string;
}): Promise<void> {
  await assertAccess("document", args.documentId, "editor");
  const db = getDb();
  await db
    .update(schema.documents)
    .set({ content: args.content, updatedAt: args.now })
    .where(eq(schema.documents.id, args.documentId));
}

// Fetch a single property definition scoped to a database (and owner).
export async function getPropertyDefinitionForDatabase(args: {
  propertyId: string;
  databaseId: string;
  ownerEmail: string;
}) {
  const db = getDb();
  const [definition] = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(
      and(
        eq(schema.documentPropertyDefinitions.id, args.propertyId),
        eq(schema.documentPropertyDefinitions.ownerEmail, args.ownerEmail),
        eq(schema.documentPropertyDefinitions.databaseId, args.databaseId),
      ),
    );
  return definition ?? null;
}

// How many Blocks-type property definitions a database has. Used to drive the
// solo (chromeless) vs. multi (headers + collapsible) rendering decision and
// the "only Blocks field" delete warning.
export async function countBlocksFieldsForDatabase(
  databaseId: string,
): Promise<number> {
  const db = getDb();
  const definitions = await db
    .select({ type: schema.documentPropertyDefinitions.type })
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, databaseId));
  return definitions.filter((definition) =>
    isBlocksPropertyType(definition.type as DocumentPropertyType),
  ).length;
}

// The id of a database's existing primary Blocks definition, if any. Used to
// adopt a legacy primary created by the old read-path seeder rather than
// creating a duplicate.
async function findExistingPrimaryBlocksDefinition(
  databaseId: string,
  db: DbClient = getDb(),
): Promise<string | null> {
  const definitions = await db
    .select({
      id: schema.documentPropertyDefinitions.id,
      type: schema.documentPropertyDefinitions.type,
      optionsJson: schema.documentPropertyDefinitions.optionsJson,
    })
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, databaseId));
  const primary = definitions.find(
    (definition) =>
      isBlocksPropertyType(definition.type as DocumentPropertyType) &&
      isPrimaryBlocksField(parsePropertyOptions(definition.optionsJson)),
  );
  return primary?.id ?? null;
}

// Seed the primary "Content" Blocks field for a database exactly ONCE.
//
// `content_databases.primary_blocks_property_id` is the single source of truth
// and the concurrency guard. The deterministic primary definition is inserted
// before the database row is marked seeded, so we never publish blocks_seeded=1
// before the definition row exists. Two concurrent calls converge on the same
// property id and the loser returns the already-claimed id.
//
// Returns the primary property id (existing or newly created). Never reseeds a
// database whose primary was intentionally deleted (blocks_seeded=1, id NULL).
export async function seedDefaultBlocksField(args: {
  databaseId: string;
  ownerEmail: string;
  orgId: string | null;
  now: string;
  db?: DbClient;
}): Promise<string | null> {
  const db = args.db ?? getDb();

  // Deterministic id keyed to the database so concurrent claimants converge on
  // the same value; the UNIQUE primary-key on definitions also rejects a
  // duplicate insert if two callers somehow both attempt it.
  const id = `blocks_primary_${args.databaseId}`;

  // Legacy adoption: a database seeded by the OLD read-path safety net already
  // has a primary "Content" definition but a NULL column (if the v52 backfill
  // somehow didn't run for it). Adopt that existing definition instead of
  // creating a second primary — guarantees the invariant even off the migration
  // path. The atomic UPDATE (column still NULL) makes this race-safe.
  const existingPrimary = await findExistingPrimaryBlocksDefinition(
    args.databaseId,
    db,
  );
  if (existingPrimary) {
    await db
      .update(schema.contentDatabases)
      .set({
        primaryBlocksPropertyId: existingPrimary,
        blocksSeeded: 1,
        updatedAt: args.now,
      })
      .where(
        and(
          eq(schema.contentDatabases.id, args.databaseId),
          sql`primary_blocks_property_id IS NULL`,
        ),
      );
    return existingPrimary;
  }

  const [database] = await db
    .select({
      primaryId: schema.contentDatabases.primaryBlocksPropertyId,
      blocksSeeded: schema.contentDatabases.blocksSeeded,
    })
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, args.databaseId));
  if (!database) return null;
  if (database.primaryId) return database.primaryId;
  if (database.blocksSeeded === 1) return null;

  await withPositionLock(
    propertyDefinitionsPositionScope(args.databaseId),
    async () => {
      const [maxPos] = await db
        .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
        .from(schema.documentPropertyDefinitions)
        .where(
          eq(schema.documentPropertyDefinitions.databaseId, args.databaseId),
        );

      await db
        .insert(schema.documentPropertyDefinitions)
        .values({
          id,
          ownerEmail: args.ownerEmail,
          orgId: args.orgId,
          databaseId: args.databaseId,
          name: DEFAULT_BLOCKS_FIELD_NAME,
          type: "blocks",
          visibility: "always_show",
          optionsJson: serializePropertyOptions({ blocks: { primary: true } }),
          position: (maxPos?.max ?? -1) + 1,
          createdAt: args.now,
          updatedAt: args.now,
        })
        .onConflictDoNothing();
    },
  );

  const claim = await db
    .update(schema.contentDatabases)
    .set({
      primaryBlocksPropertyId: id,
      blocksSeeded: 1,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(schema.contentDatabases.id, args.databaseId),
        sql`primary_blocks_property_id IS NULL`,
        sql`blocks_seeded = 0`,
      ),
    )
    .returning({ id: schema.contentDatabases.primaryBlocksPropertyId });

  if (claim[0]?.id === id) return id;

  const [afterClaim] = await db
    .select({ primaryId: schema.contentDatabases.primaryBlocksPropertyId })
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, args.databaseId));
  if (afterClaim?.primaryId) return afterClaim.primaryId;

  await db
    .delete(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.id, id));
  return null;
}

// One-time startup repair for LEGACY databases that have never been seeded —
// i.e. databases created before the Blocks type existed and which have NO
// primary Blocks field yet (blocks_seeded = 0). Their `documents.content` body
// still works; seeding the primary field exposes it as a first-class property.
//
// Runs at boot from the migration plugin, NOT from any read path, so opening a
// shared/legacy row never triggers a write. Uses each database's own owner/org
// (no request context). Idempotent: the atomic claim in seedDefaultBlocksField
// makes re-runs no-ops, and databases whose primary was intentionally deleted
// (blocks_seeded = 1) are skipped.
export async function repairUnseededBlocksFields(): Promise<number> {
  const db = getDb();
  const databases = await db
    .select({
      id: schema.contentDatabases.id,
      ownerEmail: schema.contentDatabases.ownerEmail,
      orgId: schema.contentDatabases.orgId,
    })
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.blocksSeeded, 0));

  const now = new Date().toISOString();
  let seeded = 0;
  for (const database of databases) {
    await seedDefaultBlocksField({
      databaseId: database.id,
      ownerEmail: database.ownerEmail,
      orgId: database.orgId ?? null,
      now,
    });
    seeded += 1;
  }
  return seeded;
}
