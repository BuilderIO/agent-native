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
  lockedLayerIds: Set<string>;
  visualScreenFileIds: Set<string>;
}

export function runCanMoveLayer(
  {
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    files,
    lockedLayerIds,
    visualScreenFileIds,
  }: CanMoveLayerArgs,
  intent: LayersPanelMoveIntent,
) {
  const targetOwner = codeLayerOwnerByNodeId.get(intent.targetId);
  // L19: a file/screen row is a valid drop target too — dropping a layer
  // "on" a screen row (no code-layer owner, since it isn't a DOM node)
  // appends it into that screen's body via moveNodeBetweenDocuments.
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
  // L8: a locked or hidden row can still be used as a before/after/inside
  // drop ANCHOR — locking/hiding a layer shouldn't make it impossible to
  // position other layers relative to it in the panel. Only dragging
  // (see per-draggedId checks below) stays gated by locked/hidden.
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
    return Boolean(
      draggedOwner?.runtimeOnly &&
      draggedId !== intent.targetId &&
      draggedOwner.fileId === targetOwner.fileId &&
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
      // L8: dragging a LOCKED row is still blocked (locked means
      // don't-touch-this-layer). A HIDDEN row is now draggable — hidden
      // only means "not rendered in canvas", not "structurally frozen".
      effectiveCodeLayerState.lockedIds.has(draggedId)
    ) {
      return false;
    }
    if (targetFile) {
      // Dropping directly onto a screen row: any non-locked DOM layer
      // from any file can be appended into that screen's body, EXCEPT a
      // node that's already a top-level (parentless) child of that same
      // screen and would end up in the same place — still allow it
      // through here; handleLayerMove no-ops that case cheaply.
      return true;
    }
    // Same-file move: also exclude ancestor drags (would orphan the node).
    if (targetOwner && draggedOwner.fileId === targetOwner.fileId) {
      return !collectCodeLayerAncestors(
        targetOwner.tree,
        intent.targetId,
      ).includes(draggedId);
    }
    // Cross-file move: allowed as long as the dragged side isn't locked
    // (already checked above). File-row ids are excluded by the owner check.
    return true;
  });
}
