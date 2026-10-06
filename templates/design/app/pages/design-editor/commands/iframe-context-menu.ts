import {
  buildCodeLayerTree,
  type CodeLayerProjection,
} from "@shared/code-layer";
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
  resolveCodeLayerNodeFromElementInfo,
  resolvedLayerName,
} from "@/pages/design-editor/code-layer-state";
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
  getCodeLayerProjectionForScreen: (
    screenId: string,
  ) => CodeLayerProjection | null;
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
    getCodeLayerProjectionForScreen,
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
  const projection =
    contextScreenId && payload.layerCandidates?.length
      ? getCodeLayerProjectionForScreen(contextScreenId)
      : null;
  const layerNamesByNodeId = new Map<string, string>();
  if (projection) {
    const collectLayerNames = (
      nodes: ReturnType<typeof buildCodeLayerTree>,
    ) => {
      for (const node of nodes) {
        layerNamesByNodeId.set(node.id, resolvedLayerName(node));
        collectLayerNames(node.children);
      }
    };
    collectLayerNames(buildCodeLayerTree(projection));
  }
  const layerCandidates = (payload.layerCandidates ?? []).map((candidate) => {
    const node = projection
      ? resolveCodeLayerNodeFromElementInfo(projection, candidate.info)
      : null;
    return {
      ...candidate,
      label: node
        ? (layerNamesByNodeId.get(node.id) ?? candidate.label)
        : candidate.label,
      breakpointWidthPx: payload.breakpointWidthPx,
    };
  });
  flushSync(() => {
    setCanvasLayerHitCandidates(layerCandidates);
  });
  if (payload.info && contextScreenId) {
    flushSync(() => {
      handleScreenElementSelect(contextScreenId, payload.info!, undefined, {
        persistPendingNodeId: false,
        breakpointWidthPx: payload.breakpointWidthPx,
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
  const scroll = (iframeForPoint as HTMLIFrameElement | null)?.contentWindow;
  menu.openAt({
    clientX,
    clientY,
    ...(canvasPoint
      ? {
          canvasX: canvasPoint.x + (scroll?.scrollX ?? 0),
          canvasY: canvasPoint.y + (scroll?.scrollY ?? 0),
          ...(contextScreenId ? { screenId: contextScreenId } : {}),
        }
      : {}),
  });
}
