import { useQueryClient } from "@tanstack/react-query";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import type {
  AddDatabaseItemRequest,
  AttachContentDatabaseSourceRequest,
  BuilderCmsModelsResponse,
  ContentDatabaseResponse,
  ContentDatabaseSourceStatusResponse,
  CreateDatabaseRequest,
  DuplicateDatabaseItemRequest,
  MoveDatabaseItemRequest,
  PrepareBuilderSourceExecutionRequest,
  PrepareBuilderSourceReviewRequest,
  PrepareBuilderSourceReviewResponse,
  ProposeContentDatabaseSourceChangeSetRequest,
  RefreshContentDatabaseSourceRequest,
  ReviewContentDatabaseSourceChangeSetRequest,
  StageBuilderRevisionRequest,
  UpdateContentDatabaseViewRequest,
  ValidateBuilderSourceExecutionRequest,
} from "@shared/api";

export function useContentDatabase(documentId: string | null) {
  return useActionQuery<ContentDatabaseResponse>(
    "get-content-database",
    documentId ? { documentId } : undefined,
    {
      enabled: !!documentId,
      retry: false,
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
            queryKey: ["action", "get-content-database", { documentId }],
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
          queryKey: ["action", "get-content-database", { documentId }],
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
        queryKey: ["action", "get-content-database", { documentId }],
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
          queryKey: ["action", "get-content-database", { documentId }],
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
        queryKey: ["action", "get-content-database", { documentId }],
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
        queryKey: ["action", "get-content-database", { documentId }],
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

export function useRefreshContentDatabaseSource(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseSourceStatusResponse,
    RefreshContentDatabaseSourceRequest
  >("refresh-content-database-source", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database", { documentId }],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
    },
  });
}

export function useProposeContentDatabaseSourceChangeSet(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    ContentDatabaseResponse,
    ProposeContentDatabaseSourceChangeSetRequest
  >("propose-content-database-source-change-set", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database", { documentId }],
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
        queryKey: ["action", "get-content-database", { documentId }],
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
        queryKey: ["action", "get-content-database", { documentId }],
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
        queryKey: ["action", "get-content-database", { documentId }],
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
        queryKey: ["action", "get-content-database", { documentId }],
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
        queryKey: ["action", "get-content-database", { documentId }],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database-source", { documentId }],
      });
    },
  });
}
