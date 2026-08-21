import { useActionMutation } from "@agent-native/core/client/hooks";
import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { QueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import type { FrameGeometry } from "@/components/design/multi-screen/types";
import { prettyScreenName } from "@/lib/screen-names";
import {
  blankScreenHtml,
  nextBlankScreenFilename,
} from "@/pages/design-editor/canvas-primitive-insert";
import type { FileCreationHistoryEntry } from "@/pages/design-editor/history";
import type { DesignFile } from "@/pages/design-editor/types";

export interface CreateScreenFrameArgs {
  canEditDesign: boolean;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  createFileMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "create-file">
  >;
  files: DesignFile[];
  focusCreatedScreen: (screenId: string, geometry: FrameGeometry) => void;
  id: string | undefined;
  locallyPinnedHeightIdsRef: RefObject<Set<string>>;
  optimisticallyInsertCreatedFile: (args: {
    fileId: string;
    filename: string;
    fileType: DesignFile["fileType"];
    content: string;
    result?: Record<string, unknown> | null;
  }) => void;
  queryClient: QueryClient;
  recordFileCreationHistoryEntry: (entry: FileCreationHistoryEntry) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  writeFrameGeometrySnapshot: (
    geometryById: CanvasFrameGeometryById,
    options?: { syncViewportFrameIds?: string[]; pinHeightFrameIds?: string[] },
  ) => void;
}

export function runCreateScreenFrame(
  {
    canEditDesign,
    canvasFrameGeometryById,
    createFileMutation,
    files,
    focusCreatedScreen,
    id,
    locallyPinnedHeightIdsRef,
    optimisticallyInsertCreatedFile,
    queryClient,
    recordFileCreationHistoryEntry,
    t,
    writeFrameGeometrySnapshot,
  }: CreateScreenFrameArgs,
  geometry: { x: number; y: number; width: number; height: number },
) {
  if (!id || !canEditDesign) return;
  const filename = nextBlankScreenFilename(files);
  const content = blankScreenHtml(prettyScreenName(filename));
  const nextGeometry = {
    x: Math.round(geometry.x),
    y: Math.round(geometry.y),
    width: Math.max(64, Math.round(geometry.width)),
    height: Math.max(64, Math.round(geometry.height)),
  };
  createFileMutation.mutate(
    {
      designId: id,
      filename,
      content,
      fileType: "html",
    } as any,
    {
      onSuccess: (result: any) => {
        const nextId = typeof result?.id === "string" ? result.id : null;
        if (nextId) {
          optimisticallyInsertCreatedFile({
            fileId: nextId,
            filename,
            fileType: "html",
            content,
            result,
          });
          locallyPinnedHeightIdsRef.current.add(nextId);
          trace("screen", "pin-drawn-height", {
            fileId: nextId,
            height: nextGeometry.height,
            why: "a drawn size is deliberate; without this the device floor and content-fit pass override it",
          });
          // The drawn height is a deliberate size, so pin it: otherwise
          // the device floor and content-fit pass immediately override it.
          writeFrameGeometrySnapshot(
            {
              ...canvasFrameGeometryById,
              [nextId]: nextGeometry,
            },
            {
              syncViewportFrameIds: [nextId],
              pinHeightFrameIds: [nextId],
            },
          );
          focusCreatedScreen(nextId, nextGeometry);
          recordFileCreationHistoryEntry({
            filename,
            content,
            fileType: "html",
            geometry: nextGeometry,
          });
        }
        // Refetch only when there is no created id to insert optimistically:
        // a whole-design refetch re-downloads every screen's HTML, which is
        // what made adding a frame feel slow.
        if (!nextId) {
          queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
        }
      },
      onError: (error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : t("designEditor.toasts.screenDuplicateError"),
        );
      },
    },
  );
}
