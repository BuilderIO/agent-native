import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { RefObject } from "react";

import type { DesignSaveOutboxEntry } from "@/lib/design-save-outbox";
import {
  buildFrameGeometryDataOperations,
  compactDesignDataOperations,
  pendingDesignDataOperations,
  type DesignDataOperation,
  type PendingDesignDataOperations,
  stagePendingDesignDataOperations,
} from "@/pages/design-editor/data-operations";
import {
  cloneCanvasFrameGeometry,
  getCanvasFrameGeometry,
} from "@/pages/design-editor/design-data-geometry-utils";
import {
  quantizeCanvasFrameGeometryForPersist,
  sanitizeCanvasFrameGeometryForPersist,
} from "@/pages/design-editor/geometry-persistence";

export interface QueueFrameGeometrySaveArgs {
  boardFileId: string | undefined;
  canEditDesignRef: RefObject<boolean>;
  createFrameGeometryOutboxEntry: (
    dataOperations: readonly DesignDataOperation[],
    revision: number,
  ) => DesignSaveOutboxEntry | null;
  designDataJsonRef: RefObject<Record<string, unknown>>;
  flushPendingFrameGeometrySave: () => void;
  frameGeometryOperationRevisionRef: RefObject<number>;
  frameGeometryOperationsInFlightRef: RefObject<PendingDesignDataOperations>;
  frameGeometrySaveTimerRef: RefObject<number | null>;
  id: string | undefined;
  journalOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<boolean>;
  pendingFrameGeometryOperationsForUnloadRef: RefObject<PendingDesignDataOperations>;
  pendingFrameGeometrySaveRef: RefObject<{
    geometryById: CanvasFrameGeometryById;
    previousGeometry: CanvasFrameGeometryById;
  } | null>;
}

export function runQueueFrameGeometrySave(
  {
    boardFileId,
    canEditDesignRef,
    createFrameGeometryOutboxEntry,
    designDataJsonRef,
    flushPendingFrameGeometrySave,
    frameGeometryOperationRevisionRef,
    frameGeometryOperationsInFlightRef,
    frameGeometrySaveTimerRef,
    id,
    journalOutboxEntry,
    pendingFrameGeometryOperationsForUnloadRef,
    pendingFrameGeometrySaveRef,
  }: QueueFrameGeometrySaveArgs,
  geometryById: CanvasFrameGeometryById,
) {
  if (!id || !canEditDesignRef.current) return;
  const previousGeometry = cloneCanvasFrameGeometry(
    getCanvasFrameGeometry(designDataJsonRef.current),
  );
  pendingFrameGeometrySaveRef.current = {
    geometryById: quantizeCanvasFrameGeometryForPersist(
      cloneCanvasFrameGeometry(geometryById),
      previousGeometry,
    ),
    previousGeometry,
  };
  const pending = pendingFrameGeometrySaveRef.current;
  const { geometryById: safeGeometryById } =
    sanitizeCanvasFrameGeometryForPersist(
      pending.geometryById,
      pending.previousGeometry,
      boardFileId ? [boardFileId] : [],
    );
  const dataOperations = buildFrameGeometryDataOperations({
    previousGeometry: pending.previousGeometry,
    nextGeometry: safeGeometryById,
    designData: designDataJsonRef.current,
  });
  const combinedOperations = compactDesignDataOperations([
    ...pendingDesignDataOperations(
      pendingFrameGeometryOperationsForUnloadRef.current,
    ),
    ...dataOperations,
  ]);
  if (combinedOperations.length > 0) {
    const revision = frameGeometryOperationRevisionRef.current + 1;
    frameGeometryOperationRevisionRef.current = revision;
    pendingFrameGeometryOperationsForUnloadRef.current =
      stagePendingDesignDataOperations(
        pendingFrameGeometryOperationsForUnloadRef.current,
        dataOperations,
        revision,
      );
    frameGeometryOperationsInFlightRef.current =
      stagePendingDesignDataOperations(
        frameGeometryOperationsInFlightRef.current,
        dataOperations,
        revision,
      );
    const entry = createFrameGeometryOutboxEntry(combinedOperations, revision);
    if (entry) void journalOutboxEntry(entry);
  }
  if (frameGeometrySaveTimerRef.current !== null) {
    window.clearTimeout(frameGeometrySaveTimerRef.current);
  }
  frameGeometrySaveTimerRef.current = window.setTimeout(
    flushPendingFrameGeometrySave,
    500,
  );
}
