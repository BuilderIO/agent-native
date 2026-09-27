import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { QueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";

import type { KScaleStyleChangesByFrameId } from "@/components/design/multi-screen/types";
import {
  cloneCanvasFrameGeometry,
  frameHeightChangedIds,
  viewportChangedFrameIds,
} from "@/pages/design-editor/design-data-geometry-utils";
import type { UndoRedoOrderKind } from "@/pages/design-editor/editor-state";
import {
  geometrySnapshotsEqual,
  quantizeCanvasFrameGeometryForPersist,
  sanitizeCanvasFrameGeometryForPersist,
} from "@/pages/design-editor/geometry-persistence";
import type {
  ContentHistoryChange,
  GeometryHistoryEntry,
  GeometryHistorySelection,
} from "@/pages/design-editor/history";
import { MAX_DESIGN_UNDO_STACK } from "@/pages/design-editor/history";
import { selectionHistorySnapshotsEqual } from "@/pages/design-editor/selection-state";

export interface GeometryCommitArgs {
  boardFileId: string | undefined;
  captureLinkedContentChanges?: (
    linkedFrameIds: readonly string[],
    kScaleStyleChangesByFrameId?: KScaleStyleChangesByFrameId,
  ) => ContentHistoryChange[] | null;
  captureCurrentSelection: () => GeometryHistorySelection;
  clearRedoStacks: () => void;
  designDataJsonRef: RefObject<Record<string, unknown>>;
  geometryUndoStackRef: RefObject<GeometryHistoryEntry[]>;
  historyOrderRef: RefObject<UndoRedoOrderKind[]>;
  id: string | undefined;
  applyLinkedContentChanges?: (
    changes: readonly ContentHistoryChange[],
    direction: "commit" | "undo" | "redo",
  ) => void;
  lastGeometryCommitAtRef: RefObject<number>;
  lastGeometryCommitSourceRef: RefObject<"pointer" | "keyboard" | null>;
  liveFrameGeometryRef: RefObject<CanvasFrameGeometryById>;
  locallyPinnedHeightIdsRef: RefObject<Set<string>>;
  queryClient: QueryClient;
  queueFrameGeometrySave: (geometryById: CanvasFrameGeometryById) => void;
  syncUndoRedoState: () => void;
  writeFrameGeometrySnapshot: (
    geometryById: CanvasFrameGeometryById,
    options?: { syncViewportFrameIds?: string[]; pinHeightFrameIds?: string[] },
  ) => void;
}

export function runGeometryCommit(
  {
    boardFileId,
    captureLinkedContentChanges,
    captureCurrentSelection,
    clearRedoStacks,
    designDataJsonRef,
    geometryUndoStackRef,
    historyOrderRef,
    id,
    applyLinkedContentChanges,
    lastGeometryCommitAtRef,
    lastGeometryCommitSourceRef,
    liveFrameGeometryRef,
    locallyPinnedHeightIdsRef,
    queryClient,
    queueFrameGeometrySave,
    syncUndoRedoState,
    writeFrameGeometrySnapshot,
  }: GeometryCommitArgs,
  before: CanvasFrameGeometryById,
  after: CanvasFrameGeometryById,
  options?: {
    source?: "pointer" | "keyboard";
    kScaleStyleChangesByFrameId?: KScaleStyleChangesByFrameId;
  },
) {
  const beforeSnapshot = cloneCanvasFrameGeometry(before);
  const hasKScaleGeometry =
    Object.keys(options?.kScaleStyleChangesByFrameId ?? {}).length > 0;
  const { geometryById: afterSnapshot } = sanitizeCanvasFrameGeometryForPersist(
    hasKScaleGeometry
      ? cloneCanvasFrameGeometry(after)
      : quantizeCanvasFrameGeometryForPersist(
          cloneCanvasFrameGeometry(after),
          beforeSnapshot,
        ),
    beforeSnapshot,
    boardFileId ? [boardFileId] : [],
  );
  if (geometrySnapshotsEqual(beforeSnapshot, afterSnapshot)) {
    return true;
  }
  const heightChangedFrameIds = frameHeightChangedIds(
    beforeSnapshot,
    afterSnapshot,
  );
  const kScaleStyleChangesByFrameId = options?.kScaleStyleChangesByFrameId;
  const linkedFrameIds = Array.from(
    new Set([
      ...heightChangedFrameIds,
      ...Object.keys(kScaleStyleChangesByFrameId ?? {}),
    ]),
  );
  const linkedContentChangesResult =
    linkedFrameIds.length > 0
      ? captureLinkedContentChanges?.(
          linkedFrameIds,
          kScaleStyleChangesByFrameId,
        )
      : [];
  if (
    linkedContentChangesResult === null ||
    (Object.keys(kScaleStyleChangesByFrameId ?? {}).length > 0 &&
      !captureLinkedContentChanges)
  ) {
    return false;
  }
  const linkedContentChanges = linkedContentChangesResult ?? [];
  liveFrameGeometryRef.current = afterSnapshot;
  const source = options?.source ?? "pointer";
  const now = Date.now();
  const selectionAfter = captureCurrentSelection();
  const lastEntry =
    geometryUndoStackRef.current[geometryUndoStackRef.current.length - 1];
  const continuesLastGesture =
    source === "keyboard" &&
    lastGeometryCommitSourceRef.current === "keyboard" &&
    historyOrderRef.current[historyOrderRef.current.length - 1] ===
      "geometry" &&
    lastEntry &&
    now - lastGeometryCommitAtRef.current < 800 &&
    lastEntry.selectionAfter !== undefined &&
    selectionHistorySnapshotsEqual(lastEntry.selectionAfter, selectionAfter) &&
    geometrySnapshotsEqual(lastEntry.after, beforeSnapshot);
  lastGeometryCommitAtRef.current = now;
  lastGeometryCommitSourceRef.current = source;
  if (continuesLastGesture) {
    geometryUndoStackRef.current = [
      ...geometryUndoStackRef.current.slice(0, -1),
      {
        before: lastEntry.before,
        after: afterSnapshot,
        selectionBefore: lastEntry.selectionBefore,
        selectionAfter,
        ...((lastEntry.linkedContentChanges?.length ?? 0) > 0 ||
        linkedContentChanges.length > 0
          ? {
              linkedContentChanges: [
                ...(lastEntry.linkedContentChanges ?? []),
                ...linkedContentChanges,
              ],
            }
          : {}),
      },
    ];
  } else {
    geometryUndoStackRef.current = [
      ...geometryUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      {
        before: beforeSnapshot,
        after: afterSnapshot,
        selectionBefore: selectionAfter,
        selectionAfter,
        ...(linkedContentChanges.length > 0 ? { linkedContentChanges } : {}),
      },
    ];
  }
  clearRedoStacks();
  historyOrderRef.current = continuesLastGesture
    ? historyOrderRef.current
    : [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "geometry",
      ];
  const resizedFrameIds = viewportChangedFrameIds(
    beforeSnapshot,
    afterSnapshot,
  );
  if (continuesLastGesture) {
    queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
      if (!old || typeof old !== "object") return old;
      const nextData = {
        ...designDataJsonRef.current,
        canvasFrames: afterSnapshot,
      };
      return { ...old, data: JSON.stringify(nextData) };
    });
    queueFrameGeometrySave(afterSnapshot);
    liveFrameGeometryRef.current = cloneCanvasFrameGeometry(afterSnapshot);
  } else {
    writeFrameGeometrySnapshot(
      afterSnapshot,
      resizedFrameIds.length > 0
        ? (heightChangedFrameIds.forEach((frameId) =>
            locallyPinnedHeightIdsRef.current.add(frameId),
          ),
          {
            syncViewportFrameIds: resizedFrameIds,
            pinHeightFrameIds: heightChangedFrameIds,
          })
        : undefined,
    );
  }
  if (linkedContentChanges.length > 0) {
    applyLinkedContentChanges?.(linkedContentChanges, "commit");
  }
  syncUndoRedoState();
  return true;
}
