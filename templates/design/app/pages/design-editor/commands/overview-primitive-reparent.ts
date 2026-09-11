import {
  computeReparentedChildPosition,
  normalizePoisonedBoardNestedCoords,
} from "@shared/board-file";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  moveNodeBetweenDocuments,
} from "@shared/code-layer";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  codeLayerPatchMessage,
  elementInfoFromCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";
import type { ContentHistoryEntry } from "@/pages/design-editor/history";
import {
  getAbsolutePositioningForNodeInHtml,
  removeAbsolutePositioningFromNodeInHtml,
  setAbsolutePositioningForNodeInHtml,
  warnIfPoisonedBoardCoordsNormalized,
} from "@/pages/design-editor/html-layer-positioning";

export interface OverviewPrimitiveReparentArgs {
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => void;
  boardFileId: string | undefined;
  canEditDesign: boolean;
  getScreenContent: (screenId: string) => string;
  recordContentHistoryEntry: (entry: ContentHistoryEntry) => void;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runOverviewPrimitiveReparent(
  {
    applyFileContentUpdate,
    boardFileId,
    canEditDesign,
    getScreenContent,
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
    placement = "inside",
  }: {
    sourceNodeId: string;
    sourceScreenId: string;
    targetNodeId: string;
    targetScreenId: string;
    placement?: "before" | "after" | "inside";
  },
) {
  if (!canEditDesign) return;

  if (sourceScreenId === targetScreenId) {
    // --- Same-screen reparent ---
    const baseContent = getScreenContent(sourceScreenId);
    if (!baseContent) return;

    // 1. Move the node relative to the target anchor. For "inside" the
    // anchor is the container itself (append); for "before"/"after" the
    // anchor is a sibling child already inside an auto-layout container
    // (flow-insert at that index) — applyMoveNodeEdit's
    // prepareMovedFragmentForParent already strips absolute positioning
    // from the moved fragment's root when the destination parent is a
    // flow container, regardless of which placement resolved it there.
    const movePatch = applyVisualEdit(baseContent, {
      kind: "moveNode",
      target: { nodeId: sourceNodeId },
      anchor: { nodeId: targetNodeId },
      placement,
    });
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
          n.dataAttributes["data-agent-native-node-id"] === sourceNodeId ||
          n.id === sourceNodeId,
      )?.dataAttributes["data-agent-native-node-id"] ?? sourceNodeId;

    if (placement !== "inside") {
      // Auto-layout flow-insert: belt-and-suspenders alongside
      // prepareMovedFragmentForParent above — make sure the moved node
      // itself carries no leftover position/left/top so it renders as a
      // pure flow child at its new index instead of an absolute layer
      // sitting on top of its new siblings.
      const flowContent = removeAbsolutePositioningFromNodeInHtml(
        movePatch.content,
        movedNodeAttrId,
      );
      applyFileContentUpdate(sourceScreenId, flowContent, {
        skipPreview: true,
      });
      const nextProjection = buildCodeLayerProjection(flowContent);
      const movedNodeAfter = nextProjection.nodes.find(
        (n) =>
          n.dataAttributes["data-agent-native-node-id"] === sourceNodeId ||
          n.id === sourceNodeId,
      );
      if (movedNodeAfter) {
        setSelectedLayerIdsState([movedNodeAfter.id]);
        setSelectedElement(elementInfoFromCodeLayerNode(movedNodeAfter));
      }
      return;
    }

    const sourcePosition = getAbsolutePositioningForNodeInHtml(
      baseContent,
      sourceNodeId,
    );
    const targetPosition = getAbsolutePositioningForNodeInHtml(
      baseContent,
      targetNodeId,
    );
    // Rebase the moved node's left/top to be PARENT-relative.
    // computeReparentedChildPosition strips the board-surface offset
    // (65536-multiples) from either side first, so a source that was
    // persisted in board-iframe viewport coordinates (the historic
    // container-drop poison — see BOARD_SURFACE_CONTENT_OFFSET_PX in
    // shared/board-file.ts) still comes out as a sane parent-relative
    // position instead of an off-world near-65536 value.
    const rebasedContent =
      sourcePosition && targetPosition
        ? setAbsolutePositioningForNodeInHtml(
            movePatch.content,
            movedNodeAttrId,
            computeReparentedChildPosition(sourcePosition, targetPosition),
          )
        : movePatch.content;
    // Board safety net: if any nested coordinate still carries the
    // surface-offset fingerprint (e.g. the position pair above could not
    // be resolved and the rebase was skipped), normalize the final
    // content so a nested board child can never persist off-world.
    const nextContent = (() => {
      if (!boardFileId || sourceScreenId !== boardFileId) {
        return rebasedContent;
      }
      const normalized = normalizePoisonedBoardNestedCoords(rebasedContent);
      warnIfPoisonedBoardCoordsNormalized(sourceScreenId, normalized);
      return normalized.html;
    })();

    applyFileContentUpdate(sourceScreenId, nextContent, {
      skipPreview: true,
    });

    // Re-select the moved node.
    const nextProjection = buildCodeLayerProjection(nextContent);
    const movedNodeAfter = nextProjection.nodes.find(
      (n) =>
        n.dataAttributes["data-agent-native-node-id"] === sourceNodeId ||
        n.id === sourceNodeId,
    );
    if (movedNodeAfter) {
      setSelectedLayerIdsState([movedNodeAfter.id]);
      setSelectedElement(elementInfoFromCodeLayerNode(movedNodeAfter));
    }
    return;
  }

  // --- Cross-screen reparent ---
  const sourceContent = getScreenContent(sourceScreenId);
  const destContent = getScreenContent(targetScreenId);
  if (!sourceContent || !destContent) return;

  // Resolve data-agent-native-node-id attributes for moveNodeBetweenDocuments.
  const sourceProjection = buildCodeLayerProjection(sourceContent);
  const destProjection = buildCodeLayerProjection(destContent);
  const sourceNode = sourceProjection.nodes.find(
    (n) =>
      n.dataAttributes["data-agent-native-node-id"] === sourceNodeId ||
      n.id === sourceNodeId,
  );
  const anchorNode = destProjection.nodes.find(
    (n) =>
      n.dataAttributes["data-agent-native-node-id"] === targetNodeId ||
      n.id === targetNodeId,
  );
  const nodeAttrId =
    sourceNode?.dataAttributes["data-agent-native-node-id"] ?? sourceNodeId;
  const anchorAttrId =
    anchorNode?.dataAttributes["data-agent-native-node-id"] ?? targetNodeId;

  const result = moveNodeBetweenDocuments(sourceContent, destContent, {
    nodeId: nodeAttrId,
    anchorNodeId: anchorAttrId,
    placement,
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
  // Finding 8: the requested anchor placement landed inside a
  // <template> interior and was redirected to a real DOM slot right
  // after the enclosing template instead — let the user know the drop
  // wasn't silently discarded, just relocated nearby.
  if (result.anchorRedirected) {
    toast(t("designEditor.toasts.layerMoveRedirected"), {
      duration: 4000,
    });
  }

  const destNodeAttrId = result.movedNodeId ?? nodeAttrId;
  // "inside" rebases to a parent-relative absolute position (matches the
  // same-screen branch above and historic behavior for dropping onto a
  // plain absolute container). "before"/"after" is an auto-layout
  // flow-insert — moveNodeBetweenDocuments's prepareMovedFragmentForParent
  // already stripped absolute positioning from the moved fragment's
  // root, so just belt-and-suspenders clear it again by node id rather
  // than reintroducing position:absolute via the rebase below.
  const nextDestContent = (() => {
    const rebasedDestContent = (() => {
      if (placement !== "inside") {
        return removeAbsolutePositioningFromNodeInHtml(
          result.destHtml,
          destNodeAttrId,
        );
      }
      const sourcePosition = getAbsolutePositioningForNodeInHtml(
        sourceContent,
        nodeAttrId,
      );
      const targetPosition = getAbsolutePositioningForNodeInHtml(
        destContent,
        anchorAttrId,
      );
      // Same parent-relative rebase + board-poison stripping as the
      // same-screen branch above (see computeReparentedChildPosition).
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

  recordContentHistoryEntry({
    changes: [
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
    ],
  });

  applyFileContentUpdate(sourceScreenId, result.sourceHtml, {
    recordHistory: false,
    refreshPreview: false,
    forcePreviewFullDocument: true,
  });
  applyFileContentUpdate(targetScreenId, nextDestContent, {
    recordHistory: false,
    refreshPreview: false,
    forcePreviewFullDocument: true,
  });

  // Re-select the moved node in the destination.
  const finalProjection = buildCodeLayerProjection(nextDestContent);
  const movedNodeFinal = finalProjection.nodes.find(
    (n) => n.dataAttributes["data-agent-native-node-id"] === destNodeAttrId,
  );
  if (movedNodeFinal) {
    setSelectedLayerIdsState([movedNodeFinal.id]);
    setSelectedElement(elementInfoFromCodeLayerNode(movedNodeFinal));
  }
}
