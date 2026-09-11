import { tryCallActionKeepalive } from "@agent-native/core/client/hooks";
import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { QueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";

import type { DesignSaveOutboxEntry } from "@/lib/design-save-outbox";
import type {
  DesignDataOperation,
  PendingDesignDataOperations,
} from "@/pages/design-editor/data-operations";
import {
  applyDesignDataOperations,
  buildFrameGeometryDataOperations,
  compactDesignDataOperations,
  pendingDesignDataOperations,
} from "@/pages/design-editor/data-operations";
import { sanitizeCanvasFrameGeometryForPersist } from "@/pages/design-editor/geometry-persistence";

export interface PersistFrameGeometrySaveArgs {
  acknowledgeOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<void>;
  boardFileId: string | undefined;
  canEditDesignRef: RefObject<boolean>;
  createFrameGeometryOutboxEntry: (
    dataOperations: readonly DesignDataOperation[],
    revision: number,
  ) => DesignSaveOutboxEntry | null;
  designDataJsonRef: RefObject<Record<string, unknown>>;
  enqueueFrameGeometryDataSave: (
    dataOperations: DesignDataOperation[],
  ) => boolean;
  frameGeometryOperationRevisionRef: RefObject<number>;
  id: string | undefined;
  journalOutboxEntry: (entry: DesignSaveOutboxEntry) => Promise<boolean>;
  pendingFrameGeometryOperationsForUnloadRef: RefObject<PendingDesignDataOperations>;
  queryClient: QueryClient;
  warnChangesWillRetry: () => void;
}

export function runPersistFrameGeometrySave(
  {
    acknowledgeOutboxEntry,
    boardFileId,
    canEditDesignRef,
    createFrameGeometryOutboxEntry,
    designDataJsonRef,
    enqueueFrameGeometryDataSave,
    frameGeometryOperationRevisionRef,
    id,
    journalOutboxEntry,
    pendingFrameGeometryOperationsForUnloadRef,
    queryClient,
    warnChangesWillRetry,
  }: PersistFrameGeometrySaveArgs,
  pending: {
    geometryById: CanvasFrameGeometryById;
    previousGeometry: CanvasFrameGeometryById;
  },
  keepalive = false,
): boolean {
  if (!id || !canEditDesignRef.current) return false;
  // Geometry-persist guard: refuse absurd per-frame geometry (see
  // sanitizeCanvasFrameGeometryForPersist) so a corrupted transient
  // zoom basis can never shred the persisted layout. The board frame
  // is exempt — its surface is a legitimate 131k square.
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
  if (keepalive) {
    const combinedOperations = compactDesignDataOperations([
      ...pendingDesignDataOperations(
        pendingFrameGeometryOperationsForUnloadRef.current,
      ),
      ...dataOperations,
    ]);
    if (combinedOperations.length === 0) return true;
    const operationRevision = frameGeometryOperationRevisionRef.current + 1;
    frameGeometryOperationRevisionRef.current = operationRevision;
    const entry = createFrameGeometryOutboxEntry(
      combinedOperations,
      operationRevision,
    );
    if (!entry) return false;
    void journalOutboxEntry(entry);
    const attempt = tryCallActionKeepalive(
      "update-design",
      entry.payload as any,
    );
    if (!attempt.accepted) return false;
    void attempt.completion
      .then(() => acknowledgeOutboxEntry(entry))
      .catch(warnChangesWillRetry);
    return true;
  }
  if (dataOperations.length === 0) return true;
  const nextData = applyDesignDataOperations(
    designDataJsonRef.current,
    dataOperations,
  );
  designDataJsonRef.current = nextData;
  queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
    if (!old || typeof old !== "object") return old;
    return { ...old, data: JSON.stringify(nextData) };
  });
  return enqueueFrameGeometryDataSave(dataOperations);
}
