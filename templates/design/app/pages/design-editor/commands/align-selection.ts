import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { getFrameGroupBounds } from "@shared/canvas-math";
import type { CodeLayerNode } from "@shared/code-layer";
import { buildCodeLayerProjection } from "@shared/code-layer";
import type { RefObject } from "react";

import { trace } from "@/components/design/design-trace";
import { getInitialFrameGeometry } from "@/components/design/multi-screen/frame-geometry";
import type { FrameGeometry } from "@/components/design/multi-screen/types";
import type { ElementInfo } from "@/components/design/types";
import type { DesignHotkeyAlignEdge } from "@/hooks/useDesignHotkeys";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  cloneCanvasFrameGeometry,
  getCanvasFrameGeometry,
} from "@/pages/design-editor/design-data-geometry-utils";
import type { AlignableRect } from "@/pages/design-editor/layout-operations";
import { computeAlignedPositions } from "@/pages/design-editor/layout-operations";
import { overviewSelectionTargetsElement } from "@/pages/design-editor/selection-state";
import type { DesignFile } from "@/pages/design-editor/types";

export interface AlignSelectionArgs {
  activeFile: DesignFile;
  boardFileId: string | undefined;
  boardFrameGeometry: FrameGeometry | undefined;
  canEditDesign: boolean;
  commitNodePositions: (
    baseContent: string,
    positions: ReadonlyMap<string, { x: number; y: number }>,
  ) => boolean;
  designDataJsonRef: RefObject<Record<string, unknown>>;
  files: DesignFile[];
  getActiveFileSelectedNodeIds: (content: string) => string[];
  getFreshActiveContent: () => string;
  handleGeometryCommit: (
    before: CanvasFrameGeometryById,
    after: CanvasFrameGeometryById,
    options?: { source?: "pointer" | "keyboard" },
  ) => void;
  overviewScreens: OverviewScreen[];
  overviewSelectedScreenIds: string[];
  rectFromCodeLayerNode: (node: CodeLayerNode) => AlignableRect;
  selectedElement: ElementInfo | null;
  selectedLayerIdsState: string[];
  viewModeRef: RefObject<"single" | "overview">;
}

export function runAlignSelection(
  {
    activeFile,
    boardFileId,
    boardFrameGeometry,
    canEditDesign,
    commitNodePositions,
    designDataJsonRef,
    files,
    getActiveFileSelectedNodeIds,
    getFreshActiveContent,
    handleGeometryCommit,
    overviewScreens,
    overviewSelectedScreenIds,
    rectFromCodeLayerNode,
    selectedElement,
    selectedLayerIdsState,
    viewModeRef,
  }: AlignSelectionArgs,
  edge: DesignHotkeyAlignEdge,
) {
  const abandon = (reason: string, data?: Record<string, unknown>) => {
    trace("structure", "align-abandoned", { reason, edge, ...data });
  };
  trace("structure", "align", { layers: selectedLayerIdsState.length });
  if (!canEditDesign) return abandon("read-only");

  // Overview, 2+ selected SCREENS: align each screen's frame geometry to
  // the selection's combined bounding box through the same
  // handleGeometryCommit path drags/nudges use — one undo step for the
  // whole align. A layer selection must fall through to the element path
  // below instead, as Figma aligns whatever is selected.
  if (
    viewModeRef.current === "overview" &&
    !overviewSelectionTargetsElement({
      selectedElement,
      selectedLayerIds: selectedLayerIdsState,
      fileIds: files.map((file) => file.id),
    })
  ) {
    if (overviewSelectedScreenIds.length < 2) {
      return abandon("overview: needs 2+ screens", {
        selected: overviewSelectedScreenIds.length,
      });
    }
    const before = getCanvasFrameGeometry(designDataJsonRef.current);
    const screenRects: AlignableRect[] = [];
    overviewSelectedScreenIds.forEach((screenId) => {
      const screenIndex = overviewScreens.findIndex(
        (screen) => screen.id === screenId,
      );
      const screen =
        screenIndex >= 0 ? overviewScreens[screenIndex] : undefined;
      const fallbackGeometry =
        screenIndex >= 0
          ? getInitialFrameGeometry(screenIndex, {
              width: screen?.width ?? 1280,
              height: screen?.height ?? 2560,
            })
          : boardFileId === screenId
            ? boardFrameGeometry
            : undefined;
      if (!fallbackGeometry) {
        abandon("overview: screen has no geometry", { screenId });
        return;
      }
      const geometry = { ...fallbackGeometry, ...before[screenId] };
      screenRects.push({
        id: screenId,
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
      });
    });
    if (screenRects.length < 2) {
      return abandon("overview: fewer than 2 measurable screens", {
        measured: screenRects.length,
      });
    }
    const bounds = getFrameGroupBounds(screenRects);
    if (!bounds) return abandon("no combined bounds for selection");
    const positions = computeAlignedPositions(
      screenRects,
      {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      edge,
    );
    if (positions.size === 0) {
      return abandon("already aligned; nothing to move", { edge });
    }
    const after = cloneCanvasFrameGeometry(before);
    positions.forEach((position, screenId) => {
      after[screenId] = { ...after[screenId]!, ...position };
    });
    handleGeometryCommit(before, after);
    return;
  }

  // Single-screen mode: in-screen DOM-node layers.
  if (!activeFile) return abandon("no active file");
  const baseContent = getFreshActiveContent();
  const nodeIds = getActiveFileSelectedNodeIds(baseContent);
  if (nodeIds.length === 0) {
    return abandon("selection has no nodes in the active file", {
      selectedLayerIds: selectedLayerIdsState.length,
    });
  }
  const projection = buildCodeLayerProjection(baseContent);
  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
  const selectedNodes = nodeIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is CodeLayerNode => Boolean(node));
  if (selectedNodes.length === 0) {
    return abandon("selected ids resolve to no projection nodes", { nodeIds });
  }
  const selectedRects = selectedNodes.map(rectFromCodeLayerNode);

  if (selectedRects.length >= 2) {
    // Multi-selection: align to the selection's own combined bbox.
    const bounds = getFrameGroupBounds(selectedRects);
    if (!bounds) return abandon("no combined bounds for selection");
    const positions = computeAlignedPositions(
      selectedRects,
      {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      edge,
    );
    if (positions.size === 0) {
      return abandon("already aligned; nothing to move", { edge });
    }
    commitNodePositions(baseContent, positions);
    return;
  }

  // Single selection: align relative to the parent's content box. A
  // single top-level screen (no code-layer parent) is a no-op, matching
  // Figma (there's nothing to align a lone top-level frame against).
  const soleNode = selectedNodes[0]!;
  const parentId = soleNode.parentId;
  if (!parentId) {
    return abandon("single selection has no parent to align against", {
      nodeId: soleNode.id,
    });
  }
  const parentNode = nodesById.get(parentId);
  if (!parentNode) return abandon("parent id not in projection", { parentId });
  const parentRect = rectFromCodeLayerNode(parentNode);
  const positions = computeAlignedPositions(
    [selectedRects[0]!],
    { x: 0, y: 0, width: parentRect.width, height: parentRect.height },
    edge,
  );
  if (positions.size === 0) {
    return abandon("already aligned; nothing to move", { edge });
  }
  commitNodePositions(baseContent, positions);
}
