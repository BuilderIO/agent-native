import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";

import { useContentActionMutation } from "./use-content-action-mutation";

export type ContentSpaceSummary = {
  id: string;
  name: string;
  kind: string;
  filesDatabaseId: string;
  filesDocumentId: string;
  orgId: string | null;
  role: "owner" | "editor" | "viewer";
  canCreateDatabase?: boolean;
  catalogItemId: string;
  catalogDocumentId: string;
  catalogPosition: number;
};

export type ListContentSpacesResponse = {
  sourceMode: "database" | "local-files";
  catalogDatabaseId: string;
  catalogDocumentId: string;
  favoritesDatabaseId: string | null;
  favoritesDocumentId: string | null;
  needsReconciliation: boolean;
  reconciliationKey: string;
  spaces: ContentSpaceSummary[];
};

export function shouldAutoEnsureContentSpaces({
  querySucceeded,
  reconciliationNeeded,
  reconciliationKey,
  attemptedReconciliationKey,
  provisioningPending,
}: {
  querySucceeded: boolean;
  reconciliationNeeded: boolean;
  reconciliationKey: string;
  attemptedReconciliationKey: string | null;
  provisioningPending: boolean;
}) {
  return (
    querySucceeded &&
    reconciliationNeeded &&
    reconciliationKey !== attemptedReconciliationKey &&
    !provisioningPending
  );
}

export function useContentSpaces() {
  return useActionQuery<ListContentSpacesResponse>(
    "list-content-spaces",
    undefined,
    {
      placeholderData: (previous) => previous,
    },
  );
}

export function useEnsureContentSpaces() {
  const queryClient = useQueryClient();
  return useActionMutation("ensure-content-spaces", {
    skipActionQueryInvalidation: true,
    onSuccess: async () => {
      await queryClient.refetchQueries({
        queryKey: ["action", "list-content-spaces"],
      });
    },
  });
}

export function useCreateContentSpace() {
  const queryClient = useQueryClient();
  return useContentActionMutation<
    {
      spaceId: string;
      filesDatabaseId: string;
      filesDocumentId: string;
      catalogDatabaseId: string;
      catalogItemId: string;
      catalogDocumentId: string;
      name: string;
      kind: "user";
    },
    {
      name: string;
      requestId: string;
      propertyValues?: Record<string, unknown>;
    }
  >("create-content-space", {
    invalidates: [],
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({
          queryKey: ["action", "list-content-spaces"],
        }),
        queryClient.refetchQueries({
          queryKey: ["action", "get-content-database"],
        }),
      ]);
    },
  });
}

export function useDeleteContentSpace() {
  const queryClient = useQueryClient();
  return useContentActionMutation<
    { success: boolean; spaceId: string; deletedDocuments: number },
    { spaceId: string }
  >("delete-content-space", {
    invalidates: [
      ["action", "get-content-recent"],
      ["action", "list-trashed-documents"],
      ["action", "list-trashed-content-databases"],
      ["action", "list-content-trash"],
    ],
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({
          queryKey: ["action", "list-content-spaces"],
        }),
        queryClient.refetchQueries({
          queryKey: ["action", "get-content-database"],
        }),
        queryClient.refetchQueries({
          queryKey: ["action", "list-documents"],
        }),
      ]);
    },
  });
}
