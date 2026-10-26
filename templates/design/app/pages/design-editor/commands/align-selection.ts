import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { getFrameGroupBounds } from "@shared/canvas-math";
import type { CodeLayerNode, CodeLayerSource } from "@shared/code-layer";
import { buildCodeLayerProjection } from "@shared/code-layer";
import type { RefObject } from "react";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import { getInitialFrameGeometry } from "@/components/design/multi-screen/frame-geometry";
import type { FrameGeometry } from "@/components/design/multi-screen/types";
import type { ElementInfo } from "@/components/design/types";
import type { DesignHotkeyAlignEdge } from "@/hooks/useDesignHotkeys";
import { codeLayerPatchMessage } from "@/pages/design-editor/code-layer-state";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  cloneCanvasFrameGeometry,
  getCanvasFrameGeometry,
} from "@/pages/design-editor/design-data-geometry-utils";
import type {
  AlignableRect,
  AlignMeasurement,
  MeasuredAlignNode,
  SharedDelta,
  StylePatch,
} from "@/pages/design-editor/layout-operations";
import {
  alignSharedDelta,
  autoLayoutAlignmentPatch,
  computeAlignedPositions,
  planSharedMoves,
  unionSharedRects,
} from "@/pages/design-editor/layout-operations";
import { overviewSelectionTargetsElement } from "@/pages/design-editor/selection-state";
import type { DesignFile } from "@/pages/design-editor/types";

export type AlignSelectionBlocker =
  | "read-only"
  | "no-selection"
  | "overview-needs-two-screens"
  | "no-alignable-parent"
  | "unmeasurable"
  | "auto-layout-children"
  | "unsupported-position";

/** Refusals shared by align, distribute, and tidy, including run-time-only ones. */
export type LayoutMoveRefusal =
  | AlignSelectionBlocker
  | "moves-nested-layers"
  | "commit-failed";

export type MeasureAlignSelection = (
  nodes: readonly CodeLayerNode[],
  options?: { checkNestedLayers?: boolean },
) => AlignMeasurement;

export type CommitNodeStylePatches = (
  baseContent: string,
  patches: ReadonlyMap<string, StylePatch>,
  source?: CodeLayerSource,
) => { applied: true } | { applied: false; message?: string };

export interface AlignSelectionAvailabilityArgs {
  canEditDesign: boolean;
  fileIds: string[];
  measureSelection: MeasureAlignSelection;
  overviewSelectedScreenIds: string[];
  resolveNodesById: () => ReadonlyMap<string, CodeLayerNode>;
  selectedElement: ElementInfo | null;
  selectedLayerIds: string[];
  viewMode: "single" | "overview";
}

export type AlignSelectionAvailability =
  | { canAlign: true }
  | { canAlign: false; blocker: AlignSelectionBlocker };

const REFUSAL_TOASTS: Partial<Record<LayoutMoveRefusal, string>> = {
  "overview-needs-two-screens": "designEditor.toasts.alignNeedsTwoScreens",
  "no-alignable-parent": "designEditor.toasts.alignNeedsTwoLayers",
  unmeasurable: "designEditor.toasts.layoutUnmeasurable",
  "auto-layout-children": "designEditor.toasts.layoutAutoLayoutChildren",
  "unsupported-position": "designEditor.toasts.layoutUnsupportedPosition",
  "moves-nested-layers": "designEditor.toasts.layoutMovesNestedLayers",
  "commit-failed": "designEditor.toasts.layoutMoveFailed",
};

/** The catalog key explaining a refusal, or null when it needs no explanation. */
export function layoutMoveRefusalMessageKey(
  refusal: LayoutMoveRefusal,
): string | null {
  return REFUSAL_TOASTS[refusal] ?? null;
}

/** Says why a layout move did nothing. Read-only and empty selections stay quiet. */
export function toastLayoutMoveRefusal(
  t: (key: string) => string,
  refusal: LayoutMoveRefusal,
  message?: string,
) {
  const key = REFUSAL_TOASTS[refusal];
  if (!key) return;
  toast.error(codeLayerPatchMessage(message, t(key), t), { duration: 4000 });
}

export function selectedLayerNodes(
  selectedLayerIds: readonly string[],
  fileIds: readonly string[],
  nodesById: ReadonlyMap<string, CodeLayerNode>,
): CodeLayerNode[] {
  const fileIdSet = new Set(fileIds);
  return selectedLayerIds
    .filter((layerId) => !layerId.startsWith("__") && !fileIdSet.has(layerId))
    .map((layerId) => nodesById.get(layerId))
    .filter((node): node is CodeLayerNode => Boolean(node));
}

/** What the measured selection rules out before any motion is computed. */
export function alignSelectionStructuralBlocker(
  nodes: readonly MeasuredAlignNode[],
): AlignSelectionBlocker | null {
  if (nodes.length === 0) return "no-selection";
  if (nodes.some((node) => node.layout.kind === "unsupported")) {
    return "unsupported-position";
  }
  if (nodes.length === 1) {
    return nodes[0]!.parentBox ? null : "no-alignable-parent";
  }
  return nodes.some((node) => node.layout.kind === "auto-layout-child")
    ? "auto-layout-children"
    : null;
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
  const nodes = selectedLayerNodes(
    args.selectedLayerIds,
    args.fileIds,
    args.resolveNodesById(),
  );
  if (nodes.length === 0) return { canAlign: false, blocker: "no-selection" };
  const measurement = args.measureSelection(nodes);
  if (measurement.status !== "measured") {
    return { canAlign: false, blocker: "unmeasurable" };
  }
  const blocker = alignSelectionStructuralBlocker(measurement.nodes);
  return blocker ? { canAlign: false, blocker } : { canAlign: true };
}

export type AlignSelectionPlan =
  | { kind: "refused"; refusal: LayoutMoveRefusal }
  | { kind: "offsets"; patches: Map<string, StylePatch> }
  | { kind: "parent-alignment"; patch: StylePatch };

/**
 * One set of rules in one shared space: a lone layer aligns to its parent (the
 * screen when it is top-level), a multi-selection to its own bounding box.
 * Only the aligned axis moves; nothing is resized, reparented, or taken out of
 * flow, so unselected siblings stay where they are.
 */
export function planAlignSelection(
  nodes: readonly MeasuredAlignNode[],
  edge: DesignHotkeyAlignEdge,
): AlignSelectionPlan {
  const blocker = alignSelectionStructuralBlocker(nodes);
  if (blocker) return { kind: "refused", refusal: blocker };
  const sole = nodes.length === 1 ? nodes[0]! : null;
  if (sole?.layout.kind === "auto-layout-child") {
    return {
      kind: "parent-alignment",
      patch: autoLayoutAlignmentPatch(
        sole.layout.parent,
        edge,
        sole.layout.fillsCrossAxis,
      ),
    };
  }
  const bounds = sole
    ? sole.parentBox!
    : unionSharedRects(nodes.map((node) => node.rect));
  const deltas = new Map(
    nodes.map((node) => [node.id, alignSharedDelta(node.rect, bounds, edge)]),
  );
  const plan = planSharedMoves(nodes, deltas);
  return plan.status === "planned"
    ? { kind: "offsets", patches: plan.patches }
    : { kind: "refused", refusal: plan.blocker };
}

export interface AlignSelectionArgs {
  activeFile: DesignFile;
  boardFileId: string | undefined;
  boardFrameGeometry: FrameGeometry | undefined;
  canEditDesign: boolean;
  commitNodePositions: CommitNodeStylePatches;
  designDataJsonRef: RefObject<Record<string, unknown>>;
  files: DesignFile[];
  getActiveFileSelectedNodeIds: (content: string) => string[];
  getFreshActiveContent: () => string;
  handleGeometryCommit: (
    before: CanvasFrameGeometryById,
    after: CanvasFrameGeometryById,
    options?: { source?: "pointer" | "keyboard" },
  ) => void;
  measureSelection: MeasureAlignSelection;
  overviewScreens: OverviewScreen[];
  overviewSelectedScreenIds: string[];
  selectedElement: ElementInfo | null;
  selectedLayerIdsState: string[];
  t: (key: string) => string;
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
    measureSelection,
    overviewScreens,
    overviewSelectedScreenIds,
    selectedElement,
    selectedLayerIdsState,
    t,
    viewModeRef,
  }: AlignSelectionArgs,
  edge: DesignHotkeyAlignEdge,
) {
  const abandon = (reason: string, data?: Record<string, unknown>) => {
    trace("structure", "align-abandoned", { reason, edge, ...data });
  };
  const refuse = (
    refusal: LayoutMoveRefusal,
    data?: Record<string, unknown>,
    message?: string,
  ) => {
    abandon(refusal, data);
    toastLayoutMoveRefusal(t, refusal, message);
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
  let measurement: AlignMeasurement | null = null;
  let measuredKey = "";
  const measureOnce: MeasureAlignSelection = (nodes) => {
    const key = nodes
      .map((node) => node.id)
      .sort()
      .join("\n");
    if (!measurement || key !== measuredKey) {
      measurement = measureSelection(nodes, { checkNestedLayers: true });
      measuredKey = key;
    }
    return measurement;
  };

  const availability = alignSelectionAvailability({
    canEditDesign,
    fileIds: files.map((file) => file.id),
    measureSelection: measureOnce,
    overviewSelectedScreenIds,
    resolveNodesById,
    selectedElement,
    selectedLayerIds: selectedLayerIdsState,
    viewMode: viewModeRef.current ?? "single",
  });
  if (!availability.canAlign) {
    const unmeasurable = measurement as AlignMeasurement | null;
    return refuse(
      availability.blocker,
      unmeasurable?.status === "unmeasurable"
        ? { nodeId: unmeasurable.nodeId, cause: unmeasurable.reason }
        : undefined,
    );
  }

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
  const nodesById = resolveNodesById();
  const selectedNodes = getActiveFileSelectedNodeIds(baseContent)
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is CodeLayerNode => Boolean(node));
  if (selectedNodes.length === 0) {
    return abandon("selected ids resolve to no projection nodes");
  }
  const measured = measureOnce(selectedNodes);
  if (measured.status !== "measured") {
    return refuse("unmeasurable", {
      nodeId: measured.nodeId,
      cause: measured.reason,
    });
  }
  const plan = planAlignSelection(measured.nodes, edge);
  if (plan.kind === "refused") return refuse(plan.refusal);

  let patches: ReadonlyMap<string, StylePatch>;
  if (plan.kind === "parent-alignment") {
    const sole = selectedNodes[0]!;
    const parentNode = sole.parentId ? nodesById.get(sole.parentId) : undefined;
    const renderedParentId = measured.nodes[0]!.parentStableId;
    if (
      !parentNode ||
      (renderedParentId !== null &&
        parentNode.dataAttributes["data-agent-native-node-id"] !== undefined &&
        parentNode.dataAttributes["data-agent-native-node-id"] !==
          renderedParentId)
    ) {
      return refuse("unmeasurable", {
        parentId: sole.parentId,
        renderedParentId,
      });
    }
    patches = new Map(
      plan.patch.length > 0 ? [[parentNode.id, plan.patch]] : [],
    );
  } else {
    patches = plan.patches;
  }
  if (patches.size === 0) {
    return abandon("already aligned; nothing to move", { edge });
  }
  const committed = commitNodePositions(baseContent, patches, activeSource);
  if (!committed.applied) {
    refuse("commit-failed", undefined, committed.message);
  }
}

/**
 * Distribute and tidy: measure the selection in the shared space, place each
 * rect where `targets` says, and move every node by the difference in its own
 * offset space.
 */
export function runSharedLayoutMove({
  baseContent,
  commitNodePositions,
  measureSelection,
  nodes,
  source,
  t,
  targets,
  traceName,
}: {
  baseContent: string;
  commitNodePositions: CommitNodeStylePatches;
  measureSelection: MeasureAlignSelection;
  nodes: readonly CodeLayerNode[];
  source: CodeLayerSource;
  t: (key: string) => string;
  targets: (
    rects: AlignableRect[],
  ) => ReadonlyMap<string, { x?: number; y?: number }>;
  traceName: string;
}) {
  const refuse = (
    refusal: LayoutMoveRefusal,
    data?: Record<string, unknown>,
    message?: string,
  ) => {
    trace("structure", `${traceName}-abandoned`, { reason: refusal, ...data });
    toastLayoutMoveRefusal(t, refusal, message);
  };
  const measured = measureSelection(nodes, { checkNestedLayers: true });
  if (measured.status !== "measured") {
    return refuse("unmeasurable", {
      nodeId: measured.nodeId,
      cause: measured.reason,
    });
  }
  const rectsById = new Map(measured.nodes.map((node) => [node.id, node.rect]));
  const deltas = new Map<string, SharedDelta>();
  targets(
    measured.nodes.map((node) => ({ id: node.id, ...node.rect })),
  ).forEach((target, nodeId) => {
    const rect = rectsById.get(nodeId);
    if (!rect) return;
    deltas.set(nodeId, {
      dx: target.x === undefined ? 0 : target.x - rect.x,
      dy: target.y === undefined ? 0 : target.y - rect.y,
    });
  });
  const plan = planSharedMoves(measured.nodes, deltas);
  if (plan.status === "blocked") {
    return refuse(plan.blocker, { nodeId: plan.nodeId });
  }
  if (plan.patches.size === 0) return;
  const committed = commitNodePositions(baseContent, plan.patches, source);
  if (!committed.applied) refuse("commit-failed", undefined, committed.message);
}
