import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import type {
  AddContentDatabaseSourceFieldPropertyRequest,
  AddDatabaseItemRequest,
  AttachContentDatabaseSourceRequest,
  BuilderCmsModelsResponse,
  ChangeContentDatabaseSourceRoleRequest,
  ContentDatabaseResponse,
  CreateInlineDatabaseRequest,
  CreateInlineDatabaseResponse,
  ListTrashedContentDatabasesResponse,
  ListContentDatabasesResponse,
  ContentDatabaseSourceFieldPropertyResponse,
  ContentDatabaseSourceStatusResponse,
  CreateDatabaseRequest,
  DatabaseItemsBatchRequest,
  DisconnectContentDatabaseSourceRequest,
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
  SuggestSourceJoinKeyResponse,
  UpdateContentDatabaseViewRequest,
  ValidateBuilderSourceExecutionRequest,
} from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";

export function contentDatabaseQueryKey(documentId: string) {
  return ["action", "get-content-database", { documentId }] as const;
}

export function applySourceFieldPropertyToDatabaseResponse(
  current: ContentDatabaseResponse | undefined,
  patch: ContentDatabaseSourceFieldPropertyResponse,
): ContentDatabaseResponse | undefined {
  if (!current || current.database.id !== patch.databaseId) return current;

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
    source: current.source
      ? {
          ...current.source,
          fields: current.source.fields.map((field) =>
            field.id === patch.sourceField.id ? patch.sourceField : field,
          ),
        }
      : current.source,
  };
}

export function useContentDatabase(documentId: string | null, limit?: number) {
  return useActionQuery<ContentDatabaseResponse>(
    "get-content-database",
    documentId ? { documentId, limit } : undefined,
    {
      enabled: !!documentId,
      retry: false,
      placeholderData: (previous) => previous,
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
    { success: boolean; databaseId: string; deletedAt: string },
    { databaseId: string }
  >("delete-content-database", {
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
    },
  });
}

export function useRestoreContentDatabase() {
  const queryClient = useQueryClient();
  return useActionMutation<
    { success: boolean; databaseId: string; deletedAt: null },
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

export function useAttachContentDatabaseSource(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseResponse,
    AttachContentDatabaseSourceRequest
  >("attach-content-database-source", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contentDatabaseQueryKey(documentId),
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
    onSuccess: (data) => {
      queryClient.setQueryData<ContentDatabaseResponse>(
        contentDatabaseQueryKey(documentId),
        (current) => applySourceFieldPropertyToDatabaseResponse(current, data),
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
    },
  );
}

export function useContentDatabases(args: {
  excludeDatabaseId?: string;
  enabled: boolean;
}) {
  return useActionQuery<ListContentDatabasesResponse>(
    "list-content-databases",
    args.enabled
      ? { excludeDatabaseId: args.excludeDatabaseId ?? undefined }
      : undefined,
    { enabled: args.enabled, retry: false },
  );
}

export function useSuggestSourceJoinKey(args: {
  documentId: string;
  candidateSourceType: "mock-local" | "builder-cms" | "local-table";
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

export function useProcessBuilderBodyHydration(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ProcessBuilderBodyHydrationResponse,
    ProcessBuilderBodyHydrationRequest
  >("process-builder-body-hydration", {
    onSuccess: (_data, variables) => {
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
    },
  });
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
