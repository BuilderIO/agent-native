import type { CodeLayerTreeNode } from "@shared/code-layer";

export type SelectAllDecision =
  | { kind: "layers"; layerIds: string[] }
  | { kind: "screens" };

export type SelectAllFallback = "screens" | "top-level-layers";

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

export function runSelectAll(args: {
  tree: readonly CodeLayerTreeNode[];
  selectedLayerIds: readonly string[];
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
