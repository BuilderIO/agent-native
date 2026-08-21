import { isBoardFile } from "@shared/board-file";
import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { ElementInfo } from "@/components/design/types";
import type { EffectiveCodeLayerState } from "@/pages/design-editor/code-layer-state";
import { elementInfoFromCodeLayerNode } from "@/pages/design-editor/code-layer-state";
import {
  getOverviewScreenIdsFromLayerSelection,
  getSidebarCodeLayerSelectionState,
} from "@/pages/design-editor/selection-state";
import type {
  DesignFile,
  DesignTool,
  EditorMode,
} from "@/pages/design-editor/types";

export interface LayerSelectionChangeArgs {
  activeFile: DesignFile;
  clearPendingOverviewLayerSelectionTimer: () => void;
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
  focusDesignInspectorForSelection: () => void;
  overviewSelectedScreenIds: string[];
  pendingOverviewLayerSelectionRef: RefObject<string | null>;
  pendingOverviewScreenSelectionRef: RefObject<string | null>;
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setActiveTool: Dispatch<SetStateAction<DesignTool>>;
  setCreatedOverviewLayerSelection: Dispatch<
    SetStateAction<{ screenId: string; layerId: string } | null>
  >;
  setMode: Dispatch<SetStateAction<EditorMode>>;
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  setViewMode: Dispatch<SetStateAction<"single" | "overview">>;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runLayerSelectionChange(
  {
    activeFile,
    clearPendingOverviewLayerSelectionTimer,
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    files,
    focusDesignInspectorForSelection,
    overviewSelectedScreenIds,
    pendingOverviewLayerSelectionRef,
    pendingOverviewScreenSelectionRef,
    setActiveFileId,
    setActiveTool,
    setCreatedOverviewLayerSelection,
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
) {
  const nextLayerIds = ids.filter((layerId) => !layerId.startsWith("__"));
  pendingOverviewScreenSelectionRef.current = null;
  pendingOverviewLayerSelectionRef.current = null;
  clearPendingOverviewLayerSelectionTimer();
  setCreatedOverviewLayerSelection(null);
  setSelectedLayerIdsState(nextLayerIds);
  const screenFileIds = files
    .filter((file) => !isBoardFile(file.filename))
    .map((file) => file.id);
  if (viewModeRef.current === "overview") {
    setOverviewSelectedScreenIds(
      getOverviewScreenIdsFromLayerSelection({
        fileIds: screenFileIds,
        layerIds: nextLayerIds,
      }),
    );
  }
  const selectedId = nextLayerIds[nextLayerIds.length - 1];
  if (!selectedId) {
    setSelectedElement(null);
    return;
  }
  const codeLayerOwner = codeLayerOwnerByNodeId.get(selectedId);
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
        nextSelectionState.overviewSelectedScreenIds,
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
      setActiveTool("move");
      setMode("edit");
      return;
    }
    setSelectedElement(elementInfoFromCodeLayerNode(codeLayerOwner.node));
    focusDesignInspectorForSelection();
    setActiveTool("move");
    setMode("edit");
    return;
  }
  if (selectedId.startsWith("element:")) return;
  const fileId = selectedId.startsWith("code:")
    ? selectedId.slice("code:".length)
    : selectedId;
  if (files.some((file) => file.id === fileId && !isBoardFile(file.filename))) {
    setOverviewSelectedScreenIds([fileId]);
    setActiveFileId(fileId);
    setSelectedElement(null);
    setSelectedLayerIdsState(
      nextLayerIds.some((layerId) => files.some((file) => file.id === layerId))
        ? nextLayerIds
        : [fileId],
    );
    setActiveTool("move");
    setMode("edit");
    viewModeRef.current = "overview";
    setViewMode("overview");
  }
}
