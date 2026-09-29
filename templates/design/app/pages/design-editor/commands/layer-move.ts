import { computeReparentedChildPosition } from "@shared/board-file";
import type {
  CodeLayerNode,
  CodeLayerProjection,
  CodeLayerSource,
  CodeLayerTreeNode,
  MoveNodeEditIntent,
} from "@shared/code-layer";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
  moveNodeBetweenDocuments,
} from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { LayersPanelMoveIntent } from "@/components/design/LayersPanel";
import {
  captureCrossScreenSourceHtmlSnapshot,
  validateCrossScreenSourceHtmlSnapshot,
} from "@/components/design/multi-screen/cross-screen-drop";
import type {
  ElementInfo,
  RuntimeStructureDeleteRequest,
  RuntimeStructureMoveRequest,
  RuntimeStructureInsertRequest,
} from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  prepareClonedHtmlLayer,
  prepareClonedHtmlLayersForLiveInsert,
  type ComponentCloneBatchContext,
} from "@/pages/design-editor/clone-and-pen-edit";
import type { EffectiveCodeLayerState } from "@/pages/design-editor/code-layer-state";
import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerSelectorAliases,
  codeLayerPatchMessage,
  collectCodeLayerAncestors,
  elementInfoFromCodeLayerNode,
  findMovedCodeLayerNodeInProjection,
  removeEmptyGeneratedGroupWrappers,
} from "@/pages/design-editor/code-layer-state";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  getLayerMoveIterationOrder,
  getLayerMoveSourceContent,
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
  getAbsolutePositioningForNodeInHtml,
  setAbsolutePositioningForNodeInHtml,
} from "@/pages/design-editor/html-layer-positioning";
import {
  isFlowDisplay,
  readLiveLayerMoveLayout,
} from "@/pages/design-editor/live-layer-move-layout";
import { resolveRuntimeStructureMoveExecutionMode } from "@/pages/design-editor/react-semantic-handoff";
import { prepareAcceptedSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import { prepareLayerNodeIdentities } from "./layer-node-identity";
import {
  resolveLinkedComponentStructureTarget,
  type ApplyLinkedComponentEdit,
} from "./linked-component-structure";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "./selection-publication";

export interface LayerMoveArgs {
  activeFileId?: string | null;
  activeBreakpointWidthState?: number;
  activeFile: DesignFile;
  applyLinkedComponentEdit?: ApplyLinkedComponentEdit;
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
  canEditDesign: boolean;
  canEditLiveScreen?: (screenId: string) => boolean;
  canMoveLayer: (intent: LayersPanelMoveIntent) => boolean;
  boardFileId?: string;
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
  liveScreenIds?: ReadonlySet<string>;
  overviewScreens?: readonly OverviewScreen[];
  overviewSelectedScreenIds?: string[];
  contentHistorySelectionAfterRef?: RefObject<ContentHistorySelectionAfterMap>;
  contentUndoStackRef?: RefObject<ContentHistoryEntry[]>;
  getFreshActiveContent: () => string;
  getScreenContent: (screenId: string) => string;
  handleLayerMoveToScreen: (
    intent: LayersPanelMoveIntent,
    targetFileId: string,
  ) => void;
  handleScreenLayerMove: (intent: LayersPanelMoveIntent) => void;
  recordContentHistoryEntry: (entry: ContentHistoryEntry) => void;
  recordLocalContentHistoryEntry: (change: ContentHistoryChange) => void;
  remapMotionTracksForClone: (
    nodeIdMap: Map<string, string>,
    targetFileId: string,
  ) => void;
  runtimeStructureMoveRevisionRef: RefObject<number>;
  runtimeStructureInsertRevisionRef?: RefObject<number>;
  runtimeLayerSnapshotsById?: Record<string, { html: string }>;
  sendRuntimeLayerMoveSemanticHandoff: (
    subjectLayerId: string,
    targetLayerId: string,
    placement: "before" | "after" | "inside",
  ) => boolean;
  setExpandedLayerIds: Dispatch<SetStateAction<string[]>>;
  setRuntimeStructureMoveRequest: Dispatch<
    SetStateAction<(RuntimeStructureMoveRequest & { screenId: string }) | null>
  >;
  setRuntimeStructureInsertRequest?: Dispatch<
    SetStateAction<
      (RuntimeStructureInsertRequest & { screenId: string }) | null
    >
  >;
  setRuntimeStructureDeleteRequest?: Dispatch<
    SetStateAction<
      (RuntimeStructureDeleteRequest & { screenId: string }) | null
    >
  >;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
  visualScreenFileIds: Set<string>;
}

export function duplicateNodeForPanelDrop(
  content: string,
  draggedNodeId: string,
  anchorNodeId: string,
  placement: LayersPanelMoveIntent["placement"],
  projectionSource: CodeLayerSource = { kind: "inline-html" },
  componentLinks?: ComponentCloneBatchContext,
): {
  content: string;
  duplicatedNodeId: string;
  nodeIdMap: Map<string, string>;
} | null {
  if (typeof document === "undefined") return null;
  const projection = buildCodeLayerProjection(content, {
    source: projectionSource,
  });
  const source = projection.nodes.find((node) => node.id === draggedNodeId);
  if (!source?.source) return null;
  const fragment = content.slice(source.source.start, source.source.end);
  const prepared = prepareClonedHtmlLayer(
    document.implementation.createHTMLDocument(""),
    fragment,
    undefined,
    null,
    componentLinks
      ? {
          sourceFileId: componentLinks.sourceFileIds[0] ?? "",
          targetSource: componentLinks.targetSource,
          documents: componentLinks.documents,
        }
      : undefined,
  );
  if (!prepared) return null;
  const withClone =
    content.slice(0, source.source.end) +
    prepared.element.outerHTML +
    content.slice(source.source.end);
  const movePatch = applyVisualEdit(
    withClone,
    {
      kind: "moveNode",
      target: { nodeId: prepared.rootNodeId },
      anchor: { nodeId: anchorNodeId },
      placement,
    },
    { source: projectionSource },
  );
  if (movePatch.result.status !== "applied") return null;
  return {
    content: movePatch.content,
    duplicatedNodeId: prepared.rootNodeId,
    nodeIdMap: prepared.nodeIdMap,
  };
}

type CodeLayerOwner = NonNullable<
  ReturnType<LayerMoveArgs["codeLayerOwnerByNodeId"]["get"]>
>;

function isOutOfFlowNode(node: CodeLayerNode): boolean {
  const position = node.style.position?.toLowerCase();
  if (position) return position === "absolute" || position === "fixed";
  return node.classes.some((token) => {
    const parts = token.split(":");
    const utility = parts[parts.length - 1]?.replace(/^!/, "");
    return utility === "absolute" || utility === "fixed";
  });
}

function isFlowContainerNode(node: CodeLayerNode | undefined): boolean {
  if (!node) return false;
  const display = node.style.display?.toLowerCase();
  if (display) return isFlowDisplay(display);
  return node.layout.isFlexContainer || node.layout.isGridContainer;
}

function isNodeParentFlow(
  node: CodeLayerNode,
  projection: CodeLayerProjection,
): boolean {
  const parent = node.parentId
    ? projection.nodes.find((candidate) => candidate.id === node.parentId)
    : undefined;
  if (parent) return isFlowContainerNode(parent);
  return isFlowDisplay(node.layout.parentDisplay);
}

function tryDuplicateOnPanelDrop(
  intent: LayersPanelMoveIntent,
  targetOwner: CodeLayerOwner,
  {
    activeFileId,
    activeFile,
    applyFileContentUpdate,
    codeLayerOwnerByNodeId,
    contentHistorySelectionAfterRef,
    contentUndoStackRef,
    effectiveCodeLayerState,
    files,
    getFreshActiveContent,
    getScreenContent,
    overviewSelectedScreenIds,
    remapMotionTracksForClone,
    setSelectedElement,
    setSelectedLayerIdsState,
  }: Pick<
    LayerMoveArgs,
    | "activeFile"
    | "activeFileId"
    | "applyFileContentUpdate"
    | "codeLayerOwnerByNodeId"
    | "contentHistorySelectionAfterRef"
    | "contentUndoStackRef"
    | "effectiveCodeLayerState"
    | "files"
    | "getFreshActiveContent"
    | "getScreenContent"
    | "overviewSelectedScreenIds"
    | "remapMotionTracksForClone"
    | "setSelectedElement"
    | "setSelectedLayerIdsState"
  >,
): "handled" | "skip" {
  const draggedId = intent.draggedIds[0]!;
  const draggedOwner = codeLayerOwnerByNodeId.get(draggedId);
  if (
    !draggedOwner ||
    draggedOwner.runtimeOnly ||
    targetOwner.runtimeOnly ||
    draggedOwner.fileId !== targetOwner.fileId ||
    effectiveCodeLayerState.lockedIds.has(draggedId)
  ) {
    return "skip";
  }
  const baseContent =
    targetOwner.fileId === activeFile?.id
      ? getFreshActiveContent()
      : (files.find((file) => file.id === targetOwner.fileId)?.content ?? "");
  if (!baseContent) return "skip";
  const projectionSource = targetOwner.sourceProjection.source;
  const componentLinks =
    projectionSource.kind === "design-file" && projectionSource.designId
      ? {
          sourceFileIds: [targetOwner.fileId],
          targetSource: projectionSource,
          documents: files.map((file) => ({
            source: {
              kind: "design-file" as const,
              designId: projectionSource.designId!,
              fileId: file.id,
              filename: file.filename,
            },
            content: getScreenContent(file.id),
          })),
        }
      : undefined;
  const duplicated = duplicateNodeForPanelDrop(
    baseContent,
    draggedId,
    intent.targetId,
    intent.placement,
    projectionSource,
    componentLinks,
  );
  if (!duplicated) return "skip";
  const contentUndoStackTopBeforeDuplicate = contentUndoStackRef
    ? captureContentUndoStackTop(contentUndoStackRef.current)
    : undefined;
  const publication = applyFileContentUpdate(
    targetOwner.fileId,
    duplicated.content,
    {
      recordHistory: true,
      refreshPreview: false,
      forcePreviewFullDocument: true,
    },
  );
  if (publication.status !== "accepted") return "handled";
  remapMotionTracksForClone(duplicated.nodeIdMap, targetOwner.fileId);
  const candidateProjection = buildCodeLayerProjection(duplicated.content, {
    source: { kind: "design-file", fileId: targetOwner.fileId },
  });
  const candidateNode = candidateProjection.nodes.find(
    (node) =>
      node.dataAttributes["data-agent-native-node-id"] ===
      duplicated.duplicatedNodeId,
  );
  const acceptedProjection = projectAcceptedSource(publication, {
    kind: "design-file",
    fileId: targetOwner.fileId,
  });
  const finalNode = mapAcceptedSelectionNode(
    publication,
    acceptedProjection,
    candidateNode,
  );
  if (finalNode) {
    setSelectedLayerIdsState([finalNode.id]);
    if (targetOwner.fileId === activeFile?.id) {
      setSelectedElement(elementInfoFromCodeLayerNode(finalNode));
    }
    if (contentUndoStackRef && contentHistorySelectionAfterRef) {
      stampContentHistorySelectionAfter(
        contentUndoStackRef.current,
        contentHistorySelectionAfterRef.current,
        contentUndoStackTopBeforeDuplicate,
        {
          activeFileId: activeFileId ?? activeFile?.id ?? null,
          overviewSelectedScreenIds: overviewSelectedScreenIds ?? [],
          selectedLayerIds: [finalNode.id],
        },
      );
    }
  }
  return "handled";
}

export function runLayerMove(
  {
    activeFileId,
    activeBreakpointWidthState,
    activeFile,
    applyLinkedComponentEdit,
    applyFileContentUpdate,
    canEditDesign,
    canEditLiveScreen,
    canMoveLayer,
    boardFileId,
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    files,
    liveScreenIds,
    getFreshActiveContent,
    getScreenContent,
    handleLayerMoveToScreen,
    handleScreenLayerMove,
    overviewScreens,
    overviewSelectedScreenIds,
    contentHistorySelectionAfterRef,
    contentUndoStackRef,
    recordContentHistoryEntry,
    recordLocalContentHistoryEntry,
    remapMotionTracksForClone,
    runtimeLayerSnapshotsById,
    runtimeStructureMoveRevisionRef,
    runtimeStructureInsertRevisionRef,
    sendRuntimeLayerMoveSemanticHandoff,
    setExpandedLayerIds,
    setRuntimeStructureDeleteRequest,
    setRuntimeStructureInsertRequest,
    setRuntimeStructureMoveRequest,
    setSelectedElement,
    setSelectedLayerIdsState,
    t,
    viewModeRef,
    visualScreenFileIds,
  }: LayerMoveArgs,
  intent: LayersPanelMoveIntent,
) {
  if (!canEditDesign) {
    const targetOwner = codeLayerOwnerByNodeId.get(intent.targetId);
    const targetFileId =
      targetOwner?.fileId ??
      (files.some((file) => file.id === intent.targetId)
        ? intent.targetId
        : null);
    const canEditLiveMove = Boolean(
      targetFileId &&
      canEditLiveScreen?.(targetFileId) &&
      intent.draggedIds.length > 0 &&
      intent.draggedIds.every((draggedId) => {
        const owner = codeLayerOwnerByNodeId.get(draggedId);
        return Boolean(owner && canEditLiveScreen?.(owner.fileId));
      }),
    );
    if (!canEditLiveMove) return;
  }
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
  if (intent.duplicate) {
    const outcome =
      intent.draggedIds.length === 1
        ? tryDuplicateOnPanelDrop(intent, targetOwner, {
            activeFileId,
            activeFile,
            applyFileContentUpdate,
            codeLayerOwnerByNodeId,
            contentHistorySelectionAfterRef,
            contentUndoStackRef,
            effectiveCodeLayerState,
            files,
            getFreshActiveContent,
            getScreenContent,
            overviewSelectedScreenIds,
            remapMotionTracksForClone,
            setSelectedElement,
            setSelectedLayerIdsState,
          })
        : "skip";
    if (outcome === "handled") return;
    toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
    return;
  }
  const runtimeDraggedOwner =
    intent.draggedIds.length === 1
      ? codeLayerOwnerByNodeId.get(intent.draggedIds[0]!)
      : undefined;
  const targetScreenIsLive = liveScreenIds?.has(targetOwner.fileId) ?? false;
  const sourceScreenIsLive = Boolean(
    runtimeDraggedOwner &&
    (liveScreenIds?.has(runtimeDraggedOwner.fileId) ?? false),
  );
  if (
    runtimeDraggedOwner?.runtimeOnly &&
    targetOwner.runtimeOnly &&
    sourceScreenIsLive &&
    targetScreenIsLive &&
    runtimeDraggedOwner.fileId !== targetOwner.fileId
  ) {
    if (
      !setRuntimeStructureInsertRequest ||
      !setRuntimeStructureDeleteRequest
    ) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
      return;
    }
    const sourceSnapshot =
      runtimeLayerSnapshotsById?.[runtimeDraggedOwner.fileId];
    const sourceId = bridgeSourceIdForCodeLayerNode(runtimeDraggedOwner.node);
    const sourceHtml =
      sourceSnapshot && typeof DOMParser !== "undefined"
        ? captureCrossScreenSourceHtmlSnapshot(
            new DOMParser().parseFromString(sourceSnapshot.html, "text/html"),
            sourceId,
          )
        : undefined;
    const validatedSourceHtml = sourceHtml
      ? validateCrossScreenSourceHtmlSnapshot(sourceHtml, sourceId)
      : undefined;
    if (!validatedSourceHtml) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
      return;
    }
    const prepared = prepareClonedHtmlLayersForLiveInsert(
      getScreenContent(targetOwner.fileId),
      [validatedSourceHtml],
    );
    const insertedHtml = prepared?.htmlFragments[0];
    if (!insertedHtml) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
      return;
    }
    const transactionId = `layer-panel-cross-screen-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const insertRevisionRef =
      runtimeStructureInsertRevisionRef ?? runtimeStructureMoveRevisionRef;
    insertRevisionRef.current += 1;
    setRuntimeStructureInsertRequest({
      requestId: insertRevisionRef.current,
      transactionId,
      screenId: targetOwner.fileId,
      sourceScreenId: runtimeDraggedOwner.fileId,
      html: insertedHtml,
      anchor: {
        selector: targetOwner.node.selector,
        sourceId: bridgeSourceIdForCodeLayerNode(targetOwner.node),
      },
      placement: intent.placement,
    });
    setRuntimeStructureDeleteRequest({
      requestId: `${transactionId}:source`,
      transactionId,
      screenId: runtimeDraggedOwner.fileId,
      selector: runtimeDraggedOwner.node.selector,
      waitForInsertTransaction: true,
      rollbackScreenId: targetOwner.fileId,
      selectorCandidates: Array.from(
        new Set([
          runtimeDraggedOwner.node.selector,
          ...codeLayerSelectorAliases(runtimeDraggedOwner.node),
        ]),
      ).filter(Boolean),
    });
    return;
  }
  if (
    targetOwner.runtimeOnly ||
    runtimeDraggedOwner?.runtimeOnly ||
    targetScreenIsLive ||
    sourceScreenIsLive
  ) {
    if (!runtimeDraggedOwner) {
      return;
    }
    const executionMode = resolveRuntimeStructureMoveExecutionMode({
      subjectRuntimeOnly: runtimeDraggedOwner.runtimeOnly || sourceScreenIsLive,
      targetRuntimeOnly: targetOwner.runtimeOnly || targetScreenIsLive,
      sourceScreenId: runtimeDraggedOwner.fileId,
      targetScreenId: targetOwner.fileId,
      sourceScreenIsBoard:
        Boolean(boardFileId) && runtimeDraggedOwner.fileId === boardFileId,
      targetScreenIsLive,
    });
    if (executionMode === "screen-bridge") {
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
  const freshActiveContent = getFreshActiveContent();
  const destFile = files.find((file) => file.id === targetOwner.fileId);
  const destContent =
    targetOwner.fileId === activeFile?.id
      ? freshActiveContent
      : destFile
        ? getScreenContent(targetOwner.fileId)
        : "";
  if (!destContent) return;

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
      effectiveCodeLayerState.lockedIds.has(draggedId)
    ) {
      continue;
    }
    if (draggedOwner.runtimeOnly) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      continue;
    }
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
  const preparedNodeIdByDraggedId = new Map<string, string>();
  const destinationNodes = [
    targetOwner.node,
    ...classifiedDrags.flatMap((drag) => {
      if (drag.kind !== "same-file") return [];
      const owner = codeLayerOwnerByNodeId.get(drag.draggedId);
      return owner ? [owner.node] : [];
    }),
  ];
  const preparedDestination = prepareLayerNodeIdentities({
    content: destContent,
    nodes: destinationNodes,
    renderedProjection: targetOwner.sourceProjection,
  });
  const preparedAnchorId = preparedDestination.nodeIds.get(targetOwner.node.id);
  if (!preparedAnchorId) {
    toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
    return;
  }
  for (const drag of classifiedDrags) {
    if (drag.kind !== "same-file") continue;
    const nodeId = preparedDestination.nodeIds.get(drag.draggedId);
    if (nodeId) preparedNodeIdByDraggedId.set(drag.draggedId, nodeId);
  }

  const destinationSource = targetOwner.sourceProjection.source;
  const linkedStructureIntents =
    classifiedDrags.length > 0 &&
    classifiedDrags.every((drag) => drag.kind === "same-file")
      ? getLayerMoveIterationOrder(classifiedDrags, intent.placement).flatMap(
          (drag): MoveNodeEditIntent[] => {
            const draggedOwner = codeLayerOwnerByNodeId.get(drag.draggedId);
            const draggedNodeId =
              draggedOwner?.node.dataAttributes["data-agent-native-node-id"];
            const anchorNodeId =
              targetOwner.node.dataAttributes["data-agent-native-node-id"];
            return draggedNodeId && anchorNodeId
              ? [
                  {
                    kind: "moveNode",
                    target: { nodeId: draggedNodeId },
                    anchor: { nodeId: anchorNodeId },
                    placement: intent.placement,
                  },
                ]
              : [];
          },
        )
      : [];
  const linkedComponentTarget =
    applyLinkedComponentEdit &&
    linkedStructureIntents.length === classifiedDrags.length
      ? resolveLinkedComponentStructureTarget({
          content: destContent,
          source: destinationSource,
          intents: linkedStructureIntents,
        })
      : null;

  let nextDestContent = preparedDestination.content;
  const preparedSourceContentMap = new Map<string, string>();
  const sourceOriginalContentMap = new Map<string, string>();
  const crossFileOwnersByFile = new Map<
    string,
    Array<{ draggedId: string; node: CodeLayerNode }>
  >();
  for (const drag of classifiedDrags) {
    if (drag.kind !== "cross-file") continue;
    const owner = codeLayerOwnerByNodeId.get(drag.draggedId);
    if (!owner) continue;
    const owners = crossFileOwnersByFile.get(drag.sourceFileId) ?? [];
    owners.push({ draggedId: drag.draggedId, node: owner.node });
    crossFileOwnersByFile.set(drag.sourceFileId, owners);
  }
  for (const [sourceFileId, owners] of crossFileOwnersByFile) {
    const firstOwner = codeLayerOwnerByNodeId.get(owners[0]!.draggedId);
    if (!firstOwner || !files.some((file) => file.id === sourceFileId)) {
      continue;
    }
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
      renderedProjection: firstOwner.sourceProjection,
    });
    preparedSourceContentMap.set(sourceFileId, prepared.content);
    for (const owner of owners) {
      const nodeId = prepared.nodeIds.get(owner.node.id);
      if (nodeId) preparedNodeIdByDraggedId.set(owner.draggedId, nodeId);
    }
  }

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

  let moved = false;
  const sourceContentMap = new Map<string, string>();
  const movedNodeIdByDraggedId = new Map<string, string>();

  for (const drag of getLayerMoveIterationOrder(
    classifiedDrags,
    intent.placement,
  )) {
    const { draggedId } = drag;
    if (drag.kind === "same-file") {
      const draggedOwner = codeLayerOwnerByNodeId.get(draggedId);
      const draggedNodeId = preparedNodeIdByDraggedId.get(draggedId);
      if (!draggedOwner || !draggedNodeId) {
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
        continue;
      }
      const targetOwnerNode = codeLayerOwnerByNodeId.get(intent.targetId);
      const newParentId =
        intent.placement === "inside"
          ? intent.targetId
          : (targetOwnerNode?.node.parentId ?? null);
      const newParentOwnerNode = newParentId
        ? codeLayerOwnerByNodeId.get(newParentId)?.node
        : undefined;
      const isCrossParent = Boolean(
        draggedOwner &&
        newParentId &&
        draggedOwner.node.parentId !== newParentId,
      );
      const targetIsAutoLayout = isFlowContainerNode(newParentOwnerNode);
      const liveLayout = readLiveLayerMoveLayout({
        activeBreakpointWidthState,
        activeFileId: activeFile?.id,
        boardFileId,
        destination: {
          fileId: targetOwner.fileId,
          node: targetOwner.node,
          projection: targetOwner.sourceProjection,
        },
        overviewScreens,
        placement: intent.placement,
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
        continue;
      }
      const destinationIsAutoLayout =
        liveLayout.status === "resolved"
          ? isFlowDisplay(liveLayout.destinationDisplay)
          : targetIsAutoLayout;
      const sourceIsOutOfFlow =
        liveLayout.status === "resolved"
          ? liveLayout.sourcePosition === "absolute" ||
            liveLayout.sourcePosition === "fixed"
          : isOutOfFlowNode(draggedOwner.node);
      const sourceParentIsAutoLayout =
        liveLayout.status === "resolved"
          ? isFlowDisplay(liveLayout.sourceParentDisplay)
          : isNodeParentFlow(draggedOwner.node, draggedOwner.sourceProjection);
      const sourceWasIgnoredInAutoLayout =
        sourceIsOutOfFlow && sourceParentIsAutoLayout;
      const prevContentForRebase = nextDestContent;
      const source = targetOwner.sourceProjection.source;
      const patch = applyVisualEdit(
        nextDestContent,
        {
          kind: "moveNode",
          target: { nodeId: draggedNodeId },
          anchor: { nodeId: preparedAnchorId },
          placement: intent.placement,
        },
        {
          source,
          ...(linkedComponentTarget
            ? { allowMainComponentStructure: true }
            : {}),
          moveNode: {
            destinationIsFlow: destinationIsAutoLayout,
            sourceWasIgnoredInFlow:
              sourceIsOutOfFlow && sourceParentIsAutoLayout,
            forceRootIntoFlow:
              destinationIsAutoLayout &&
              sourceIsOutOfFlow &&
              !sourceParentIsAutoLayout,
          },
        },
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
      if (
        isCrossParent &&
        newParentId &&
        (!destinationIsAutoLayout || sourceWasIgnoredInAutoLayout)
      ) {
        const movedNodeAttrId =
          patch.projection.nodes.find(
            (n) =>
              n.dataAttributes["data-agent-native-node-id"] === draggedNodeId ||
              n.id === draggedNodeId,
          )?.dataAttributes["data-agent-native-node-id"] ?? draggedNodeId;
        const draggedAttrId = draggedNodeId;
        const newParentAttrId =
          newParentId === intent.targetId
            ? preparedAnchorId
            : (codeLayerOwnerByNodeId.get(newParentId)?.node.dataAttributes[
                "data-agent-native-node-id"
              ] ?? newParentId);
        const sourcePosition = getAbsolutePositioningForNodeInHtml(
          prevContentForRebase,
          draggedAttrId,
        );
        const targetPosition = getAbsolutePositioningForNodeInHtml(
          prevContentForRebase,
          newParentAttrId,
        );
        if (sourcePosition && targetPosition) {
          nextDestContent = setAbsolutePositioningForNodeInHtml(
            nextDestContent,
            movedNodeAttrId,
            computeReparentedChildPosition(sourcePosition, targetPosition),
          );
        }
      }
      movedNodeIdByDraggedId.set(draggedId, draggedNodeId);
      moved = true;
    } else {
      const { sourceFileId } = drag;
      const draggedOwner = codeLayerOwnerByNodeId.get(draggedId);
      const srcFile = files.find((f) => f.id === sourceFileId);
      if (!srcFile || !draggedOwner) continue;
      const currentSourceContent =
        sourceContentMap.get(sourceFileId) ??
        preparedSourceContentMap.get(sourceFileId);
      const nodeAttrId = preparedNodeIdByDraggedId.get(draggedId);
      if (!currentSourceContent || !nodeAttrId) {
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
        continue;
      }

      const sourceProjection = buildCodeLayerProjection(currentSourceContent, {
        source: { kind: "design-file", fileId: sourceFileId },
      });
      const sourceNode = sourceProjection.nodes.find(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] === nodeAttrId,
      );
      const destinationProjection = buildCodeLayerProjection(nextDestContent, {
        source: { kind: "design-file", fileId: targetOwner.fileId },
      });
      const destinationNode = destinationProjection.nodes.find(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] === preparedAnchorId,
      );
      if (!sourceNode || !destinationNode) {
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
          fileId: targetOwner.fileId,
          node: targetOwner.node,
          projection: targetOwner.sourceProjection,
        },
        overviewScreens,
        placement: intent.placement,
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
      const sourceIsOutOfFlow =
        liveLayout.status === "resolved"
          ? liveLayout.sourcePosition === "absolute" ||
            liveLayout.sourcePosition === "fixed"
          : isOutOfFlowNode(draggedOwner.node);
      const sourceParentIsFlow =
        liveLayout.status === "resolved"
          ? isFlowDisplay(liveLayout.sourceParentDisplay)
          : isNodeParentFlow(draggedOwner.node, draggedOwner.sourceProjection);
      const destinationIsFlow =
        liveLayout.status === "resolved"
          ? isFlowDisplay(liveLayout.destinationDisplay)
          : intent.placement === "inside"
            ? isFlowContainerNode(targetOwner.node)
            : isNodeParentFlow(targetOwner.node, targetOwner.sourceProjection);
      const sourceWasIgnoredInFlow = sourceIsOutOfFlow && sourceParentIsFlow;

      const result = moveNodeBetweenDocuments(
        currentSourceContent,
        nextDestContent,
        {
          nodeId: nodeAttrId,
          sourceSelector: sourceNode.path,
          anchorNodeId: preparedAnchorId,
          placement: intent.placement,
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
  }

  if (!moved) return;

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
      ? buildCodeLayerProjection(nextDestContent, {
          source: targetOwner.sourceProjection.source,
        })
      : null;
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

  const hasCrossFileMoves = sourceContentMap.size > 0;

  if (
    linkedComponentTarget &&
    movedNodeIdByDraggedId.size !== linkedStructureIntents.length
  ) {
    return;
  }

  if (
    applyLinkedComponentEdit &&
    !hasCrossFileMoves &&
    linkedComponentTarget &&
    nextDestContent !== destContent &&
    movedNodeIdByDraggedId.size === linkedStructureIntents.length
  ) {
    let semanticContent = destContent;
    let semanticPlanMatches = true;
    for (const moveIntent of linkedStructureIntents) {
      const semanticPatch = applyVisualEdit(semanticContent, moveIntent, {
        source: destinationSource,
        allowMainComponentStructure: true,
      });
      if (semanticPatch.result.status !== "applied") {
        semanticPlanMatches = false;
        break;
      }
      semanticContent = semanticPatch.content;
    }
    applyLinkedComponentEdit(
      linkedComponentTarget.fileId,
      linkedComponentTarget.nodeId,
      semanticPlanMatches && semanticContent === nextDestContent
        ? { kind: "structure", intents: linkedStructureIntents }
        : {
            kind: "structure",
            before: destContent,
            after: nextDestContent,
            selectionNodeIds: linkedStructureIntents.map(
              (moveIntent) => moveIntent.target.nodeId!,
            ),
          },
    );
    return;
  }

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
      const destinationFile = files.find(
        (file) => file.id === targetOwner.fileId,
      );
      prepareAcceptedSourceContent(nextDestContent, {
        fileId: targetOwner.fileId,
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
              fileId: targetOwner.fileId,
              before: destContent,
              after: nextDestContent,
            },
          ]
        : []),
    ];
    crossFileHistoryChanges = crossFileChanges;
    if (viewModeRef.current === "overview") {
      recordContentHistoryEntry({ changes: crossFileChanges });
    } else {
      crossFileChanges.forEach((change) =>
        recordLocalContentHistoryEntry(change),
      );
    }
  }

  let allSourcePublicationsAccepted = true;
  for (const [sourceFileId, newSourceContent] of sourceContentMap) {
    const publication = applyFileContentUpdate(sourceFileId, newSourceContent, {
      recordHistory: !hasCrossFileMoves,
      historyBeforeContent:
        sourceOriginalContentMap.get(sourceFileId) ??
        files.find((file) => file.id === sourceFileId)?.content ??
        "",
      refreshPreview: false,
      forcePreviewFullDocument: true,
    });
    if (publication.status !== "accepted") {
      allSourcePublicationsAccepted = false;
    } else {
      const historyChange = crossFileHistoryChanges?.find(
        (change) => change.fileId === sourceFileId,
      );
      if (historyChange) historyChange.after = publication.content;
    }
  }

  if (nextDestContent !== destContent) {
    const publication = applyFileContentUpdate(
      targetOwner.fileId,
      nextDestContent,
      {
        recordHistory: !hasCrossFileMoves,
        historyBeforeContent: destContent,
        refreshPreview: false,
        forcePreviewFullDocument: true,
      },
    );
    if (publication.status !== "accepted" || !finalDestProjection) return;
    const destinationHistoryChange = crossFileHistoryChanges?.find(
      (change) => change.fileId === targetOwner.fileId,
    );
    if (destinationHistoryChange) {
      destinationHistoryChange.after = publication.content;
    } else if (contentUndoStackRef) {
      const entry =
        contentUndoStackRef.current[contentUndoStackRef.current.length - 1];
      const change =
        entry && entry !== contentUndoStackTopBeforeMove
          ? getContentHistoryChanges(entry).find(
              (candidate) => candidate.fileId === targetOwner.fileId,
            )
          : undefined;
      if (change) change.after = publication.content;
    }
    const acceptedProjection = projectAcceptedSource(
      publication,
      targetOwner.sourceProjection.source,
    );
    const acceptedMovedNodes = movedNodesAfterMove
      .map((node) =>
        mapAcceptedSelectionNode(publication, acceptedProjection, node),
      )
      .filter((node): node is CodeLayerNode => Boolean(node));
    if (allSourcePublicationsAccepted && acceptedMovedNodes.length > 0) {
      setSelectedLayerIdsState(acceptedMovedNodes.map((node) => node.id));
      const lastMovedNode = acceptedMovedNodes[acceptedMovedNodes.length - 1];
      if (lastMovedNode && targetOwner.fileId === activeFile?.id) {
        setSelectedElement(elementInfoFromCodeLayerNode(lastMovedNode));
      }
      const acceptedTree = buildCodeLayerTree(acceptedProjection);
      const movedAncestorIds = acceptedMovedNodes.flatMap((node) =>
        collectCodeLayerAncestors(acceptedTree, node.id),
      );
      setExpandedLayerIds((current) => {
        const next = new Set(current);
        next.add(targetOwner.fileId);
        movedAncestorIds.forEach((ancestorId) => next.add(ancestorId));
        return next.size === current.length ? current : Array.from(next);
      });
      if (
        allSourcePublicationsAccepted &&
        contentUndoStackRef &&
        contentHistorySelectionAfterRef
      ) {
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
}
