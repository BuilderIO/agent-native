import {
  WorkflowError,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from "../contract.js";

export interface GraphPlan {
  /** Every node, upstream before downstream. */
  readonly order: readonly string[];
  readonly nodes: ReadonlyMap<string, WorkflowNode>;
  /** Forward edges only, by the node they leave. */
  readonly outgoing: ReadonlyMap<string, readonly WorkflowEdge[]>;
  /** Loop back-edges, by the node they leave. */
  readonly backEdges: ReadonlyMap<string, readonly WorkflowEdge[]>;
}

/** One loop: the back-edge, where it sends items, and the nodes a pass runs through. */
export interface LoopInfo {
  readonly edgeId: string;
  /** The node the back-edge returns to. */
  readonly head: string;
  /** The node the back-edge leaves. */
  readonly tail: string;
  /** The passes an item may repeat before it leaves by `limitReached`. */
  readonly max: number;
  /** Every node on a path from the head to the tail, both included. */
  readonly body: ReadonlySet<string>;
}

/**
 * Orders the nodes over forward edges, ties broken by the order they are
 * listed in. A graph that passed validation has no cycle without a back-edge;
 * one that does fails here instead of looping.
 */
export function planGraph(graph: WorkflowGraph): GraphPlan {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const position = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const outgoing = new Map<string, WorkflowEdge[]>();
  const backEdges = new Map<string, WorkflowEdge[]>();
  const waiting = new Map<string, number>(
    graph.nodes.map((node) => [node.id, 0]),
  );
  for (const edge of graph.edges) {
    if (edge.back) {
      backEdges.set(edge.from.node, [
        ...(backEdges.get(edge.from.node) ?? []),
        edge,
      ]);
      continue;
    }
    outgoing.set(edge.from.node, [
      ...(outgoing.get(edge.from.node) ?? []),
      edge,
    ]);
    waiting.set(edge.to.node, (waiting.get(edge.to.node) ?? 0) + 1);
  }
  const ready = graph.nodes
    .filter((node) => waiting.get(node.id) === 0)
    .map((node) => node.id);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
    const next = ready.shift();
    if (next === undefined) break;
    order.push(next);
    for (const edge of outgoing.get(next) ?? []) {
      const left = (waiting.get(edge.to.node) ?? 0) - 1;
      waiting.set(edge.to.node, left);
      if (left === 0) ready.push(edge.to.node);
    }
  }
  if (order.length !== graph.nodes.length) {
    throw new WorkflowError(
      "graph_invalid",
      "The graph has a cycle that is not a loop back-edge.",
    );
  }
  return { order, nodes, outgoing, backEdges };
}

function reach(
  start: string,
  edges: readonly WorkflowEdge[],
  direction: "forward" | "reverse",
): Set<string> {
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const [from, to] =
      direction === "forward"
        ? [edge.from.node, edge.to.node]
        : [edge.to.node, edge.from.node];
    next.set(from, [...(next.get(from) ?? []), to]);
  }
  const seen = new Set([start]);
  const queue = [start];
  for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
    for (const target of next.get(node) ?? []) {
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

/**
 * The loops of a graph, one per back-edge. The validator has already refused a
 * loop that avoids a Wait or nests in another, so a body here is one pass of
 * nodes an item runs again.
 */
export function loopsOf(graph: WorkflowGraph): LoopInfo[] {
  const forward = graph.edges.filter((edge) => !edge.back);
  return graph.edges.flatMap((edge): LoopInfo[] => {
    if (!edge.back) return [];
    const downstream = reach(edge.to.node, forward, "forward");
    const upstream = reach(edge.from.node, forward, "reverse");
    return [
      {
        edgeId: edge.id,
        head: edge.to.node,
        tail: edge.from.node,
        max: edge.back.maxIterations,
        body: new Set([...downstream].filter((id) => upstream.has(id))),
      },
    ];
  });
}
