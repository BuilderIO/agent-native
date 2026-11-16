import { useMutationState } from "@tanstack/react-query";
import { useMemo } from "react";

import type { FilesRowMove } from "@/lib/files-navigation";

/** Moving a page to a new parent; the Files tree draws it there while the move is pending. */
export const MOVE_DOCUMENT_MUTATION_KEY = ["content", "move-document"];

/** What a pending move carries for the tree: its context from `useMoveDocument`. */
export type MoveDocumentContext = { move?: FilesRowMove };

/**
 * The pages whose move is still waiting on the server, by page ID. The Files
 * tree draws each under its new parent, so a page moves with the click, a read
 * that started before the move can't put it back, and a failed move shows it
 * where it was. A page's latest move that hasn't failed decides: an older
 * move still waiting doesn't draw a page where a newer, finished one took it
 * from, and a newer move that failed doesn't hide an older one still waiting.
 */
export function usePendingMoves(): ReadonlyMap<string, FilesRowMove> {
  const moves = useMutationState({
    filters: {
      mutationKey: MOVE_DOCUMENT_MUTATION_KEY,
      // Only a move to a new parent changes where a page shows.
      predicate: (mutation) =>
        mutation.state.status !== "error" &&
        (mutation.state.variables as MoveVariables | undefined)?.parentId !==
          undefined,
    },
    select: (mutation) => ({
      documentId: (mutation.state.variables as MoveVariables).id,
      move:
        mutation.state.status === "pending"
          ? ((mutation.state.context as MoveDocumentContext | undefined)
              ?.move ?? null)
          : null,
    }),
  });
  return useMemo(() => {
    // Moves come oldest first, so a page's latest move is its last.
    const latest = new Map<string, FilesRowMove | null>();
    for (const { documentId, move } of moves) latest.set(documentId, move);
    return new Map(
      [...latest].flatMap(([documentId, move]) =>
        move ? [[documentId, move] as const] : [],
      ),
    );
  }, [moves]);
}

type MoveVariables = { id: string; parentId?: string | null };
