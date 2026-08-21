import { useActionMutation } from "@agent-native/core/client/hooks";
import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { QueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";
import { toast } from "sonner";

import { getInitialFrameGeometry } from "@/components/design/multi-screen/frame-geometry";
import type { FrameGeometry } from "@/components/design/multi-screen/types";
import {
  nextDuplicatedFilename,
  normalizedDesignFileType,
  reassignDuplicatedNodeIds,
} from "@/pages/design-editor/canvas-primitive-insert";
import type { DesignDataOperation } from "@/pages/design-editor/data-operations";
import { applyDesignDataOperations } from "@/pages/design-editor/data-operations";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  getCanvasFrameGeometry,
  getDesignDataRecord,
} from "@/pages/design-editor/design-data-geometry-utils";
import type { FileCreationHistoryEntry } from "@/pages/design-editor/history";
import type { DesignFile } from "@/pages/design-editor/types";

export interface DuplicateScreenArgs {
  canEditDesign: boolean;
  createFileAsync: ReturnType<
    typeof useActionMutation<undefined, undefined, "create-file">
  >["mutateAsync"];
  designDataJsonRef: RefObject<Record<string, unknown>>;
  files: DesignFile[];
  focusCreatedScreen: (screenId: string, geometry: FrameGeometry) => void;
  id: string | undefined;
  liveFrameGeometryRef: RefObject<CanvasFrameGeometryById>;
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
  updateDesignAsync: ReturnType<
    typeof useActionMutation<undefined, undefined, "update-design">
  >["mutateAsync"];
  writeFrameGeometrySnapshot: (
    geometryById: CanvasFrameGeometryById,
    options?: { syncViewportFrameIds?: string[]; pinHeightFrameIds?: string[] },
  ) => void;
}

export function runDuplicateScreen(
  {
    canEditDesign,
    createFileAsync,
    designDataJsonRef,
    files,
    focusCreatedScreen,
    id,
    liveFrameGeometryRef,
    optimisticallyInsertCreatedFile,
    overviewScreens,
    queryClient,
    recordFileCreationHistoryEntry,
    t,
    updateDesignAsync,
    writeFrameGeometrySnapshot,
  }: DuplicateScreenArgs,
  screenId: string,
  request?: {
    canvasPosition?: { x: number; y: number };
  },
) {
  if (!id || !canEditDesign) return;
  const source = files.find((file) => file.id === screenId);
  if (!source) return;
  const filename = nextDuplicatedFilename(files, source.filename);
  const content = reassignDuplicatedNodeIds(source.content);
  const fileType = normalizedDesignFileType(source.fileType);
  const sourceOverviewScreen = overviewScreens.find(
    (screen) => screen.id === screenId,
  );
  const fallbackGeometry = getInitialFrameGeometry(overviewScreens.length, {
    width: sourceOverviewScreen?.width ?? 1280,
    height: sourceOverviewScreen?.height ?? 2560,
  });
  const createdGeometry: FrameGeometry = request?.canvasPosition
    ? {
        ...fallbackGeometry,
        ...liveFrameGeometryRef.current[screenId],
        x: request.canvasPosition.x,
        y: request.canvasPosition.y,
      }
    : fallbackGeometry;

  // Per-call mutate callbacks, not a promise, would silently strand every
  // duplicate but the last: a second mutate() detaches the observer from
  // the first mutation, so only the newest call's onSuccess ever runs.
  void createFileAsync({
    designId: id,
    filename,
    content,
    fileType,
  } as any)
    .then((result: any) => {
      const nextId = typeof result?.id === "string" ? result.id : null;
      // Refetch only when there is no created id to insert optimistically:
      // a whole-design refetch re-downloads every screen's HTML, which is
      // what made adding a frame feel slow.
      if (!nextId) {
        queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });
      } else {
        optimisticallyInsertCreatedFile({
          fileId: nextId,
          filename,
          fileType,
          content,
          result,
        });
        // Optimistic geometry keeps frame, selection, and camera agreeing
        // before the refetch. Base it on the map writeFrameGeometrySnapshot
        // diffs against, or a sibling duplicate's placement is deleted.
        writeFrameGeometrySnapshot({
          ...getCanvasFrameGeometry(designDataJsonRef.current),
          [nextId]: createdGeometry,
        });
        focusCreatedScreen(nextId, createdGeometry);
        recordFileCreationHistoryEntry({
          filename,
          content,
          fileType,
          geometry: createdGeometry,
        });
        // A duplicated localhost/fusion screen stays URL-backed only if its
        // metadata comes along, and the carry must be path-addressed or it
        // replaces a peer's metadata for every other screen.
        const sourceMetadataById = getDesignDataRecord(
          designDataJsonRef.current,
          "screenMetadata",
        );
        const sourceMetadata = getDesignDataRecord(
          sourceMetadataById,
          screenId,
        );
        const sourceType = sourceMetadata.sourceType;
        if (sourceType === "localhost" || sourceType === "fusion") {
          const dataOperations: DesignDataOperation[] = [
            {
              op: "set",
              path: ["screenMetadata", nextId],
              value: { ...sourceMetadata },
            },
          ];
          const sourceLocalhostScreensById = getDesignDataRecord(
            designDataJsonRef.current,
            "localhostScreens",
          );
          const sourceLocalhostScreen = getDesignDataRecord(
            sourceLocalhostScreensById,
            screenId,
          );
          if (Object.keys(sourceLocalhostScreen).length > 0) {
            dataOperations.push({
              op: "set",
              path: ["localhostScreens", nextId],
              value: { ...sourceLocalhostScreen },
            });
          }
          const nextData = applyDesignDataOperations(
            designDataJsonRef.current,
            dataOperations,
          );
          designDataJsonRef.current = nextData;
          queryClient.setQueryData(
            ["action", "get-design", { id }],
            (old: any) => {
              if (!old || typeof old !== "object") return old;
              return { ...old, data: JSON.stringify(nextData) };
            },
          );
          void updateDesignAsync({ id, dataOperations } as any).catch(() => {
            queryClient.invalidateQueries({
              queryKey: ["action", "get-design"],
            });
          });
        }
      }
      toast.success(t("designEditor.toasts.screenDuplicated"));
    })
    .catch((error: unknown) => {
      toast.error(
        error instanceof Error
          ? error.message
          : t("designEditor.toasts.screenDuplicateError"),
      );
    });
}
