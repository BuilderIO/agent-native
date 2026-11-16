import { useMutationState } from "@tanstack/react-query";
import { useMemo } from "react";

import type { FilesRowMove } from "@/lib/files-navigation";

/** Moving a page to a new parent; the Files tree draws it there while the move is pending. */
export const MOVE_DOCUMENT_MUTATION_KEY = ["content", "move-document"];

/** What a pending move carries for the tree: its context from `useMoveDocument`. */
export type MoveDocumentContext = { move?: FilesRowMove };

/**
 * The pages whose move is still waiting on the server, by page ID, the latest
 * move of a page last. The Files tree draws each under its new parent, so a
 * page moves with the click, a read that started before the move can't put it
 * back, and a failed move shows it where it was.
 */
export function usePendingMoves(): ReadonlyMap<string, FilesRowMove> {
  const moves = useMutationState({
    filters: { mutationKey: MOVE_DOCUMENT_MUTATION_KEY, status: "pending" },
    select: (mutation) =>
      (mutation.state.context as MoveDocumentContext | undefined)?.move ?? null,
  });
  return useMemo(
    () =>
      new Map(
        moves.flatMap((move) =>
          move ? [[move.documentId, move] as const] : [],
        ),
      ),
    [moves],
  );
}
