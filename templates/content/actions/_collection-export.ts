import { fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseItem,
  ContentDatabaseTableQuery,
  DocumentProperty,
} from "../shared/api.js";
import type {
  CollectionExportProjection,
  CollectionExportRecord,
} from "../shared/database-collection-export.js";
import { databasePropertyValueText } from "../shared/database-csv-export.js";
import { applyContentDatabaseTableQuery } from "../shared/database-query.js";
import {
  evaluatePropertyFormula,
  formulaValueText,
  isBlocksPropertyType,
  isComputedPropertyType,
  isPrimaryBlocksField,
  parsePropertyValue,
  resolveBlocksFieldValue,
  type DocumentPropertyValue,
} from "../shared/properties.js";
import { chunks } from "./_batch-utils.js";
import { readPersonalDatabaseViewOverrides } from "./_content-database-personal-view.js";
import { listContentOrganizationMemberships } from "./_content-space-access.js";
import {
  CONTENT_DATABASE_MAX_READ_LIMIT,
  getDatabaseByDocumentId,
} from "./_database-utils.js";
import {
  computedPropertyValue,
  listPropertiesForDatabase,
  parseDatabaseViewConfig,
} from "./_property-utils.js";

export interface CollectionExportRequest {
  scope:
    | { kind: "all_members" }
    | {
        kind: "current_view";
        viewId: string;
        query: ContentDatabaseTableQuery;
      };
  propertyIds: string[];
  includePrimaryBody: boolean;
  blockPropertyIds: string[];
}

type Candidate = {
  item: {
    id: string;
    databaseId: string;
    documentId: string;
    position: number;
    bodyHydrationStatus: string;
  };
  document: {
    id: string;
    parentId: string | null;
    title: string;
    content?: string;
    icon: string | null;
    position: number;
    isFavorite: number;
    hideFromSearch: number;
    ownerEmail: string;
    createdAt: string;
    updatedAt: string;
  };
};

function accessClauses(userEmail: string, orgIds: readonly string[]) {
  return [
    accessFilter(
      schema.documents,
      schema.documentShares,
      { userEmail },
      "viewer",
      { includePublic: true },
    ),
    ...orgIds.map((orgId) =>
      accessFilter(
        schema.documents,
        schema.documentShares,
        { userEmail, orgId },
        "viewer",
        { includePublic: true },
      ),
    ),
  ];
}

async function loadCandidates(
  databaseId: string,
  includeContent: boolean,
  clauses: ReturnType<typeof accessClauses>,
): Promise<Candidate[]> {
  const documentColumns = {
    id: schema.documents.id,
    parentId: schema.documents.parentId,
    title: schema.documents.title,
    icon: schema.documents.icon,
    position: schema.documents.position,
    isFavorite: schema.documents.isFavorite,
    hideFromSearch: schema.documents.hideFromSearch,
    ownerEmail: schema.documents.ownerEmail,
    createdAt: schema.documents.createdAt,
    updatedAt: schema.documents.updatedAt,
    ...(includeContent ? { content: schema.documents.content } : {}),
  };
  return getDb()
    .select({
      item: {
        id: schema.contentDatabaseItems.id,
        databaseId: schema.contentDatabaseItems.databaseId,
        documentId: schema.contentDatabaseItems.documentId,
        position: schema.contentDatabaseItems.position,
        bodyHydrationStatus: schema.contentDatabaseItems.bodyHydrationStatus,
      },
      document: documentColumns,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, databaseId),
        isNull(schema.documents.trashedAt),
        or(...clauses),
      ),
    )
    .orderBy(
      asc(schema.contentDatabaseItems.position),
      asc(schema.contentDatabaseItems.createdAt),
      asc(schema.contentDatabaseItems.id),
    )
    .limit(CONTENT_DATABASE_MAX_READ_LIMIT + 1) as Promise<Candidate[]>;
}

function assertUnique(ids: readonly string[], label: string) {
  if (new Set(ids).size !== ids.length) {
    fail(`${label} must be unique.`, {
      errorCode: "invalid_collection_export_selection",
    });
  }
}

function assertValidQuery(
  query: ContentDatabaseTableQuery,
  propertyIds: ReadonlySet<string>,
) {
  for (const key of [...query.filters, ...query.sorts].map(({ key }) => key)) {
    if (key !== "name" && !propertyIds.has(key)) {
      fail(`Unknown database property "${key}" in export query.`, {
        errorCode: "invalid_collection_export_query",
      });
    }
  }
}

function queryPropertyIds(query: ContentDatabaseTableQuery) {
  return [...query.filters, ...query.sorts]
    .map(({ key }) => key)
    .filter((key) => key !== "name");
}

function queryNeedsBlocks(
  query: ContentDatabaseTableQuery,
  propertyById: ReadonlyMap<string, DocumentProperty>,
) {
  if (query.search.trim()) {
    return [...propertyById.values()].some((property) =>
      isBlocksPropertyType(property.definition.type),
    );
  }
  return [...query.filters, ...query.sorts].some(({ key }) => {
    const property = propertyById.get(key);
    return !!property && isBlocksPropertyType(property.definition.type);
  });
}

function queryWithOnlyFilters(
  filters: ContentDatabaseTableQuery["filters"],
  filterMode: ContentDatabaseTableQuery["filterMode"],
): ContentDatabaseTableQuery {
  return { search: "", filters, sorts: [], filterMode };
}

function formulaDependencyNames(formula: string | undefined) {
  return [...(formula ?? "").matchAll(/\{([^{}]+)\}/g)]
    .map((match) => match[1]?.trim())
    .filter((name): name is string => !!name);
}

function propertyKey(documentId: string, propertyId: string) {
  return `${documentId}\0${propertyId}`;
}

async function loadStoredValues(
  documentIds: readonly string[],
  propertyIds: readonly string[],
) {
  const values = new Map<string, DocumentPropertyValue>();
  for (const documentIdChunk of chunks([...documentIds], 180)) {
    for (const propertyIdChunk of chunks([...propertyIds], 180)) {
      const rows = await getDb()
        .select({
          documentId: schema.documentPropertyValues.documentId,
          propertyId: schema.documentPropertyValues.propertyId,
          valueJson: schema.documentPropertyValues.valueJson,
        })
        .from(schema.documentPropertyValues)
        .where(
          and(
            inArray(schema.documentPropertyValues.documentId, documentIdChunk),
            inArray(schema.documentPropertyValues.propertyId, propertyIdChunk),
          ),
        );
      for (const row of rows) {
        values.set(
          propertyKey(row.documentId, row.propertyId),
          parsePropertyValue(row.valueJson),
        );
      }
    }
  }
  return values;
}

async function loadAdditionalBlocks(
  documentIds: readonly string[],
  propertyIds: readonly string[],
) {
  const values = new Map<string, string>();
  for (const documentIdChunk of chunks([...documentIds], 180)) {
    for (const propertyIdChunk of chunks([...propertyIds], 180)) {
      const rows = await getDb()
        .select({
          documentId: schema.documentBlockFieldContents.documentId,
          propertyId: schema.documentBlockFieldContents.propertyId,
          content: schema.documentBlockFieldContents.content,
        })
        .from(schema.documentBlockFieldContents)
        .where(
          and(
            inArray(
              schema.documentBlockFieldContents.documentId,
              documentIdChunk,
            ),
            inArray(
              schema.documentBlockFieldContents.propertyId,
              propertyIdChunk,
            ),
          ),
        );
      for (const row of rows) {
        values.set(propertyKey(row.documentId, row.propertyId), row.content);
      }
    }
  }
  return values;
}

function aggregateRollup(
  aggregation: string,
  linkedIds: readonly string[],
  values: readonly DocumentPropertyValue[],
): DocumentPropertyValue {
  if (aggregation === "count") return linkedIds.length;
  const filled = values.filter(
    (value) =>
      value !== null && value !== undefined && formulaValueText(value) !== "",
  );
  if (aggregation === "count_values") return filled.length;
  if (aggregation === "count_unique") {
    return new Set(filled.map(formulaValueText)).size;
  }
  const numbers = filled
    .map((value) => Number(formulaValueText(value)))
    .filter(Number.isFinite);
  if (numbers.length === 0) return null;
  if (aggregation === "sum")
    return numbers.reduce((sum, value) => sum + value, 0);
  if (aggregation === "average") {
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  }
  if (aggregation === "min") return Math.min(...numbers);
  if (aggregation === "max") return Math.max(...numbers);
  return null;
}

export async function buildCollectionExportProjection(
  documentId: string,
  request: CollectionExportRequest,
): Promise<CollectionExportProjection> {
  const database = await getDatabaseByDocumentId(documentId);
  if (!database) {
    fail("Collection export requires a database document.", {
      errorCode: "collection_export_requires_database",
    });
  }
  const userEmail = getRequestUserEmail();
  if (!userEmail)
    fail("Not authenticated.", {
      errorCode: "not_authenticated",
      statusCode: 401,
    });

  assertUnique(request.propertyIds, "Collection export property IDs");
  assertUnique(
    request.blockPropertyIds,
    "Collection export Blocks property IDs",
  );
  const allProperties = await listPropertiesForDatabase(database.id);
  const propertyById = new Map(
    allProperties.map((property) => [property.definition.id, property]),
  );
  const propertyByName = new Map(
    allProperties.map((property) => [property.definition.name, property]),
  );
  const selectedScalars = request.propertyIds.map((id) => {
    const property = propertyById.get(id);
    if (!property || isBlocksPropertyType(property.definition.type)) {
      fail(`Unknown scalar database property "${id}".`, {
        errorCode: "invalid_collection_export_selection",
      });
    }
    return property;
  });
  const selectedBlocks = request.blockPropertyIds.map((id) => {
    const property = propertyById.get(id);
    if (
      !property ||
      !isBlocksPropertyType(property.definition.type) ||
      isPrimaryBlocksField(property.definition.options)
    ) {
      fail(`Unknown additional Blocks property "${id}".`, {
        errorCode: "invalid_collection_export_selection",
      });
    }
    return property;
  });
  const primaryBlocks = allProperties.find(
    (property) =>
      isBlocksPropertyType(property.definition.type) &&
      isPrimaryBlocksField(property.definition.options),
  );

  const savedQueries: ContentDatabaseTableQuery[] = [];
  let personalQuery: ContentDatabaseTableQuery | null = null;
  let transientQuery: ContentDatabaseTableQuery | null = null;
  if (request.scope.kind === "current_view") {
    const currentViewScope = request.scope;
    const savedView = parseDatabaseViewConfig(
      database.viewConfigJson,
    ).views.find((view) => view.id === currentViewScope.viewId);
    if (!savedView) {
      fail(`Database view "${currentViewScope.viewId}" not found.`, {
        errorCode: "collection_export_view_not_found",
        statusCode: 404,
      });
    }
    const knownPropertyIds = new Set(propertyById.keys());
    transientQuery = currentViewScope.query;
    assertValidQuery(transientQuery, knownPropertyIds);
    const savedQuery = queryWithOnlyFilters(
      savedView.filters,
      savedView.filterMode ?? "and",
    );
    assertValidQuery(savedQuery, knownPropertyIds);
    savedQueries.push(savedQuery);
    const personal = await readPersonalDatabaseViewOverrides(
      userEmail,
      database.id,
    );
    const personalView = personal?.views.find(
      (view) => view.id === savedView.id,
    );
    if (personalView) {
      personalQuery = queryWithOnlyFilters(
        personalView.filters,
        personalView.filterMode,
      );
      assertValidQuery(personalQuery, knownPropertyIds);
    }
  }

  const requiredPropertyIds = new Set<string>([
    ...request.propertyIds,
    ...request.blockPropertyIds,
    ...savedQueries.flatMap(queryPropertyIds),
    ...(personalQuery ? queryPropertyIds(personalQuery) : []),
    ...(transientQuery ? queryPropertyIds(transientQuery) : []),
  ]);
  if (transientQuery?.search.trim()) {
    for (const property of allProperties) {
      requiredPropertyIds.add(property.definition.id);
    }
  }
  const addDependencies = (
    propertyId: string,
    visiting = new Set<string>(),
  ) => {
    if (visiting.has(propertyId)) return;
    visiting.add(propertyId);
    const property = propertyById.get(propertyId);
    if (!property) return;
    if (property.definition.type === "formula") {
      for (const name of formulaDependencyNames(
        property.definition.options.formula,
      )) {
        const dependency = propertyByName.get(name);
        if (!dependency) continue;
        requiredPropertyIds.add(dependency.definition.id);
        addDependencies(dependency.definition.id, visiting);
      }
    }
    if (property.definition.type === "rollup") {
      const relationId = property.definition.options.rollup?.relationPropertyId;
      if (relationId) {
        requiredPropertyIds.add(relationId);
        addDependencies(relationId, visiting);
      }
    }
  };
  for (const propertyId of [...requiredPropertyIds])
    addDependencies(propertyId);

  const requiredProperties = allProperties.filter((property) =>
    requiredPropertyIds.has(property.definition.id),
  );
  const requiredBlocks = requiredProperties.filter((property) =>
    isBlocksPropertyType(property.definition.type),
  );
  const includePrimaryContent =
    request.includePrimaryBody ||
    requiredBlocks.some((property) =>
      isPrimaryBlocksField(property.definition.options),
    );
  const memberships = await listContentOrganizationMemberships(userEmail);
  const clauses = accessClauses(
    userEmail,
    memberships.map((membership) => membership.orgId),
  );
  const candidates = await loadCandidates(
    database.id,
    includePrimaryContent,
    clauses,
  );
  if (candidates.length > CONTENT_DATABASE_MAX_READ_LIMIT) {
    fail(
      `Collection export supports up to ${CONTENT_DATABASE_MAX_READ_LIMIT} authorized records. Narrow the current View and try again.`,
      { errorCode: "collection_export_limit_exceeded", statusCode: 413 },
    );
  }
  const documentIds = candidates.map(({ document }) => document.id);
  const storedPropertyIds = requiredProperties
    .filter(
      (property) =>
        !isBlocksPropertyType(property.definition.type) &&
        !isComputedPropertyType(property.definition.type),
    )
    .map((property) => property.definition.id);
  const storedValues = await loadStoredValues(documentIds, storedPropertyIds);
  const additionalBlockIds = requiredBlocks
    .filter((property) => !isPrimaryBlocksField(property.definition.options))
    .map((property) => property.definition.id);
  const additionalBlocks = await loadAdditionalBlocks(
    documentIds,
    additionalBlockIds,
  );
  const rowNumberByDocumentId = new Map(
    candidates.map(({ document }, index) => [document.id, index + 1]),
  );

  const rollupValues = new Map<string, DocumentPropertyValue>();
  const requiredRollups = requiredProperties.filter(
    (property) => property.definition.type === "rollup",
  );
  const linkedIds = new Set<string>();
  for (const rollup of requiredRollups) {
    const relationId = rollup.definition.options.rollup?.relationPropertyId;
    if (!relationId) continue;
    for (const documentId of documentIds) {
      const relationValue = storedValues.get(
        propertyKey(documentId, relationId),
      );
      const ids = Array.isArray(relationValue)
        ? relationValue.filter(
            (value): value is string => typeof value === "string",
          )
        : typeof relationValue === "string" && relationValue
          ? [relationValue]
          : [];
      for (const id of ids) linkedIds.add(id);
    }
  }
  const linkedDocuments = new Map<string, Candidate["document"]>();
  if (linkedIds.size) {
    for (const idChunk of chunks([...linkedIds], 180)) {
      const rows = await getDb()
        .select({
          id: schema.documents.id,
          parentId: schema.documents.parentId,
          title: schema.documents.title,
          icon: schema.documents.icon,
          position: schema.documents.position,
          isFavorite: schema.documents.isFavorite,
          hideFromSearch: schema.documents.hideFromSearch,
          ownerEmail: schema.documents.ownerEmail,
          createdAt: schema.documents.createdAt,
          updatedAt: schema.documents.updatedAt,
        })
        .from(schema.documents)
        .where(
          and(
            inArray(schema.documents.id, idChunk),
            isNull(schema.documents.trashedAt),
            or(...clauses),
          ),
        );
      for (const row of rows) linkedDocuments.set(row.id, row);
    }
  }
  const rollupTargetIds = [
    ...new Set(
      requiredRollups
        .map((property) => property.definition.options.rollup?.targetPropertyId)
        .filter((id): id is string => !!id),
    ),
  ];
  for (const rollup of requiredRollups) {
    const config = rollup.definition.options.rollup;
    if (!config?.targetPropertyId || config.aggregation === "count") continue;
    const target = propertyById.get(config.targetPropertyId);
    if (
      target &&
      (isComputedPropertyType(target.definition.type) ||
        isBlocksPropertyType(target.definition.type))
    ) {
      fail(
        `Rollup "${rollup.definition.name}" targets a computed or Blocks property that this bounded export cannot hydrate safely.`,
        {
          errorCode: "collection_export_rollup_target_unsupported",
          statusCode: 422,
        },
      );
    }
  }
  const linkedStoredValues = await loadStoredValues(
    [...linkedDocuments.keys()],
    rollupTargetIds,
  );
  for (const rollup of requiredRollups) {
    const config = rollup.definition.options.rollup;
    if (!config?.relationPropertyId) continue;
    for (const documentId of documentIds) {
      const relationValue = storedValues.get(
        propertyKey(documentId, config.relationPropertyId),
      );
      const ids = (
        Array.isArray(relationValue)
          ? relationValue
          : typeof relationValue === "string"
            ? [relationValue]
            : []
      ).filter(
        (id): id is string => typeof id === "string" && linkedDocuments.has(id),
      );
      const values = config.targetPropertyId
        ? ids.map(
            (id) =>
              linkedStoredValues.get(
                propertyKey(id, config.targetPropertyId!),
              ) ?? null,
          )
        : [];
      rollupValues.set(
        propertyKey(documentId, rollup.definition.id),
        aggregateRollup(config.aggregation ?? "count", ids, values),
      );
    }
  }

  const propertiesByDocumentId = new Map<string, DocumentProperty[]>();
  for (const { document } of candidates) {
    const memo = new Map<string, DocumentPropertyValue>();
    const evaluating = new Set<string>();
    const valueFor = (property: DocumentProperty): DocumentPropertyValue => {
      const id = property.definition.id;
      if (memo.has(id)) return memo.get(id) ?? null;
      if (evaluating.has(id)) return null;
      evaluating.add(id);
      let value: DocumentPropertyValue;
      if (isBlocksPropertyType(property.definition.type)) {
        value = resolveBlocksFieldValue({
          options: property.definition.options,
          documentBody: document.content,
          blockFieldContent: additionalBlocks.get(propertyKey(document.id, id)),
        });
      } else if (property.definition.type === "formula") {
        const names = formulaDependencyNames(
          property.definition.options.formula,
        );
        const valuesByName = Object.fromEntries(
          names.map((name) => {
            const dependency = propertyByName.get(name);
            return [name, dependency ? valueFor(dependency) : null];
          }),
        );
        value = evaluatePropertyFormula(
          property.definition.options.formula,
          valuesByName,
        );
      } else if (property.definition.type === "rollup") {
        value = rollupValues.get(propertyKey(document.id, id)) ?? null;
      } else if (isComputedPropertyType(property.definition.type)) {
        value = computedPropertyValue(
          property.definition.type,
          document as never,
          {
            databaseRowNumber: rowNumberByDocumentId.get(document.id),
          },
        );
      } else {
        value = storedValues.get(propertyKey(document.id, id)) ?? null;
      }
      evaluating.delete(id);
      memo.set(id, value);
      return value;
    };
    propertiesByDocumentId.set(
      document.id,
      requiredProperties.map((property) => ({
        ...property,
        value: valueFor(property),
      })),
    );
  }

  let queryItems: ContentDatabaseItem[] = candidates.map(
    ({ item, document }) => ({
      id: item.id,
      databaseId: item.databaseId,
      document: {
        id: document.id,
        parentId: document.parentId,
        title: document.title,
        content: document.content ?? "",
        icon: document.icon,
        position: document.position,
        isFavorite: document.isFavorite === 1,
        hideFromSearch: document.hideFromSearch === 1,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      },
      position: item.position,
      properties: propertiesByDocumentId.get(document.id) ?? [],
    }),
  );
  const queryStages = [
    ...savedQueries,
    ...(personalQuery ? [personalQuery] : []),
    ...(transientQuery ? [transientQuery] : []),
  ];
  let hydrationChecked = false;
  const assertBodiesReady = () => {
    const remainingIds = new Set(queryItems.map((item) => item.document.id));
    const pending = candidates.find(
      ({ item }) =>
        remainingIds.has(item.documentId) &&
        item.bodyHydrationStatus !== "hydrated" &&
        item.bodyHydrationStatus !== "unavailable",
    );
    if (pending) {
      fail(
        `Database item "${pending.item.documentId}" is not ready for export.`,
        {
          errorCode: "collection_export_body_not_ready",
          statusCode: 409,
        },
      );
    }
    hydrationChecked = true;
  };
  for (const query of queryStages) {
    if (!hydrationChecked && queryNeedsBlocks(query, propertyById)) {
      assertBodiesReady();
    }
    queryItems = applyContentDatabaseTableQuery(
      queryItems,
      requiredProperties,
      query,
    );
  }
  if (
    !hydrationChecked &&
    (request.includePrimaryBody || selectedBlocks.length > 0)
  ) {
    assertBodiesReady();
  }

  const bodyFields = [
    ...(request.includePrimaryBody
      ? [
          {
            id: "primary-body",
            name: primaryBlocks?.definition.name ?? "Content",
          },
        ]
      : []),
    ...selectedBlocks.map((property) => ({
      id: property.definition.id,
      name: property.definition.name,
    })),
  ];
  const records: CollectionExportRecord[] = queryItems.map((item) => {
    const values = new Map(
      item.properties.map((property) => [property.definition.id, property]),
    );
    return {
      id: item.document.id,
      title: item.document.title || "Untitled",
      scalarValues: new Map(
        selectedScalars.map((property) => [
          property.definition.id,
          databasePropertyValueText(
            property,
            values.get(property.definition.id)?.value,
          ),
        ]),
      ),
      bodyValues: new Map([
        ...(request.includePrimaryBody
          ? [["primary-body", item.document.content] as const]
          : []),
        ...selectedBlocks.map(
          (property) =>
            [
              property.definition.id,
              typeof values.get(property.definition.id)?.value === "string"
                ? (values.get(property.definition.id)?.value as string)
                : "",
            ] as const,
        ),
      ]),
    };
  });
  return {
    id: database.documentId,
    title: database.title,
    updatedAt: database.updatedAt,
    scalarFields: selectedScalars.map((property) => ({
      id: property.definition.id,
      name: property.definition.name,
    })),
    bodyFields,
    records,
  };
}
