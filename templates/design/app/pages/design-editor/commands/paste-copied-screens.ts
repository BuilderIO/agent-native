import { useActionMutation } from "@agent-native/core/client/hooks";
import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { VisibleCanvasRect } from "@/components/design/multi-screen/types";
import type { ElementInfo } from "@/components/design/types";
import type { DesignClipboardScreenEntry } from "@/lib/design-import";
import {
  nextDuplicatedFilename,
  normalizedDesignFileType,
  reassignDuplicatedNodeIds,
} from "@/pages/design-editor/canvas-primitive-insert";
import {
  resolveCopiedScreenSourceFrame,
  resolveScreenViewPastePositions,
} from "@/pages/design-editor/commands/paste-view-position";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { getAllScreenFrameEntries } from "@/pages/design-editor/overview-camera";
import type { DesignFile, DesignTool } from "@/pages/design-editor/types";

export interface PasteCopiedScreensArgs {
  canEditDesign: boolean;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  createFileMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "create-file">
  >;
  files: DesignFile[];
  getVisibleCanvasRect: () => VisibleCanvasRect | null;
  id: string | undefined;
  overviewScreens: OverviewScreen[];
  pasteCascadeRef: RefObject<number>;
  queryClient: QueryClient;
  queueFrameGeometrySave: (geometryById: CanvasFrameGeometryById) => void;
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setActiveTool: Dispatch<SetStateAction<DesignTool>>;
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  setViewMode: Dispatch<SetStateAction<"single" | "overview">>;
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runPasteCopiedScreens(
  {
    canEditDesign,
    canvasFrameGeometryById,
    createFileMutation,
    files,
    getVisibleCanvasRect,
    id,
    overviewScreens,
    pasteCascadeRef,
    queryClient,
    queueFrameGeometrySave,
    setActiveFileId,
    setActiveTool,
    setOverviewSelectedScreenIds,
    setSelectedElement,
    setSelectedLayerIdsState,
    setViewMode,
    t,
    viewModeRef,
  }: PasteCopiedScreensArgs,
  screens: DesignClipboardScreenEntry[],
  position?: { x: number; y: number },
) {
  if (!id || !canEditDesign || screens.length === 0) return;
  const pasteOffset = 32 + pasteCascadeRef.current * 16;
  const currentFrames = getAllScreenFrameEntries({
    overviewScreens,
    canvasFrameGeometryById,
  });
  const sourceFrames = screens.map((screen) =>
    resolveCopiedScreenSourceFrame(screen, currentFrames),
  );
  const viewPositions = position
    ? null
    : resolveScreenViewPastePositions({
        visibleRect:
          viewModeRef.current === "overview" ? getVisibleCanvasRect() : null,
        sourceFrames,
        cascadeOffset: pasteCascadeRef.current * 16,
      });
  pasteCascadeRef.current += 1;
  screens.forEach((screen, index) => {
    const filename = nextDuplicatedFilename(files, screen.filename);
    const content = reassignDuplicatedNodeIds(screen.content);
    const sourceFrame = sourceFrames[index];
    createFileMutation.mutate(
      {
        designId: id,
        filename,
        content,
        fileType: normalizedDesignFileType(screen.fileType ?? "html"),
      } as any,
      {
        onSuccess: (result: any) => {
          const nextId = typeof result?.id === "string" ? result.id : null;
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
          if (!nextId) return;
          const nextX = position
            ? position.x + index * 16
            : viewPositions
              ? viewPositions[index]!.x
              : (sourceFrame?.x ?? 0) + pasteOffset;
          const nextY = position
            ? position.y + index * 16
            : viewPositions
              ? viewPositions[index]!.y
              : (sourceFrame?.y ?? 0) + pasteOffset;
          queueFrameGeometrySave({
            ...canvasFrameGeometryById,
            [nextId]: {
              ...screen.canvasFrame,
              x: nextX,
              y: nextY,
            },
          });
          if (index === screens.length - 1) {
            setActiveFileId(nextId);
            setActiveTool("move");
            setSelectedElement(null);
            setSelectedLayerIdsState([nextId]);
            viewModeRef.current = "overview";
            setViewMode("overview");
            setOverviewSelectedScreenIds([nextId]);
          }
        },
        onError: (error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : t("designEditor.toasts.screenDuplicateError"),
          );
        },
      },
    );
  });
}
