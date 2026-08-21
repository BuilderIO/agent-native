import type { Dispatch, RefObject, SetStateAction } from "react";
import { flushSync } from "react-dom";

import type { CanvasContextMenuHandle } from "@/components/design/CanvasContextMenu";
import type { IframeContextMenuPayload } from "@/components/design/design-canvas/iframe-events";
import { findCanvasIframeForScreen } from "@/components/design/multi-screen/iframe-targeting";
import type {
  CanvasLayerHitCandidate,
  ElementInfo,
  ElementSelectionIntent,
} from "@/components/design/types";
import {
  computeIframeLocalCanvasPoint,
  readOverviewZoomPercentFromTransform,
} from "@/pages/design-editor/overview-camera";
import type { DesignFile } from "@/pages/design-editor/types";

export interface IframeContextMenuArgs {
  activeFile: DesignFile;
  activeFileId: string | null;
  boardFileId: string | undefined;
  canvasContainerRef: RefObject<HTMLDivElement | null>;
  canvasContextMenuRef: RefObject<CanvasContextMenuHandle | null>;
  focusDesignInspectorForSelection: () => void;
  handleScreenElementSelect: (
    screenId: string,
    info: ElementInfo,
    intent?: ElementSelectionIntent,
    options?: { persistPendingNodeId?: boolean; breakpointWidthPx?: number },
  ) => void;
  overviewCanvasZoom: number;
  setCanvasLayerHitCandidates: Dispatch<
    SetStateAction<CanvasLayerHitCandidate[]>
  >;
  viewMode: "single" | "overview";
  zoom: number;
}

export function runIframeContextMenu(
  {
    activeFile,
    activeFileId,
    boardFileId,
    canvasContainerRef,
    canvasContextMenuRef,
    focusDesignInspectorForSelection,
    handleScreenElementSelect,
    overviewCanvasZoom,
    setCanvasLayerHitCandidates,
    viewMode,
    zoom,
  }: IframeContextMenuArgs,
  payload: IframeContextMenuPayload,
) {
  const container = canvasContainerRef.current;
  const menu = canvasContextMenuRef.current;
  if (!container || !menu) return;
  const contextScreenId =
    payload.screenId ?? activeFile?.id ?? activeFileId ?? null;
  flushSync(() => {
    setCanvasLayerHitCandidates(payload.layerCandidates ?? []);
  });
  if (payload.info && contextScreenId) {
    flushSync(() => {
      handleScreenElementSelect(contextScreenId, payload.info!, undefined, {
        persistPendingNodeId: false,
      });
    });
    focusDesignInspectorForSelection();
  }
  const clientX =
    typeof payload.viewportClientX === "number"
      ? payload.viewportClientX
      : payload.clientX;
  const clientY =
    typeof payload.viewportClientY === "number"
      ? payload.viewportClientY
      : payload.clientY;
  // PASTE-HERE-IN-CONTENT: this imperative openAt() call bypasses
  // CanvasContextMenu's own onContextMenuCapture handler entirely — the
  // ONLY place that normally calls getCanvasPoint to attach canvasX/
  // canvasY to the menu's point. Without computing it here too, a
  // right-click that lands ON rendered screen content (an element, or
  // empty in-screen space — as opposed to the shared canvas background,
  // which still goes through onContextMenuCapture) never got a
  // canvasX/canvasY at all, so "Paste here" from it silently degraded to
  // the position-less cascade/offset paste instead of landing under the
  // cursor. Overview screens each carry their own screenId through the
  // context-menu bridge, including non-active screens, so target that
  // exact iframe rather than the currently-active screen. Otherwise
  // Paste here would translate the pointer through the wrong frame just
  // before Select layer activates the right-clicked screen.
  const iframeForPoint =
    viewMode === "single"
      ? container.querySelector<HTMLElement>("[data-design-preview-iframe]")
      : findCanvasIframeForScreen(
          container,
          contextScreenId ?? "",
          boardFileId ?? undefined,
        );
  const liveOverviewZoom =
    viewMode === "overview"
      ? readOverviewZoomPercentFromTransform(
          container.querySelector<HTMLElement>(
            "[data-multi-screen-canvas-world]",
          )?.style.transform,
          overviewCanvasZoom,
        )
      : overviewCanvasZoom;
  const canvasPoint = computeIframeLocalCanvasPoint({
    clientX,
    clientY,
    iframeRect: iframeForPoint?.getBoundingClientRect() ?? null,
    zoomPercent: viewMode === "single" ? zoom : liveOverviewZoom,
  });
  menu.openAt({
    clientX,
    clientY,
    ...(canvasPoint ? { canvasX: canvasPoint.x, canvasY: canvasPoint.y } : {}),
  });
}
