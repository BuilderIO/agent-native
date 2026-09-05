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

/**
 * Why an alignment click would do nothing. The inspector disables its six
 * buttons on the same verdict `runAlignSelection` refuses on, so the row is
 * never an affordance that silently no-ops (or, when the bounds could not be
 * measured, moves the selection to the wrong edge).
 */
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
  /** Active-file projection nodes, resolved only when the verdict needs them. */
  resolveNodesById: () => ReadonlyMap<string, CodeLayerNode>;
  selectedElement: ElementInfo | null;
  selectedLayerIds: string[];
  viewMode: "single" | "overview";
}

/**
 * The box a single selection aligns inside, in the same parent-relative space
 * `rectFromCodeLayerNode` reports the child in. Null means unmeasured, not
 * empty: a zero box puts every edge at the parent's origin, which reads as the
 * buttons moving the selection the wrong way.
 */
export type MeasureAlignParentBox = (
  node: CodeLayerNode,
  parentNode: CodeLayerNode,
) => { width: number; height: number } | null;

export type AlignSelectionAvailability =
  | { canAlign: true }
  | { canAlign: false; blocker: AlignSelectionBlocker };

/** A frame at the top of the document has nothing to align against. */
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
  // 2+ objects align to their own combined bounding box, so they never need a
  // parent — a pair of top-level frames is alignable where one is not.
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

  // One projection for both the verdict below and the layer paths further
  // down, built on demand so aligning overview screens never pays for it.
  const baseContent = activeFile ? getFreshActiveContent() : "";
  let projectionNodesById: ReadonlyMap<string, CodeLayerNode> | null = null;
  const resolveNodesById = () => {
    if (!projectionNodesById) {
      projectionNodesById = new Map(
        buildCodeLayerProjection(baseContent).nodes.map((node) => [
          node.id,
          node,
        ]),
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

  // Selected SCREENS go through handleGeometryCommit, so the whole align is
  // one undo step. A layer selection must fall through to the element path
  // below instead, as Figma aligns whatever is selected.
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

  // Single-screen mode: in-screen DOM-node layers.
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

  // Single selection: align relative to the parent's content box.
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
  commitNodePositions(baseContent, positions);
}
