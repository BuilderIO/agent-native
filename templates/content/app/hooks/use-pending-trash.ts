import { useMutationState } from "@tanstack/react-query";
import { useMemo } from "react";

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
 * shows it again. A page delete that names a collection may only take the
 * page out of Favorites, so it isn't counted: the page may stay.
 */
export function usePendingTrash(): PendingTrash {
  const documentIds = useMutationState({
    filters: { mutationKey: DELETE_DOCUMENT_MUTATION_KEY, status: "pending" },
    select: (mutation) => {
      const variables = mutation.state.variables as
        | { id?: string; databaseDocumentId?: string }
        | undefined;
      return variables?.id && !variables.databaseDocumentId
        ? variables.id
        : null;
    },
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
  return useMemo(
    () => ({
      documentIds: new Set(
        documentIds.filter((id): id is string => id !== null),
      ),
      databaseIds: new Set(
        databaseIds.filter((id): id is string => id !== null),
      ),
    }),
    [documentIds, databaseIds],
  );
}
