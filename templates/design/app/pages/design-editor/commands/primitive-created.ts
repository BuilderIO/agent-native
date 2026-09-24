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
    // The new node is the selection; leaving its parent frame selected too
    // hands Cmd+D and alt-drag to the screen-level duplicate instead.
    setOverviewSelectedScreenIds([]);
    if (revealLayers) {
      setActiveLeftPanel("file");
    }
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
    // Creation-race capture. This runs inside the creating pointer gesture,
    // so arm the HOST-level buffer here — before anything asks a canvas to
    // open the session. The canvas that owns the node may not exist yet: the
    // board surface only renders once its file has content, and this very
    // insert is what gives it content. Arming inside a canvas therefore armed
    // whichever OTHER screen happened to be mounted, and that canvas then
    // swallowed the whole gesture's typing.
    const capture = armPendingTextCapture({ owner: screenId });
    capture.bind(textNodeId);
    // Mounted owner (the ordinary single-screen case) begins synchronously and
    // drains the buffer immediately; an unmounted one (board) leaves the
    // request on the capture, which replays it the moment that canvas
    // registers. Activation itself still waits until the pointer gesture's
    // trailing click: focusing during mouseup lets that click blur the empty
    // editable one frame later, producing the visible caret blink and losing
    // typing.
    beginTextEditForOwner(screenId, textNodeId, { afterPointerGesture: true });
    let abandoned = false;
    let cleanedUp = false;
    const cleanUpIfUntouched = () => {
      if (cleanedUp) return;
      // A DETACHED host write can still owe this node its text: a rolled-back
      // save queues the payload and clears `active`, so judging the node from
      // the live capture alone deleted it mid-write. Ask the queue. This
      // deliberately does not mark the creation cleaned up — once that write
      // settles without landing, a later terminal pass can still remove an
      // untouched node.
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
      // A request that COMPLETED stops asking too. The frame's commit releases
      // the capture without the stand-down above, and a retry still inside the
      // ladder window force-opens the node it just committed.
      isAbandoned: () =>
        abandoned || !isPendingTextRequestLive(screenId, textNodeId),
      onExhausted: (finalStatus) => {
        const pending = pendingEmptyTextEditRef.current;
        if (!pending || pending.nodeId !== textNodeId || pending.settled) {
          return;
        }
        pending.settled = true;
        if (!abandoned && isTextEditSessionOutcome(finalStatus)) return;
        // A READY owner answering without the node is a failure, not a slow
        // mount: end interception and put what was typed into the source.
        if (finalStatus === "node-missing") {
          // A queued host write owes this node its text and is still inside
          // its backoff. Deleting the node now lands that write in something
          // that no longer exists — or deletes it right after it landed — so
          // the node outlives the writer, which preserves it either way.
          if (failPendingTextCapture(screenId, textNodeId) === "write-queued") {
            return;
          }
        }
        // While the creation's request is open, the capture decides the node's
        // fate: it delivers the typed text, commits it host-side, or stands
        // down — and a stand-down runs the cleanup registered above. Judging
        // from the host buffer alone deleted nodes whose keystrokes a canvas
        // was still holding for a slow frame.
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
      // Once a session opened, the ladder settled on that first active result
      // and stopped judging this node — so the session ENDING (Escape, blur,
      // commit) is the only thing left that can, and an empty node otherwise
      // stayed on the canvas forever. A request still delivering owes this node
      // text, so it decides instead; the source content decides the rest.
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
