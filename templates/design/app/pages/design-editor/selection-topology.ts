import type { CodeLayerNode } from "@shared/code-layer";

export interface AlignmentGroup {
  parentId: string | null;
  nodeIds: string[];
}

/**
 * Collapse single-child pass-through wrappers: walk UP from `nodeId` while the
 * parent has exactly one child and no layout role (`!isFlexContainer &&
 * !isGridContainer`), returning the id of the nearest meaningful parent (or the
 * original parentId if none). Returns null when there is no parent or the walk
 * climbs off the top.
 */
export function nearestMeaningfulParentId(
  nodesById: Map<string, CodeLayerNode>,
  nodeId: string,
): string | null {
  const node = nodesById.get(nodeId);
  if (!node) return null;

  let currentId: string | undefined = node.parentId;
  while (currentId !== undefined) {
    const parent = nodesById.get(currentId);
    // An unresolvable parent is an opaque boundary — it can't be collapsed, so
    // treat its id as the nearest meaningful parent.
    if (!parent) return currentId;

    const isPassThroughWrapper =
      parent.children.length === 1 &&
      !parent.layout.isFlexContainer &&
      !parent.layout.isGridContainer;
    if (!isPassThroughWrapper) return currentId;

    currentId = parent.parentId;
  }
  return null;
}

/** Partition a multi-selection into the smallest valid alignment groups. */
export function partitionSelectionForAlignment(
  nodes: CodeLayerNode[],
  selectedIds: string[],
): AlignmentGroup[] {
  const nodesById = new Map<string, CodeLayerNode>(
    nodes.map((node) => [node.id, node]),
  );

  const selectedExisting: string[] = [];
  const selectedSet = new Set<string>();
  for (const id of selectedIds) {
    if (!nodesById.has(id) || selectedSet.has(id)) continue;
    selectedSet.add(id);
    selectedExisting.push(id);
  }

  const hasSelectedAncestor = (id: string): boolean => {
    let currentId = nodesById.get(id)?.parentId;
    while (currentId !== undefined) {
      if (selectedSet.has(currentId)) return true;
      currentId = nodesById.get(currentId)?.parentId;
    }
    return false;
  };

  const groups = new Map<string | null, string[]>();
  for (const id of selectedExisting) {
    if (hasSelectedAncestor(id)) continue;
    const key = nearestMeaningfulParentId(nodesById, id);
    const members = groups.get(key);
    if (members) members.push(id);
    else groups.set(key, [id]);
  }

  const result: AlignmentGroup[] = [];
  for (const [parentId, nodeIds] of groups) {
    if (nodeIds.length === 0) continue;
    result.push({ parentId, nodeIds });
  }
  return result;
}
