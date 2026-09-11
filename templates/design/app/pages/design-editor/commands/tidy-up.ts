import type {
  CanvasFrameGeometry,
  CanvasFrameGeometryById,
} from "@shared/canvas-frames";
import type { CodeLayerNode } from "@shared/code-layer";
import { buildCodeLayerProjection } from "@shared/code-layer";
import type { RefObject } from "react";

import { getInitialFrameGeometry } from "@/components/design/multi-screen/frame-geometry";
import type { FrameGeometry } from "@/components/design/multi-screen/types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  cloneCanvasFrameGeometry,
  getCanvasFrameGeometry,
} from "@/pages/design-editor/design-data-geometry-utils";
import type { AlignableRect } from "@/pages/design-editor/layout-operations";
import { computeTidyPositions } from "@/pages/design-editor/layout-operations";
import type { DesignFile } from "@/pages/design-editor/types";

export interface TidyUpArgs {
  activeFile: DesignFile;
  boardFileId: string | undefined;
  boardFrameGeometry: FrameGeometry | undefined;
  canEditDesign: boolean;
  commitNodePositions: (
    baseContent: string,
    positions: ReadonlyMap<string, { x: number; y: number }>,
  ) => boolean;
  designDataJsonRef: RefObject<Record<string, unknown>>;
  getActiveFileSelectedNodeIds: (content: string) => string[];
  getFreshActiveContent: () => string;
  getScreenGroupFootprint: (
    screenId: string,
    geometry: CanvasFrameGeometry,
    breakpointWidthsOverride?: readonly number[],
  ) => { x: number; y: number; width: number; height: number };
  handleGeometryCommit: (
    before: CanvasFrameGeometryById,
    after: CanvasFrameGeometryById,
    options?: { source?: "pointer" | "keyboard" },
  ) => void;
  overviewScreens: OverviewScreen[];
  overviewSelectedScreenIds: string[];
  rectFromCodeLayerNode: (node: CodeLayerNode) => AlignableRect;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runTidyUp({
  activeFile,
  boardFileId,
  boardFrameGeometry,
  canEditDesign,
  commitNodePositions,
  designDataJsonRef,
  getActiveFileSelectedNodeIds,
  getFreshActiveContent,
  getScreenGroupFootprint,
  handleGeometryCommit,
  overviewScreens,
  overviewSelectedScreenIds,
  rectFromCodeLayerNode,
  viewModeRef,
}: TidyUpArgs) {
  if (!canEditDesign) return;

  if (viewModeRef.current === "overview") {
    if (overviewSelectedScreenIds.length === 0) return;
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
      if (!fallbackGeometry) return;
      const geometry = { ...fallbackGeometry, ...before[screenId] };
      // Pack against the breakpoint group's footprint, not just the base
      // frame — otherwise tidy leaves every breakpoint row overlapping the
      // neighbouring screen.
      const footprint = getScreenGroupFootprint(screenId, geometry);
      screenRects.push({
        id: screenId,
        x: footprint.x,
        y: footprint.y,
        width: footprint.width,
        height: footprint.height,
      });
    });
    if (screenRects.length === 0) return;
    const positions = computeTidyPositions(screenRects);
    if (positions.size === 0) return;
    const after = cloneCanvasFrameGeometry(before);
    positions.forEach((position, screenId) => {
      after[screenId] = { ...after[screenId]!, ...position };
    });
    handleGeometryCommit(before, after);
    return;
  }

  if (!activeFile) return;
  const baseContent = getFreshActiveContent();
  const nodeIds = getActiveFileSelectedNodeIds(baseContent);
  if (nodeIds.length === 0) return;
  const projection = buildCodeLayerProjection(baseContent);
  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
  const selectedNodes = nodeIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is CodeLayerNode => Boolean(node));
  if (selectedNodes.length === 0) return;
  const selectedRects = selectedNodes.map(rectFromCodeLayerNode);
  const positions = computeTidyPositions(selectedRects);
  commitNodePositions(baseContent, positions);
}
