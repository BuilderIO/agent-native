import { useActionMutation } from "@agent-native/core/client/hooks";
import type {
  ContentDatabasePersonalViewResponse,
  ContentDatabaseView,
} from "@shared/api";
import { applyContentPersonalNavigationPatch } from "@shared/content-personal-navigation-patch";
import { useQueryClient } from "@tanstack/react-query";

export function useUpdateContentPersonalNavigation(
  databaseId: string | null,
  sharedViews?: ContentDatabaseView[],
) {
  const queryClient = useQueryClient();
  const queryKey = [
    "action",
    "get-content-database-personal-view",
    { databaseId },
  ];
  const mutationKey = ["content-personal-navigation", databaseId];
  return useActionMutation("update-content-database-personal-view", {
    mutationKey,
    scope: { id: JSON.stringify(mutationKey) },
    skipActionQueryInvalidation: true,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<ContentDatabasePersonalViewResponse>(queryKey);
      if (variables.navigation)
        queryClient.setQueryData(queryKey, {
          databaseId,
          overrides: applyContentPersonalNavigationPatch(
            previous?.overrides ?? null,
            variables.navigation,
            sharedViews,
          ),
        });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (queryClient.isMutating({ mutationKey }) > 1) return;
      queryClient.setQueryData(
        queryKey,
        (
          context as
            | { previous?: ContentDatabasePersonalViewResponse }
            | undefined
        )?.previous,
      );
    },
    onSuccess: (data) => {
      if (queryClient.isMutating({ mutationKey }) > 1) return;
      queryClient.setQueryData(queryKey, data);
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey }) > 1) return;
      void queryClient.invalidateQueries({ queryKey });
    },
  });
}
