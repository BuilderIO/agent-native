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
  RuntimeStructureInsertRequest,
} from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import type { EffectiveCodeLayerState } from "@/pages/design-editor/code-layer-state";
import {
  codeLayerPatchMessage,
  elementInfoFromCodeLayerNode,
  findMovedCodeLayerNodeInProjection,
} from "@/pages/design-editor/code-layer-state";
import {
  getLayerMoveSourceContent,
  isStandaloneHttpUrl,
} from "@/pages/design-editor/editor-state";
import type {
  ContentHistoryChange,
  ContentHistoryEntry,
} from "@/pages/design-editor/history";
import { prepareLiveScreenLayerDrop } from "@/pages/design-editor/live-screen-layer-drop";
import type { DesignFile } from "@/pages/design-editor/types";

export interface LayerMoveToScreenArgs {
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
  boardFileId: string | undefined;
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
  recordContentHistoryEntry: (entry: ContentHistoryEntry) => void;
  recordLocalContentHistoryEntry: (change: ContentHistoryChange) => void;
  runtimeStructureInsertRevisionRef: RefObject<number>;
  setExpandedLayerIds: Dispatch<SetStateAction<string[]>>;
  setRuntimeStructureInsertRequest: Dispatch<
    SetStateAction<
      (RuntimeStructureInsertRequest & { screenId: string }) | null
    >
  >;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runLayerMoveToScreen(
  {
    activeFile,
    applyFileContentUpdate,
    boardFileId,
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    files,
    getFreshActiveContent,
    recordContentHistoryEntry,
    recordLocalContentHistoryEntry,
    runtimeStructureInsertRevisionRef,
    setExpandedLayerIds,
    setRuntimeStructureInsertRequest,
    setSelectedElement,
    setSelectedLayerIdsState,
    t,
    viewModeRef,
  }: LayerMoveToScreenArgs,
  intent: LayersPanelMoveIntent,
  targetFileId: string,
) {
  const freshActiveContent = getFreshActiveContent();
  const destFile = files.find((file) => file.id === targetFileId);
  const destContent =
    targetFileId === activeFile?.id
      ? freshActiveContent
      : (destFile?.content ?? "");
  if (!destContent) return;

  if (isStandaloneHttpUrl(destContent)) {
    // A localhost screen row represents the live iframe's body, while its
    // stored content remains the route URL. Layers-panel drops from the
    // board therefore use the same runtime insert lifecycle as canvas
    // drops: serialize the complete subtree, insert optimistically in the
    // iframe, and let the bridge echo create the pending source handoff.
    // Keep the board copy until Apply for the same undo/data-loss reason
    // documented in handleCrossScreenElementDrop.
    if (intent.draggedIds.length !== 1) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    const draggedId = intent.draggedIds[0]!;
    const draggedOwner = codeLayerOwnerByNodeId.get(draggedId);
    if (
      !draggedOwner ||
      effectiveCodeLayerState.lockedIds.has(draggedId) ||
      !boardFileId ||
      draggedOwner.fileId !== boardFileId
    ) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    const sourceFile = files.find((file) => file.id === draggedOwner.fileId);
    const sourceContent = getLayerMoveSourceContent({
      sourceFileId: draggedOwner.fileId,
      activeFileId: activeFile?.id,
      activeContent: freshActiveContent,
      sourceFileContent: sourceFile?.content,
      sourceContentMap: new Map(),
    });
    const nodeId =
      draggedOwner.node.dataAttributes["data-agent-native-node-id"] ??
      draggedId;
    const prepared = prepareLiveScreenLayerDrop({
      sourceContent,
      destinationContent: destContent,
      nodeId,
    });
    if (prepared.status !== "applied") {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    runtimeStructureInsertRevisionRef.current += 1;
    setRuntimeStructureInsertRequest({
      requestId: runtimeStructureInsertRevisionRef.current,
      screenId: targetFileId,
      html: prepared.html,
      anchor: { selector: "body" },
      placement: "inside",
    });
    return;
  }

  let nextDestContent = destContent;
  const sourceContentMap = new Map<string, string>();
  const sourceOriginalContentMap = new Map<string, string>();
  const movedNodeSnapshots = new Map<string, CodeLayerNode>();
  const movedNodeIdByDraggedId = new Map<string, string>();
  let moved = false;

  for (const draggedId of intent.draggedIds) {
    const draggedOwner = codeLayerOwnerByNodeId.get(draggedId);
    if (!draggedOwner || effectiveCodeLayerState.lockedIds.has(draggedId)) {
      continue;
    }
    movedNodeSnapshots.set(draggedId, draggedOwner.node);
    const nodeAttrId =
      draggedOwner.node.dataAttributes["data-agent-native-node-id"] ??
      draggedId;

    if (draggedOwner.fileId === targetFileId) {
      // Already in this screen — move to the end of <body> (topmost
      // paint / top of the panel's top-level list) via moveNode with no
      // anchor needed: reuse moveNodeBetweenDocuments's own-document
      // append behavior by routing it through itself (source === dest)
      // isn't safe (it would duplicate the node), so instead resolve the
      // body element directly via applyVisualEdit's moveNode against the
      // document's own root container element by falling back to the
      // existing tree ordering: append after the current last top-level
      // sibling in this screen. When there's no other top-level sibling
      // to anchor on, the node is already effectively at the root and
      // there's nothing to do.
      const tree = buildCodeLayerTree(
        buildCodeLayerProjection(nextDestContent),
      );
      const lastRootId = tree[tree.length - 1]?.id;
      if (!lastRootId || lastRootId === draggedId) continue;
      const patch = applyVisualEdit(nextDestContent, {
        kind: "moveNode",
        target: { nodeId: draggedId },
        anchor: { nodeId: lastRootId },
        placement: "after",
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
      moved = true;
      continue;
    }

    // Cross-file: append into the target screen's body (no anchor ==
    // moveNodeBetweenDocuments's own default append-to-body behavior).
    const sourceFileId = draggedOwner.fileId;
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
    const result = moveNodeBetweenDocuments(
      currentSourceContent,
      nextDestContent,
      { nodeId: nodeAttrId, placement: "inside" },
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

  if (!moved) return;

  const finalDestProjection = buildCodeLayerProjection(nextDestContent);
  const movedNodesAfterMove = intent.draggedIds
    .map((draggedId) => {
      const node = movedNodeSnapshots.get(draggedId);
      return node
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
    if (lastMovedNode && targetFileId === activeFile?.id) {
      setSelectedElement(elementInfoFromCodeLayerNode(lastMovedNode));
    }
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      next.add(targetFileId);
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
              fileId: targetFileId,
              before: destContent,
              after: nextDestContent,
            },
          ]
        : []),
    ];
    if (viewModeRef.current === "overview") {
      recordContentHistoryEntry({ changes: crossFileChanges });
    } else {
      crossFileChanges.forEach((change) =>
        recordLocalContentHistoryEntry(change),
      );
    }
  }

  for (const [sourceFileId, newSourceContent] of sourceContentMap) {
    applyFileContentUpdate(sourceFileId, newSourceContent, {
      recordHistory: !hasCrossFileMoves,
      refreshPreview: false,
    });
  }
  if (nextDestContent !== destContent) {
    applyFileContentUpdate(targetFileId, nextDestContent, {
      recordHistory: !hasCrossFileMoves,
      refreshPreview: false,
    });
  }
}
