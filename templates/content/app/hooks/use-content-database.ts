import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import type {
  AddContentDatabaseSourceFieldPropertyRequest,
  AddDatabaseItemRequest,
  AttachContentDatabaseSourceRequest,
  BuilderCmsModelsResponse,
  ChangeContentDatabaseSourceRoleRequest,
  ContentDatabaseResponse,
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

export function contentDatabaseQueryKey(documentId: string) {
  return ["action", "get-content-database", { documentId }] as const;
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

export function writeContentDatabaseResponseToCache(
  queryClient: Pick<QueryClient, "setQueryData" | "setQueriesData">,
  documentId: string,
  data: ContentDatabaseResponse,
) {
  queryClient.setQueryData<ContentDatabaseResponse>(
    contentDatabaseQueryKey(documentId),
    data,
  );
  queryClient.setQueriesData<ContentDatabaseResponse>(
    contentDatabaseQueryFilter(documentId),
    data,
  );
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
  queryClient.removeQueries({
    queryKey: ["action", "get-document", { id: documentId }],
  });
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

export function useContentDatabase(documentId: string | null, limit?: number) {
  const queryClient = useQueryClient();
  return useActionQuery<ContentDatabaseResponse>(
    "get-content-database",
    documentId ? { documentId, limit } : undefined,
    {
      enabled: !!documentId,
      retry: false,
      placeholderData: (previous) => previous,
      initialData: () =>
        documentId
          ? readCachedContentDatabaseResponse(queryClient, documentId)
          : undefined,
      // Cross-key seeds (e.g. a differently-paginated cached response) render
      // instantly but must refetch immediately, not sit fresh for staleTime.
      initialDataUpdatedAt: 0,
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
          queryClient.invalidateQueries({
            queryKey: ["action", "get-document", { id: documentId }],
          });
          queryClient.invalidateQueries({
            queryKey: contentDatabaseQueryKey(documentId),
          });
        }
        queryClient.invalidateQueries({
          queryKey: [
            "action",
            "get-document",
            { id: data.database.documentId },
          ],
        });
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
        queryClient.invalidateQueries({
          queryKey: ["action", "get-document", { id: hostDocumentId }],
        });
      }
      queryClient.invalidateQueries({
        queryKey: [
          "action",
          "get-document",
          { id: data.block.databaseDocumentId },
        ],
      });
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

export function useDeleteDatabaseItems(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<ContentDatabaseResponse, DatabaseItemsBatchRequest>(
    "delete-database-items",
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

export function useUpdateContentDatabaseView(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseResponse,
    UpdateContentDatabaseViewRequest
  >("update-content-database-view", {
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

export function useContentDatabasePersonalView(databaseId: string | null) {
  return useActionQuery<ContentDatabasePersonalViewResponse>(
    "get-content-database-personal-view",
    databaseId ? { databaseId } : undefined,
    {
      enabled: !!databaseId,
      retry: false,
      placeholderData: (previous) => previous,
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
    onSuccess: (data) => {
      if (!databaseId) return;
      queryClient.setQueryData(
        ["action", "get-content-database-personal-view", { databaseId }],
        data,
      );
    },
  });
}

export function useAttachContentDatabaseSource(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseResponse,
    AttachContentDatabaseSourceRequest
  >("attach-content-database-source", {
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
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "list-document-properties", { documentId }],
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
    onSuccess: (_data, variables) => {
      invalidateBuilderBodyHydrationQueries(queryClient, documentId, variables);
    },
  });
}

export function invalidateBuilderBodyHydrationQueries(
  queryClient: {
    invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown;
  },
  documentId: string,
  variables?: Pick<ProcessBuilderBodyHydrationRequest, "documentId"> | null,
) {
  queryClient.invalidateQueries({
    queryKey: contentDatabaseQueryKey(documentId),
  });
  queryClient.invalidateQueries({
    queryKey: ["action", "get-content-database-source", { documentId }],
  });
  if (variables?.documentId) {
    queryClient.invalidateQueries({
      queryKey: ["action", "get-document", { id: variables.documentId }],
    });
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
