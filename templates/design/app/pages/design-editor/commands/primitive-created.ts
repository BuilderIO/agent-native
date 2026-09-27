import type { Dispatch, RefObject, SetStateAction } from "react";
import { flushSync } from "react-dom";

import {
  armPendingTextCapture,
  beginTextEditForOwner,
  failPendingTextCapture,
  isPendingTextRequestLive,
  isPendingTextWriteInFlight,
  onPendingTextCaptureCancel,
} from "@/components/design/design-canvas/pending-text-capture";
import { PENDING_TEXT_EDIT_TIMEOUT_MS } from "@/components/design/design-canvas/pending-text-edit";
import type { ElementInfo } from "@/components/design/types";
import {
  isTextEditSessionOutcome,
  scheduleBeginTextEditForScreen,
} from "@/pages/design-editor/text-edit-utils";
import { shouldRevealLayersOnFirstCreate } from "@/pages/design-editor/tool-state";
import type {
  DesignLeftPanel,
  DesignTool,
  EditorMode,
} from "@/pages/design-editor/types";

export interface PrimitiveCreatedArgs {
  activeLeftPanel: DesignLeftPanel | null;
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
  layersRevealedForFirstCreateRef: RefObject<boolean>;
  removeEmptyTextNodeWithRetry: (
    screenId: string | null,
    nodeId: string,
  ) => void;
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setActiveLeftPanel: Dispatch<SetStateAction<DesignLeftPanel | null>>;
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
    activeLeftPanel,
    boardFileId,
    clearPendingOverviewLayerSelectionTimer,
    pendingEmptyTextEditRef,
    pendingOverviewLayerSelectionRef,
    pendingOverviewScreenSelectionRef,
    pendingTextEditNodeIdRef,
    layersRevealedForFirstCreateRef,
    removeEmptyTextNodeWithRetry,
    setActiveFileId,
    setActiveLeftPanel,
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
  const isBoardTarget = Boolean(boardFileId && screenId === boardFileId);
  const revealLayers = shouldRevealLayersOnFirstCreate({
    activeLeftPanel,
    alreadyRevealed: layersRevealedForFirstCreateRef.current,
  });
  layersRevealedForFirstCreateRef.current = true;
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
    setOverviewSelectedScreenIds([]);
    if (revealLayers) {
      setActiveLeftPanel("file");
    }
    if (!options?.preserveActiveTool) {
      setActiveTool(options?.nextTool ?? "move");
    }
    setMode("edit");
  });

  const textNodeId = pendingTextEditNodeIdRef.current;
  pendingTextEditNodeIdRef.current = null;
  if (textNodeId) {
    pendingEmptyTextEditRef.current?.cancel();
    const capture = armPendingTextCapture({ owner: screenId });
    capture.bind(textNodeId);
    beginTextEditForOwner(screenId, textNodeId, { afterPointerGesture: true });
    let abandoned = false;
    let cleanedUp = false;
    const cleanUpIfUntouched = () => {
      if (cleanedUp) return;
      if (isPendingTextWriteInFlight(screenId, textNodeId)) return;
      cleanedUp = true;
      capture.cancel();
      removeEmptyTextNodeWithRetry(screenId, textNodeId);
    };
    // Pointer-away (and Escape/undo/supersede) stands this creation's request
    // down. Stop asking for activation, but leave the ladder probing: its
    // exhaustion is what judges the node, and settling it here would race the
    // commit the same click just started. The ladder may also have settled
    // already — it stops at the first live session — so an abandoned session
    // that was never typed into needs its own pass, or the empty node stays on
    // the canvas with nothing left to remove it.
    // Registered as CLEANUP, not revoke: this deletes the node. A host-side
    // commit still owes that node its text, so the fallback must never run
    // this — deleting the only target before the write lands loses the text
    // exactly where the capture exists to save it.
    onPendingTextCaptureCancel(
      screenId,
      textNodeId,
      () => {
        abandoned = true;
        window.setTimeout(cleanUpIfUntouched, PENDING_TEXT_EDIT_TIMEOUT_MS);
      },
      { kind: "cleanup" },
    );
    const cancel = scheduleBeginTextEditForScreen(screenId, textNodeId, {
      boardFileId,
      isAbandoned: () =>
        abandoned || !isPendingTextRequestLive(screenId, textNodeId),
      onExhausted: (finalStatus) => {
        const pending = pendingEmptyTextEditRef.current;
        if (!pending || pending.nodeId !== textNodeId || pending.settled) {
          return;
        }
        pending.settled = true;
        if (!abandoned && isTextEditSessionOutcome(finalStatus)) return;
        if (finalStatus === "node-missing") {
          if (failPendingTextCapture(screenId, textNodeId) === "write-queued") {
            return;
          }
        }
        if (isPendingTextRequestLive(screenId, textNodeId)) return;
        if (finalStatus === "no-iframe" || finalStatus === "no-reply") {
          console.warn(
            `[design] text edit never reached a surface for ${screenId}/${textNodeId} (${finalStatus})`,
          );
        }
        cleanUpIfUntouched();
      },
    });
    pendingEmptyTextEditRef.current = {
      screenId,
      nodeId: textNodeId,
      cancel: () => {
        cancel();
        window.setTimeout(() => {
          if (isPendingTextRequestLive(screenId, textNodeId)) return;
          cleanUpIfUntouched();
        }, PENDING_TEXT_EDIT_TIMEOUT_MS);
      },
      settled: false,
    };
  }
}
