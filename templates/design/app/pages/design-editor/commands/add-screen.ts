import { useActionMutation } from "@agent-native/core/client/hooks";
import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { getInitialFrameGeometry } from "@/components/design/multi-screen/frame-geometry";
import type { FrameGeometry } from "@/components/design/multi-screen/types";
import { prettyScreenName } from "@/lib/screen-names";
import {
  blankScreenHtml,
  nextBlankScreenFilename,
} from "@/pages/design-editor/canvas-primitive-insert";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import type { FileCreationHistoryEntry } from "@/pages/design-editor/history";
import type { DesignFile } from "@/pages/design-editor/types";

export interface AddScreenArgs {
  canEditDesign: boolean;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  createFileMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "create-file">
  >;
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
  canvasFrameGeometryById,
  createFileMutation,
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
  const nextGeometry = getInitialFrameGeometry(overviewScreens.length, {
    width: 1280,
    height: 2560,
  });
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
            ...canvasFrameGeometryById,
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
