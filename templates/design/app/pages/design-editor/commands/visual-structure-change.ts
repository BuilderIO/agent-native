import { stripBoardSurfaceOffsetFromCoord } from "@shared/board-file";
import { applyVisualEdit, buildCodeLayerProjection } from "@shared/code-layer";
import { isRunningAppSourceType } from "@shared/source-mode";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import { dndHostLog } from "@/components/design/dnd-debug";
import type {
  ElementInfo,
  GridGroupStructureMove,
} from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerPatchMessage,
  preferredCodeLayerSelector,
  resolveCodeLayerNodeFromBridge,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import {
  isAbsoluteCodeLayerNode,
  rawAbsoluteContainerOffsetFromDrop,
  removeAbsolutePositioningFromNodeInHtml,
  setAbsolutePositioningForNodeInHtml,
  setFlowPositioningOverrideForNodeInHtml,
} from "@/pages/design-editor/html-layer-positioning";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyLocalContentUpdateResult } from "./apply-local-content-update";
import {
  resolveLinkedComponentStructureTarget,
  type ApplyLinkedComponentEdit,
} from "./linked-component-structure";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "./selection-publication";

export interface VisualStructureChangeArgs {
  activeCanvasSourceType: "inline" | "localhost" | "fusion";
  activeFile: DesignFile;
  applyLinkedComponentEdit?: ApplyLinkedComponentEdit;
  applyLocalContentUpdate: (
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      immediateSave?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyLocalContentUpdateResult;
  canEditDesign: boolean;
  canEditLiveScreen?: boolean;
  getFreshActiveContent: () => string;
  recordPendingLiveStructureEdit: (
    screenId: string,
    selector: string,
    anchorSelector: string,
    placement: "before" | "after" | "inside",
    elementInfo?: ElementInfo,
    details?: {
      sourceId?: string;
      anchorSourceId?: string;
      anchorElementInfo?: ElementInfo;
      requestId?: string;
      transactionId?: string;
      routePath?: string;
      dropMode?: "flow-insert" | "absolute-container";
      forceFlowPositionOverride?: boolean;
      sourceRect?: { x: number; y: number; width: number; height: number };
      anchorRect?: { x: number; y: number; width: number; height: number };
      gridPlacement?: {
        column: number;
        columnEnd: number;
        row: number;
        rowEnd: number;
      };
      gridDisplacements?: Array<{
        sourceId?: string;
        selector?: string;
        placement: {
          column: number;
          columnEnd: number;
          row: number;
          rowEnd: number;
        };
      }>;
      insertedHtml?: string;
      replaced?: true;
      replacementSelector?: string;
      replacementSourceId?: string;
      replacementElementInfo?: ElementInfo;
      replacementSnapshotHtml?: string;
      removed?: true;
    },
  ) => void;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runVisualStructureChange(
  {
    activeCanvasSourceType,
    activeFile,
    applyLocalContentUpdate,
    canEditDesign,
    canEditLiveScreen,
    getFreshActiveContent,
    recordPendingLiveStructureEdit,
    setSelectedElement,
    setSelectedLayerIdsState,
    t,
    applyLinkedComponentEdit,
  }: VisualStructureChangeArgs,
  selector: string,
  anchorSelector: string,
  placement: "before" | "after" | "inside",
  elementInfo?: ElementInfo,
  details?: {
    sourceId?: string;
    anchorSourceId?: string;
    anchorElementInfo?: ElementInfo;
    requestId?: string;
    transactionId?: string;
    routePath?: string;
    dropMode?: "flow-insert" | "absolute-container";
    forceFlowPositionOverride?: boolean;
    sourceRect?: { x: number; y: number; width: number; height: number };
    anchorRect?: { x: number; y: number; width: number; height: number };
    gridPlacement?: {
      column: number;
      columnEnd: number;
      row: number;
      rowEnd: number;
    };
    gridDisplacements?: Array<{
      sourceId?: string;
      selector?: string;
      placement: {
        column: number;
        columnEnd: number;
        row: number;
        rowEnd: number;
      };
    }>;
    insertedHtml?: string;
    replaced?: true;
    replacementSelector?: string;
    replacementSourceId?: string;
    replacementElementInfo?: ElementInfo;
    replacementSnapshotHtml?: string;
  },
) {
  dndHostLog("persist:begin", {
    selector,
    anchorSelector,
    placement,
    dropMode: details?.dropMode,
    source: activeCanvasSourceType,
  });
  if (!canEditDesign && !canEditLiveScreen) return false;
  if (!activeFile) return false;
  if (isRunningAppSourceType(activeCanvasSourceType)) {
    recordPendingLiveStructureEdit(
      activeFile.id,
      selector,
      anchorSelector,
      placement,
      elementInfo,
      details,
    );
    return "pending";
  }
  const baseContent = getFreshActiveContent();
  const source = { kind: "design-file" as const, fileId: activeFile.id };
  const projection = buildCodeLayerProjection(baseContent, { source });
  const resolveBridgeNode = (targetSelector: string, sourceId?: string) =>
    resolveCodeLayerNodeFromBridge(projection, targetSelector, sourceId);
  const targetInfo = elementInfo
    ? {
        ...elementInfo,
        selector,
        sourceId: details?.sourceId ?? elementInfo.sourceId,
      }
    : null;
  const targetNode = details?.sourceId
    ? resolveCodeLayerNodeFromBridge(projection, undefined, details.sourceId)
    : targetInfo
      ? resolveCodeLayerNodeFromElementInfo(projection, targetInfo)
      : resolveBridgeNode(selector, details?.sourceId);
  const anchorNode = details?.anchorSourceId
    ? resolveCodeLayerNodeFromBridge(
        projection,
        undefined,
        details.anchorSourceId,
      )
    : resolveBridgeNode(anchorSelector, details?.anchorSourceId);
  if (
    (details?.sourceId && !targetNode) ||
    (details?.anchorSourceId && !anchorNode)
  ) {
    return false;
  }
  const moveIntent = {
    kind: "moveNode" as const,
    target: targetNode
      ? {
          nodeId: targetNode.id,
        }
      : details?.sourceId
        ? { nodeId: details.sourceId, selector }
        : { selector },
    anchor: anchorNode
      ? {
          nodeId: anchorNode.id,
        }
      : details?.anchorSourceId
        ? { nodeId: details.anchorSourceId, selector: anchorSelector }
        : { selector: anchorSelector },
    placement,
  };
  const linkedMoveIntent =
    targetNode?.dataAttributes["data-agent-native-node-id"] &&
    anchorNode?.dataAttributes["data-agent-native-node-id"]
      ? {
          kind: "moveNode" as const,
          target: {
            nodeId: targetNode.dataAttributes["data-agent-native-node-id"],
          },
          anchor: {
            nodeId: anchorNode.dataAttributes["data-agent-native-node-id"],
          },
          placement,
        }
      : null;
  const linkedComponentTarget =
    applyLinkedComponentEdit && linkedMoveIntent
      ? resolveLinkedComponentStructureTarget({
          content: baseContent,
          source,
          intents: [linkedMoveIntent],
        })
      : null;
  const patch = applyVisualEdit(
    baseContent,
    linkedComponentTarget ? linkedMoveIntent! : moveIntent,
    linkedComponentTarget
      ? { source, allowMainComponentStructure: true }
      : { source },
  );
  dndHostLog("persist:rewrite", {
    status: patch.result.status,
    message: patch.result.message,
  });
  if (patch.result.status !== "applied") {
    toast.error(
      codeLayerPatchMessage(
        patch.result.message,
        t("designEditor.toasts.layerMoveFailed"),
        t,
      ),
      { duration: 4000 },
    );
    return false;
  }
  const movedNodeAttrId =
    targetNode?.dataAttributes["data-agent-native-node-id"] ??
    details?.sourceId ??
    elementInfo?.sourceId ??
    (patch.result.after?.nodeId
      ? patch.projection.nodes.find(
          (node) => node.id === patch.result.after?.nodeId,
        )?.dataAttributes["data-agent-native-node-id"]
      : undefined);
  const rawAbsoluteContainerOffset = rawAbsoluteContainerOffsetFromDrop({
    dropMode: details?.dropMode,
    placement,
    sourceRect: details?.sourceRect,
    anchorRect: details?.anchorRect,
    inlineStyles: elementInfo?.inlineStyles,
    anchorSelector,
  });
  const absoluteContainerOffset = rawAbsoluteContainerOffset
    ? {
        x: stripBoardSurfaceOffsetFromCoord(rawAbsoluteContainerOffset.x),
        y: stripBoardSurfaceOffsetFromCoord(rawAbsoluteContainerOffset.y),
      }
    : null;
  const absoluteOffsetWasPoisoned = Boolean(
    rawAbsoluteContainerOffset &&
    absoluteContainerOffset &&
    (rawAbsoluteContainerOffset.x !== absoluteContainerOffset.x ||
      rawAbsoluteContainerOffset.y !== absoluteContainerOffset.y),
  );
  let nextContent =
    movedNodeAttrId && details?.dropMode === "absolute-container"
      ? absoluteContainerOffset
        ? setAbsolutePositioningForNodeInHtml(
            patch.content,
            movedNodeAttrId,
            absoluteContainerOffset,
          )
        : patch.content
      : movedNodeAttrId &&
          details?.dropMode === "flow-insert" &&
          details.forceFlowPositionOverride
        ? setFlowPositioningOverrideForNodeInHtml(
            patch.content,
            movedNodeAttrId,
          )
        : isAbsoluteCodeLayerNode(targetNode) && movedNodeAttrId
          ? removeAbsolutePositioningFromNodeInHtml(
              patch.content,
              movedNodeAttrId,
            )
          : patch.content;
  if (movedNodeAttrId && details?.gridPlacement) {
    const gridTarget = { nodeId: movedNodeAttrId };
    const columnPatch = applyVisualEdit(
      nextContent,
      {
        kind: "style",
        target: gridTarget,
        property: "grid-column",
        value: `${details.gridPlacement.column} / ${details.gridPlacement.columnEnd}`,
      },
      { source },
    );
    if (columnPatch.result.status === "applied") {
      nextContent = columnPatch.content;
      const rowPatch = applyVisualEdit(
        nextContent,
        {
          kind: "style",
          target: gridTarget,
          property: "grid-row",
          value: `${details.gridPlacement.row} / ${details.gridPlacement.rowEnd}`,
        },
        { source },
      );
      if (rowPatch.result.status === "applied") nextContent = rowPatch.content;
    }
  }
  if (details?.gridDisplacements) {
    for (const displaced of details.gridDisplacements) {
      const target = displaced.sourceId
        ? {
            nodeId: displaced.sourceId,
            ...(displaced.selector ? { selector: displaced.selector } : {}),
          }
        : displaced.selector
          ? { selector: displaced.selector }
          : null;
      if (!target) continue;
      const displacementPatch = applyVisualEdit(
        nextContent,
        {
          kind: "style",
          target,
          property: "grid-column",
          value: `${displaced.placement.column} / ${displaced.placement.columnEnd}`,
        },
        { source },
      );
      if (displacementPatch.result.status !== "applied") continue;
      nextContent = displacementPatch.content;
      const rowPatch = applyVisualEdit(
        nextContent,
        {
          kind: "style",
          target,
          property: "grid-row",
          value: `${displaced.placement.row} / ${displaced.placement.rowEnd}`,
        },
        { source },
      );
      if (rowPatch.result.status === "applied") nextContent = rowPatch.content;
    }
  }
  const nextProjection = buildCodeLayerProjection(nextContent, { source });
  const movedNodeCandidate =
    (movedNodeAttrId
      ? nextProjection.nodes.find(
          (node) =>
            node.dataAttributes["data-agent-native-node-id"] ===
            movedNodeAttrId,
        )
      : null) ??
    (patch.result.after?.nodeId
      ? nextProjection.nodes.find(
          (node) => node.id === patch.result.after?.nodeId,
        )
      : null) ??
    resolveCodeLayerNodeFromBridge(
      nextProjection,
      selector,
      details?.sourceId ??
        elementInfo?.sourceId ??
        (targetNode ? bridgeSourceIdForCodeLayerNode(targetNode) : undefined),
    );
  if (linkedComponentTarget && applyLinkedComponentEdit) {
    applyLinkedComponentEdit(
      linkedComponentTarget.fileId,
      linkedComponentTarget.nodeId,
      {
        kind: "structure",
        before: baseContent,
        after: nextContent,
        ...(movedNodeAttrId ? { selectionNodeIds: [movedNodeAttrId] } : {}),
      },
    );
    return true;
  }
  const publication = applyLocalContentUpdate(nextContent, {
    ...(absoluteOffsetWasPoisoned
      ? { forcePreviewFullDocument: true }
      : { skipPreview: true }),
  });
  if (publication.status !== "accepted") return false;
  const acceptedProjection = projectAcceptedSource(publication, source);
  const movedNode = mapAcceptedSelectionNode(
    publication,
    acceptedProjection,
    movedNodeCandidate,
  );
  if (movedNode) setSelectedLayerIdsState([movedNode.id]);
  if (elementInfo) {
    setSelectedElement({
      ...elementInfo,
      sourceId: movedNode
        ? bridgeSourceIdForCodeLayerNode(movedNode)
        : elementInfo.sourceId,
      selector: movedNode
        ? preferredCodeLayerSelector(movedNode)
        : elementInfo.selector,
    });
  }
  return true;
}

export function planVisualGridGroupStructureChange(
  activeFile: DesignFile,
  content: string,
  moves: GridGroupStructureMove[],
  t: VisualStructureChangeArgs["t"],
  linked = false,
): string | null {
  let nextContent = content;
  for (const move of moves) {
    const applied = runVisualStructureChange(
      {
        activeCanvasSourceType: "inline",
        activeFile,
        applyLocalContentUpdate: (next) => {
          nextContent = next;
          return { status: "accepted", content: next, nodeIdMap: new Map() };
        },
        applyLinkedComponentEdit: linked
          ? (_fileId, _nodeId, edit) => {
              if (edit.kind === "structure" && "after" in edit)
                nextContent = edit.after;
            }
          : undefined,
        canEditDesign: true,
        getFreshActiveContent: () => nextContent,
        recordPendingLiveStructureEdit: () => {
          throw new Error("Inline grid group cannot queue a live-source edit");
        },
        setSelectedElement: () => {},
        setSelectedLayerIdsState: () => {},
        t,
      },
      move.selector,
      move.persistenceAnchorSelector ?? move.anchorSelector,
      move.persistencePlacement ?? move.placement ?? "inside",
      undefined,
      {
        ...move,
        anchorSourceId: move.persistenceAnchorSourceId ?? move.anchorSourceId,
        dropMode: "flow-insert",
      },
    );
    if (applied !== true) return null;
  }
  return nextContent;
}

export function resolveGridGroupLinkedComponentTarget(
  content: string,
  fileId: string,
  moves: GridGroupStructureMove[],
):
  | { status: "none" }
  | { status: "mixed" }
  | { status: "linked"; fileId: string; nodeId: string } {
  const source = { kind: "design-file" as const, fileId };
  const targets = moves.map((move) =>
    resolveLinkedComponentStructureTarget({
      content,
      source,
      intents: [
        {
          kind: "moveNode",
          target: { nodeId: move.sourceId },
          anchor: {
            nodeId: move.persistenceAnchorSourceId ?? move.anchorSourceId,
          },
          placement: move.persistencePlacement ?? move.placement ?? "inside",
        },
      ],
    }),
  );
  const linked = targets.find((target) => target !== null);
  if (!linked) return { status: "none" };
  if (
    targets.some(
      (target) =>
        target?.fileId !== linked.fileId || target?.nodeId !== linked.nodeId,
    )
  )
    return { status: "mixed" };
  return { status: "linked", ...linked };
}
