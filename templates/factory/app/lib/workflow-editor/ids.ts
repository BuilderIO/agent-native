import { nodeScopeKey, type WorkflowGraph } from "./engine.js";

const MAX_IDENTIFIER_LENGTH = 64;

/** `assess` then `assess2`, `assess3`: a taken name gains the next free number. */
export function nextFreeName(base: string, isTaken: (name: string) => boolean) {
  const stem = base.replace(/\d+$/, "") || base;
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? "" : String(n);
    const candidate = `${stem.slice(0, MAX_IDENTIFIER_LENGTH - suffix.length)}${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
}

/**
 * A name that is free as a scope key and as an id, so a node can use one
 * string for both. Ids stay put when a node is renamed, which is why the two
 * can drift apart and both have to be checked.
 */
export function nextNodeIdentity(graph: WorkflowGraph, base: string): string {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const keys = new Set(graph.nodes.map(nodeScopeKey));
  return nextFreeName(base, (name) => ids.has(name) || keys.has(name));
}

export function nextEdgeId(graph: WorkflowGraph): string {
  const taken = new Set(graph.edges.map((edge) => edge.id));
  for (let n = graph.edges.length + 1; ; n += 1) {
    const id = `e${n}`;
    if (!taken.has(id)) return id;
  }
}

export function nextRouteId(existing: readonly string[]): string {
  const taken = new Set(existing);
  for (let n = existing.length + 1; ; n += 1) {
    const id = `route${n}`;
    if (!taken.has(id)) return id;
  }
}
