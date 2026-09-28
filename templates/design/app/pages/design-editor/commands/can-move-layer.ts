import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";

import type { LayersPanelMoveIntent } from "@/components/design/LayersPanel";
import type { EffectiveCodeLayerState } from "@/pages/design-editor/code-layer-state";
import { collectCodeLayerAncestors } from "@/pages/design-editor/code-layer-state";
import type { DesignFile } from "@/pages/design-editor/types";

export interface CanMoveLayerArgs {
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
  liveScreenIds?: ReadonlySet<string>;
  lockedLayerIds: Set<string>;
  visualScreenFileIds: Set<string>;
}

export function runCanMoveLayer(
  {
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    files,
    liveScreenIds,
    lockedLayerIds,
    visualScreenFileIds,
  }: CanMoveLayerArgs,
  intent: LayersPanelMoveIntent,
) {
  const targetOwner = codeLayerOwnerByNodeId.get(intent.targetId);
  const targetFile = !targetOwner
    ? files.find((file) => file.id === intent.targetId)
    : undefined;
  const draggedScreenIds = intent.draggedIds.filter((draggedId) =>
    visualScreenFileIds.has(draggedId),
  );
  if (draggedScreenIds.length > 0) {
    return Boolean(
      draggedScreenIds.length === intent.draggedIds.length &&
      targetFile &&
      visualScreenFileIds.has(targetFile.id) &&
      intent.placement !== "inside" &&
      draggedScreenIds.every(
        (screenId) =>
          screenId !== targetFile.id && !lockedLayerIds.has(screenId),
      ),
    );
  }
  if (!targetOwner && !targetFile) {
    return false;
  }
  const runtimeDraggedOwners = intent.draggedIds.map((draggedId) =>
    codeLayerOwnerByNodeId.get(draggedId),
  );
  const hasRuntimeDraggedOwner = runtimeDraggedOwners.some(
    (owner) => owner?.runtimeOnly,
  );
  if (targetOwner?.runtimeOnly || hasRuntimeDraggedOwner) {
    if (!targetOwner?.runtimeOnly || intent.draggedIds.length !== 1) {
      return false;
    }
    const draggedId = intent.draggedIds[0]!;
    const draggedOwner = runtimeDraggedOwners[0];
    const liveRuntimeCrossScreenMove = Boolean(
      draggedOwner?.runtimeOnly &&
      liveScreenIds?.has(draggedOwner.fileId) &&
      liveScreenIds.has(targetOwner.fileId) &&
      draggedOwner.fileId !== targetOwner.fileId,
    );
    return Boolean(
      draggedOwner?.runtimeOnly &&
      draggedId !== intent.targetId &&
      (draggedOwner.fileId === targetOwner.fileId ||
        liveRuntimeCrossScreenMove) &&
      !effectiveCodeLayerState.lockedIds.has(draggedId) &&
      !collectCodeLayerAncestors(targetOwner.tree, intent.targetId).includes(
        draggedId,
      ),
    );
  }
  return intent.draggedIds.some((draggedId) => {
    const draggedOwner = codeLayerOwnerByNodeId.get(draggedId);
    if (
      draggedId === intent.targetId ||
      !draggedOwner ||
      draggedOwner.runtimeOnly ||
      effectiveCodeLayerState.lockedIds.has(draggedId)
    ) {
      return false;
    }
    if (targetFile) {
      return true;
    }
    if (targetOwner && draggedOwner.fileId === targetOwner.fileId) {
      return !collectCodeLayerAncestors(
        targetOwner.tree,
        intent.targetId,
      ).includes(draggedId);
    }
    return true;
  });
}
