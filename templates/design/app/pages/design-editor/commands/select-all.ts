import type { CodeLayerTreeNode } from "@shared/code-layer";

export type SelectAllDecision =
  | { kind: "layers"; layerIds: string[] }
  | { kind: "screens" };

/**
 * What Cmd+A falls back to when nothing is selected. Overview treats screens as
 * the top-level objects; a single screen treats its own root layers as those.
 */
export type SelectAllFallback = "screens" | "top-level-layers";

/** Includes the anchor, so select-all never drops the row it started from. */
function siblingIdsOf(
  nodes: readonly CodeLayerTreeNode[],
  layerId: string,
): string[] | null {
  if (nodes.some((node) => node.id === layerId)) {
    return nodes.map((node) => node.id);
  }
  for (const node of nodes) {
    const found = siblingIdsOf(node.children, layerId);
    if (found) return found;
  }
  return null;
}

/**
 * A repeat renders N rows from one source element, so its rows share one layer
 * id and collapse to a single entry here. Selecting that entry is what makes an
 * edit reach every row.
 */
export function runSelectAll(args: {
  tree: readonly CodeLayerTreeNode[];
  selectedLayerIds: readonly string[];
  /** Screen/file rows are not layers, and `__` ids are editor-internal. */
  nonLayerIds: ReadonlySet<string>;
  fallback: SelectAllFallback;
}): SelectAllDecision {
  const anchor = args.selectedLayerIds.find(
    (id) => id && !id.startsWith("__") && !args.nonLayerIds.has(id),
  );
  const siblings = anchor ? siblingIdsOf(args.tree, anchor) : null;
  if (siblings && siblings.length > 0) {
    return { kind: "layers", layerIds: siblings };
  }
  if (args.fallback === "top-level-layers" && args.tree.length > 0) {
    return { kind: "layers", layerIds: args.tree.map((node) => node.id) };
  }
  return { kind: "screens" };
}
