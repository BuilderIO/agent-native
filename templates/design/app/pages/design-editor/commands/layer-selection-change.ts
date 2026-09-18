import {
  buildCodeLayerProjection,
  type CodeLayerNode,
  type CodeLayerProjection,
  type CodeLayerTreeNode,
} from "@shared/code-layer";
import { getOverviewScreenFileIds } from "@shared/design-files";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { ElementInfo } from "@/components/design/types";
import type { EffectiveCodeLayerState } from "@/pages/design-editor/code-layer-state";
import { elementInfoForOwnedCodeLayerNode } from "@/pages/design-editor/code-layer-state";
import {
  getOverviewScreenIdsFromLayerSelection,
  getSidebarCodeLayerSelectionState,
} from "@/pages/design-editor/selection-state";
import { resolveToolAfterSelection } from "@/pages/design-editor/tool-state";
import type {
  DesignFile,
  DesignTool,
  EditorMode,
} from "@/pages/design-editor/types";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import { prepareLayerNodeIdentities } from "./layer-node-identity";
import { mapAcceptedSelectionNode } from "./selection-publication";

export interface LayerSelectionChangeArgs {
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: { recordHistory?: boolean },
  ) => ApplyFileContentUpdateResult;
  activeFile: DesignFile;
  clearPendingOverviewLayerSelectionTimer: () => void;
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
  getScreenContent: (screenId: string) => string;
  focusDesignInspectorForSelection: () => void;
  overviewSelectedScreenIds: string[];
  pendingOverviewLayerSelectionRef: RefObject<string | null>;
  pendingOverviewScreenSelectionRef: RefObject<string | null>;
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setActiveTool: Dispatch<SetStateAction<DesignTool>>;
  setCreatedOverviewLayerSelection: Dispatch<
    SetStateAction<{ screenId: string; layerId: string } | null>
  >;
  selectedElement: ElementInfo | null;
  setMode: Dispatch<SetStateAction<EditorMode>>;
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  setViewMode: Dispatch<SetStateAction<"single" | "overview">>;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runLayerSelectionChange(
  {
    applyFileContentUpdate,
    activeFile,
    clearPendingOverviewLayerSelectionTimer,
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    files,
    getScreenContent,
    focusDesignInspectorForSelection,
    overviewSelectedScreenIds,
    pendingOverviewLayerSelectionRef,
    pendingOverviewScreenSelectionRef,
    setActiveFileId,
    setActiveTool,
    setCreatedOverviewLayerSelection,
    selectedElement,
    setMode,
    setOverviewSelectedScreenIds,
    setSelectedElement,
    setSelectedLayerIdsState,
    setViewMode,
    viewModeRef,
  }: LayerSelectionChangeArgs,
  ids: string[],
  _intent: {
    additive: boolean;
    currentSelectedIds?: string[];
    id: string;
    range: boolean;
  },
): string[] {
  const requestedLayerIds = ids.filter((layerId) => !layerId.startsWith("__"));
  pendingOverviewScreenSelectionRef.current = null;
  pendingOverviewLayerSelectionRef.current = null;
  clearPendingOverviewLayerSelectionTimer();
  setCreatedOverviewLayerSelection(null);
  const screenFileIds = getOverviewScreenFileIds(files);
  const requestedScreenIds = getOverviewScreenIdsFromLayerSelection({
    fileIds: screenFileIds,
    layerIds: requestedLayerIds,
  });
  if (viewModeRef.current === "overview") {
    setOverviewSelectedScreenIds(requestedScreenIds);
  }
  const requestedSelectedId = requestedLayerIds[requestedLayerIds.length - 1];
  let selectedElementNode = requestedSelectedId
    ? codeLayerOwnerByNodeId.get(requestedSelectedId)?.node
    : undefined;
  const refreshedIds = new Map<string, string>();
  const selectedOwnersByFile = new Map<
    string,
    Array<{
      layerId: string;
      node: CodeLayerNode;
      sourceProjection: CodeLayerProjection;
    }>
  >();
  for (const layerId of requestedLayerIds) {
    const owner = codeLayerOwnerByNodeId.get(layerId);
    if (!owner || owner.runtimeOnly) continue;
    const selectedOwners = selectedOwnersByFile.get(owner.fileId) ?? [];
    selectedOwners.push({
      layerId,
      node: owner.node,
      sourceProjection: owner.sourceProjection,
    });
    selectedOwnersByFile.set(owner.fileId, selectedOwners);
  }
  for (const [fileId, owners] of selectedOwnersByFile) {
    const originalContent = getScreenContent(fileId);
    let content = originalContent;
    if (!content) continue;
    const sourceProjection = owners[0]!.sourceProjection;
    if (
      owners.some(
        (owner) =>
          owner.sourceProjection.projectionId !== sourceProjection.projectionId,
      )
    ) {
      continue;
    }
    const pendingRefreshedIds = new Map<string, string>();
    const eligibleOwners = owners.filter(
      (owner) =>
        owner.node.tag !== "html" &&
        owner.node.tag !== "body" &&
        owner.node.source &&
        !effectiveCodeLayerState.lockedIds.has(owner.layerId) &&
        !effectiveCodeLayerState.hiddenIds.has(owner.layerId),
    );
    const prepared = prepareLayerNodeIdentities({
      content,
      nodes: eligibleOwners.map((owner) => owner.node),
      renderedProjection: sourceProjection,
    });
    content = prepared.content;
    for (const owner of eligibleOwners) {
      const nodeId = prepared.nodeIds.get(owner.node.id);
      if (nodeId) pendingRefreshedIds.set(owner.layerId, nodeId);
    }
    let acceptedProjection: CodeLayerProjection | null = null;
    if (content !== originalContent) {
      const update = applyFileContentUpdate(fileId, content, {
        recordHistory: false,
      });
      if (update.status !== "accepted") continue;
      content = update.content;
      const submittedProjection = buildCodeLayerProjection(prepared.content, {
        source: sourceProjection.source,
      });
      const displayedProjection = buildCodeLayerProjection(content, {
        source: sourceProjection.source,
      });
      for (const owner of eligibleOwners) {
        const stableId = pendingRefreshedIds.get(owner.layerId);
        if (!stableId) continue;
        const submittedNode = submittedProjection.nodes.find(
          (node) =>
            node.dataAttributes["data-agent-native-node-id"] === stableId,
        );
        const acceptedNode = mapAcceptedSelectionNode(
          update,
          displayedProjection,
          submittedNode,
        );
        if (acceptedNode) refreshedIds.set(owner.layerId, acceptedNode.id);
      }
      acceptedProjection = displayedProjection;
    } else if (pendingRefreshedIds.size === 0) continue;
    if (content === originalContent) {
      acceptedProjection = buildCodeLayerProjection(content, {
        source: sourceProjection.source,
      });
      pendingRefreshedIds.forEach((stableId, layerId) => {
        const refreshedNode = acceptedProjection?.nodes.find(
          (node) =>
            node.dataAttributes["data-agent-native-node-id"] === stableId,
        );
        if (refreshedNode) refreshedIds.set(layerId, refreshedNode.id);
      });
    }
    for (const owner of owners) {
      const stableId = refreshedIds.get(owner.layerId);
      if (!stableId) continue;
      const refreshedNode = acceptedProjection?.nodes.find(
        (node) => node.id === stableId,
      );
      if (!refreshedNode) continue;
      refreshedIds.set(owner.layerId, refreshedNode.id);
      if (owner.layerId === requestedSelectedId) {
        selectedElementNode = refreshedNode;
      }
    }
  }
  const nextLayerIds = requestedLayerIds.map(
    (layerId) => refreshedIds.get(layerId) ?? layerId,
  );
  setSelectedLayerIdsState(nextLayerIds);
  const selectedId = nextLayerIds[nextLayerIds.length - 1];
  if (!selectedId) {
    setSelectedElement(null);
    return nextLayerIds;
  }
  const codeLayerOwner =
    codeLayerOwnerByNodeId.get(selectedId) ??
    (requestedSelectedId
      ? codeLayerOwnerByNodeId.get(requestedSelectedId)
      : undefined);
  if (codeLayerOwner) {
    const ownerIsScreenFile = screenFileIds.includes(codeLayerOwner.fileId);
    if (viewModeRef.current === "overview") {
      pendingOverviewScreenSelectionRef.current = ownerIsScreenFile
        ? codeLayerOwner.fileId
        : null;
      pendingOverviewLayerSelectionRef.current = selectedId;
    }
    if (codeLayerOwner.fileId !== activeFile?.id) {
      setActiveFileId(codeLayerOwner.fileId);
    }
    const nextSelectionState = getSidebarCodeLayerSelectionState({
      currentViewMode: viewModeRef.current,
      ownerFileId: codeLayerOwner.fileId,
      overviewSelectedScreenIds,
      screenFileIds,
    });
    viewModeRef.current = nextSelectionState.viewMode;
    setViewMode(nextSelectionState.viewMode);
    if (nextSelectionState.viewMode === "overview") {
      setOverviewSelectedScreenIds(
        requestedScreenIds.length > 0
          ? requestedScreenIds
          : nextSelectionState.overviewSelectedScreenIds,
      );
    }
    const layerCanvasBlocked =
      effectiveCodeLayerState.lockedIds.has(codeLayerOwner.fileId) ||
      effectiveCodeLayerState.hiddenIds.has(codeLayerOwner.fileId) ||
      effectiveCodeLayerState.lockedIds.has(selectedId) ||
      effectiveCodeLayerState.hiddenIds.has(selectedId);
    if (layerCanvasBlocked) {
      setSelectedElement(null);
      focusDesignInspectorForSelection();
      setActiveTool(resolveToolAfterSelection);
      setMode("edit");
      return nextLayerIds;
    }
    const selectedNode = selectedElementNode ?? codeLayerOwner.node;
    setSelectedElement(
      elementInfoForOwnedCodeLayerNode({
        info: selectedElement,
        node: selectedNode,
        ownerFileId: codeLayerOwner.fileId,
      }),
    );
    focusDesignInspectorForSelection();
    setActiveTool(resolveToolAfterSelection);
    setMode("edit");
    return nextLayerIds;
  }
  if (selectedId.startsWith("element:")) return nextLayerIds;
  const fileId = selectedId.startsWith("code:")
    ? selectedId.slice("code:".length)
    : selectedId;
  if (screenFileIds.includes(fileId)) {
    setOverviewSelectedScreenIds(
      requestedScreenIds.length > 0 ? requestedScreenIds : [fileId],
    );
    setActiveFileId(fileId);
    setSelectedElement(null);
    setSelectedLayerIdsState(
      nextLayerIds.some((layerId) => files.some((file) => file.id === layerId))
        ? nextLayerIds
        : [fileId],
    );
    setActiveTool(resolveToolAfterSelection);
    setMode("edit");
    viewModeRef.current = "overview";
    setViewMode("overview");
  }
  return nextLayerIds;
}
