import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { getFrameGroupBounds } from "@shared/canvas-math";
import type { CodeLayerNode, CodeLayerSource } from "@shared/code-layer";
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

export type AlignSelectionBlocker =
  | "read-only"
  | "no-selection"
  | "overview-needs-two-screens"
  | "no-alignable-parent"
  | "parent-not-measurable";

export interface AlignSelectionAvailabilityArgs {
  canEditDesign: boolean;
  fileIds: string[];
  measureAlignParentBox: MeasureAlignParentBox;
  overviewSelectedScreenIds: string[];
  resolveNodesById: () => ReadonlyMap<string, CodeLayerNode>;
  selectedElement: ElementInfo | null;
  selectedLayerIds: string[];
  viewMode: "single" | "overview";
}

export type MeasureAlignParentBox = (
  node: CodeLayerNode,
  parentNode: CodeLayerNode,
) => { width: number; height: number } | null;

export type AlignSelectionAvailability =
  | { canAlign: true }
  | { canAlign: false; blocker: AlignSelectionBlocker };

function isDocumentRootNode(node: CodeLayerNode | undefined): boolean {
  const tag = node?.tag.toLowerCase();
  return tag === "body" || tag === "html";
}

export function alignSelectionAvailability(
  args: AlignSelectionAvailabilityArgs,
): AlignSelectionAvailability {
  if (!args.canEditDesign) return { canAlign: false, blocker: "read-only" };
  if (
    args.viewMode === "overview" &&
    !overviewSelectionTargetsElement({
      selectedElement: args.selectedElement,
      selectedLayerIds: args.selectedLayerIds,
      fileIds: args.fileIds,
    })
  ) {
    return args.overviewSelectedScreenIds.length >= 2
      ? { canAlign: true }
      : { canAlign: false, blocker: "overview-needs-two-screens" };
  }
  const nodesById = args.resolveNodesById();
  const fileIdSet = new Set(args.fileIds);
  const nodeIds = args.selectedLayerIds.filter(
    (layerId) =>
      !layerId.startsWith("__") &&
      !fileIdSet.has(layerId) &&
      nodesById.has(layerId),
  );
  if (nodeIds.length === 0) return { canAlign: false, blocker: "no-selection" };
  if (nodeIds.length >= 2) return { canAlign: true };
  const soleNode = nodesById.get(nodeIds[0]!)!;
  const parentId = soleNode.parentId;
  const parentNode = parentId ? nodesById.get(parentId) : undefined;
  if (!parentNode || isDocumentRootNode(parentNode)) {
    return { canAlign: false, blocker: "no-alignable-parent" };
  }
  return args.measureAlignParentBox(soleNode, parentNode)
    ? { canAlign: true }
    : { canAlign: false, blocker: "parent-not-measurable" };
}

export interface AlignSelectionArgs {
  activeFile: DesignFile;
  boardFileId: string | undefined;
  boardFrameGeometry: FrameGeometry | undefined;
  canEditDesign: boolean;
  commitNodePositions: (
    baseContent: string,
    positions: ReadonlyMap<string, { x: number; y: number }>,
    source?: CodeLayerSource,
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
  measureAlignParentBox: MeasureAlignParentBox;
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
    measureAlignParentBox,
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

  const baseContent = activeFile ? getFreshActiveContent() : "";
  const activeSource = activeFile
    ? { kind: "design-file" as const, fileId: activeFile.id }
    : undefined;
  let projectionNodesById: ReadonlyMap<string, CodeLayerNode> | null = null;
  const resolveNodesById = () => {
    if (!projectionNodesById) {
      projectionNodesById = new Map(
        buildCodeLayerProjection(baseContent, {
          ...(activeSource ? { source: activeSource } : {}),
        }).nodes.map((node) => [node.id, node]),
      );
    }
    return projectionNodesById;
  };

  const availability = alignSelectionAvailability({
    canEditDesign,
    fileIds: files.map((file) => file.id),
    measureAlignParentBox,
    overviewSelectedScreenIds,
    resolveNodesById,
    selectedElement,
    selectedLayerIds: selectedLayerIdsState,
    viewMode: viewModeRef.current ?? "single",
  });
  if (!availability.canAlign) return abandon(availability.blocker);

  if (
    viewModeRef.current === "overview" &&
    !overviewSelectionTargetsElement({
      selectedElement,
      selectedLayerIds: selectedLayerIdsState,
      fileIds: files.map((file) => file.id),
    })
  ) {
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

  if (!activeFile) return abandon("no active file");
  const nodeIds = getActiveFileSelectedNodeIds(baseContent);
  const nodesById = resolveNodesById();
  const selectedNodes = nodeIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is CodeLayerNode => Boolean(node));
  if (selectedNodes.length === 0) {
    return abandon("selected ids resolve to no projection nodes", { nodeIds });
  }
  const selectedRects = selectedNodes.map(rectFromCodeLayerNode);

  if (selectedRects.length >= 2) {
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
    commitNodePositions(baseContent, positions, activeSource);
    return;
  }

  const soleNode = selectedNodes[0]!;
  const parentId = soleNode.parentId;
  const parentNode = parentId ? nodesById.get(parentId) : undefined;
  if (!parentNode) return abandon("parent id not in projection", { parentId });
  const parentBox = measureAlignParentBox(soleNode, parentNode);
  if (!parentBox) {
    return abandon("parent box could not be measured", { parentId });
  }
  const positions = computeAlignedPositions(
    [selectedRects[0]!],
    { x: 0, y: 0, width: parentBox.width, height: parentBox.height },
    edge,
  );
  if (positions.size === 0) {
    return abandon("already aligned; nothing to move", { edge });
  }
  commitNodePositions(baseContent, positions, activeSource);
}
