import { useActionMutation } from "@agent-native/core/client/hooks";
import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { getFrameGroupBounds } from "@shared/canvas-math";
import type { QueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";
import { toast } from "sonner";

import { getInitialFrameGeometry } from "@/components/design/multi-screen/frame-geometry";
import type { FrameGeometry } from "@/components/design/multi-screen/types";
import { prettyScreenName } from "@/lib/screen-names";
import {
  blankScreenHtml,
  nextBlankScreenFilename,
} from "@/pages/design-editor/canvas-primitive-insert";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { getCanvasFrameGeometry } from "@/pages/design-editor/design-data-geometry-utils";
import type { FileCreationHistoryEntry } from "@/pages/design-editor/history";
import type { DesignFile } from "@/pages/design-editor/types";

import { getAllScreenFrameEntries } from "../overview-camera";

export interface AddScreenArgs {
  canEditDesign: boolean;
  boardContentBounds?: FrameGeometry | null;
  boardFileId?: string | null;
  createFileMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "create-file">
  >;
  designDataJsonRef: RefObject<Record<string, unknown>>;
  files: DesignFile[];
  focusCreatedScreen: (screenId: string, geometry: FrameGeometry) => void;
  id: string | undefined;
  optimisticallyInsertCreatedFile: (args: {
    fileId: string;
    filename: string;
    fileType: DesignFile["fileType"];
    content: string;
    result?: Record<string, unknown> | null;
  }) => void;
  overviewScreens: OverviewScreen[];
  queryClient: QueryClient;
  recordFileCreationHistoryEntry: (entry: FileCreationHistoryEntry) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  writeFrameGeometrySnapshot: (
    geometryById: CanvasFrameGeometryById,
    options?: { syncViewportFrameIds?: string[]; pinHeightFrameIds?: string[] },
  ) => void;
}

export function runAddScreen({
  canEditDesign,
  boardContentBounds,
  boardFileId,
  createFileMutation,
  designDataJsonRef,
  files,
  focusCreatedScreen,
  id,
  optimisticallyInsertCreatedFile,
  overviewScreens,
  queryClient,
  recordFileCreationHistoryEntry,
  t,
  writeFrameGeometrySnapshot,
}: AddScreenArgs) {
  if (!id || !canEditDesign) return;
  const filename = nextBlankScreenFilename(files);
  const content = blankScreenHtml(prettyScreenName(filename));
  const defaultGeometry = getInitialFrameGeometry(overviewScreens.length, {
    width: 1280,
    height: 2560,
  });
  const bounds = getFrameGroupBounds(
    getAllScreenFrameEntries({
      overviewScreens,
      canvasFrameGeometryById: getCanvasFrameGeometry(
        designDataJsonRef.current,
      ),
      boardContentBounds,
      boardFileId,
      includeResponsivePreviews: true,
    }),
  );
  const nextGeometry = bounds
    ? {
        x: bounds.right + 56,
        y: bounds.top,
        width: defaultGeometry.width,
        height: defaultGeometry.height,
      }
    : defaultGeometry;
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
          writeFrameGeometrySnapshot({
            ...getCanvasFrameGeometry(designDataJsonRef.current),
            [nextId]: nextGeometry,
          });
          focusCreatedScreen(nextId, nextGeometry);
          recordFileCreationHistoryEntry({
            filename,
            content,
            fileType: "html",
            geometry: nextGeometry,
          });
        }
        if (!nextId) {
          void queryClient.invalidateQueries({
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
