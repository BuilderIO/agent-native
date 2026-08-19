import { computeReparentedChildPosition } from "@shared/board-file";
import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
  moveNodeBetweenDocuments,
} from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { LayersPanelMoveIntent } from "@/components/design/LayersPanel";
import type {
  ElementInfo,
  RuntimeStructureMoveRequest,
} from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import type { EffectiveCodeLayerState } from "@/pages/design-editor/code-layer-state";
import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerPatchMessage,
  collectCodeLayerAncestors,
  elementInfoFromCodeLayerNode,
  findMovedCodeLayerNodeInProjection,
  removeEmptyGeneratedGroupWrappers,
} from "@/pages/design-editor/code-layer-state";
import {
  getLayerMoveIterationOrder,
  getLayerMoveSourceContent,
} from "@/pages/design-editor/editor-state";
import type {
  ContentHistoryChange,
  ContentHistoryEntry,
} from "@/pages/design-editor/history";
import {
  getAbsolutePositioningForNodeInHtml,
  setAbsolutePositioningForNodeInHtml,
} from "@/pages/design-editor/html-layer-positioning";
import { resolveRuntimeStructureMoveExecutionMode } from "@/pages/design-editor/react-semantic-handoff";
import type { DesignFile } from "@/pages/design-editor/types";

export interface LayerMoveArgs {
  activeFile: DesignFile;
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
  canEditDesign: boolean;
  canMoveLayer: (intent: LayersPanelMoveIntent) => boolean;
  codeLayerOwnerByNodeId: Map<
    string,
    {
      fileId: string;
      node: CodeLayerNode;
      tree: CodeLayerTreeNode[];
      runtimeOnly: boolean;
    }
  >;
  effectiveCodeLayerState: EffectiveCodeLayerState;
  files: DesignFile[];
  getFreshActiveContent: () => string;
  handleLayerMoveToScreen: (
    intent: LayersPanelMoveIntent,
    targetFileId: string,
  ) => void;
  handleScreenLayerMove: (intent: LayersPanelMoveIntent) => void;
  recordContentHistoryEntry: (entry: ContentHistoryEntry) => void;
  recordLocalContentHistoryEntry: (change: ContentHistoryChange) => void;
  runtimeStructureMoveRevisionRef: RefObject<number>;
  sendRuntimeLayerMoveSemanticHandoff: (
    subjectLayerId: string,
    targetLayerId: string,
    placement: "before" | "after" | "inside",
  ) => boolean;
  setExpandedLayerIds: Dispatch<SetStateAction<string[]>>;
  setRuntimeStructureMoveRequest: Dispatch<
    SetStateAction<(RuntimeStructureMoveRequest & { screenId: string }) | null>
  >;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
  visualScreenFileIds: Set<string>;
}

export function runLayerMove(
  {
    activeFile,
    applyFileContentUpdate,
    canEditDesign,
    canMoveLayer,
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    files,
    getFreshActiveContent,
    handleLayerMoveToScreen,
    handleScreenLayerMove,
    recordContentHistoryEntry,
    recordLocalContentHistoryEntry,
    runtimeStructureMoveRevisionRef,
    sendRuntimeLayerMoveSemanticHandoff,
    setExpandedLayerIds,
    setRuntimeStructureMoveRequest,
    setSelectedElement,
    setSelectedLayerIdsState,
    t,
    viewModeRef,
    visualScreenFileIds,
  }: LayerMoveArgs,
  intent: LayersPanelMoveIntent,
) {
  if (!canEditDesign) return;
  if (!canMoveLayer(intent)) return;
  if (
    intent.draggedIds.length > 0 &&
    intent.draggedIds.every((draggedId) => visualScreenFileIds.has(draggedId))
  ) {
    handleScreenLayerMove(intent);
    return;
  }
  const targetOwner = codeLayerOwnerByNodeId.get(intent.targetId);
  if (!targetOwner) {
    const targetFile = files.find((file) => file.id === intent.targetId);
    if (targetFile) {
      handleLayerMoveToScreen(intent, targetFile.id);
    }
    return;
  }
  const runtimeDraggedOwner =
    intent.draggedIds.length === 1
      ? codeLayerOwnerByNodeId.get(intent.draggedIds[0]!)
      : undefined;
  if (targetOwner.runtimeOnly || runtimeDraggedOwner?.runtimeOnly) {
    if (!runtimeDraggedOwner) {
      return;
    }
    const executionMode = resolveRuntimeStructureMoveExecutionMode({
      subjectRuntimeOnly: runtimeDraggedOwner.runtimeOnly,
      targetRuntimeOnly: targetOwner.runtimeOnly,
      sourceScreenId: runtimeDraggedOwner.fileId,
      targetScreenId: targetOwner.fileId,
    });
    if (executionMode === "screen-bridge") {
      // Keep the existing fast, optimistic in-iframe path when one
      // screen-scoped bridge owns both runtime endpoints. Cross-screen or
      // mixed runtime/source ownership cannot be represented by that
      // one-screen StructureMove message and must go through the semantic
      // coding-agent handoff below.
      runtimeStructureMoveRevisionRef.current += 1;
      setRuntimeStructureMoveRequest({
        requestId: runtimeStructureMoveRevisionRef.current,
        screenId: targetOwner.fileId,
        subject: {
          selector: runtimeDraggedOwner.node.selector,
          sourceId: bridgeSourceIdForCodeLayerNode(runtimeDraggedOwner.node),
        },
        anchor: {
          selector: targetOwner.node.selector,
          sourceId: bridgeSourceIdForCodeLayerNode(targetOwner.node),
        },
        placement: intent.placement,
      });
      return;
    }
    sendRuntimeLayerMoveSemanticHandoff(
      intent.draggedIds[0]!,
      intent.targetId,
      intent.placement,
    );
    return;
  }
  // L8: locked/hidden is no longer a blocker for using this row as a drop
  // anchor (see canMoveLayer) — only dragging a LOCKED row is blocked,
  // checked per-draggedId below. Hidden rows are draggable.
  const freshActiveContent = getFreshActiveContent();
  const destFile = files.find((file) => file.id === targetOwner.fileId);
  const destContent =
    targetOwner.fileId === activeFile?.id
      ? freshActiveContent
      : (destFile?.content ?? "");
  if (!destContent) return;

  // L17: a single ordered insert pipeline for a MIXED same-file/cross-file
  // multi-drag. Previously same-file drags were all applied as one batch
  // (each inserted at the shared anchor), THEN cross-file drags were
  // applied as a second batch — so a selection like [same-file A,
  // cross-file B, same-file C] (in panel-visual order) would always end
  // up as A,C,B relative to the anchor instead of preserving A,B,C,
  // because the two source kinds never interleaved against one another.
  // Fix: classify each dragged id but keep ONE combined list in the
  // original intent.draggedIds order (already translated from panel order
  // into DOM order at the LayersPanel callback boundary), then iterate
  // that single list once, dispatching each item through the same-file or
  // cross-file primitive against the shared running nextDestContent /
  // sourceContentMap state so mixed sequences interleave in the intended
  // order.
  const movedNodeSnapshots = new Map<string, CodeLayerNode>();
  type ClassifiedDrag =
    | { draggedId: string; kind: "same-file" }
    | { draggedId: string; kind: "cross-file"; sourceFileId: string };
  const classifiedDrags: ClassifiedDrag[] = [];
  for (const draggedId of intent.draggedIds) {
    const draggedOwner = codeLayerOwnerByNodeId.get(draggedId);
    if (
      draggedId === intent.targetId ||
      !draggedOwner ||
      // L8: only LOCKED dragged rows are blocked; hidden rows may be
      // dragged/reordered like any other layer.
      effectiveCodeLayerState.lockedIds.has(draggedId)
    ) {
      continue;
    }
    // L15: mirror canMoveLayer's per-drag ancestor-of-target guard here.
    // canMoveLayer only gates the whole intent (true if ANY dragged id is
    // valid), so a mixed multi-drag where one id is an ancestor of the
    // drop target would otherwise reach applyVisualEdit/moveNode for that
    // id, which always reports "conflict" (the anchor is inside the
    // dragged element) — a spurious per-id failure toast for a case we
    // can just silently skip, exactly like the other guards above.
    if (
      draggedOwner.fileId === targetOwner.fileId &&
      collectCodeLayerAncestors(targetOwner.tree, intent.targetId).includes(
        draggedId,
      )
    ) {
      continue;
    }
    movedNodeSnapshots.set(draggedId, draggedOwner.node);
    if (draggedOwner.fileId === targetOwner.fileId) {
      classifiedDrags.push({ draggedId, kind: "same-file" });
    } else {
      classifiedDrags.push({
        draggedId,
        kind: "cross-file",
        sourceFileId: draggedOwner.fileId,
      });
    }
  }

  const movedIdOrder = classifiedDrags.map((drag) => drag.draggedId);

  // L25: track each dragged node's former parent (by fileId + stable
  // data-agent-native-node-id), so that once every move in this intent
  // is applied we can sweep each touched file for now-empty generated
  // "Group" wrappers left behind by the move.
  const formerParentAttrIdsByFileId = new Map<string, Set<string>>();
  for (const drag of classifiedDrags) {
    const draggedOwner = codeLayerOwnerByNodeId.get(drag.draggedId);
    const parentId = draggedOwner?.node.parentId;
    if (!parentId) continue;
    const parentAttrId =
      codeLayerOwnerByNodeId.get(parentId)?.node.dataAttributes[
        "data-agent-native-node-id"
      ];
    if (!parentAttrId) continue;
    const fileId = draggedOwner.fileId;
    const set = formerParentAttrIdsByFileId.get(fileId) ?? new Set<string>();
    set.add(parentAttrId);
    formerParentAttrIdsByFileId.set(fileId, set);
  }

  let nextDestContent = destContent;
  let moved = false;
  const sourceContentMap = new Map<string, string>();
  const sourceOriginalContentMap = new Map<string, string>();
  const movedNodeIdByDraggedId = new Map<string, string>();

  for (const drag of getLayerMoveIterationOrder(
    classifiedDrags,
    intent.placement,
  )) {
    const { draggedId } = drag;
    if (drag.kind === "same-file") {
      const draggedOwner = codeLayerOwnerByNodeId.get(draggedId);
      // L2: a panel drop can reparent the node onto a different container
      // (not just reorder among the same siblings) — e.g. dropping
      // "inside" a different frame, or "before"/"after" an anchor that
      // lives under a different parent than the dragged node's current
      // one. The overview canvas reparent path
      // (handleOverviewPrimitiveReparent) already rebases absolute
      // left/top in that case so the element keeps its visual position
      // instead of teleporting to (0,0)-relative-to-new-parent; mirror
      // that here for the panel/tree move path.
      const targetOwnerNode = codeLayerOwnerByNodeId.get(intent.targetId);
      const newParentAttrId =
        intent.placement === "inside"
          ? intent.targetId
          : (targetOwnerNode?.node.parentId ?? null);
      const isCrossParent = Boolean(
        draggedOwner &&
        newParentAttrId &&
        draggedOwner.node.parentId !== newParentAttrId,
      );
      const prevContentForRebase = nextDestContent;
      const patch = applyVisualEdit(nextDestContent, {
        kind: "moveNode",
        target: { nodeId: draggedId },
        anchor: { nodeId: intent.targetId },
        placement: intent.placement,
      });
      if (patch.result.status !== "applied") {
        toast.error(
          codeLayerPatchMessage(
            patch.result.message,
            t("designEditor.toasts.layerMoveFailed"),
          ),
          { duration: 4000 },
        );
        continue;
      }
      nextDestContent = patch.content;
      if (isCrossParent && newParentAttrId) {
        const movedNodeAttrId =
          patch.projection.nodes.find(
            (n) =>
              n.dataAttributes["data-agent-native-node-id"] === draggedId ||
              n.id === draggedId,
          )?.dataAttributes["data-agent-native-node-id"] ?? draggedId;
        const sourcePosition = getAbsolutePositioningForNodeInHtml(
          prevContentForRebase,
          draggedId,
        );
        const targetPosition = getAbsolutePositioningForNodeInHtml(
          prevContentForRebase,
          newParentAttrId,
        );
        if (sourcePosition && targetPosition) {
          // Same parent-relative rebase as the canvas reparent path —
          // computeReparentedChildPosition also strips the historic
          // board-surface offset poison (65536-multiples) from either
          // side so a panel move of a poisoned nested board child heals
          // its coordinates instead of preserving them.
          nextDestContent = setAbsolutePositioningForNodeInHtml(
            nextDestContent,
            movedNodeAttrId,
            computeReparentedChildPosition(sourcePosition, targetPosition),
          );
        }
      }
      moved = true;
    } else {
      const { sourceFileId } = drag;
      const srcFile = files.find((f) => f.id === sourceFileId);
      if (!srcFile) continue;
      const currentSourceContent = getLayerMoveSourceContent({
        sourceFileId,
        activeFileId: activeFile?.id,
        activeContent: freshActiveContent,
        sourceFileContent: srcFile.content,
        sourceContentMap,
      });
      if (!sourceOriginalContentMap.has(sourceFileId)) {
        sourceOriginalContentMap.set(sourceFileId, currentSourceContent);
      }

      // The dragged node's data-agent-native-node-id is the node id
      // tracked by code-layer. Look up the actual attribute value from
      // the owner.
      const draggedOwner = codeLayerOwnerByNodeId.get(draggedId);
      const nodeAttrId =
        draggedOwner?.node.dataAttributes["data-agent-native-node-id"] ??
        draggedId;
      const anchorAttrId =
        codeLayerOwnerByNodeId.get(intent.targetId)?.node.dataAttributes[
          "data-agent-native-node-id"
        ] ?? intent.targetId;

      const result = moveNodeBetweenDocuments(
        currentSourceContent,
        nextDestContent,
        {
          nodeId: nodeAttrId,
          anchorNodeId: anchorAttrId,
          placement: intent.placement,
        },
      );
      if (result.status !== "applied") {
        toast.error(
          codeLayerPatchMessage(
            result.message,
            t("designEditor.toasts.layerMoveFailed"),
          ),
          { duration: 4000 },
        );
        continue;
      }
      sourceContentMap.set(sourceFileId, result.sourceHtml);
      nextDestContent = result.destHtml;
      movedNodeIdByDraggedId.set(draggedId, result.movedNodeId ?? nodeAttrId);
      moved = true;
    }
  }

  if (!moved) return;

  // L25: sweep every touched file for now-empty generated "Group"
  // wrappers left behind once their last child moved away, and remove
  // them. Applied per-file against whichever content variable currently
  // holds that file's post-move state.
  for (const [fileId, parentAttrIds] of formerParentAttrIdsByFileId) {
    if (fileId === targetOwner.fileId) {
      nextDestContent = removeEmptyGeneratedGroupWrappers(
        nextDestContent,
        parentAttrIds,
      );
    } else if (sourceContentMap.has(fileId)) {
      sourceContentMap.set(
        fileId,
        removeEmptyGeneratedGroupWrappers(
          sourceContentMap.get(fileId)!,
          parentAttrIds,
        ),
      );
    }
  }

  const finalDestProjection =
    nextDestContent !== destContent
      ? buildCodeLayerProjection(nextDestContent)
      : null;
  const finalDestTree = finalDestProjection
    ? buildCodeLayerTree(finalDestProjection)
    : [];
  const movedNodesAfterMove = movedIdOrder
    .map((draggedId) => {
      const node = movedNodeSnapshots.get(draggedId);
      return node && finalDestProjection
        ? findMovedCodeLayerNodeInProjection(
            finalDestProjection,
            node,
            movedNodeIdByDraggedId.get(draggedId),
          )
        : null;
    })
    .filter((node): node is CodeLayerNode => Boolean(node));

  if (movedNodesAfterMove.length > 0) {
    setSelectedLayerIdsState(movedNodesAfterMove.map((node) => node.id));
    const lastMovedNode = movedNodesAfterMove[movedNodesAfterMove.length - 1];
    if (lastMovedNode && targetOwner.fileId === activeFile?.id) {
      setSelectedElement(elementInfoFromCodeLayerNode(lastMovedNode));
    }
    const movedAncestorIds = movedNodesAfterMove.flatMap((node) =>
      collectCodeLayerAncestors(finalDestTree, node.id),
    );
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      next.add(targetOwner.fileId);
      movedAncestorIds.forEach((ancestorId) => next.add(ancestorId));
      return next.size === current.length ? current : Array.from(next);
    });
  }

  const hasCrossFileMoves = sourceContentMap.size > 0;
  if (hasCrossFileMoves) {
    const crossFileChanges = [
      ...Array.from(sourceContentMap.entries()).map(
        ([sourceFileId, newSourceContent]) => ({
          fileId: sourceFileId,
          before:
            sourceOriginalContentMap.get(sourceFileId) ??
            files.find((file) => file.id === sourceFileId)?.content ??
            "",
          after: newSourceContent,
        }),
      ),
      ...(nextDestContent !== destContent
        ? [
            {
              fileId: targetOwner.fileId,
              before: destContent,
              after: nextDestContent,
            },
          ]
        : []),
    ];
    // recordContentHistoryEntry writes to the overview-only global stack
    // and (when the change touches the active file) clears the live
    // single-mode Yjs undo stack as a side effect. Outside overview mode
    // that stack is never consulted by handleUndo, so a cross-file move
    // made while a single screen is focused would both go unrecorded and
    // wipe that screen's undo history (see U5). Record into the local
    // per-file stack instead so single-mode Cmd+Z can reach it.
    if (viewModeRef.current === "overview") {
      recordContentHistoryEntry({ changes: crossFileChanges });
    } else {
      crossFileChanges.forEach((change) =>
        recordLocalContentHistoryEntry(change),
      );
    }
  }

  // Persist source files that changed.
  for (const [sourceFileId, newSourceContent] of sourceContentMap) {
    applyFileContentUpdate(sourceFileId, newSourceContent, {
      recordHistory: !hasCrossFileMoves,
      refreshPreview: false,
    });
  }

  // Persist dest file (which may also be the active file).
  if (nextDestContent !== destContent) {
    applyFileContentUpdate(targetOwner.fileId, nextDestContent, {
      recordHistory: !hasCrossFileMoves,
      refreshPreview: false,
    });
  }
}
