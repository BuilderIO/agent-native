import type {
  CodeLayerNode,
  CodeLayerProjection,
  CodeLayerTreeNode,
} from "@shared/code-layer";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
  moveNodeBetweenDocuments,
} from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import { isShaderWriteInFlight } from "@/components/design/inspector/GlslShaderPanel";
import type { LayersPanelMoveIntent } from "@/components/design/LayersPanel";
import type {
  ElementInfo,
  RuntimeStructureInsertRequest,
} from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import type { EffectiveCodeLayerState } from "@/pages/design-editor/code-layer-state";
import {
  codeLayerPatchMessage,
  collectCodeLayerAncestors,
  elementInfoFromCodeLayerNode,
  findMovedCodeLayerNodeInProjection,
} from "@/pages/design-editor/code-layer-state";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  getLayerMoveSourceContent,
  isStandaloneHttpUrl,
} from "@/pages/design-editor/editor-state";
import type {
  ContentHistoryChange,
  ContentHistoryEntry,
  ContentHistorySelectionAfterMap,
} from "@/pages/design-editor/history";
import {
  captureContentUndoStackTop,
  getContentHistoryChanges,
  stampContentHistorySelectionAfter,
} from "@/pages/design-editor/history";
import {
  isFlowDisplay,
  readLiveLayerMoveLayout,
} from "@/pages/design-editor/live-layer-move-layout";
import { prepareLiveScreenLayerDrop } from "@/pages/design-editor/live-screen-layer-drop";
import { prepareAcceptedSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import { prepareLayerNodeIdentities } from "./layer-node-identity";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "./selection-publication";

export interface LayerMoveToScreenArgs {
  activeFileId?: string | null;
  activeBreakpointWidthState?: number;
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
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyFileContentUpdateResult;
  boardFileId: string | undefined;
  codeLayerOwnerByNodeId: Map<
    string,
    {
      fileId: string;
      node: CodeLayerNode;
      sourceProjection: CodeLayerProjection;
      tree: CodeLayerTreeNode[];
      runtimeOnly: boolean;
    }
  >;
  effectiveCodeLayerState: EffectiveCodeLayerState;
  files: DesignFile[];
  overviewScreens?: readonly OverviewScreen[];
  overviewSelectedScreenIds?: string[];
  contentHistorySelectionAfterRef?: RefObject<ContentHistorySelectionAfterMap>;
  contentUndoStackRef?: RefObject<ContentHistoryEntry[]>;
  getFreshActiveContent: () => string;
  getScreenContent: (screenId: string) => string;
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
    activeFileId,
    activeBreakpointWidthState,
    activeFile,
    applyFileContentUpdate,
    boardFileId,
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    files,
    getFreshActiveContent,
    getScreenContent,
    overviewScreens,
    overviewSelectedScreenIds,
    contentHistorySelectionAfterRef,
    contentUndoStackRef,
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
      : destFile
        ? getScreenContent(targetFileId)
        : "";
  if (!destContent) return;

  if (isStandaloneHttpUrl(destContent)) {
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
    const sourceContent = getLayerMoveSourceContent({
      sourceFileId: draggedOwner.fileId,
      activeFileId: activeFile?.id,
      activeContent: freshActiveContent,
      sourceFileContent: getScreenContent(draggedOwner.fileId),
      sourceContentMap: new Map(),
    });
    const nodeId =
      draggedOwner.node.dataAttributes["data-agent-native-node-id"] ??
      draggedId;
    const liveLayout = readLiveLayerMoveLayout({
      activeBreakpointWidthState,
      activeFileId: activeFile?.id,
      boardFileId,
      destination: {
        fileId: targetFileId,
        projection: buildCodeLayerProjection("", {
          source: { kind: "design-file", fileId: targetFileId },
        }),
        root: "body",
      },
      overviewScreens,
      placement: "inside",
      source: {
        fileId: draggedOwner.fileId,
        node: draggedOwner.node,
        projection: draggedOwner.sourceProjection,
      },
    });
    if (liveLayout.status === "stale") {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    const sourceIsOutOfFlow =
      liveLayout.status === "resolved" &&
      (liveLayout.sourcePosition === "absolute" ||
        liveLayout.sourcePosition === "fixed");
    const destinationIsFlow =
      liveLayout.status === "resolved" &&
      isFlowDisplay(liveLayout.destinationDisplay);
    const sourceWasIgnoredInFlow =
      sourceIsOutOfFlow &&
      liveLayout.status === "resolved" &&
      isFlowDisplay(liveLayout.sourceParentDisplay);
    const prepared = prepareLiveScreenLayerDrop({
      sourceContent,
      destinationContent: destContent,
      nodeId,
      moveLayout:
        liveLayout.status === "resolved"
          ? {
              destinationIsFlow,
              sourceWasIgnoredInFlow,
              forceRootIntoFlow:
                destinationIsFlow &&
                sourceIsOutOfFlow &&
                !sourceWasIgnoredInFlow,
            }
          : undefined,
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
      sourceScreenId: draggedOwner.fileId,
      html: prepared.html,
      anchor: { selector: "body" },
      placement: "inside",
    });
    return;
  }

  let nextDestContent = destContent;
  const sourceContentMap = new Map<string, string>();
  const sourceOriginalContentMap = new Map<string, string>();
  const preparedSourceContentMap = new Map<string, string>();
  const preparedNodeIdByDraggedId = new Map<string, string>();
  const movedNodeSnapshots = new Map<string, CodeLayerNode>();
  const movedNodeIdByDraggedId = new Map<string, string>();
  let moved = false;

  const destinationOwners: Array<{
    draggedId: string;
    node: CodeLayerNode;
    sourceProjection: CodeLayerProjection;
  }> = [];
  const ownersBySourceFile = new Map<
    string,
    Array<{
      draggedId: string;
      node: CodeLayerNode;
      sourceProjection: CodeLayerProjection;
    }>
  >();
  for (const draggedId of intent.draggedIds) {
    const owner = codeLayerOwnerByNodeId.get(draggedId);
    if (
      !owner ||
      owner.runtimeOnly ||
      effectiveCodeLayerState.lockedIds.has(draggedId)
    ) {
      continue;
    }
    const entry = {
      draggedId,
      node: owner.node,
      sourceProjection: owner.sourceProjection,
    };
    if (owner.fileId === targetFileId) {
      destinationOwners.push(entry);
      continue;
    }
    const owners = ownersBySourceFile.get(owner.fileId) ?? [];
    owners.push(entry);
    ownersBySourceFile.set(owner.fileId, owners);
  }
  if (destinationOwners.length > 0) {
    const prepared = prepareLayerNodeIdentities({
      content: destContent,
      nodes: destinationOwners.map((owner) => owner.node),
      renderedProjection: destinationOwners[0]!.sourceProjection,
    });
    nextDestContent = prepared.content;
    for (const owner of destinationOwners) {
      const nodeId = prepared.nodeIds.get(owner.node.id);
      if (nodeId) preparedNodeIdByDraggedId.set(owner.draggedId, nodeId);
    }
  }
  for (const [sourceFileId, owners] of ownersBySourceFile) {
    if (!files.some((file) => file.id === sourceFileId)) continue;
    const sourceContent = getLayerMoveSourceContent({
      sourceFileId,
      activeFileId: activeFile?.id,
      activeContent: freshActiveContent,
      sourceFileContent: getScreenContent(sourceFileId),
      sourceContentMap: preparedSourceContentMap,
    });
    sourceOriginalContentMap.set(sourceFileId, sourceContent);
    const prepared = prepareLayerNodeIdentities({
      content: sourceContent,
      nodes: owners.map((owner) => owner.node),
      renderedProjection: owners[0]!.sourceProjection,
    });
    preparedSourceContentMap.set(sourceFileId, prepared.content);
    for (const owner of owners) {
      const nodeId = prepared.nodeIds.get(owner.node.id);
      if (nodeId) preparedNodeIdByDraggedId.set(owner.draggedId, nodeId);
    }
  }

  for (const draggedId of intent.draggedIds) {
    const draggedOwner = codeLayerOwnerByNodeId.get(draggedId);
    if (!draggedOwner || effectiveCodeLayerState.lockedIds.has(draggedId)) {
      continue;
    }
    if (draggedOwner.runtimeOnly) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      continue;
    }
    movedNodeSnapshots.set(draggedId, draggedOwner.node);

    if (draggedOwner.fileId === targetFileId) {
      const draggedNodeId = preparedNodeIdByDraggedId.get(draggedId);
      if (!draggedNodeId) {
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
        continue;
      }
      const source = draggedOwner.sourceProjection.source;
      const projection = buildCodeLayerProjection(nextDestContent, { source });
      const tree = buildCodeLayerTree(projection);
      const lastRootId = tree[tree.length - 1]?.id;
      const currentDraggedId = projection.nodes.find(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] === draggedNodeId,
      )?.id;
      if (!lastRootId || lastRootId === currentDraggedId) continue;
      const patch = applyVisualEdit(
        nextDestContent,
        {
          kind: "moveNode",
          target: { nodeId: draggedNodeId },
          anchor: { nodeId: lastRootId },
          placement: "after",
        },
        { source },
      );
      if (patch.result.status !== "applied") {
        toast.error(
          codeLayerPatchMessage(
            patch.result.message,
            t("designEditor.toasts.layerMoveFailed"),
            t,
          ),
          { duration: 4000 },
        );
        continue;
      }
      nextDestContent = patch.content;
      movedNodeIdByDraggedId.set(draggedId, draggedNodeId);
      moved = true;
      continue;
    }

    const sourceFileId = draggedOwner.fileId;
    const srcFile = files.find((f) => f.id === sourceFileId);
    if (!srcFile) continue;
    const nodeAttrId = preparedNodeIdByDraggedId.get(draggedId);
    if (!nodeAttrId) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      continue;
    }
    const currentSourceContent =
      sourceContentMap.get(sourceFileId) ??
      preparedSourceContentMap.get(sourceFileId) ??
      getLayerMoveSourceContent({
        sourceFileId,
        activeFileId: activeFile?.id,
        activeContent: freshActiveContent,
        sourceFileContent: getScreenContent(sourceFileId),
        sourceContentMap,
      });
    if (!sourceOriginalContentMap.has(sourceFileId)) {
      sourceOriginalContentMap.set(sourceFileId, currentSourceContent);
    }
    const sourceProjection = buildCodeLayerProjection(currentSourceContent, {
      source: { kind: "design-file", fileId: sourceFileId },
    });
    const sourceNode = sourceProjection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === nodeAttrId,
    );
    const destinationProjection = buildCodeLayerProjection(nextDestContent, {
      source: { kind: "design-file", fileId: targetFileId },
    });
    if (!sourceNode) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      continue;
    }
    const liveLayout = readLiveLayerMoveLayout({
      activeBreakpointWidthState,
      activeFileId: activeFile?.id,
      boardFileId,
      destination: {
        fileId: targetFileId,
        projection: destinationProjection,
        root: "body",
      },
      overviewScreens,
      placement: "inside",
      source: {
        fileId: sourceFileId,
        node: draggedOwner.node,
        projection: draggedOwner.sourceProjection,
      },
    });
    if (liveLayout.status === "stale") {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      continue;
    }
    const destinationIsFlow =
      liveLayout.status === "resolved"
        ? isFlowDisplay(liveLayout.destinationDisplay)
        : false;
    const sourceIsOutOfFlow =
      liveLayout.status === "resolved" &&
      (liveLayout.sourcePosition === "absolute" ||
        liveLayout.sourcePosition === "fixed");
    const sourceWasIgnoredInFlow =
      sourceIsOutOfFlow &&
      liveLayout.status === "resolved" &&
      isFlowDisplay(liveLayout.sourceParentDisplay);
    const result = moveNodeBetweenDocuments(
      currentSourceContent,
      nextDestContent,
      {
        nodeId: nodeAttrId,
        sourceSelector: sourceNode.path,
        placement: "inside",
        moveLayout:
          liveLayout.status === "resolved"
            ? {
                destinationIsFlow,
                sourceWasIgnoredInFlow,
                forceRootIntoFlow:
                  destinationIsFlow &&
                  sourceIsOutOfFlow &&
                  !sourceWasIgnoredInFlow,
              }
            : undefined,
      },
    );
    if (result.status !== "applied") {
      toast.error(
        codeLayerPatchMessage(
          result.message,
          t("designEditor.toasts.layerMoveFailed"),
          t,
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

  const finalDestProjection = buildCodeLayerProjection(nextDestContent, {
    source: { kind: "design-file", fileId: targetFileId },
  });
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

  const hasCrossFileMoves = sourceContentMap.size > 0;
  try {
    for (const [sourceFileId, nextSourceContent] of sourceContentMap) {
      const sourceFile = files.find((file) => file.id === sourceFileId);
      prepareAcceptedSourceContent(nextSourceContent, {
        fileId: sourceFileId,
        fileType: sourceFile?.fileType,
        previousContent:
          sourceOriginalContentMap.get(sourceFileId) ??
          sourceFile?.content ??
          "",
      });
    }
    if (nextDestContent !== destContent) {
      const destinationFile = files.find((file) => file.id === targetFileId);
      prepareAcceptedSourceContent(nextDestContent, {
        fileId: targetFileId,
        fileType: destinationFile?.fileType,
        previousContent: destContent,
      });
    }
  } catch {
    toast.error(t("designEditor.toasts.layerMoveFailed"), {
      duration: 4000,
    });
    return;
  }

  const publicationFileIds = new Set(sourceContentMap.keys());
  if (nextDestContent !== destContent) publicationFileIds.add(targetFileId);
  if ([...publicationFileIds].some(isShaderWriteInFlight)) {
    toast.error(t("designEditor.toasts.saveConflict"));
    return;
  }

  let crossFileHistoryChanges: ContentHistoryChange[] | null = null;
  const contentUndoStackTopBeforeMove = contentUndoStackRef
    ? captureContentUndoStackTop(contentUndoStackRef.current)
    : undefined;
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
    crossFileHistoryChanges = crossFileChanges;
  }

  for (const [sourceFileId, newSourceContent] of sourceContentMap) {
    const publication = applyFileContentUpdate(sourceFileId, newSourceContent, {
      recordHistory: !hasCrossFileMoves,
      historyBeforeContent:
        sourceOriginalContentMap.get(sourceFileId) ??
        files.find((file) => file.id === sourceFileId)?.content ??
        "",
      refreshPreview: false,
    });
    if (publication.status !== "accepted") return;
    const historyChange = crossFileHistoryChanges?.find(
      (change) => change.fileId === sourceFileId,
    );
    if (historyChange) historyChange.after = publication.content;
  }
  let destinationPublication: ApplyFileContentUpdateResult | null = null;
  if (nextDestContent !== destContent) {
    destinationPublication = applyFileContentUpdate(
      targetFileId,
      nextDestContent,
      {
        recordHistory: !hasCrossFileMoves,
        historyBeforeContent: destContent,
        refreshPreview: false,
      },
    );
  }
  if (destinationPublication?.status !== "accepted" || !finalDestProjection) {
    return;
  }
  const destinationHistoryChange = crossFileHistoryChanges?.find(
    (change) => change.fileId === targetFileId,
  );
  if (destinationHistoryChange) {
    destinationHistoryChange.after = destinationPublication.content;
  } else if (contentUndoStackRef) {
    const entry =
      contentUndoStackRef.current[contentUndoStackRef.current.length - 1];
    const change =
      entry && entry !== contentUndoStackTopBeforeMove
        ? getContentHistoryChanges(entry).find(
            (candidate) => candidate.fileId === targetFileId,
          )
        : undefined;
    if (change) change.after = destinationPublication.content;
  }
  if (crossFileHistoryChanges) {
    if (viewModeRef.current === "overview") {
      recordContentHistoryEntry({ changes: crossFileHistoryChanges });
    } else {
      crossFileHistoryChanges.forEach((change) =>
        recordLocalContentHistoryEntry(change),
      );
    }
  }
  const acceptedProjection = projectAcceptedSource(destinationPublication, {
    kind: "design-file",
    fileId: targetFileId,
  });
  const acceptedMovedNodes = movedNodesAfterMove
    .map((node) =>
      mapAcceptedSelectionNode(
        destinationPublication,
        acceptedProjection,
        node,
      ),
    )
    .filter((node): node is CodeLayerNode => Boolean(node));
  if (acceptedMovedNodes.length > 0) {
    setSelectedLayerIdsState(acceptedMovedNodes.map((node) => node.id));
    const lastMovedNode = acceptedMovedNodes[acceptedMovedNodes.length - 1];
    if (lastMovedNode && targetFileId === activeFile?.id) {
      setSelectedElement(elementInfoFromCodeLayerNode(lastMovedNode));
    }
    const acceptedTree = buildCodeLayerTree(acceptedProjection);
    const movedAncestorIds = acceptedMovedNodes.flatMap((node) =>
      collectCodeLayerAncestors(acceptedTree, node.id),
    );
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      next.add(targetFileId);
      movedAncestorIds.forEach((ancestorId) => next.add(ancestorId));
      return next.size === current.length ? current : Array.from(next);
    });
    if (contentUndoStackRef && contentHistorySelectionAfterRef) {
      stampContentHistorySelectionAfter(
        contentUndoStackRef.current,
        contentHistorySelectionAfterRef.current,
        contentUndoStackTopBeforeMove,
        {
          activeFileId: activeFileId ?? activeFile?.id ?? null,
          overviewSelectedScreenIds: overviewSelectedScreenIds ?? [],
          selectedLayerIds: acceptedMovedNodes.map((node) => node.id),
        },
      );
    }
  }
}
