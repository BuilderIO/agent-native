import { useT } from "@agent-native/core/client/i18n";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { useContentSpaces } from "@/hooks/use-content-spaces";
import { useMoveDocument } from "@/hooks/use-documents";

import {
  MovePageDialog,
  type MovePageDestination,
  type MovePageTarget,
} from "./MovePageDialog";

/**
 * The "Move to" flow: picking a page opens the move dialog, and choosing a
 * destination moves it. Shared by the sidebar's row menus and the command
 * menu, so both move pages the same way.
 */
export function useMovePageDialog({
  onMove,
}: {
  /**
   * Runs as the move starts, while the page already shows in its new place.
   * Returns what to run once the server answers.
   */
  onMove?: (
    page: MovePageTarget,
    destination: MovePageDestination,
  ) => ((succeeded: boolean) => void) | void;
} = {}) {
  const t = useT();
  const moveDocument = useMoveDocument();
  const contentSpacesQuery = useContentSpaces();
  const contentSpaces = useMemo(
    () => contentSpacesQuery.data?.spaces ?? [],
    [contentSpacesQuery.data],
  );
  const [movingPage, setMovingPage] = useState<MovePageTarget | null>(null);

  const moveSpaces = useMemo(
    () =>
      contentSpaces.filter(
        (space) =>
          space.id === movingPage?.spaceId ||
          (space.kind !== "source_backed" && space.canCreateDatabase !== false),
      ),
    [contentSpaces, movingPage?.spaceId],
  );
  const handleMovePage = useCallback(
    (page: MovePageTarget, destination: MovePageDestination) => {
      const { spaceId, parentId } = destination;
      const crossSpace = spaceId !== page.spaceId;
      const settle = onMove?.(page, destination);
      // Each move answers for itself: callbacks given to `mutate` run only for
      // the latest of several moves still waiting.
      void moveDocument
        .mutateAsync({
          id: page.documentId,
          parentId,
          ...(crossSpace ? { spaceId } : {}),
        })
        .then(
          () => {
            settle?.(true);
            if (crossSpace) {
              const space = contentSpaces.find(
                (candidate) => candidate.id === spaceId,
              );
              toast.success(
                t("sidebar.movedToSpace", {
                  title: page.title,
                  space: space?.name ?? "",
                }),
              );
            }
          },
          (error: unknown) => {
            settle?.(false);
            toast.error(t("sidebar.failedMovePage"), {
              description:
                error instanceof Error
                  ? error.message
                  : t("empty.genericError"),
            });
          },
        );
    },
    [contentSpaces, moveDocument, onMove, t],
  );

  const dialog = (
    <MovePageDialog
      page={movingPage}
      spaces={moveSpaces}
      onOpenChange={(open) => {
        if (!open) setMovingPage(null);
      }}
      onMove={handleMovePage}
    />
  );

  return { startMove: setMovingPage, dialog };
}
