import {
  computeReparentedChildPosition,
  normalizePoisonedBoardNestedCoords,
} from "@shared/board-file";
import type { CodeLayerNode } from "@shared/code-layer";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  moveNodeBetweenDocuments,
} from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { ScreenProjectionNodeIdentity } from "@/components/design/multi-screen/types";
import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  codeLayerPatchMessage,
  elementInfoFromCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import type {
  ContentHistoryEntry,
  ContentHistorySelectionAfterMap,
} from "@/pages/design-editor/history";
import {
  captureContentUndoStackTop,
  stampContentHistorySelectionAfter,
} from "@/pages/design-editor/history";
import {
  getAbsolutePositioningForNodeInHtml,
  removeAbsolutePositioningFromNodeInHtml,
  setAbsolutePositioningForNodeInHtml,
  warnIfPoisonedBoardCoordsNormalized,
} from "@/pages/design-editor/html-layer-positioning";
import {
  isFlowDisplay,
  readLiveLayerMoveLayout,
} from "@/pages/design-editor/live-layer-move-layout";
import { prepareAcceptedSourceContent } from "@/pages/design-editor/source-publication";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import { prepareLayerNodeIdentities } from "./layer-node-identity";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "./selection-publication";

function isFlowContainerNode(node: CodeLayerNode | undefined): boolean {
  if (!node) return false;
  const display = node.style.display?.toLowerCase();
  if (display) return isFlowDisplay(display);
  return node.layout.isFlexContainer || node.layout.isGridContainer;
}

export interface OverviewPrimitiveReparentArgs {
  activeFileId?: string | null;
  activeBreakpointWidthState?: number;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyFileContentUpdateResult;
  boardFileId: string | undefined;
  canEditDesign: boolean;
  getScreenContent: (screenId: string) => string;
  overviewScreens?: readonly OverviewScreen[];
  overviewSelectedScreenIds?: string[];
  contentHistorySelectionAfterRef?: RefObject<ContentHistorySelectionAfterMap>;
  contentUndoStackRef?: RefObject<ContentHistoryEntry[]>;
  recordContentHistoryEntry: (entry: ContentHistoryEntry) => void;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runOverviewPrimitiveReparent(
  {
    activeFileId,
    activeBreakpointWidthState,
    applyFileContentUpdate,
    boardFileId,
    canEditDesign,
    getScreenContent,
    overviewScreens,
    overviewSelectedScreenIds,
    contentHistorySelectionAfterRef,
    contentUndoStackRef,
    recordContentHistoryEntry,
    setSelectedElement,
    setSelectedLayerIdsState,
    t,
  }: OverviewPrimitiveReparentArgs,
  {
    sourceNodeId,
    sourceScreenId,
    targetNodeId,
    targetScreenId,
    targetIdentity,
    preparedTargetNodeId,
    placement = "inside",
  }: {
    sourceNodeId: string;
    sourceScreenId: string;
    targetNodeId: string;
    targetScreenId: string;
    targetIdentity?: ScreenProjectionNodeIdentity;
    preparedTargetNodeId?: string;
    placement?: "before" | "after" | "inside";
  },
) {
  if (!canEditDesign) return;

  const destinationSource =
    targetIdentity?.projection.source ??
    ({ kind: "design-file" as const, fileId: targetScreenId } as const);
  if (
    destinationSource.kind !== "design-file" ||
    destinationSource.fileId !== targetScreenId
  ) {
    return;
  }
  const destinationContent = getScreenContent(targetScreenId);
  if (!destinationContent) return;
  let moveDestinationContent = destinationContent;
  let destinationAnchorNodeId = targetNodeId;
  let destinationProjection = buildCodeLayerProjection(destinationContent, {
    source: destinationSource,
  });
  let liveDestinationProjection = destinationProjection;
  let liveDestinationAnchor: CodeLayerNode | undefined;
  if (targetIdentity) {
    const hitTarget = targetIdentity.projection.nodes.find(
      (node) => node.id === targetIdentity.nodeId,
    );
    if (
      targetIdentity.projection.source.kind !== "design-file" ||
      targetIdentity.projection.source.fileId !== targetScreenId ||
      !hitTarget ||
      hitTarget.dataAttributes["data-agent-native-node-id"] !==
        targetIdentity.authoredNodeId ||
      targetIdentity.authoredNodeId !== targetNodeId
    ) {
      return;
    }
    liveDestinationProjection = targetIdentity.projection;
    liveDestinationAnchor = hitTarget;
    const prepared = prepareLayerNodeIdentities({
      content: destinationContent,
      nodes: [hitTarget],
      renderedProjection: targetIdentity.projection,
    });
    const preparedId = prepared.nodeIds.get(hitTarget.id);
    if (
      !preparedId ||
      (preparedTargetNodeId && preparedTargetNodeId !== preparedId)
    ) {
      return;
    }
    moveDestinationContent = prepared.content;
    destinationAnchorNodeId = preparedId;
    destinationProjection = buildCodeLayerProjection(moveDestinationContent, {
      source: destinationSource,
    });
  } else {
    const anchors = destinationProjection.nodes.filter(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === targetNodeId,
    );
    if (anchors.length !== 1) return;
    liveDestinationAnchor = anchors[0];
  }
  const destinationAnchor = destinationProjection.nodes.find(
    (node) =>
      node.dataAttributes["data-agent-native-node-id"] ===
      destinationAnchorNodeId,
  );
  if (!destinationAnchor) return;

  if (sourceScreenId === targetScreenId) {
    const source = destinationSource;
    const moveBaseContent = moveDestinationContent;
    const durableTargetNodeId = destinationAnchorNodeId;
    const baseProjection = destinationProjection;
    const sourceNode = baseProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === sourceNodeId ||
        node.id === sourceNodeId,
    );
    const targetNode = destinationAnchor;
    if (!sourceNode || !targetNode) return;
    const sourceAuthoredNodeId =
      sourceNode.dataAttributes["data-agent-native-node-id"] ?? sourceNodeId;

    const movePatch = applyVisualEdit(
      moveBaseContent,
      {
        kind: "moveNode",
        target: {
          nodeId: sourceAuthoredNodeId,
          ...(sourceNode?.path ? { selector: sourceNode.path } : {}),
        },
        anchor: {
          nodeId: durableTargetNodeId,
          ...(targetNode?.path ? { selector: targetNode.path } : {}),
        },
        placement,
      },
      { source },
    );
    if (movePatch.result.status !== "applied") {
      toast.error(
        codeLayerPatchMessage(
          movePatch.result.message,
          t("designEditor.toasts.layerMoveFailed"),
        ),
        { duration: 4000 },
      );
      return;
    }

    const movedNodeAttrId =
      movePatch.projection.nodes.find(
        (n) =>
          n.dataAttributes["data-agent-native-node-id"] ===
            sourceAuthoredNodeId || n.id === sourceNodeId,
      )?.dataAttributes["data-agent-native-node-id"] ?? sourceNodeId;

    if (placement !== "inside") {
      const flowContent = removeAbsolutePositioningFromNodeInHtml(
        movePatch.content,
        movedNodeAttrId,
      );
      const publication = applyFileContentUpdate(sourceScreenId, flowContent, {
        skipPreview: true,
      });
      if (publication.status !== "accepted") return;
      const nextProjection = buildCodeLayerProjection(flowContent, { source });
      const movedNodeCandidate = nextProjection.nodes.find(
        (n) =>
          n.dataAttributes["data-agent-native-node-id"] === sourceNodeId ||
          n.id === sourceNodeId,
      );
      const movedNodeAfter = mapAcceptedSelectionNode(
        publication,
        projectAcceptedSource(publication, source),
        movedNodeCandidate,
      );
      if (movedNodeAfter) {
        setSelectedLayerIdsState([movedNodeAfter.id]);
        setSelectedElement(elementInfoFromCodeLayerNode(movedNodeAfter));
      }
      return;
    }

    const sourcePosition = getAbsolutePositioningForNodeInHtml(
      moveBaseContent,
      sourceAuthoredNodeId,
    );
    const targetPosition = getAbsolutePositioningForNodeInHtml(
      moveBaseContent,
      durableTargetNodeId,
    );
    const rebasedContent =
      sourcePosition && targetPosition
        ? setAbsolutePositioningForNodeInHtml(
            movePatch.content,
            movedNodeAttrId,
            computeReparentedChildPosition(sourcePosition, targetPosition),
          )
        : movePatch.content;
    const nextContent = (() => {
      if (!boardFileId || sourceScreenId !== boardFileId) {
        return rebasedContent;
      }
      const normalized = normalizePoisonedBoardNestedCoords(rebasedContent);
      warnIfPoisonedBoardCoordsNormalized(sourceScreenId, normalized);
      return normalized.html;
    })();

    const publication = applyFileContentUpdate(sourceScreenId, nextContent, {
      skipPreview: true,
    });
    if (publication.status !== "accepted") return;

    const nextProjection = buildCodeLayerProjection(nextContent, { source });
    const movedNodeCandidate = nextProjection.nodes.find(
      (n) =>
        n.dataAttributes["data-agent-native-node-id"] === sourceNodeId ||
        n.id === sourceNodeId,
    );
    const movedNodeAfter = mapAcceptedSelectionNode(
      publication,
      projectAcceptedSource(publication, source),
      movedNodeCandidate,
    );
    if (movedNodeAfter) {
      setSelectedLayerIdsState([movedNodeAfter.id]);
      setSelectedElement(elementInfoFromCodeLayerNode(movedNodeAfter));
    }
    return;
  }

  const sourceContent = getScreenContent(sourceScreenId);
  if (!sourceContent) return;

  const sourceProjection = buildCodeLayerProjection(sourceContent, {
    source: { kind: "design-file", fileId: sourceScreenId },
  });
  const destContent = destinationContent;
  const moveDestContent = moveDestinationContent;
  const anchorAttrId = destinationAnchorNodeId;
  const sourceNode = sourceProjection.nodes.find(
    (n) =>
      n.dataAttributes["data-agent-native-node-id"] === sourceNodeId ||
      n.id === sourceNodeId,
  );
  const anchorNode = destinationAnchor;
  if (!sourceNode || !anchorNode || !liveDestinationAnchor) return;
  const liveLayout = readLiveLayerMoveLayout({
    activeBreakpointWidthState,
    activeFileId: targetScreenId,
    boardFileId,
    destination: {
      fileId: targetScreenId,
      node: liveDestinationAnchor,
      projection: liveDestinationProjection,
    },
    overviewScreens,
    placement,
    source: {
      fileId: sourceScreenId,
      node: sourceNode,
      projection: sourceProjection,
    },
  });
  if (liveLayout.status === "stale") {
    toast.error(t("designEditor.toasts.layerMoveFailed"), {
      duration: 4000,
    });
    return;
  }
  const destinationIsFlow =
    liveLayout.status === "resolved"
      ? isFlowDisplay(liveLayout.destinationDisplay)
      : isFlowContainerNode(
          placement === "inside"
            ? liveDestinationAnchor
            : liveDestinationProjection.nodes.find(
                (node) => node.id === liveDestinationAnchor.parentId,
              ),
        );
  const sourcePosition = sourceNode.style.position?.toLowerCase();
  const sourceIsOutOfFlow =
    liveLayout.status === "resolved"
      ? liveLayout.sourcePosition === "absolute" ||
        liveLayout.sourcePosition === "fixed"
      : sourcePosition
        ? sourcePosition === "absolute" || sourcePosition === "fixed"
        : sourceNode.classes.some((token) => {
            const parts = token.split(":");
            const utility = parts[parts.length - 1]?.replace(/^!/, "");
            return utility === "absolute" || utility === "fixed";
          });
  const sourceParentNode = sourceNode.parentId
    ? sourceProjection.nodes.find((node) => node.id === sourceNode.parentId)
    : undefined;
  const sourceParentIsFlow =
    liveLayout.status === "resolved"
      ? isFlowDisplay(liveLayout.sourceParentDisplay)
      : sourceParentNode
        ? isFlowContainerNode(sourceParentNode)
        : isFlowDisplay(sourceNode.layout.parentDisplay);
  const sourceWasIgnoredInFlow = sourceIsOutOfFlow && sourceParentIsFlow;
  const nodeAttrId =
    sourceNode?.dataAttributes["data-agent-native-node-id"] ?? sourceNodeId;
  const result = moveNodeBetweenDocuments(sourceContent, moveDestContent, {
    nodeId: nodeAttrId,
    ...(sourceNode?.path ? { sourceSelector: sourceNode.path } : {}),
    anchorNodeId: anchorAttrId,
    ...(anchorNode?.path ? { anchorSelector: anchorNode.path } : {}),
    placement,
    moveLayout:
      liveLayout.status === "resolved"
        ? {
            destinationIsFlow,
            sourceWasIgnoredInFlow,
            forceRootIntoFlow:
              destinationIsFlow && sourceIsOutOfFlow && !sourceWasIgnoredInFlow,
          }
        : undefined,
  });
  if (result.status !== "applied") {
    toast.error(
      codeLayerPatchMessage(
        result.message,
        t("designEditor.toasts.layerMoveFailed"),
      ),
      { duration: 4000 },
    );
    return;
  }
  if (result.anchorRedirected) {
    toast(t("designEditor.toasts.layerMoveRedirected"), {
      duration: 4000,
    });
  }

  const destNodeAttrId = result.movedNodeId ?? nodeAttrId;
  const nextDestContent = (() => {
    const rebasedDestContent = (() => {
      const preserveAbsolute =
        sourceIsOutOfFlow && (!destinationIsFlow || sourceWasIgnoredInFlow);
      if (!preserveAbsolute) return result.destHtml;
      const destinationParentNodeId =
        placement === "inside"
          ? liveDestinationAnchor.id
          : liveDestinationAnchor.parentId;
      const destinationParent = destinationParentNodeId
        ? liveDestinationProjection.nodes.find(
            (node) => node.id === destinationParentNodeId,
          )
        : undefined;
      const destinationParentAttrId =
        destinationParent?.dataAttributes["data-agent-native-node-id"];
      if (!destinationParentAttrId) return result.destHtml;
      const sourcePosition = getAbsolutePositioningForNodeInHtml(
        sourceContent,
        nodeAttrId,
      );
      const targetPosition = getAbsolutePositioningForNodeInHtml(
        moveDestContent,
        destinationParentAttrId,
      );
      return sourcePosition && targetPosition
        ? setAbsolutePositioningForNodeInHtml(
            result.destHtml,
            destNodeAttrId,
            computeReparentedChildPosition(sourcePosition, targetPosition),
          )
        : result.destHtml;
    })();
    if (!boardFileId || targetScreenId !== boardFileId) {
      return rebasedDestContent;
    }
    const normalized = normalizePoisonedBoardNestedCoords(rebasedDestContent);
    warnIfPoisonedBoardCoordsNormalized(targetScreenId, normalized);
    return normalized.html;
  })();

  const contentUndoStackTopBeforeReparent = contentUndoStackRef
    ? captureContentUndoStackTop(contentUndoStackRef.current)
    : undefined;
  try {
    prepareAcceptedSourceContent(result.sourceHtml, {
      fileId: sourceScreenId,
      previousContent: sourceContent,
    });
    prepareAcceptedSourceContent(nextDestContent, {
      fileId: targetScreenId,
      previousContent: destContent,
    });
  } catch {
    toast.error(t("designEditor.toasts.layerMoveFailed"), {
      duration: 4000,
    });
    return;
  }

  const reparentHistoryChanges = [
    {
      fileId: sourceScreenId,
      before: sourceContent,
      after: result.sourceHtml,
    },
    {
      fileId: targetScreenId,
      before: destContent,
      after: nextDestContent,
    },
  ];
  recordContentHistoryEntry({ changes: reparentHistoryChanges });

  const sourcePublication = applyFileContentUpdate(
    sourceScreenId,
    result.sourceHtml,
    {
      recordHistory: false,
      historyBeforeContent: sourceContent,
      refreshPreview: false,
      forcePreviewFullDocument: true,
    },
  );
  const targetPublication = applyFileContentUpdate(
    targetScreenId,
    nextDestContent,
    {
      recordHistory: false,
      historyBeforeContent: destContent,
      refreshPreview: false,
      forcePreviewFullDocument: true,
    },
  );
  if (
    sourcePublication.status !== "accepted" ||
    targetPublication.status !== "accepted"
  ) {
    return;
  }
  reparentHistoryChanges[0].after = sourcePublication.content;
  reparentHistoryChanges[1].after = targetPublication.content;

  const submittedProjection = buildCodeLayerProjection(nextDestContent, {
    source: { kind: "design-file", fileId: targetScreenId },
  });
  const movedNodeCandidate = submittedProjection.nodes.find(
    (n) => n.dataAttributes["data-agent-native-node-id"] === destNodeAttrId,
  );
  const movedNodeFinal = mapAcceptedSelectionNode(
    targetPublication,
    projectAcceptedSource(targetPublication, {
      kind: "design-file",
      fileId: targetScreenId,
    }),
    movedNodeCandidate,
  );
  if (movedNodeFinal) {
    setSelectedLayerIdsState([movedNodeFinal.id]);
    setSelectedElement(elementInfoFromCodeLayerNode(movedNodeFinal));
    if (contentUndoStackRef && contentHistorySelectionAfterRef) {
      stampContentHistorySelectionAfter(
        contentUndoStackRef.current,
        contentHistorySelectionAfterRef.current,
        contentUndoStackTopBeforeReparent,
        {
          activeFileId: activeFileId ?? null,
          overviewSelectedScreenIds: overviewSelectedScreenIds ?? [],
          selectedLayerIds: [movedNodeFinal.id],
        },
      );
    }
  }
}
