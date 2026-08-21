import type { Dispatch, RefObject, SetStateAction } from "react";
import { flushSync } from "react-dom";

import type { ElementInfo } from "@/components/design/types";
import {
  isTextEditSessionOutcome,
  scheduleBeginTextEditForScreen,
} from "@/pages/design-editor/text-edit-utils";
import type { DesignTool, EditorMode } from "@/pages/design-editor/types";

export interface PrimitiveCreatedArgs {
  boardFileId: string | undefined;
  clearPendingOverviewLayerSelectionTimer: () => void;
  pendingEmptyTextEditRef: RefObject<{
    screenId: string | null;
    nodeId: string;
    cancel: () => void;
    settled: boolean;
  } | null>;
  pendingOverviewLayerSelectionRef: RefObject<string | null>;
  pendingOverviewScreenSelectionRef: RefObject<string | null>;
  pendingTextEditNodeIdRef: RefObject<string | null>;
  removeEmptyTextNodeWithRetry: (
    screenId: string | null,
    nodeId: string,
  ) => void;
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setActiveTool: Dispatch<SetStateAction<DesignTool>>;
  setCreatedOverviewLayerSelection: Dispatch<
    SetStateAction<{ screenId: string; layerId: string } | null>
  >;
  setHoveredElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setMode: Dispatch<SetStateAction<EditorMode>>;
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
}

export function runPrimitiveCreated(
  {
    boardFileId,
    clearPendingOverviewLayerSelectionTimer,
    pendingEmptyTextEditRef,
    pendingOverviewLayerSelectionRef,
    pendingOverviewScreenSelectionRef,
    pendingTextEditNodeIdRef,
    removeEmptyTextNodeWithRetry,
    setActiveFileId,
    setActiveTool,
    setCreatedOverviewLayerSelection,
    setHoveredElement,
    setMode,
    setOverviewSelectedScreenIds,
    setSelectedElement,
    setSelectedLayerIdsState,
  }: PrimitiveCreatedArgs,
  screenId: string,
  nodeId: string,
  options?: {
    nextTool?: "move" | "pen";
    preserveActiveTool?: boolean;
  },
) {
  // B2/B4 fix: stay in overview mode after drawing a primitive.  The user
  // drew a shape on the board — they should remain on the board with the
  // new primitive selected, matching Figma behaviour.  We activate the
  // target screen (so the layers panel shows its content) and select the
  // new node, but do NOT switch to single/full view.
  //
  // Board guard (overview-zoom corruption fix): the board file is NOT a
  // screen — it never appears in `overviewScreens` and has no
  // `canvasFrames` entry, so activating it flipped the overview zoom
  // basis onto double-fallback inputs (scale snapped to 0.25) while
  // `explicitOverviewCanvasZoom` stayed pinned to the previous screen's
  // scale — the displayed zoom showed garbage (observed: 10241.49%).
  // For a board-created primitive we still select the node and honor the
  // pending text-edit intent below (both are screen-id scoped and work
  // for the board), but keep the previous active FILE and never put the
  // board id into the overview screen-frame selection.
  const isBoardTarget = Boolean(boardFileId && screenId === boardFileId);
  pendingOverviewScreenSelectionRef.current = null;
  pendingOverviewLayerSelectionRef.current = nodeId;
  clearPendingOverviewLayerSelectionTimer();
  flushSync(() => {
    setCreatedOverviewLayerSelection({ screenId, layerId: nodeId });
    if (!isBoardTarget) {
      setActiveFileId(screenId);
    }
    setSelectedElement(null);
    setHoveredElement(null);
    setSelectedLayerIdsState([nodeId]);
    // The new node is the selection; leaving its parent frame selected too
    // hands Cmd+D and alt-drag to the screen-level duplicate instead.
    setOverviewSelectedScreenIds([]);
    if (!options?.preserveActiveTool) {
      setActiveTool(options?.nextTool ?? "move");
    }
    setMode("edit");
  });
  // viewMode stays at "overview" — no setViewMode("single") call here.

  // Immediately enter text-editing for newly created TEXT primitives. In
  // overview mode the target iframe may become active and receive the
  // inserted HTML over separate renders, so post directly to the target
  // iframe with a few short retries instead of relying on a single global
  // bridge callback.
  const textNodeId = pendingTextEditNodeIdRef.current;
  pendingTextEditNodeIdRef.current = null;
  if (textNodeId) {
    // Cancel any still-pending retry loop from a PREVIOUS text primitive
    // (e.g. the user drew a second text box before the first one settled)
    // before starting a new one, so stale timers can't fight over which
    // node to clean up.
    pendingEmptyTextEditRef.current?.cancel();
    // Creation-race fast path: the retry loop below fires its FIRST
    // begin-text-edit attempt at 180ms and its status-query round trips
    // can leave a multi-second window where keystrokes still hit HOST
    // shortcuts (Delete deleted the just-created text layer). The
    // DesignCanvas runtime bridge's beginTextEdit (registered as
    // window.__designCanvasBeginTextEdit by the active surface's canvas
    // — the flushSync above just pointed activeFileId at this screenId
    // for non-board targets) queues begin-text-edit through the
    // bridge-ready one-shot queue AND arms the host keystroke buffer
    // SYNCHRONOUSLY, so typing is captured from the very first keydown.
    // Activation itself waits until the pointer gesture's trailing click:
    // focusing during mouseup lets that click blur the empty editable one
    // frame later, producing the visible caret blink and losing typing.
    // Best-effort only: if the registered bridge still belongs to a
    // different surface, its iframe no-ops on the unknown nodeId while
    // the buffer still swallows destructive shortcuts, and the
    // screen-id-scoped scheduleBeginTextEditForScreen loop below remains
    // the authoritative per-iframe fallback (resolved through
    // findCanvasIframeForScreen, so board-space text works too).
    if (typeof window !== "undefined") {
      const beginTextEditNow = (window as any).__designCanvasBeginTextEdit;
      if (typeof beginTextEditNow === "function") {
        beginTextEditNow(textNodeId, { afterPointerGesture: true });
      }
    }
    const cancel = scheduleBeginTextEditForScreen(screenId, textNodeId, {
      boardFileId,
      onExhausted: (finalStatus) => {
        const pending = pendingEmptyTextEditRef.current;
        if (!pending || pending.nodeId !== textNodeId || pending.settled) {
          return;
        }
        pending.settled = true;
        if (isTextEditSessionOutcome(finalStatus)) return;
        if (finalStatus === "no-iframe" || finalStatus === "no-reply") {
          // Never reached an editing surface at all. That is a targeting
          // defect, not the user declining to type, so make it audible —
          // but the persisted document, not this outcome, still decides
          // whether the node is empty and should go.
          console.warn(
            `[design] text edit never reached a surface for ${screenId}/${textNodeId} (${finalStatus})`,
          );
        }
        removeEmptyTextNodeWithRetry(screenId, textNodeId);
      },
    });
    pendingEmptyTextEditRef.current = {
      screenId,
      nodeId: textNodeId,
      cancel,
      settled: false,
    };
  }
}
