import { useQueryClient } from "@tanstack/react-query";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import type {
  AddDatabaseItemRequest,
  AttachContentDatabaseSourceRequest,
  BuilderCmsModelsResponse,
  ContentDatabaseResponse,
  ListContentDatabasesResponse,
  ContentDatabaseSourceFieldPropertyResponse,
  ContentDatabaseSourceStatusResponse,
  CreateDatabaseRequest,
  DisconnectContentDatabaseSourceRequest,
  DuplicateDatabaseItemRequest,
  ExecuteBuilderSourceExecutionRequest,
  MoveDatabaseItemRequest,
  PrepareBuilderSourceExecutionRequest,
  PrepareBuilderSourceReviewRequest,
  PrepareBuilderSourceReviewResponse,
  RefreshContentDatabaseSourceRequest,
  ReviewContentDatabaseSourceChangeSetRequest,
  SetContentDatabaseSourceWriteModeRequest,
  StageBuilderRevisionRequest,
  SuggestSourceJoinKeyResponse,
  UpdateContentDatabaseViewRequest,
  ValidateBuilderSourceExecutionRequest,
} from "@shared/api";

export function contentDatabaseQueryKey(_documentId?: string) {
  return ["action", "get-content-database"] as const;
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
