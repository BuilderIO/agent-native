import type {
  NodeKind,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeOfKind,
} from "./contract.js";

export const OUT_PORT = "out";
export const OTHERWISE_PORT = "otherwise";
export const LIMIT_REACHED_PORT = "limitReached";

/** Kinds whose outputs do not depend on their settings. */
export const STATIC_PORTS: Readonly<
  Record<Exclude<NodeKind, "switch" | "wait">, readonly string[]>
> = {
  trigger: [OUT_PORT],
  source: [OUT_PORT],
  lookup: [OUT_PORT],
  action: [OUT_PORT],
  filter: ["match", OTHERWISE_PORT],
  combine: [OUT_PORT],
  split: [OUT_PORT],
  ai: [OUT_PORT],
  agent: [OUT_PORT],
  end: [],
};

export function routePort(routeId: string): string {
  return `route:${routeId}`;
}

function unique(ports: string[]): string[] {
  return [...new Set(ports)];
}

function waitPorts(settings: WorkflowNodeOfKind<"wait">["settings"]): string[] {
  switch (settings.wait) {
    case "reply":
      return ["replied", "timedOut"];
    case "time":
      return ["done"];
    case "condition":
      return ["met", "timedOut"];
  }
}

export function portsFor(node: WorkflowNode): string[] {
  if (node.kind === "switch") {
    return unique([
      ...node.settings.routes.map((route) => routePort(route.id)),
      OTHERWISE_PORT,
    ]);
  }
  if (node.kind === "wait") return waitPorts(node.settings);
  return [...STATIC_PORTS[node.kind]];
}

/** A node that a back-edge leaves also exposes `limitReached`, taken when the loop runs out of passes. */
export function portsWithLimit(
  graph: WorkflowGraph,
  node: WorkflowNode,
): string[] {
  const ports = portsFor(node);
  const hasBackEdge = graph.edges.some(
    (edge) => edge.back !== undefined && edge.from.node === node.id,
  );
  return hasBackEdge ? [...ports, LIMIT_REACHED_PORT] : ports;
}
