import { useT } from "@agent-native/core/client/i18n";
import { useCallback, useMemo, useRef, useState } from "react";
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
  onMoved,
}: {
  onMoved?: (page: MovePageTarget, destination: MovePageDestination) => void;
} = {}) {
  const t = useT();
  const moveDocument = useMoveDocument();
  const contentSpacesQuery = useContentSpaces();
  const contentSpaces = useMemo(
    () => contentSpacesQuery.data?.spaces ?? [],
    [contentSpacesQuery.data],
  );
  const [movingPage, setMovingPage] = useState<MovePageTarget | null>(null);
  const onMovedRef = useRef(onMoved);
  onMovedRef.current = onMoved;

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
      moveDocument.mutate(
        { id: page.documentId, parentId, ...(crossSpace ? { spaceId } : {}) },
        {
          onSuccess: () => {
            onMovedRef.current?.(page, destination);
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
          onError: (error) => {
            toast.error(t("sidebar.failedMovePage"), {
              description:
                error instanceof Error
                  ? error.message
                  : t("empty.genericError"),
            });
          },
        },
      );
    },
    [contentSpaces, moveDocument, t],
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
