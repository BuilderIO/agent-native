import { useQueryClient } from "@tanstack/react-query";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import type {
  AddDatabaseItemRequest,
  ContentDatabaseResponse,
  CreateDatabaseRequest,
  DuplicateDatabaseItemRequest,
  MoveDatabaseItemRequest,
  UpdateContentDatabaseViewRequest,
} from "@shared/api";

export function useContentDatabase(documentId: string | null) {
  return useActionQuery<ContentDatabaseResponse>(
    "get-content-database",
    documentId ? { documentId } : undefined,
    {
      enabled: !!documentId,
      retry: false,
      placeholderData: (prev) => prev,
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
    },
  });
}
