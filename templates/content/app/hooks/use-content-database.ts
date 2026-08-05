import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import type {
  AddContentDatabaseSourceFieldPropertyRequest,
  AddDatabaseItemRequest,
  AttachContentDatabaseSourceRequest,
  BuilderCmsAttachPreviewResponse,
  BuilderCmsModelsResponse,
  CancelPreparedBuilderSourceUpdateRequest,
  CancelPreparedBuilderSourceUpdateResponse,
  ChangeContentDatabaseSourceRoleRequest,
  ContentDatabaseResponse,
  ContentDatabaseSourceAttachmentAck,
  ContentDatabaseSourceAttachmentResult,
  ContentDatabaseItemsPageResponse,
  ContentDatabaseTableQuery,
  ContentDatabaseItem,
  ContentDatabasePersonalViewResponse,
  ContentDatabaseSourceFieldMapping,
  CreateInlineDatabaseRequest,
  CreateInlineDatabaseResponse,
  DocumentPropertyType,
  ListTrashedContentDatabasesResponse,
  ListContentDatabasesResponse,
  ContentDatabaseSourceFieldPropertyResponse,
  ContentDatabaseSourceStatusResponse,
  CreateDatabaseRequest,
  DatabaseItemsBatchRequest,
  DisconnectContentDatabaseSourceRequest,
  DocumentPropertiesResponse,
  ExecuteBuilderSourceBatchRequest,
  ExecuteBuilderSourceBatchResponse,
  DuplicateDatabaseItemRequest,
  ExecuteBuilderSourceExecutionRequest,
  MoveDatabaseItemRequest,
  PrepareBuilderSourceExecutionRequest,
  PreviewBuilderSourceReviewResponse,
  PrepareBuilderSourceReviewRequest,
  PrepareBuilderSourceReviewResponse,
  ProcessBuilderBodyHydrationRequest,
  ProcessBuilderBodyHydrationResponse,
  RefreshContentDatabaseSourceRequest,
  ReviewContentDatabaseSourceChangeSetRequest,
  SetContentDatabaseSourceWriteModeRequest,
  StageBuilderSourceBulkUpdateRequest,
  StageBuilderSourceBulkUpdateResponse,
  StageBuilderRevisionRequest,
  SubmitContentDatabaseFormRequest,
  SubmitContentDatabaseFormResponse,
  SuggestSourceJoinKeyResponse,
  UpdateContentDatabasePersonalViewRequest,
  UpdateContentDatabaseViewRequest,
  ValidateBuilderSourceExecutionRequest,
} from "@shared/api";
import type { Query, QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";

import { documentQueryFilter } from "../lib/document-query";

export function contentDatabaseQueryKey(documentId: string) {
  return ["action", "get-content-database", { documentId }] as const;
}

export function contentDatabaseByIdQueryKey(databaseId: string) {
  return ["action", "get-content-database", { databaseId }] as const;
}

export const contentDatabaseItemsPageQueryKey = [
  "action",
  "query-content-database-items",
] as const;

export function applyOptimisticItemToContentDatabase(
  current: ContentDatabaseResponse | undefined,
  item: ContentDatabaseItem,
): ContentDatabaseResponse | undefined {
  if (!current) return current;
  if (
    current.items.some(
      (candidate) =>
        candidate.id === item.id || candidate.document.id === item.document.id,
    )
  ) {
    return current;
  }

  return {
    ...current,
    items: [...current.items, item],
    pagination: current.pagination
      ? {
          ...current.pagination,
          totalItems: current.pagination.totalItems + 1,
          returnedItems: current.pagination.returnedItems + 1,
        }
      : current.pagination,
  };
}

export function removeOptimisticItemFromContentDatabase(
  current: ContentDatabaseResponse | undefined,
  documentId: string,
): ContentDatabaseResponse | undefined {
  if (!current) return current;
  const items = current.items.filter(
    (candidate) => candidate.document.id !== documentId,
  );
  if (items.length === current.items.length) return current;

  return {
    ...current,
    items,
    pagination: current.pagination
      ? {
          ...current.pagination,
          totalItems: Math.max(0, current.pagination.totalItems - 1),
          returnedItems: Math.max(0, current.pagination.returnedItems - 1),
        }
      : current.pagination,
  };
}

export function moveOptimisticContentDatabaseItem(
  current: ContentDatabaseResponse | undefined,
  itemId: string,
  position: number,
) {
  if (!current) return current;
  const currentIndex = current.items.findIndex((item) => item.id === itemId);
  if (currentIndex < 0 || current.items.length < 2) return current;
  const nextIndex = Math.min(Math.max(position, 0), current.items.length - 1);
  if (currentIndex === nextIndex) return current;
  const items = [...current.items];
  const [moved] = items.splice(currentIndex, 1);
  items.splice(nextIndex, 0, moved);
  return {
    ...current,
    items: items.map((item, index) => ({ ...item, position: index })),
  };
}

export function preserveScopedDatabasePlaceholder<T>(
  previous: T | undefined,
  previousQuery: Pick<Query, "queryKey"> | undefined,
  scope: { documentId?: string; databaseId?: string },
): T | undefined {
  const previousParams = previousQuery?.queryKey[2];
  if (!previousParams || typeof previousParams !== "object") return undefined;

  const params = previousParams as {
    documentId?: unknown;
    databaseId?: unknown;
  };
  if (scope.documentId !== undefined) {
    return params.documentId === scope.documentId ? previous : undefined;
  }
  if (scope.databaseId !== undefined) {
    return params.databaseId === scope.databaseId ? previous : undefined;
  }
  return undefined;
}

function isContentDatabaseQueryForDocument(
  queryKey: readonly unknown[],
  documentId: string,
) {
  if (
    queryKey[0] !== "action" ||
    queryKey[1] !== "get-content-database" ||
    !queryKey[2] ||
    typeof queryKey[2] !== "object"
  ) {
    return false;
  }
  const params = queryKey[2] as { documentId?: unknown };
  return params.documentId === documentId;
}

export function contentDatabaseQueryFilter(documentId: string) {
  return {
    queryKey: ["action", "get-content-database"],
    predicate: (query: Query) =>
      isContentDatabaseQueryForDocument(query.queryKey, documentId),
  };
}

export function contentDatabaseConstrainedQueryFilter(documentId: string) {
  return {
    queryKey: ["action", "get-content-database"],
    predicate: (query: Query) => {
      if (!isContentDatabaseQueryForDocument(query.queryKey, documentId)) {
        return false;
      }
      const params = query.queryKey[2] as { tableQuery?: unknown };
      return params.tableQuery !== undefined;
    },
  };
}

export function writeContentDatabaseResponseToCache(
  queryClient: Pick<QueryClient, "setQueryData" | "setQueriesData">,
  documentId: string,
  data: ContentDatabaseResponse,
) {
  if (!data.pagination) {
    queryClient.setQueryData<ContentDatabaseResponse>(
      contentDatabaseQueryKey(documentId),
      data,
    );
  }
  queryClient.setQueriesData<ContentDatabaseResponse>(
    {
      queryKey: ["action", "get-content-database"],
      predicate: (query) =>
        contentDatabaseResponseCanSeedQuery(query.queryKey, documentId, data),
    },
    data,
  );
}

export function contentDatabaseResponseCanSeedQuery(
  queryKey: readonly unknown[],
  documentId: string,
  data: ContentDatabaseResponse,
) {
  if (!isContentDatabaseQueryForDocument(queryKey, documentId)) return false;
  const params = queryKey[2] as {
    limit?: unknown;
    offset?: unknown;
    tableQuery?: unknown;
  };
  if (params.tableQuery !== undefined) return false;
  if (!data.pagination) return params.limit === undefined;
  return (
    params.limit === data.pagination.limit &&
    (params.offset ?? 0) === data.pagination.offset
  );
}

export function applyOptimisticBuilderWriteMode(
  current: ContentDatabaseResponse | undefined,
  request: SetContentDatabaseSourceWriteModeRequest,
) {
  if (!current || !request.writeMode) return current;
  const sourceId = request.sourceId ?? current.source?.id;
  if (!sourceId) return current;
  const writeMode = request.writeMode;
  const liveWritesEnabled = writeMode !== "read_only";
  const allowPublicationTransitions =
    writeMode === "publish_updates" &&
    request.allowPublicationTransitions === true;
  const allowedWriteModes =
    writeMode === "publish_updates"
      ? (["autosave", "publish"] as const)
      : writeMode === "stage_only"
        ? (["autosave"] as const)
        : ([] as const);
  const patchSource = (
    source: ContentDatabaseResponse["source"],
  ): ContentDatabaseResponse["source"] =>
    source?.id === sourceId
      ? {
          ...source,
          capabilities: {
            ...source.capabilities,
            liveWritesEnabled,
          },
          metadata: {
            ...source.metadata,
            writeMode,
            allowPublicationTransitions,
            allowedWriteModes: [...allowedWriteModes],
            allowDraftWrites: false,
            allowPublishWrites: writeMode === "publish_updates",
            pushMode:
              writeMode === "publish_updates"
                ? "publish"
                : writeMode === "stage_only"
                  ? "autosave"
                  : "none",
          },
        }
      : source;
  return {
    ...current,
    source: patchSource(current.source),
    sources: current.sources?.map((source) => patchSource(source)!),
  };
}

export function applyDocumentPropertyValueToDatabaseResponse(
  current: ContentDatabaseResponse | undefined,
  patch: {
    documentId: string;
    propertyId: string;
    value: ContentDatabaseResponse["properties"][number]["value"];
  },
): ContentDatabaseResponse | undefined {
  if (!current) return current;
  const databaseProperty = current.properties.find(
    (property) => property.definition.id === patch.propertyId,
  );
  if (!databaseProperty) return current;

  let changed = false;
  const items = current.items.map((item) => {
    if (item.document.id !== patch.documentId) return item;

    const existingIndex = item.properties.findIndex(
      (property) => property.definition.id === patch.propertyId,
    );
    if (existingIndex >= 0) {
      const properties = item.properties.map((property, index) =>
        index === existingIndex
          ? { ...property, value: patch.value }
          : property,
      );
      changed = true;
      return { ...item, properties };
    }

    changed = true;
    return {
      ...item,
      properties: [
        ...item.properties,
        { ...databaseProperty, value: patch.value },
      ]
        .slice()
        .sort((a, b) => a.definition.position - b.definition.position),
    };
  });

  return changed ? { ...current, items } : current;
}

export function applyDocumentPropertiesToDatabaseResponse(
  current: ContentDatabaseResponse | undefined,
  response: Pick<DocumentPropertiesResponse, "databaseId" | "properties">,
): ContentDatabaseResponse | undefined {
  if (!current) return current;
  if (response.databaseId && current.database.id !== response.databaseId) {
    return current;
  }

  const sortedProperties = [...response.properties].sort(
    (a, b) => a.definition.position - b.definition.position,
  );
  const propertyById = new Map(
    sortedProperties.map((property) => [property.definition.id, property]),
  );

  return {
    ...current,
    properties: sortedProperties,
    items: current.items.map((item) => ({
      ...item,
      properties: item.properties
        .filter((property) => propertyById.has(property.definition.id))
        .map((property) => ({
          ...propertyById.get(property.definition.id)!,
          value: property.value,
        })),
    })),
  };
}

export function removeDocumentPropertyFromDatabaseResponse(
  current: ContentDatabaseResponse | undefined,
  propertyId: string,
): ContentDatabaseResponse | undefined {
  if (!current) return current;

  return {
    ...current,
    properties: current.properties.filter(
      (property) => property.definition.id !== propertyId,
    ),
    items: current.items.map((item) => ({
      ...item,
      properties: item.properties.filter(
        (property) => property.definition.id !== propertyId,
      ),
    })),
  };
}

// `get-content-database` returns a union at runtime: the full response, or an
// unavailable payload (`{ available: false, reason: "deleted" | "not_found" }`)
// with no `database` field. Consumers typed against ContentDatabaseResponse
// must narrow with this guard before touching `data.database`.
export function isContentDatabaseUnavailable(
  data: unknown,
): data is { available: false; reason: string } {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { available?: unknown }).available === false
  );
}

export function readCachedContentDatabaseResponse(
  queryClient: Pick<QueryClient, "getQueryData" | "getQueriesData">,
  documentId: string,
) {
  const exact = queryClient.getQueryData<ContentDatabaseResponse>(
    contentDatabaseQueryKey(documentId),
  );
  if (exact && !isContentDatabaseUnavailable(exact)) return exact;

  const cached = queryClient
    .getQueriesData<ContentDatabaseResponse>(
      contentDatabaseQueryFilter(documentId),
    )
    .find(([, data]) => data && !isContentDatabaseUnavailable(data));
  return cached?.[1];
}

export function clearDeletedContentDatabaseFromCache(
  queryClient: Pick<QueryClient, "removeQueries" | "invalidateQueries">,
  documentId: string,
) {
  queryClient.removeQueries(contentDatabaseQueryFilter(documentId));
  queryClient.removeQueries(documentQueryFilter(documentId));
  queryClient.invalidateQueries({
    queryKey: ["action", "get-content-database"],
  });
  queryClient.invalidateQueries({
    queryKey: ["action", "get-document"],
  });
  queryClient.invalidateQueries({
    queryKey: ["action", "list-documents"],
  });
  queryClient.invalidateQueries({
    queryKey: ["action", "list-trashed-content-databases"],
  });
  queryClient.invalidateQueries({
    queryKey: ["action", "list-content-databases"],
  });
}

export function applySourceFieldPropertyToDatabaseResponse(
  current: ContentDatabaseResponse | undefined,
  patch: ContentDatabaseSourceFieldPropertyResponse,
): ContentDatabaseResponse | undefined {
  if (!current || current.database.id !== patch.databaseId) return current;
  const patchSource = (source: ContentDatabaseResponse["source"]) =>
    source
      ? {
          ...source,
          fields: source.fields.map((field) =>
            field.id === patch.sourceField.id ? patch.sourceField : field,
          ),
        }
      : source;

  const hasProperty = current.properties.some(
    (property) => property.definition.id === patch.property.definition.id,
  );
  const properties = hasProperty
    ? current.properties.map((property) =>
        property.definition.id === patch.property.definition.id
          ? patch.property
          : property,
      )
    : [...current.properties, patch.property].sort(
        (a, b) => a.definition.position - b.definition.position,
      );

  const valueByItemId = new Map(
    (patch.itemValues ?? []).map((itemValue) => [
      itemValue.itemId,
      itemValue.value,
    ]),
  );

  return {
    ...current,
    properties,
    items: current.items.map((item) => {
      const itemHasProperty = item.properties.some(
        (property) => property.definition.id === patch.property.definition.id,
      );
      const propertyValue = valueByItemId.has(item.id)
        ? valueByItemId.get(item.id)!
        : patch.property.value;
      const nextProperty = { ...patch.property, value: propertyValue };
      return {
        ...item,
        properties: itemHasProperty
          ? item.properties.map((property) =>
              property.definition.id === patch.property.definition.id
                ? nextProperty
                : property,
            )
          : [...item.properties, nextProperty],
      };
    }),
    source: patchSource(current.source),
    sources: current.sources?.map((source) => patchSource(source)!),
  };
}

function propertyTypeForOptimisticSourceField(
  sourceFieldType: string,
): DocumentPropertyType {
  if (sourceFieldType === "number") return "number";
  if (sourceFieldType === "datetime" || sourceFieldType === "date") {
    return "date";
  }
  if (sourceFieldType === "url") return "url";
  if (sourceFieldType === "boolean" || sourceFieldType === "checkbox") {
    return "checkbox";
  }
  return "text";
}

function optimisticSourceFieldPropertyId(sourceFieldId: string) {
  return `optimistic-source-field-property:${sourceFieldId}`;
}

function findSourceFieldById(
  current: ContentDatabaseResponse,
  sourceFieldId: string,
): ContentDatabaseSourceFieldMapping | null {
  const sources = current.sources ?? (current.source ? [current.source] : []);
  for (const source of sources) {
    const field = source.fields.find(
      (candidate) => candidate.id === sourceFieldId,
    );
    if (field) return field;
  }
  return null;
}

export function applyOptimisticSourceFieldPropertyToDatabaseResponse(
  current: ContentDatabaseResponse | undefined,
  variables: AddContentDatabaseSourceFieldPropertyRequest,
): ContentDatabaseResponse | undefined {
  if (
    !current ||
    (current.database.id !== variables.documentId &&
      current.database.documentId !== variables.documentId)
  ) {
    return current;
  }
  const field = findSourceFieldById(current, variables.sourceFieldId);
  if (!field || field.propertyId) return current;

  const propertyId = optimisticSourceFieldPropertyId(field.id);
  const now = new Date().toISOString();
  const position =
    Math.max(
      -1,
      ...current.properties.map((property) => property.definition.position),
    ) + 1;
  const property = {
    definition: {
      id: propertyId,
      databaseId: current.database.id,
      name: field.sourceFieldLabel,
      type: propertyTypeForOptimisticSourceField(field.sourceFieldType),
      visibility: "always_show" as const,
      options: {},
      position,
      createdAt: now,
      updatedAt: now,
    },
    value: null,
    editable: false,
  };
  const sourceField = {
    ...field,
    propertyId,
    propertyName: field.sourceFieldLabel,
    localFieldKey: propertyId,
    freshness: "unknown" as const,
  };

  return applySourceFieldPropertyToDatabaseResponse(current, {
    databaseId: current.database.id,
    documentId: variables.documentId,
    property,
    sourceField,
    itemValues: current.items.map((item) => ({
      itemId: item.id,
      documentId: item.document.id,
      value: null,
    })),
  });
}

function removeOptimisticSourceFieldProperty(
  current: ContentDatabaseResponse | undefined,
  sourceFieldId: string,
): ContentDatabaseResponse | undefined {
  if (!current) return current;
  const propertyId = optimisticSourceFieldPropertyId(sourceFieldId);
  const removeFromSource = (source: ContentDatabaseResponse["source"]) =>
    source
      ? {
          ...source,
          fields: source.fields.map((field) =>
            field.id === sourceFieldId && field.propertyId === propertyId
              ? {
                  ...field,
                  propertyId: null,
                  propertyName: null,
                  localFieldKey: field.sourceFieldKey,
                  freshness: "fresh" as const,
                }
              : field,
          ),
        }
      : source;
  return {
    ...current,
    properties: current.properties.filter(
      (property) => property.definition.id !== propertyId,
    ),
    items: current.items.map((item) => ({
      ...item,
      properties: item.properties.filter(
        (property) => property.definition.id !== propertyId,
      ),
    })),
    source: removeFromSource(current.source),
    sources: current.sources?.map((source) => removeFromSource(source)!),
  };
}

export function useContentDatabase(
  documentId: string | null,
  limit?: number,
  tableQuery?: ContentDatabaseTableQuery,
) {
  const queryClient = useQueryClient();
  const baseQuery = useActionQuery<ContentDatabaseResponse>(
    "get-content-database",
    documentId ? { documentId, limit } : undefined,
    {
      enabled: !!documentId,
      retry: false,
      placeholderData: (previous, previousQuery) =>
        preserveScopedDatabasePlaceholder(previous, previousQuery, {
          documentId: documentId ?? undefined,
        }),
      initialData: () =>
        documentId
          ? readCachedContentDatabaseResponse(queryClient, documentId)
          : undefined,
      // Cross-key seeds (e.g. a differently-paginated cached response) render
      // instantly but must refetch immediately, not sit fresh for staleTime.
      initialDataUpdatedAt: 0,
    },
  );
  const pageQuery = useActionQuery<ContentDatabaseItemsPageResponse>(
    "query-content-database-items",
    documentId && tableQuery ? { documentId, limit, tableQuery } : undefined,
    {
      enabled: Boolean(documentId && tableQuery),
      retry: false,
      placeholderData: (previous) => previous,
    },
  );
  const page = tableQuery ? pageQuery.data : undefined;
  const data =
    page &&
    baseQuery.data &&
    !baseQuery.data.attachPreview &&
    !isContentDatabaseUnavailable(baseQuery.data)
      ? {
          ...baseQuery.data,
          items: page.items,
          source: page.source,
          sources: page.sources,
          pagination: page.pagination,
          tableQueryMode: page.tableQueryMode,
        }
      : baseQuery.data;
  return {
    ...baseQuery,
    data,
    isLoading: tableQuery ? pageQuery.isLoading && !data : baseQuery.isLoading,
    isFetching: tableQuery ? pageQuery.isFetching : baseQuery.isFetching,
    isError: tableQuery ? pageQuery.isError : baseQuery.isError,
    error: tableQuery ? pageQuery.error : baseQuery.error,
    refetch: tableQuery ? pageQuery.refetch : baseQuery.refetch,
  };
}

export function useContentDatabaseById(databaseId: string | null) {
  return useActionQuery<ContentDatabaseResponse>(
    "get-content-database",
    databaseId ? { databaseId } : undefined,
    {
      enabled: !!databaseId,
      retry: false,
      placeholderData: (previous, previousQuery) =>
        preserveScopedDatabasePlaceholder(previous, previousQuery, {
          databaseId: databaseId ?? undefined,
        }),
    },
  );
}

export function useCreateContentDatabase(documentId: string | null) {
  const queryClient = useQueryClient();
  return useActionMutation<ContentDatabaseResponse, CreateDatabaseRequest>(
    "create-content-database",
    {
      onSuccess: (data) => {
        if (documentId) {
          queryClient.invalidateQueries(documentQueryFilter(documentId));
          queryClient.invalidateQueries({
            queryKey: contentDatabaseQueryKey(documentId),
          });
        }
        queryClient.invalidateQueries(
          documentQueryFilter(data.database.documentId),
        );
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
      },
    },
  );
}

export function useCreateInlineContentDatabase(hostDocumentId: string | null) {
  const queryClient = useQueryClient();
  return useActionMutation<
    CreateInlineDatabaseResponse,
    CreateInlineDatabaseRequest
  >("create-inline-content-database", {
    onSuccess: (data) => {
      if (hostDocumentId) {
        queryClient.invalidateQueries(documentQueryFilter(hostDocumentId));
      }
      queryClient.invalidateQueries(
        documentQueryFilter(data.block.databaseDocumentId),
      );
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(data.block.databaseDocumentId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
    },
  });
}

export function useDeleteContentDatabase() {
  const queryClient = useQueryClient();
  return useActionMutation<
    {
      success: boolean;
      databaseId: string;
      documentId: string;
      deletedAt: string;
    },
    { databaseId: string }
  >("delete-content-database", {
    onSuccess: (data) => {
      clearDeletedContentDatabaseFromCache(queryClient, data.documentId);
      queryClient.invalidateQueries({
        queryKey: ["action", "list-trashed-documents"],
      });
    },
  });
}

export function useRestoreContentDatabase() {
  const queryClient = useQueryClient();
  return useActionMutation<
    {
      success: boolean;
      databaseId: string;
      documentId: string;
      deletedAt: null;
    },
    { databaseId: string }
  >("restore-content-database", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database"],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-document"],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "list-trashed-content-databases"],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "list-trashed-documents"],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "list-content-databases"],
      });
    },
  });
}

export function useTrashedContentDatabases() {
  return useActionQuery<ListTrashedContentDatabasesResponse>(
    "list-trashed-content-databases",
    {},
    {
      retry: false,
      placeholderData: (previous) => previous,
    },
  );
}

export function useAddDatabaseItem(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<ContentDatabaseResponse, AddDatabaseItemRequest>(
    "add-database-item",
    {
      skipActionQueryInvalidation: true,
      onSuccess: (data) => {
        if (data.createdItem) {
          queryClient.setQueriesData<ContentDatabaseResponse>(
            {
              queryKey: ["action", "get-content-database"],
              predicate: (query) => {
                if (
                  !isContentDatabaseQueryForDocument(query.queryKey, documentId)
                ) {
                  return false;
                }
                const params = query.queryKey[2] as {
                  tableQuery?: unknown;
                };
                return params.tableQuery === undefined;
              },
            },
            (current) =>
              applyOptimisticItemToContentDatabase(current, data.createdItem!),
          );
        }
        queryClient.invalidateQueries({
          queryKey: contentDatabaseQueryKey(documentId),
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
      },
    },
  );
}

export function useSubmitContentDatabaseForm(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    SubmitContentDatabaseFormResponse,
    SubmitContentDatabaseFormRequest
  >("submit-content-database-form", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database"],
      });
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: contentDatabaseItemsPageQueryKey,
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
    },
  });
}

export function useDuplicateDatabaseItem(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseResponse,
    DuplicateDatabaseItemRequest
  >("duplicate-database-item", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: contentDatabaseItemsPageQueryKey,
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
    },
  });
}

export function useDuplicateDatabaseItems(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<ContentDatabaseResponse, DatabaseItemsBatchRequest>(
    "duplicate-database-items",
    {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: contentDatabaseQueryKey(documentId),
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
      },
    },
  );
}

export function useRemoveDatabaseItems(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<ContentDatabaseResponse, DatabaseItemsBatchRequest>(
    "remove-database-items",
    {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: contentDatabaseQueryKey(documentId),
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
      },
    },
  );
}

export function useMoveDatabaseItem(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<ContentDatabaseResponse, MoveDatabaseItemRequest>(
    "move-database-item",
    {
      skipActionQueryInvalidation: true,
      onMutate: async (variables) => {
        await queryClient.cancelQueries({
          queryKey: ["action", "get-content-database"],
        });
        const previous = queryClient.getQueriesData<ContentDatabaseResponse>({
          queryKey: ["action", "get-content-database"],
        });
        if (variables.itemId) {
          queryClient.setQueriesData<ContentDatabaseResponse>(
            { queryKey: ["action", "get-content-database"] },
            (current) => {
              if (
                variables.databaseId &&
                current?.database.id !== variables.databaseId
              ) {
                return current;
              }
              return moveOptimisticContentDatabaseItem(
                current,
                variables.itemId!,
                variables.position,
              );
            },
          );
        }
        return { previous };
      },
      onError: (_error, _variables, context) => {
        const rollback = context as
          | {
              previous?: Array<
                [readonly unknown[], ContentDatabaseResponse | undefined]
              >;
            }
          | undefined;
        for (const [queryKey, data] of rollback?.previous ?? []) {
          queryClient.setQueryData(queryKey, data);
        }
      },
      onSuccess: (data) => {
        writeContentDatabaseResponseToCache(queryClient, documentId, data);
        queryClient.setQueryData(
          contentDatabaseByIdQueryKey(data.database.id),
          data,
        );
      },
      onSettled: (_data, _error, variables) => {
        queryClient.invalidateQueries({
          queryKey: contentDatabaseQueryKey(documentId),
        });
        if (variables.databaseId) {
          queryClient.invalidateQueries({
            queryKey: contentDatabaseByIdQueryKey(variables.databaseId),
          });
        }
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
      },
    },
  );
}

export function useUpdateContentDatabaseView(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseResponse,
    UpdateContentDatabaseViewRequest
  >("update-content-database-view", {
    skipActionQueryInvalidation: true,
    onSuccess: (data) => {
      queryClient.setQueriesData<ContentDatabaseResponse>(
        contentDatabaseQueryFilter(documentId),
        (current) =>
          current
            ? {
                ...current,
                database: data.database,
              }
            : current,
      );
    },
  });
}

export function useContentDatabasePersonalView(databaseId: string | null) {
  return useActionQuery<ContentDatabasePersonalViewResponse>(
    "get-content-database-personal-view",
    databaseId ? { databaseId } : undefined,
    {
      enabled: !!databaseId,
      retry: false,
      placeholderData: (previous, previousQuery) =>
        preserveScopedDatabasePlaceholder(previous, previousQuery, {
          databaseId: databaseId ?? undefined,
        }),
    },
  );
}

export function useUpdateContentDatabasePersonalView(
  databaseId: string | null,
) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabasePersonalViewResponse,
    UpdateContentDatabasePersonalViewRequest
  >("update-content-database-personal-view", {
    skipActionQueryInvalidation: true,
    onMutate: async (variables) => {
      if (!databaseId) return undefined;
      const queryKey = [
        "action",
        "get-content-database-personal-view",
        { databaseId },
      ] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, {
        databaseId,
        overrides: variables.overrides,
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (!databaseId) return;
      const previous = (context as { previous?: unknown } | undefined)
        ?.previous;
      queryClient.setQueryData(
        ["action", "get-content-database-personal-view", { databaseId }],
        previous,
      );
    },
    onSuccess: (data) => {
      if (!databaseId) return;
      queryClient.setQueryData(
        ["action", "get-content-database-personal-view", { databaseId }],
        data,
      );
    },
    onSettled: () => {
      if (!databaseId) return;
      queryClient.invalidateQueries({
        queryKey: [
          "action",
          "get-content-database-personal-view",
          { databaseId },
        ],
      });
    },
  });
}

export function useAttachContentDatabaseSource(
  documentId: string,
  fallbackData?: ContentDatabaseResponse,
) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseSourceAttachmentResult,
    AttachContentDatabaseSourceRequest
  >("attach-content-database-source", {
    skipActionQueryInvalidation: true,
    onMutate: async (variables) => {
      const previous = queryClient.getQueriesData<ContentDatabaseResponse>(
        contentDatabaseQueryFilter(documentId),
      );
      const cancelPending = queryClient.cancelQueries(
        contentDatabaseQueryFilter(documentId),
        { revert: false },
      );
      if (variables.sourceType === "builder-cms" && variables.sourceTable) {
        const preview =
          queryClient.getQueryData<BuilderCmsAttachPreviewResponse>([
            "action",
            "preview-content-database-source-attach",
            {
              documentId,
              sourceTable: variables.sourceTable,
              fieldPaths: variables.builderFieldPaths,
            },
          ]);
        if (preview) {
          writeBuilderAttachPreviewToCache(
            queryClient,
            documentId,
            preview,
            fallbackData,
          );
        }
      }
      await cancelPending;
      return { previous };
    },
    onError: (_error, _variables, context) => {
      const previous = (
        context as
          | {
              previous?: Array<
                [readonly unknown[], ContentDatabaseResponse | undefined]
              >;
            }
          | undefined
      )?.previous;
      for (const [queryKey, data] of previous ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
    },
    onSuccess: (data) => {
      if (!("responseProjection" in data)) {
        writeContentDatabaseResponseToCache(queryClient, documentId, data);
      } else {
        queryClient.setQueriesData<ContentDatabaseResponse>(
          contentDatabaseQueryFilter(documentId),
          (current) => applyBuilderAttachCompletion(current, data),
        );
      }
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: contentDatabaseItemsPageQueryKey,
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
    },
  });
}

export function applyBuilderAttachCompletion(
  current: ContentDatabaseResponse | undefined,
  completion: ContentDatabaseSourceAttachmentAck,
) {
  if (!current) return current;
  return {
    ...current,
    pagination: current.pagination
      ? {
          ...current.pagination,
          totalItems: completion.importedItemCount,
          hasMore:
            current.pagination.returnedItems < completion.importedItemCount,
        }
      : current.pagination,
    attachPreview: {
      sourceTable: completion.sourceTable,
      fetchedAt: completion.fetchedAt,
      importedItemCount: completion.importedItemCount,
      complete: true,
    },
  };
}

export function useBuilderCmsAttachPreview(args: {
  documentId: string;
  sourceTable: string | null;
  fieldPaths?: string[];
  enabled?: boolean;
}) {
  return useActionQuery<BuilderCmsAttachPreviewResponse>(
    "preview-content-database-source-attach",
    args.sourceTable
      ? {
          documentId: args.documentId,
          sourceTable: args.sourceTable,
          fieldPaths: args.fieldPaths,
        }
      : undefined,
    {
      enabled: args.enabled !== false && Boolean(args.sourceTable),
      retry: false,
      staleTime: 30_000,
    },
  );
}

export function writeBuilderAttachPreviewToCache(
  queryClient: Pick<QueryClient, "setQueriesData">,
  documentId: string,
  preview: BuilderCmsAttachPreviewResponse,
  fallbackData?: ContentDatabaseResponse,
) {
  queryClient.setQueriesData<ContentDatabaseResponse>(
    contentDatabaseQueryFilter(documentId),
    (current) => {
      const base = current ?? fallbackData ?? preview.base;
      return base
        ? {
            ...base,
            items: preview.items,
            pagination: {
              offset: 0,
              limit: preview.items.length || 1,
              totalItems: preview.items.length,
              returnedItems: preview.items.length,
              hasMore: preview.hasMore,
            },
            attachPreview: {
              sourceTable: preview.sourceTable,
              fetchedAt: preview.fetchedAt,
            },
          }
        : current;
    },
  );
}

export function useChangeContentDatabaseSourceRole(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseResponse,
    ChangeContentDatabaseSourceRoleRequest
  >("change-content-database-source-role", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
    },
  });
}

export function useAddContentDatabaseSourceFieldProperty(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseSourceFieldPropertyResponse,
    AddContentDatabaseSourceFieldPropertyRequest
  >("add-content-database-source-field-property", {
    skipActionQueryInvalidation: true,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      // Patch every cached response for this document, not just the exact
      // unpaginated key — the rendered table observes a `{documentId, limit}`
      // key, and setQueryData does not partial-match the way invalidate does.
      const previous = queryClient.getQueriesData<ContentDatabaseResponse>(
        contentDatabaseQueryFilter(documentId),
      );
      queryClient.setQueriesData<ContentDatabaseResponse>(
        contentDatabaseQueryFilter(documentId),
        (current) =>
          applyOptimisticSourceFieldPropertyToDatabaseResponse(
            current,
            variables,
          ),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      const rollback = context as
        | {
            previous?: Array<
              [readonly unknown[], ContentDatabaseResponse | undefined]
            >;
          }
        | undefined;
      for (const [queryKey, data] of rollback?.previous ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueriesData<ContentDatabaseResponse>(
        contentDatabaseQueryFilter(documentId),
        (current) =>
          applySourceFieldPropertyToDatabaseResponse(
            removeOptimisticSourceFieldProperty(current, data.sourceField.id),
            data,
          ),
      );
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: contentDatabaseItemsPageQueryKey,
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
      queryClient.invalidateQueries({
        queryKey: [
          "action",
          "list-document-properties",
          { documentId, databaseId: data.databaseId },
        ],
      });
    },
  });
}

export function useMaterializeBuilderRequiredFields(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseResponse,
    { documentId: string; sourceId: string }
  >("materialize-builder-required-fields", {
    onSuccess: (data) => {
      writeContentDatabaseResponseToCache(queryClient, documentId, data);
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
      queryClient.invalidateQueries({
        queryKey: [
          "action",
          "list-document-properties",
          { documentId, databaseId: data.database.id },
        ],
      });
    },
  });
}

export function useBuilderCmsModels(enabled: boolean) {
  return useActionQuery<BuilderCmsModelsResponse>(
    "list-builder-cms-models",
    enabled ? {} : undefined,
    {
      enabled,
      retry: false,
      placeholderData: (previous) => previous,
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  );
}

export function useNotionDatabaseSources(enabled: boolean) {
  return useActionQuery(
    "list-notion-database-sources",
    enabled ? { limit: 50 } : undefined,
    {
      enabled,
      retry: false,
      placeholderData: (previous) => previous,
      staleTime: 60_000,
    },
  );
}

export function useContentDatabases(args: {
  excludeDatabaseId?: string;
  excludeDatabaseIds?: string[];
  enabled: boolean;
}) {
  return useActionQuery<ListContentDatabasesResponse>(
    "list-content-databases",
    args.enabled
      ? {
          excludeDatabaseId: args.excludeDatabaseId ?? undefined,
          excludeDatabaseIds: args.excludeDatabaseIds ?? undefined,
        }
      : undefined,
    { enabled: args.enabled, retry: false },
  );
}

export function useSuggestSourceJoinKey(args: {
  documentId: string;
  candidateSourceType:
    | "mock-local"
    | "builder-cms"
    | "local-table"
    | "notion-database";
  candidateSourceTable: string;
  enabled: boolean;
}) {
  return useActionQuery<SuggestSourceJoinKeyResponse>(
    "suggest-source-join-key",
    args.enabled
      ? {
          documentId: args.documentId,
          candidateSourceType: args.candidateSourceType,
          candidateSourceTable: args.candidateSourceTable,
        }
      : undefined,
    {
      enabled: args.enabled,
      retry: false,
    },
  );
}

export function useRefreshContentDatabaseSource(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseSourceStatusResponse,
    RefreshContentDatabaseSourceRequest
  >("refresh-content-database-source", {
    skipActionQueryInvalidation: true,
    onSuccess: () => {
      invalidateContentDatabaseSourceRefreshQueries(queryClient, documentId);
    },
  });
}

export function invalidateContentDatabaseSourceRefreshQueries(
  queryClient: {
    invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown;
  },
  documentId: string,
) {
  queryClient.invalidateQueries({
    queryKey: contentDatabaseQueryKey(documentId),
  });
  queryClient.invalidateQueries({ queryKey: contentDatabaseItemsPageQueryKey });
  queryClient.invalidateQueries({
    queryKey: ["action", "get-content-database-source", { documentId }],
  });
}

export function useProcessBuilderBodyHydration(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ProcessBuilderBodyHydrationResponse,
    ProcessBuilderBodyHydrationRequest
  >("process-builder-body-hydration", {
    skipActionQueryInvalidation: true,
    onSuccess: (data, variables) => {
      if (data.remaining === 0 || variables.documentId) {
        invalidateBuilderBodyHydrationQueries(
          queryClient,
          documentId,
          variables,
        );
      }
    },
  });
}

export function invalidateBuilderBodyHydrationQueries(
  queryClient: {
    invalidateQueries: (filters: {
      queryKey?: readonly unknown[];
      predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
    }) => unknown;
  },
  documentId: string,
  variables?: Pick<ProcessBuilderBodyHydrationRequest, "documentId"> | null,
) {
  queryClient.invalidateQueries({
    queryKey: contentDatabaseQueryKey(documentId),
  });
  queryClient.invalidateQueries({ queryKey: contentDatabaseItemsPageQueryKey });
  queryClient.invalidateQueries({
    queryKey: ["action", "get-content-database-source", { documentId }],
  });
  if (variables?.documentId) {
    queryClient.invalidateQueries(documentQueryFilter(variables.documentId));
  }
}

export function useDisconnectContentDatabaseSource(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseResponse,
    DisconnectContentDatabaseSourceRequest
  >("disconnect-content-database-source", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
    },
  });
}

export function useStageBuilderRevision(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseResponse,
    StageBuilderRevisionRequest
  >("stage-builder-revision", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
    },
  });
}

export function useReviewContentDatabaseSourceChangeSet(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseResponse,
    ReviewContentDatabaseSourceChangeSetRequest
  >("review-content-database-source-change-set", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
    },
  });
}

export function usePrepareBuilderSourceExecution(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseResponse,
    PrepareBuilderSourceExecutionRequest
  >("prepare-builder-source-execution", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
    },
  });
}

export function useCancelPreparedBuilderSourceUpdate(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    CancelPreparedBuilderSourceUpdateResponse,
    CancelPreparedBuilderSourceUpdateRequest
  >("cancel-prepared-builder-source-update", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
    },
  });
}

export function useValidateBuilderSourceExecution(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseResponse,
    ValidateBuilderSourceExecutionRequest
  >("validate-builder-source-execution", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
    },
  });
}

export function useExecuteBuilderSourceExecution(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseResponse,
    ExecuteBuilderSourceExecutionRequest
  >("execute-builder-source-execution", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
    },
  });
}

export function useExecuteBuilderSourceBatch(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ExecuteBuilderSourceBatchResponse,
    ExecuteBuilderSourceBatchRequest
  >("execute-builder-source-batch", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
    },
  });
}

export function useSetContentDatabaseSourceWriteMode(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseResponse,
    SetContentDatabaseSourceWriteModeRequest
  >("set-content-database-source-write-mode", {
    onSuccess: (data) => {
      writeContentDatabaseResponseToCache(queryClient, documentId, data);
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
    },
  });
}

export function usePrepareBuilderSourceReview(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    PrepareBuilderSourceReviewResponse,
    PrepareBuilderSourceReviewRequest
  >("prepare-builder-source-review", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
    },
  });
}

export function usePreviewBuilderSourceReview(args: {
  documentId: string;
  sourceId: string | null;
  scope: "selected" | "all";
  documentIds?: string[];
  enabled: boolean;
}) {
  return useActionQuery<PreviewBuilderSourceReviewResponse>(
    "preview-builder-source-review",
    args.enabled && args.sourceId
      ? {
          documentId: args.documentId,
          sourceId: args.sourceId,
          scope: args.scope,
          documentIds: args.documentIds,
        }
      : undefined,
    {
      enabled: args.enabled && !!args.sourceId,
      retry: false,
      staleTime: 0,
      gcTime: 0,
      refetchOnWindowFocus: false,
    },
  );
}

export function useStageBuilderSourceBulkUpdate(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    StageBuilderSourceBulkUpdateResponse,
    StageBuilderSourceBulkUpdateRequest
  >("stage-builder-source-bulk-update", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
    },
  });
}
