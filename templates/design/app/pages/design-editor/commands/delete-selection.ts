import type { FrameBounds } from "@shared/canvas-math";
import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
  removeCodeLayerNodeFromHtml,
  type CodeLayerNode,
  type CodeLayerTreeNode,
} from "@shared/code-layer";
import {
  linkedComponentRootForNode,
  COMPONENT_REF_ATTR,
  COMPONENT_ID_ATTR,
} from "@shared/component-model";
import { sourceContentHash } from "@shared/source-workspace";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import { getCurrentBoardSelectionWorldBounds } from "@/components/design/multi-screen/overview-layout";
import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  codeLayerSelectorAliases,
  collectCodeLayerAncestors,
  collectCodeLayerSubtreeDataNodeIds,
  elementInfoFromCodeLayerNode,
  liveDeleteSelectorGroups,
  preferredCodeLayerSelector,
  removeEmptyGeneratedGroupWrappers,
  resolveCodeLayerNodeFromElementInfo,
  shouldDeleteThroughLiveScreen,
  bridgeSourceIdForCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";
import type {
  LiveScreenSnapshot,
  ResponsiveEditScope,
  SelectedCanvasLayerSnapshot,
} from "@/pages/design-editor/command-types";
import { runRepeatItemEdit } from "@/pages/design-editor/commands/repeat-item-edit";
import {
  captureYjsUndoStackTop,
  stampYjsUndoSelection,
} from "@/pages/design-editor/history";
import { applyScopedVisualStyleEdit } from "@/pages/design-editor/pending-edits";
import { removeElementFromHtml } from "@/pages/design-editor/text-edit-utils";
import type { DesignFile } from "@/pages/design-editor/types";

import type { LinkedComponentEdit } from "./linked-component-mutation";

export interface DeleteSelectionArgs {
  applyLinkedComponentEdit?: (
    fileId: string,
    nodeId: string,
    edit: LinkedComponentEdit,
  ) => void;
  activeBreakpointUpperBoundPx: number | null;
  activeBreakpointWidthStateRef: RefObject<number | undefined>;
  activeCanvasSourceType: "inline" | "localhost" | "fusion";
  activeFile: DesignFile;
  boardFileId?: string | null;
  boardSelectionWorldBounds?: {
    screenId: string;
    selector: string;
    memberSelectors?: readonly string[];
    memberSourceIds?: readonly string[];
    worldBounds: FrameBounds;
  } | null;
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
  ) => void;
  canEditDesign: boolean;
  canEditLiveScreen?: boolean;
  codeLayerOwnerByNodeIdRef: RefObject<
    Map<
      string,
      {
        fileId: string;
        node: CodeLayerNode;
        tree: CodeLayerTreeNode[];
        runtimeOnly: boolean;
      }
    >
  >;
  deleteRuntimeElement: (
    selector?: string | null,
    candidates?: readonly string[],
    requestId?: string,
  ) => boolean;
  files: DesignFile[];
  getFreshActiveContent: () => string;
  getScreenContent: (screenId: string) => string;
  getSelectedLayerSnapshots: () => SelectedCanvasLayerSnapshot[];
  liveScreenSnapshotsById: Record<string, LiveScreenSnapshot>;
  previousMotionFileIdRef: RefObject<string | null>;
  pruneMotionTracksByNodeId: (nodeIdsToRemove: Set<string>) => void;
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
      dropMode?: "flow-insert" | "absolute-container";
      forceFlowPositionOverride?: boolean;
      sourceRect?: { x: number; y: number; width: number; height: number };
      anchorRect?: { x: number; y: number; width: number; height: number };
      insertedHtml?: string;
      replaced?: true;
      replacementSelector?: string;
      replacementSourceId?: string;
      removed?: true;
    },
  ) => void;
  responsiveEditScopeRef: RefObject<ResponsiveEditScope>;
  selectedElement: ElementInfo | null;
  selectedLayerIdsState: string[];
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  syncLiveScreenSnapshotPreview: (screenId: string, html: string) => void;
  undoManagerRef: RefObject<Y.UndoManager | null>;
  updateLiveScreenSnapshotContent: (
    screenId: string,
    html: string,
    options?: { recordHistory?: boolean },
  ) => boolean;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runDeleteSelection({
  applyLinkedComponentEdit,
  activeBreakpointUpperBoundPx,
  activeBreakpointWidthStateRef,
  activeCanvasSourceType,
  activeFile,
  boardFileId,
  boardSelectionWorldBounds,
  applyFileContentUpdate,
  applyLocalContentUpdate,
  canEditDesign,
  canEditLiveScreen = false,
  codeLayerOwnerByNodeIdRef,
  deleteRuntimeElement,
  files,
  getFreshActiveContent,
  getScreenContent,
  getSelectedLayerSnapshots,
  liveScreenSnapshotsById,
  previousMotionFileIdRef,
  pruneMotionTracksByNodeId,
  recordPendingLiveStructureEdit,
  responsiveEditScopeRef,
  selectedElement,
  selectedLayerIdsState,
  setOverviewSelectedScreenIds,
  setSelectedElement,
  setSelectedLayerIdsState,
  syncLiveScreenSnapshotPreview,
  t,
  undoManagerRef,
  updateLiveScreenSnapshotContent,
  viewModeRef,
}: DeleteSelectionArgs) {
  trace("structure", "delete", { layers: selectedLayerIdsState.length });
  if (!canEditDesign && !canEditLiveScreen) return;
  const snapshots = getSelectedLayerSnapshots();
  const candidates =
    snapshots.length > 0
      ? snapshots.map((snapshot) => ({
          fileId: snapshot.sourceFileId,
          nodeId:
            snapshot.rootNodeId ??
            snapshot.node.dataAttributes["data-agent-native-node-id"],
          projectionId: snapshot.node.id,
        }))
      : activeFile && selectedElement
        ? [
            {
              fileId: activeFile.id,
              nodeId: selectedElement.sourceId,
              projectionId: "",
            },
          ]
        : [];
  let unresolvedTarget = false;
  const projectionsByFile = new Map<
    string,
    ReturnType<typeof buildCodeLayerProjection>
  >();
  const sourceContentByFile = new Map<string, string>();
  const targets = candidates.flatMap((candidate) => {
    let projection = projectionsByFile.get(candidate.fileId);
    if (!projection) {
      const content =
        liveScreenSnapshotsById[candidate.fileId]?.html ??
        (candidate.fileId === activeFile?.id
          ? getFreshActiveContent()
          : getScreenContent(candidate.fileId));
      projection = buildCodeLayerProjection(content, {
        source: { kind: "design-file", fileId: candidate.fileId },
      });
      projectionsByFile.set(candidate.fileId, projection);
      sourceContentByFile.set(candidate.fileId, content);
    }
    if (
      !projection.nodes.some(
        (node) =>
          Object.prototype.hasOwnProperty.call(
            node.dataAttributes,
            COMPONENT_ID_ATTR,
          ) ||
          Object.prototype.hasOwnProperty.call(
            node.dataAttributes,
            COMPONENT_REF_ATTR,
          ),
      )
    ) {
      unresolvedTarget = true;
      return [];
    }
    const node =
      projection.nodes.find(
        (node) =>
          node.id === candidate.projectionId ||
          (candidate.nodeId &&
            node.dataAttributes["data-agent-native-node-id"] ===
              candidate.nodeId),
      ) ??
      (candidates.length === 1 && selectedElement
        ? resolveCodeLayerNodeFromElementInfo(projection, selectedElement)
        : undefined);
    if (!node) {
      unresolvedTarget = true;
      return [];
    }
    const selectedIds = new Set(
      candidates
        .filter((other) => other.fileId === candidate.fileId)
        .map((other) => other.nodeId),
    );
    let parent = projection.nodes.find((parent) => parent.id === node.parentId);
    const containedMain = projection.nodes.find(
      (candidate) =>
        Object.prototype.hasOwnProperty.call(
          candidate.dataAttributes,
          COMPONENT_ID_ATTR,
        ) &&
        candidate.source &&
        node.source &&
        candidate.source.start >= node.source.start &&
        candidate.source.end <= node.source.end,
    );
    const root =
      containedMain ??
      (parent ? linkedComponentRootForNode(parent, projection) : null);
    while (parent) {
      if (selectedIds.has(parent.dataAttributes["data-agent-native-node-id"]))
        return [];
      parent = projection.nodes.find(
        (ancestor) => ancestor.id === parent!.parentId,
      );
    }
    return [{ fileId: candidate.fileId, node, root }];
  });
  if (targets.some((target) => target.root)) {
    const lowerBoundPx =
      responsiveEditScopeRef.current === "only"
        ? (activeBreakpointWidthStateRef.current ?? null)
        : null;
    const scoped =
      activeBreakpointUpperBoundPx !== null || lowerBoundPx !== null;
    const message =
      activeCanvasSourceType !== "inline"
        ? "designEditor.componentInstances.linkedEditSourceUnsupported"
        : scoped
          ? "designEditor.componentInstances.linkedEditScopeUnsupported"
          : "designEditor.componentInstances.linkedStructureUnsupported";
    const first = targets[0]!;
    if (
      activeCanvasSourceType === "inline" &&
      !scoped &&
      !unresolvedTarget &&
      applyLinkedComponentEdit &&
      targets.length === 1 &&
      first.root?.id === first.node.id &&
      first.root.dataAttributes[COMPONENT_ID_ATTR] &&
      first.node.dataAttributes["data-agent-native-node-id"]
    ) {
      const mainNodeId = first.node.dataAttributes["data-agent-native-node-id"];
      const selectedElementMatches = Boolean(
        selectedElement &&
        (selectedElement.sourceId === mainNodeId ||
          selectedElement.sourceLayerIdentity?.nodeId === mainNodeId),
      );
      const boundingRect = selectedElementMatches
        ? selectedElement?.boundingRect
        : undefined;
      const hasBoundingRect =
        boundingRect !== undefined &&
        [
          boundingRect.x,
          boundingRect.y,
          boundingRect.width,
          boundingRect.height,
        ].every(Number.isFinite) &&
        boundingRect.width > 0 &&
        boundingRect.height > 0;
      const currentSelectors = [
        selectedElement?.runtimeSelector,
        selectedElement?.selector,
        first.node.selector,
        ...first.node.selectors,
      ].filter((selector): selector is string => Boolean(selector));
      const boardWorldBounds =
        hasBoundingRect &&
        boardFileId &&
        first.fileId === boardFileId &&
        selectedElement?.sourceLayerIdentity
          ? getCurrentBoardSelectionWorldBounds({
              selection: boardSelectionWorldBounds ?? null,
              boardFileId,
              ownerFileId: first.fileId,
              selectedLayerId: first.node.id,
              sourceLayerIdentity: selectedElement.sourceLayerIdentity,
              currentSelectors,
              currentSourceIds: [bridgeSourceIdForCodeLayerNode(first.node)],
            })
          : null;
      const deletionGeometry =
        hasBoundingRect &&
        boundingRect &&
        (!boardFileId || first.fileId !== boardFileId || boardWorldBounds)
          ? {
              fileId: first.fileId,
              mainNodeId,
              sourceVersionHash: sourceContentHash(
                sourceContentByFile.get(first.fileId) ?? "",
              ),
              boundingRect: {
                x: boundingRect.x,
                y: boundingRect.y,
                width: boundingRect.width,
                height: boundingRect.height,
              },
              ...(boardWorldBounds ? { worldBounds: boardWorldBounds } : {}),
            }
          : undefined;
      applyLinkedComponentEdit(first.fileId, mainNodeId, {
        kind: "deleteMain",
        ...(deletionGeometry ? { deletionGeometry } : {}),
      });
      return;
    }
    if (
      activeCanvasSourceType === "inline" &&
      !scoped &&
      !unresolvedTarget &&
      applyLinkedComponentEdit &&
      first.root?.dataAttributes[COMPONENT_ID_ATTR] &&
      targets.every(
        (target) =>
          target.fileId === first.fileId &&
          target.root?.id === first.root?.id &&
          target.node.id !== target.root?.id &&
          target.node.dataAttributes["data-agent-native-node-id"],
      )
    ) {
      applyLinkedComponentEdit(
        first.fileId,
        first.root.dataAttributes["data-agent-native-node-id"],
        {
          kind: "structure",
          intents: targets.map((target) => ({
            kind: "deleteNode",
            target: {
              nodeId: target.node.dataAttributes["data-agent-native-node-id"],
            },
          })),
        },
      );
      return;
    }
    if (
      activeCanvasSourceType !== "inline" ||
      scoped ||
      !applyLinkedComponentEdit ||
      unresolvedTarget ||
      targets.some(
        (target) =>
          !target.root?.dataAttributes[COMPONENT_REF_ATTR] ||
          !target.node.dataAttributes["data-agent-native-node-id"],
      )
    ) {
      toast.error(t(message));
      return;
    }
    applyLinkedComponentEdit(
      first.fileId,
      first.node.dataAttributes["data-agent-native-node-id"]!,
      {
        kind: "styleTargetsBatch",
        targets: targets.map((target) => ({
          fileId: target.fileId,
          nodeId: target.node.dataAttributes["data-agent-native-node-id"]!,
          styles: { display: "none" },
        })),
      },
    );
    return;
  }

  undoManagerRef.current?.stopCapturing();
  const selectionBeforeDelete = {
    selectedElement,
    selectedLayerIds: selectedLayerIdsState,
  };
  const undoStackTopBeforeDelete = captureYjsUndoStackTop(
    undoManagerRef.current,
  );
  if (activeFile && selectedElement?.repeat) {
    const edit = runRepeatItemEdit({
      content: getFreshActiveContent(),
      target: selectedElement.repeat,
      operation: { kind: "remove" },
    });
    if (edit.status === "written") {
      applyLocalContentUpdate(edit.content, {
        forcePreviewFullDocument: true,
      });
      stampYjsUndoSelection(
        undoManagerRef.current,
        undoStackTopBeforeDelete,
        selectionBeforeDelete,
      );
      setSelectedElement(null);
      setSelectedLayerIdsState([]);
      return;
    }
    if (edit.status === "refused") {
      trace("structure", "repeat-item-refused", {
        operation: "remove",
        reason: edit.reason,
      });
      toast.error(
        t(
          edit.refusal === "no-item"
            ? "designEditor.toasts.repeatRowPickOnCanvas"
            : "designEditor.toasts.repeatListNotEditable",
        ),
      );
      return;
    }
  }
  const runtimeAliasGroups = selectedLayerIdsState
    .map((layerId) => codeLayerOwnerByNodeIdRef.current.get(layerId))
    .filter((owner) => owner?.runtimeOnly)
    .map((owner) => codeLayerSelectorAliases(owner!.node));
  const liveSelectionSelectors = [
    selectedElement?.runtimeSelector,
    selectedElement?.runtimeSourceId
      ? `[data-agent-native-node-id="${selectedElement.runtimeSourceId}"]`
      : undefined,
    selectedElement?.selector,
  ].filter((selector): selector is string => Boolean(selector));
  const hasLiveDeleteTarget =
    runtimeAliasGroups.length > 0 || liveSelectionSelectors.length > 0;
  const deleteFromLiveDom = (fallbackSelectors: readonly string[]) => {
    liveDeleteSelectorGroups({
      runtimeAliasGroups,
      liveSelectionSelectors,
      fallbackSelectors,
    }).forEach((aliases) => deleteRuntimeElement(aliases[0], aliases));
  };
  if (
    activeFile &&
    shouldDeleteThroughLiveScreen({
      screenSourceType: activeCanvasSourceType,
      runtimeAliasGroups,
      liveSelectionSelectors,
    })
  ) {
    const runtimeTargets = selectedLayerIdsState
      .map((layerId) => codeLayerOwnerByNodeIdRef.current.get(layerId))
      .filter((owner) => owner?.runtimeOnly && owner.fileId === activeFile.id)
      .map((owner) => ({
        aliases: codeLayerSelectorAliases(owner!.node),
        info: elementInfoFromCodeLayerNode(owner!.node),
        sourceId:
          owner!.node.dataAttributes["data-agent-native-node-id"] ??
          owner!.node.id,
      }));
    const targets =
      runtimeTargets.length > 0
        ? runtimeTargets
        : [
            {
              aliases: Array.from(new Set(liveSelectionSelectors)),
              info: selectedElement ?? undefined,
              sourceId:
                selectedElement?.runtimeSourceId ??
                selectedElement?.sourceId ??
                undefined,
            },
          ];
    let deletedAny = false;
    for (const target of targets) {
      const primary = target.aliases[0];
      if (!primary) continue;
      const requestId = `delete-${Date.now().toString(36)}-${Math.random()
        .toString(16)
        .slice(2)}`;
      if (!deleteRuntimeElement(primary, target.aliases, requestId)) continue;
      deletedAny = true;
      recordPendingLiveStructureEdit(
        activeFile.id,
        primary,
        "",
        "after",
        target.info,
        { sourceId: target.sourceId, requestId, removed: true },
      );
    }
    if (!deletedAny) return;
    setSelectedElement(null);
    setSelectedLayerIdsState([]);
    if (viewModeRef.current === "overview") {
      setOverviewSelectedScreenIds([]);
    }
    return;
  }
  if (snapshots.length > 0) {
    const activeRuntimeSelectors: string[] = [];
    let shouldDeleteActiveLiveDom = false;
    let didDelete = false;
    let orphanedTrackNodeIds: Set<string> | null = null;
    for (const file of files) {
      const group = snapshots.filter(
        (snapshot) => snapshot.sourceFileId === file.id,
      );
      if (group.length === 0) continue;
      const liveSnapshot = liveScreenSnapshotsById[file.id];
      const source = liveSnapshot
        ? { kind: "inline-html" as const, fileId: file.id }
        : { kind: "design-file" as const, fileId: file.id };
      const originalContent = liveSnapshot?.html ?? getScreenContent(file.id);
      let content = originalContent;
      const projection = buildCodeLayerProjection(content, { source });
      const tree = buildCodeLayerTree(projection);
      const nodesById = new Map(
        projection.nodes.map((node) => [node.id, node]),
      );
      const selectedNodeIds = new Set(
        group.map((snapshot) => snapshot.node.id),
      );
      const nodes = group
        .map((snapshot) =>
          projection.nodes.find(
            (node) =>
              node.id === snapshot.node.id ||
              node.dataAttributes["data-agent-native-node-id"] ===
                snapshot.rootNodeId,
          ),
        )
        .filter((node): node is CodeLayerNode => Boolean(node?.source))
        .filter(
          (node) =>
            !collectCodeLayerAncestors(tree, node.id).some((ancestorId) =>
              selectedNodeIds.has(ancestorId),
            ),
        )
        .sort((a, b) => (b.source?.start ?? 0) - (a.source?.start ?? 0));
      if (nodes.length === 0) continue;
      const removedSelectors: string[] = [];
      const formerParentAttrIds = new Set<string>();
      const useBreakpointScopedDelete =
        activeBreakpointWidthStateRef.current !== undefined &&
        file.id === activeFile?.id &&
        activeBreakpointUpperBoundPx != null;
      for (const node of nodes) {
        if (useBreakpointScopedDelete) {
          const nodeId =
            node.dataAttributes["data-agent-native-node-id"] ?? node.id;
          const patch = applyScopedVisualStyleEdit({
            content,
            target: { nodeId },
            property: "display",
            value: "none",
            source,
            upperBoundPx: activeBreakpointUpperBoundPx,
            lowerBoundPx:
              responsiveEditScopeRef.current === "only"
                ? activeBreakpointWidthStateRef.current
                : null,
          });
          if (patch.result.status !== "applied") continue;
          content = patch.content;
          continue;
        }
        if (node.parentId) {
          const parentNode = nodesById.get(node.parentId);
          const parentAttrId =
            parentNode?.dataAttributes["data-agent-native-node-id"];
          if (parentAttrId) formerParentAttrIds.add(parentAttrId);
        }
        const next = removeCodeLayerNodeFromHtml(content, node);
        if (!next) continue;
        const selector = preferredCodeLayerSelector(node);
        if (selector) removedSelectors.push(selector);
        content = next;
        if (file.id === previousMotionFileIdRef.current) {
          const subtreeIds = collectCodeLayerSubtreeDataNodeIds(
            tree,
            node.id,
            nodesById,
          );
          if (subtreeIds.size > 0) {
            orphanedTrackNodeIds ??= new Set();
            subtreeIds.forEach((id) => orphanedTrackNodeIds!.add(id));
          }
        }
      }
      if (content === originalContent) continue;
      if (!useBreakpointScopedDelete) {
        content = removeEmptyGeneratedGroupWrappers(
          content,
          formerParentAttrIds,
        );
      }
      if (file.id === activeFile?.id && !useBreakpointScopedDelete) {
        activeRuntimeSelectors.push(...removedSelectors);
        shouldDeleteActiveLiveDom = true;
      }
      didDelete = true;
      if (liveSnapshot) {
        const updated = updateLiveScreenSnapshotContent(file.id, content);
        if (updated && useBreakpointScopedDelete) {
          syncLiveScreenSnapshotPreview(file.id, content);
        }
      } else {
        applyFileContentUpdate(file.id, content, {
          refreshPreview: false,
          forcePreviewFullDocument: useBreakpointScopedDelete,
        });
        if (file.id === activeFile?.id) {
          stampYjsUndoSelection(
            undoManagerRef.current,
            undoStackTopBeforeDelete,
            selectionBeforeDelete,
          );
        }
      }
    }
    if (!didDelete && !hasLiveDeleteTarget) return;
    if (orphanedTrackNodeIds) {
      const idsToRemove = orphanedTrackNodeIds;
      pruneMotionTracksByNodeId(idsToRemove);
    }
    if (shouldDeleteActiveLiveDom) {
      deleteFromLiveDom(activeRuntimeSelectors);
    }
    setSelectedElement(null);
    setSelectedLayerIdsState([]);
    if (viewModeRef.current === "overview") {
      setOverviewSelectedScreenIds([]);
    }
    return;
  }

  if (!selectedElement?.selector) return;
  const activeLiveSnapshot = activeFile
    ? liveScreenSnapshotsById[activeFile.id]
    : undefined;
  const source = activeFile
    ? activeLiveSnapshot
      ? { kind: "inline-html" as const, fileId: activeFile.id }
      : { kind: "design-file" as const, fileId: activeFile.id }
    : undefined;
  const baseContent = activeLiveSnapshot?.html ?? getFreshActiveContent();
  if (
    activeBreakpointWidthStateRef.current !== undefined &&
    activeBreakpointUpperBoundPx != null
  ) {
    const projection = buildCodeLayerProjection(baseContent, {
      ...(source ? { source } : {}),
    });
    const targetNode = resolveCodeLayerNodeFromElementInfo(
      projection,
      selectedElement,
    );
    const nodeId =
      targetNode?.dataAttributes["data-agent-native-node-id"] ??
      targetNode?.id ??
      selectedElement.sourceId;
    const patch = nodeId
      ? applyScopedVisualStyleEdit({
          content: baseContent,
          target: { nodeId },
          property: "display",
          value: "none",
          ...(source ? { source } : {}),
          upperBoundPx: activeBreakpointUpperBoundPx,
          lowerBoundPx:
            responsiveEditScopeRef.current === "only"
              ? activeBreakpointWidthStateRef.current
              : null,
        })
      : null;
    if (patch && patch.result.status === "applied") {
      if (activeLiveSnapshot) {
        if (updateLiveScreenSnapshotContent(activeFile!.id, patch.content)) {
          syncLiveScreenSnapshotPreview(activeFile!.id, patch.content);
        }
      } else {
        applyLocalContentUpdate(patch.content, {
          refreshPreview: false,
          forcePreviewFullDocument: true,
        });
      }
      setSelectedElement(null);
      setSelectedLayerIdsState([]);
    }
    return;
  }
  const nextContent = removeElementFromHtml(
    baseContent,
    selectedElement.selector,
  );
  if (!nextContent) return;
  if (
    selectedElement.sourceId &&
    previousMotionFileIdRef.current === activeFile?.id
  ) {
    const projection = buildCodeLayerProjection(baseContent, {
      ...(source ? { source } : {}),
    });
    const tree = buildCodeLayerTree(projection);
    const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
    const targetNode = projection.nodes.find(
      (node) =>
        node.id === selectedElement.sourceId ||
        node.dataAttributes["data-agent-native-node-id"] ===
          selectedElement.sourceId,
    );
    const subtreeIds = targetNode
      ? collectCodeLayerSubtreeDataNodeIds(tree, targetNode.id, nodesById)
      : new Set<string>();
    if (subtreeIds.size > 0) {
      pruneMotionTracksByNodeId(subtreeIds);
    }
  }
  deleteFromLiveDom([selectedElement.selector]);
  if (activeLiveSnapshot) {
    updateLiveScreenSnapshotContent(activeFile!.id, nextContent);
  } else {
    applyLocalContentUpdate(nextContent, { refreshPreview: false });
    stampYjsUndoSelection(
      undoManagerRef.current,
      undoStackTopBeforeDelete,
      selectionBeforeDelete,
    );
  }
  setSelectedElement(null);
  setSelectedLayerIdsState([]);
}
