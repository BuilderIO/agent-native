import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";

export type ContentSpaceSummary = {
  id: string;
  name: string;
  kind: string;
  filesDatabaseId: string;
  filesDocumentId: string;
  orgId: string | null;
  role: "owner" | "editor" | "viewer";
  catalogItemId: string;
  catalogDocumentId: string;
};

export type ListContentSpacesResponse = {
  catalogDatabaseId: string;
  catalogDocumentId: string;
  favoritesDatabaseId: string | null;
  favoritesDocumentId: string | null;
  spaces: ContentSpaceSummary[];
};

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
    onSuccess: async () => {
      await queryClient.refetchQueries({
        queryKey: ["action", "list-content-spaces"],
      });
    },
  });
}

export function useCreateContentSpace() {
  const queryClient = useQueryClient();
  return useActionMutation<
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
