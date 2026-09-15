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
  // K-scale commits preserve the fractional geometry that produced their
  // linked style snapshot; ordinary frame gestures retain pixel quantization.
  const hasKScaleGeometry =
    Object.keys(options?.kScaleStyleChangesByFrameId ?? {}).length > 0;
  // Geometry-persist guard: refuse absurd committed geometry HERE (not
  // only inside the save functions) so the undo stack and the mid-gesture
  // query-cache write below stay consistent with what actually persists —
  // an insane frame falls back to its own pre-gesture geometry, and a
  // commit whose every change was refused becomes a no-op.
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
  // U9: keyboard nudge (arrow-key auto-repeat) fires one onGeometryCommit
  // per tick, each previously pushing its own undo entry AND its own
  // immediate (non-debounced) server write — a held arrow key could evict
  // the 50-entry undo cap in well under a second and hammer the server.
  // Coalesce consecutive commits into one undo entry (mirroring Yjs's own
  // captureTimeout) when the new commit continues straight from the last
  // one (same "before" as the prior "after") within a ~800ms window, and
  // route the write through the same debounced save queue used for drags
  // instead of firing an immediate mutation per tick.
  //
  // This coalescing must only apply to KEYBOARD nudge auto-repeat, not to
  // two independent pointer gestures (e.g. two separate drags) that
  // happen to land within the same 800ms window — those are discrete
  // user actions and each must be its own undo step, matching Figma.
  // MultiScreenCanvas's onGeometryCommit callback (a real pointer drag)
  // omits `options`, so it defaults to "pointer" and never coalesces;
  // only handleNudgeSelection's overview branch passes "keyboard".
  const source = options?.source ?? "pointer";
  const now = Date.now();
  const lastEntry =
    geometryUndoStackRef.current[geometryUndoStackRef.current.length - 1];
  const continuesLastGesture =
    source === "keyboard" &&
    lastEntry &&
    now - lastGeometryCommitAtRef.current < 800 &&
    geometrySnapshotsEqual(lastEntry.after, beforeSnapshot);
  lastGeometryCommitAtRef.current = now;
  // Figma-parity undo/redo selection restore: selectionAfter always
  // reflects the CURRENT selection at this commit tick (so redo restores
  // whatever was selected when the gesture finished), while
  // selectionBefore is only captured on the FIRST tick of a gesture and
  // then carried forward unchanged through every coalesced continuation —
  // otherwise a held arrow key would keep overwriting selectionBefore
  // with the selection at the START of each individual tick instead of
  // the whole gesture's actual starting selection.
  const selectionAfter = captureCurrentSelection();
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
    // Mid-gesture tick: keep the query cache current for a responsive
    // canvas, but debounce the actual network write so a held key
    // doesn't send one mutation per tick.
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
