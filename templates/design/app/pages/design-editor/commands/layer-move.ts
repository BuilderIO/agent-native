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
import type {
  ElementInfo,
  RuntimeStructureMoveRequest,
} from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  prepareClonedHtmlLayer,
  type ComponentCloneBatchContext,
} from "@/pages/design-editor/clone-and-pen-edit";
import type { EffectiveCodeLayerState } from "@/pages/design-editor/code-layer-state";
import {
  bridgeSourceIdForCodeLayerNode,
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

/**
 * Alt-drag-duplicate in the Layers panel (Figma parity: unique-paths.md #2).
 * Clones the dragged node's markup in place — as a fresh-id same-parent
 * sibling — then moves that CLONE to the intended drop position; the
 * original is never touched. A pure string/projection transform so it can
 * run ahead of runLayerMove's codeLayerOwnerByNodeId-keyed branches, which
 * don't know about the freshly-minted clone until the next render.
 *
 * Clone generation reuses `prepareClonedHtmlLayer` — the same DOM-based
 * remapping the canvas alt-drag/duplicate/paste paths use — so authored
 * `id="…"` attributes are re-keyed (not just `data-agent-native-node-id`)
 * and the returned `nodeIdMap` lets the caller carry motion tracks over to
 * the clone, instead of a bespoke regex that only touched one attribute.
 *
 * Returns null when the drop doesn't fit this single-node, same-document
 * fast path (target missing, no `document` to clone through, or the move
 * step reports anything but "applied") — callers must refuse the gesture
 * rather than fall back to a plain, non-duplicating move of the original.
 */
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

/**
 * Attempts the alt-drag-duplicate fast path for a single-node panel drop;
 * returns "handled" once it has applied the content update and selection
 * itself, or "skip" when the shape isn't one this fast path supports (the
 * caller then runs its normal, non-duplicating move).
 */
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
      // The clone lands as a fresh sibling elsewhere in the tree; the bridge's
      // scoped single-selector morph only reconciles whatever is currently
      // selected and returns early, so a structural insert outside that
      // subtree would otherwise never reach the live iframe (see the same
      // note on the plain-move persist calls below).
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
    canMoveLayer,
    boardFileId,
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    files,
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
    // A duplicate drop that can't be honoured (multi-selection, cross-file,
    // runtime-only, or a locked source) must refuse rather than fall
    // through to the plain move below, which would silently move — not
    // copy — the original.
    toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
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
      : destFile
        ? getScreenContent(targetOwner.fileId)
        : "";
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
    if (draggedOwner.runtimeOnly) {
      // The single-drag runtimeOnly branch above only fires when the WHOLE
      // intent is one runtime-only id; a mixed multi-select drag reaches
      // here with a runtime-only item still in the list. It has no
      // sourceHtml counterpart, so applyVisualEdit/moveNodeBetweenDocuments
      // below would fail with a raw "no code layer node exists"/"not found
      // in sourceHtml" id string instead of moving anything — refuse with
      // the same plain-language copy every other per-drag failure here
      // uses, rather than let that technical message reach the user.
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
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
      // A Layers drop can reparent the node rather than reorder siblings.
      // Keep world position for freeform targets; moveNode already normalizes
      // a child entering auto layout into flow.
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
      // Preserve the auto-layout ignore state only when it existed in the
      // source parent. Absolute positioning in a regular Frame is freeform
      // placement, not an instruction to ignore the new parent's flow.
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
        // getAbsolutePositioningForNodeInHtml/setAbsolutePositioningForNodeInHtml
        // select elements by their literal data-agent-native-node-id DOM
        // attribute, not this internal projection id (nodeIdFor always
        // derives a synthetic "html:<hash>" id, even for an element that
        // already carries an explicit attribute) — resolve both ends
        // through their owners first, or the lookups below silently miss
        // and the rebase never happens, leaving the dragged node's old
        // parent-relative left/top to render against the new parent.
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

  // Once a linked MAIN was selected for atomic planning, a failed member
  // cannot fall back to publishing the successful subset locally. That would
  // split one Layers gesture across the component action and the local Yjs
  // writer and leave the linked instances out of sync.
  if (
    linkedComponentTarget &&
    movedNodeIdByDraggedId.size !== linkedStructureIntents.length
  ) {
    return;
  }

  // A same-file move whose affected parents all belong to one canonical MAIN
  // must go through the linked-component action before any local writer or
  // history reservation. The target is resolved before the planning loop so
  // the default code-layer refusal remains in force for every other move.
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

  // Persist dest file (which may also be the active file). A layer move can
  // reorder or reparent a node relative to SIBLINGS outside its own subtree
  // (e.g. two absolutely positioned cards swapping stacking order) — the
  // bridge's non-forced replace only re-morphs whichever node the CURRENT
  // selection resolves to and returns without ever touching the rest of the
  // body, so a structural move must always force the whole-document (still
  // in-place, keyed) morph or a sibling reorder outside that one subtree
  // never reaches the live iframe.
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
