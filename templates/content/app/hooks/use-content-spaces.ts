import { useActionMutation, useActionQuery } from "@agent-native/core/client";
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
