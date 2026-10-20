import type { WorkflowGraph } from "./engine.js";
import type { Selection, SelectionContext } from "./types.js";

/** Most ids and summaries the agent context carries for each of nodes and edges. */
export const SELECTION_CONTEXT_LIMIT = 20;

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function sameSelection(a: Selection, b: Selection): boolean {
  return sameIds(a.nodeIds, b.nodeIds) && sameIds(a.edgeIds, b.edgeIds);
}

/** Keeps the ids that exist, once each, in graph order. */
export function pruneSelection(
  graph: WorkflowGraph,
  selection: Selection,
): Selection {
  const nodeIds = new Set(selection.nodeIds);
  const edgeIds = new Set(selection.edgeIds);
  return {
    nodeIds: graph.nodes.map((n) => n.id).filter((id) => nodeIds.has(id)),
    edgeIds: graph.edges.map((e) => e.id).filter((id) => edgeIds.has(id)),
  };
}

/**
 * A small, serializable summary of what is selected, for the page to mirror
 * into application state so the agent sees what the user is looking at. Its
 * size does not grow with the graph.
 */
export function getSelectionContext(
  graph: WorkflowGraph,
  selection: Selection,
): SelectionContext {
  const nodeIds = new Set(selection.nodeIds);
  const edgeIds = new Set(selection.edgeIds);
  const nodes = graph.nodes.filter((node) => nodeIds.has(node.id));
  const edges = graph.edges.filter((edge) => edgeIds.has(edge.id));
  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    selectedNodes: nodes.slice(0, SELECTION_CONTEXT_LIMIT).map((node) => ({
      id: node.id,
      name: node.name,
      kind: node.kind,
      ...("operation" in node.settings
        ? { operation: node.settings.operation }
        : node.kind === "agent"
          ? { operation: `${node.settings.agent}.${node.settings.op}` }
          : {}),
    })),
    selectedEdges: edges.slice(0, SELECTION_CONTEXT_LIMIT).map((edge) => ({
      id: edge.id,
      from: edge.from.node,
      port: edge.from.port,
      to: edge.to.node,
      ...(edge.back ? { back: true as const } : {}),
    })),
    truncated:
      nodes.length > SELECTION_CONTEXT_LIMIT ||
      edges.length > SELECTION_CONTEXT_LIMIT,
  };
}
