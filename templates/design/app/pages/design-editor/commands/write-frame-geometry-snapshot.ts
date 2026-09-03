import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { QueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";

import type { DesignDataOperation } from "@/pages/design-editor/data-operations";
import {
  applyDesignDataOperations,
  buildFrameGeometryDataOperations,
  compactDesignDataOperations,
} from "@/pages/design-editor/data-operations";
import {
  cloneCanvasFrameGeometry,
  getCanvasFrameGeometry,
} from "@/pages/design-editor/design-data-geometry-utils";
import { sanitizeCanvasFrameGeometryForPersist } from "@/pages/design-editor/geometry-persistence";

export interface WriteFrameGeometrySnapshotArgs {
  boardFileId: string | undefined;
  canEditDesignRef: RefObject<boolean>;
  designDataJsonRef: RefObject<Record<string, unknown>>;
  enqueueFrameGeometryDataSave: (
    dataOperations: DesignDataOperation[],
  ) => boolean;
  frameGeometrySaveTimerRef: RefObject<number | null>;
  id: string | undefined;
  pendingFrameGeometrySaveRef: RefObject<{
    geometryById: CanvasFrameGeometryById;
    previousGeometry: CanvasFrameGeometryById;
  } | null>;
  queryClient: QueryClient;
}

export function runWriteFrameGeometrySnapshot(
  {
    boardFileId,
    canEditDesignRef,
    designDataJsonRef,
    enqueueFrameGeometryDataSave,
    frameGeometrySaveTimerRef,
    id,
    pendingFrameGeometrySaveRef,
    queryClient,
  }: WriteFrameGeometrySnapshotArgs,
  geometryById: CanvasFrameGeometryById,
  options?: {
    syncViewportFrameIds?: string[];
    pinHeightFrameIds?: string[];
  },
) {
  if (!id || !canEditDesignRef.current) return;
  const queuedSave = pendingFrameGeometrySaveRef.current;
  if (frameGeometrySaveTimerRef.current !== null) {
    window.clearTimeout(frameGeometrySaveTimerRef.current);
    frameGeometrySaveTimerRef.current = null;
  }
  pendingFrameGeometrySaveRef.current = null;
  // Geometry-persist guard — same contract as queueFrameGeometrySave:
  // never let absurd frame geometry (a corrupted zoom basis' product)
  // reach canvasFrames or the screenMetadata viewport sync below.
  const { geometryById: safeGeometryById } =
    sanitizeCanvasFrameGeometryForPersist(
      geometryById,
      getCanvasFrameGeometry(designDataJsonRef.current),
      boardFileId ? [boardFileId] : [],
    );
  const snapshot = cloneCanvasFrameGeometry(safeGeometryById);
  const queuedOperations = queuedSave
    ? buildFrameGeometryDataOperations({
        previousGeometry: queuedSave.previousGeometry,
        nextGeometry: sanitizeCanvasFrameGeometryForPersist(
          queuedSave.geometryById,
          queuedSave.previousGeometry,
          boardFileId ? [boardFileId] : [],
        ).geometryById,
        designData: designDataJsonRef.current,
      })
    : [];
  const dataOperations = compactDesignDataOperations([
    ...queuedOperations,
    ...buildFrameGeometryDataOperations({
      previousGeometry: getCanvasFrameGeometry(designDataJsonRef.current),
      nextGeometry: snapshot,
      designData: designDataJsonRef.current,
      syncViewportFrameIds: options?.syncViewportFrameIds,
      pinHeightFrameIds: options?.pinHeightFrameIds,
    }),
  ]);
  if (dataOperations.length === 0) return;
  const nextData = applyDesignDataOperations(
    designDataJsonRef.current,
    dataOperations,
  );
  designDataJsonRef.current = nextData;
  queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
    if (!old || typeof old !== "object") return old;
    return { ...old, data: JSON.stringify(nextData) };
  });
  enqueueFrameGeometryDataSave(dataOperations);
}
