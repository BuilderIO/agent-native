import { useMutationState, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import type { ListContentSpacesResponse } from "./use-content-spaces";

/** Moving a page to Trash; navigation hides the page while the move is pending. */
export const DELETE_DOCUMENT_MUTATION_KEY = ["content", "delete-document"];
/** Moving a collection to Trash; navigation hides it while the move is pending. */
export const DELETE_CONTENT_DATABASE_MUTATION_KEY = [
  "content",
  "delete-content-database",
];

export type PendingTrash = {
  documentIds: ReadonlySet<string>;
  databaseIds: ReadonlySet<string>;
};

/**
 * The pages and collections whose move to Trash is still waiting on the
 * server. Navigation lists leave them out, so a page goes with the click, a
 * read that started before the move can't bring it back, and a failed move
 * shows it again. A page delete that names the Favorites collection only takes
 * the page out of Favorites, so it isn't counted: the page stays.
 */
export function usePendingTrash(): PendingTrash {
  const queryClient = useQueryClient();
  const pageDeletes = useMutationState({
    filters: { mutationKey: DELETE_DOCUMENT_MUTATION_KEY, status: "pending" },
    select: (mutation) =>
      mutation.state.variables as
        | { id?: string; databaseDocumentId?: string }
        | undefined,
  });
  const databaseIds = useMutationState({
    filters: {
      mutationKey: DELETE_CONTENT_DATABASE_MUTATION_KEY,
      status: "pending",
    },
    select: (mutation) =>
      (mutation.state.variables as { databaseId?: string } | undefined)
        ?.databaseId ?? null,
  });
  return useMemo(() => {
    // Read when a delete starts; the spaces list has loaded long before.
    const favoritesDocumentIds = new Set(
      queryClient
        .getQueriesData<ListContentSpacesResponse>({
          queryKey: ["action", "list-content-spaces"],
        })
        .flatMap(([, data]) =>
          data?.favoritesDocumentId ? [data.favoritesDocumentId] : [],
        ),
    );
    return {
      documentIds: new Set(
        pageDeletes.flatMap((variables) =>
          variables?.id &&
          !(
            variables.databaseDocumentId &&
            favoritesDocumentIds.has(variables.databaseDocumentId)
          )
            ? [variables.id]
            : [],
        ),
      ),
      databaseIds: new Set(
        databaseIds.filter((id): id is string => id !== null),
      ),
    };
  }, [databaseIds, pageDeletes, queryClient]);
}
