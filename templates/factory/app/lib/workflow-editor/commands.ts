import { createNode } from "./defaults.js";
import {
  LIMIT_REACHED_PORT,
  MAX_EDGES,
  MAX_NODES,
  identifierSchema,
  nodeScopeKey,
  portsFor,
  portsWithLimit,
  workflowNodeSchema,
  type NodeKind,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeSettings,
} from "./engine.js";
import { nextEdgeId, nextFreeName, nextNodeIdentity } from "./ids.js";
import { fitGroupOffset, fitNewNodePosition } from "./layout.js";
import { nodeSize } from "./node-metrics.js";
import { findNodeReferences } from "./references.js";
import {
  DEFAULT_MAX_ITERATIONS,
  reject,
  type BackEdgeInput,
  type GraphEdit,
  type NewNodeOptions,
  type NodeReference,
  type Point,
  type Rejection,
  type SettingsIssue,
  type WorkflowCatalog,
} from "./types.js";

const MAX_COORDINATE = 100_000;

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function nodeById(graph: WorkflowGraph, id: string): WorkflowNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}

function withNode(graph: WorkflowGraph, node: WorkflowNode): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((existing) =>
      existing.id === node.id ? node : existing,
    ),
  };
}

/** Everything a forward walk from `start` reaches, `start` included. */
function forwardReachable(graph: WorkflowGraph, start: string): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const edge of graph.edges) {
      if (edge.back || edge.from.node !== next || seen.has(edge.to.node)) {
        continue;
      }
      seen.add(edge.to.node);
      queue.push(edge.to.node);
    }
  }
  return seen;
}

function portIsValid(graph: WorkflowGraph, edge: WorkflowEdge): boolean {
  const from = nodeById(graph, edge.from.node);
  if (!from) return false;
  const ports = edge.back ? portsFor(from) : portsWithLimit(graph, from);
  return ports.includes(edge.from.port);
}

/**
 * Drops edges that leave one of `nodeIds` from a port the node no longer has:
 * a switch route that was removed, a Wait that changed kind, or `limitReached`
 * once the last back-edge is gone. A handle that does not exist cannot be drawn,
 * so leaving such an edge behind would hide it from the author.
 */
function pruneDeadPorts(
  graph: WorkflowGraph,
  nodeIds: Iterable<string>,
): { graph: WorkflowGraph; prunedEdgeIds: string[] } {
  const affected = new Set(nodeIds);
  const dead = graph.edges.filter(
    (edge) => affected.has(edge.from.node) && !portIsValid(graph, edge),
  );
  if (dead.length === 0) return { graph, prunedEdgeIds: [] };
  const gone = new Set(dead.map((edge) => edge.id));
  return {
    graph: { ...graph, edges: graph.edges.filter((e) => !gone.has(e.id)) },
    prunedEdgeIds: dead.map((edge) => edge.id),
  };
}

export function addNode(
  graph: WorkflowGraph,
  catalog: WorkflowCatalog,
  kind: NodeKind,
  options: NewNodeOptions = {},
): GraphEdit<{ node: WorkflowNode; edge?: WorkflowEdge }> {
  if (graph.nodes.length >= MAX_NODES) {
    return reject("node_limit", `A workflow has at most ${MAX_NODES} nodes.`);
  }
  if (kind === "trigger" && graph.nodes.some((n) => n.kind === "trigger")) {
    return reject("trigger_exists", "A workflow has exactly one trigger.");
  }
  if (options.after) {
    const from = nodeById(graph, options.after.node);
    if (!from) {
      return reject("unknown_node", `No node "${options.after.node}".`);
    }
  }
  const identity = nextNodeIdentity(graph, kind);
  const made = createNode(
    kind,
    {
      id: identity,
      name: identity,
      position: { x: 0, y: 0 },
    },
    catalog,
    options,
  );
  if (!made.ok) return made;
  const position =
    options.position ??
    fitNewNodePosition(graph, {
      after: options.after?.node,
      size: nodeSize(graph, made.node),
    });
  const node: WorkflowNode = {
    ...made.node,
    position: clampPosition(position),
  };
  const added: WorkflowGraph = { ...graph, nodes: [...graph.nodes, node] };
  if (!options.after) {
    return { ok: true, graph: added, node, selection: selectNode(node.id) };
  }
  const connected = connect(added, options.after, node.id);
  if (!connected.ok) return connected;
  return {
    ok: true,
    graph: connected.graph,
    node,
    edge: connected.edge,
    selection: selectNode(node.id),
  };
}

function selectNode(id: string) {
  return { nodeIds: [id], edgeIds: [] };
}

function clampPosition(point: Point): Point {
  const clamp = (value: number) =>
    Math.round(Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, value)));
  return { x: clamp(point.x), y: clamp(point.y) };
}

export function deleteElements(
  graph: WorkflowGraph,
  ids: { nodeIds?: readonly string[]; edgeIds?: readonly string[] },
): GraphEdit<{ removedNodeIds: string[]; removedEdgeIds: string[] }> {
  const nodeIds = new Set(ids.nodeIds ?? []);
  const edgeIds = new Set(ids.edgeIds ?? []);
  for (const id of nodeIds) {
    if (!nodeById(graph, id)) return reject("unknown_node", `No node "${id}".`);
  }
  for (const id of edgeIds) {
    if (!graph.edges.some((edge) => edge.id === id)) {
      return reject("unknown_edge", `No edge "${id}".`);
    }
  }
  const removedEdges = graph.edges.filter(
    (edge) =>
      edgeIds.has(edge.id) ||
      nodeIds.has(edge.from.node) ||
      nodeIds.has(edge.to.node),
  );
  if (nodeIds.size === 0 && removedEdges.length === 0) {
    return { ok: true, graph, removedNodeIds: [], removedEdgeIds: [] };
  }
  const gone = new Set(removedEdges.map((edge) => edge.id));
  const remaining: WorkflowGraph = {
    ...graph,
    nodes: graph.nodes.filter((node) => !nodeIds.has(node.id)),
    edges: graph.edges.filter((edge) => !gone.has(edge.id)),
  };
  const pruned = pruneDeadPorts(
    remaining,
    removedEdges.map((edge) => edge.from.node),
  );
  return {
    ok: true,
    graph: pruned.graph,
    removedNodeIds: [...nodeIds],
    removedEdgeIds: [...gone, ...pruned.prunedEdgeIds],
  };
}

export function duplicateNodes(
  graph: WorkflowGraph,
  nodeIds: readonly string[],
): GraphEdit<{
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  skipped: string[];
}> {
  const sources: WorkflowNode[] = [];
  const skipped: string[] = [];
  for (const id of new Set(nodeIds)) {
    const node = nodeById(graph, id);
    if (!node) return reject("unknown_node", `No node "${id}".`);
    // A workflow has exactly one trigger.
    if (node.kind === "trigger") skipped.push(id);
    else sources.push(node);
  }
  if (sources.length === 0) {
    return skipped.length > 0
      ? reject("trigger_exists", "A workflow has exactly one trigger.")
      : { ok: true, graph, nodes: [], edges: [], skipped };
  }
  if (graph.nodes.length + sources.length > MAX_NODES) {
    return reject("node_limit", `A workflow has at most ${MAX_NODES} nodes.`);
  }
  const offset = fitGroupOffset(graph, sources);
  const idMap = new Map<string, string>();
  let working = graph;
  const copies: WorkflowNode[] = [];
  for (const source of sources) {
    const identity = nextNodeIdentity(working, source.name);
    idMap.set(source.id, identity);
    const copy = structuredClone(source) as WorkflowNode;
    copy.id = identity;
    copy.name = identity;
    copy.position = clampPosition({
      x: source.position.x + offset.x,
      y: source.position.y + offset.y,
    });
    if (copy.kind === "lookup" && copy.settings.into) {
      // `into` is the scope key; a copy sharing it would shadow the original.
      const taken = new Set(working.nodes.map(nodeScopeKey));
      copy.settings.into = nextFreeName(copy.settings.into, (n) =>
        taken.has(n),
      );
    }
    working = { ...working, nodes: [...working.nodes, copy] };
    copies.push(copy);
  }
  for (const copy of copies) {
    if (
      copy.kind === "wait" &&
      copy.settings.wait === "reply" &&
      copy.settings.watch
    ) {
      const mapped = idMap.get(copy.settings.watch.fromNode);
      if (mapped) copy.settings.watch = { fromNode: mapped };
    }
  }
  const internal = graph.edges.filter(
    (edge) => idMap.has(edge.from.node) && idMap.has(edge.to.node),
  );
  if (graph.edges.length + internal.length > MAX_EDGES) {
    return reject("edge_limit", `A workflow has at most ${MAX_EDGES} edges.`);
  }
  const copiedEdges: WorkflowEdge[] = [];
  for (const edge of internal) {
    const id = nextEdgeId({
      ...working,
      edges: [...working.edges, ...copiedEdges],
    });
    copiedEdges.push({
      ...structuredClone(edge),
      id,
      from: { node: idMap.get(edge.from.node)!, port: edge.from.port },
      to: { node: idMap.get(edge.to.node)! },
    });
  }
  return {
    ok: true,
    graph: { ...working, edges: [...working.edges, ...copiedEdges] },
    nodes: copies,
    edges: copiedEdges,
    skipped,
    selection: { nodeIds: copies.map((copy) => copy.id), edgeIds: [] },
  };
}

export function moveNodes(
  graph: WorkflowGraph,
  positions: Record<string, Point>,
): GraphEdit {
  for (const [id, point] of Object.entries(positions)) {
    if (!nodeById(graph, id)) return reject("unknown_node", `No node "${id}".`);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return reject(
        "invalid_position",
        `The position of "${id}" is not finite.`,
      );
    }
  }
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    const target = positions[node.id];
    if (!target) return node;
    const position = clampPosition(target);
    if (position.x === node.position.x && position.y === node.position.y) {
      return node;
    }
    changed = true;
    return { ...node, position };
  });
  return { ok: true, graph: changed ? { ...graph, nodes } : graph };
}

/**
 * Renames a node. Nothing else changes: expressions that read the old name
 * keep reading it, and `references` lists them so the caller can say so.
 */
export function renameNode(
  graph: WorkflowGraph,
  nodeId: string,
  name: string,
): GraphEdit<{ references: NodeReference[] }> {
  const node = nodeById(graph, nodeId);
  if (!node) return reject("unknown_node", `No node "${nodeId}".`);
  const parsed = identifierSchema.safeParse(name);
  if (!parsed.success) {
    return reject(
      "invalid_name",
      parsed.error.issues[0]?.message ?? "Not a valid name.",
    );
  }
  if (name === node.name) return { ok: true, graph, references: [] };
  const renamed = { ...node, name } as WorkflowNode;
  const key = nodeScopeKey(renamed);
  const clash = graph.nodes.some(
    (other) => other.id !== nodeId && nodeScopeKey(other) === key,
  );
  if (clash) {
    return reject("duplicate_name", `Another node is already named "${key}".`);
  }
  const references =
    nodeScopeKey(node) === key ? [] : findNodeReferences(graph, nodeId);
  return { ok: true, graph: withNode(graph, renamed), references };
}

function backEdgeIssue(maxIterations: number) {
  return Number.isInteger(maxIterations) &&
    maxIterations >= 1 &&
    maxIterations <= 25
    ? undefined
    : reject("invalid_iterations", "A loop runs between 1 and 25 passes.");
}

export function connect(
  graph: WorkflowGraph,
  from: { node: string; port: string },
  toNode: string,
  options: { back?: BackEdgeInput | "auto" } = {},
): GraphEdit<{ edge: WorkflowEdge }> {
  const source = nodeById(graph, from.node);
  const target = nodeById(graph, toNode);
  if (!source) return reject("unknown_node", `No node "${from.node}".`);
  if (!target) return reject("unknown_node", `No node "${toNode}".`);
  if (target.kind === "trigger") {
    return reject("edge_into_trigger", "Nothing connects into the trigger.");
  }
  const back: BackEdgeInput | undefined =
    options.back === "auto"
      ? forwardReachable(graph, toNode).has(from.node)
        ? { maxIterations: DEFAULT_MAX_ITERATIONS }
        : undefined
      : options.back;
  if (from.node === toNode && !(back && source.kind === "wait")) {
    // A forward self-loop is always a cycle; only a Wait may loop onto itself.
    return reject("self_loop", "A node cannot connect to itself.");
  }
  if (back) {
    const invalid = backEdgeIssue(back.maxIterations);
    if (invalid) return invalid;
    if (from.port === LIMIT_REACHED_PORT) {
      return reject(
        "limit_port_back_edge",
        "A loop cannot leave from its own limit port.",
      );
    }
  }
  const ports = back ? portsFor(source) : portsWithLimit(graph, source);
  if (!ports.includes(from.port)) {
    return reject(
      "unknown_port",
      `"${source.name}" has no "${from.port}" port.`,
    );
  }
  if (
    graph.edges.some(
      (edge) =>
        edge.from.node === from.node &&
        edge.from.port === from.port &&
        edge.to.node === toNode,
    )
  ) {
    return reject("duplicate_connection", "These are already connected.");
  }
  if (graph.edges.length >= MAX_EDGES) {
    return reject("edge_limit", `A workflow has at most ${MAX_EDGES} edges.`);
  }
  const edge: WorkflowEdge = {
    id: nextEdgeId(graph),
    from: { node: from.node, port: from.port },
    to: { node: toNode },
    ...(back ? { back: { maxIterations: back.maxIterations } } : {}),
  };
  return { ok: true, graph: { ...graph, edges: [...graph.edges, edge] }, edge };
}

/** The first output a node has that nothing leaves yet, or undefined when every output is wired. */
export function firstOpenPort(
  graph: WorkflowGraph,
  nodeId: string,
): string | undefined {
  const node = nodeById(graph, nodeId);
  if (!node) return undefined;
  return portsFor(node).find(
    (port) =>
      !graph.edges.some(
        (edge) => edge.from.node === nodeId && edge.from.port === port,
      ),
  );
}

/** Whether dropping a connection here would be accepted, without making it. */
export function checkConnection(
  graph: WorkflowGraph,
  from: { node: string; port: string },
  toNode: string,
): { ok: true } | { ok: false; rejection: Rejection } {
  const result = connect(graph, from, toNode, { back: "auto" });
  return result.ok ? { ok: true } : result;
}

export function disconnect(
  graph: WorkflowGraph,
  edgeId: string,
): GraphEdit<{ removedEdgeIds: string[] }> {
  const edge = graph.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return reject("unknown_edge", `No edge "${edgeId}".`);
  const remaining = {
    ...graph,
    edges: graph.edges.filter((candidate) => candidate.id !== edgeId),
  };
  const pruned = pruneDeadPorts(remaining, [edge.from.node]);
  return {
    ok: true,
    graph: pruned.graph,
    removedEdgeIds: [edgeId, ...pruned.prunedEdgeIds],
  };
}

/** Marks an edge as a loop back-edge with a pass cap, or turns it back into a plain edge with `null`. */
export function setBackEdge(
  graph: WorkflowGraph,
  edgeId: string,
  back: BackEdgeInput | null,
): GraphEdit<{ prunedEdgeIds: string[] }> {
  const edge = graph.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return reject("unknown_edge", `No edge "${edgeId}".`);
  if (back) {
    const invalid = backEdgeIssue(back.maxIterations);
    if (invalid) return invalid;
    if (edge.from.port === LIMIT_REACHED_PORT) {
      return reject(
        "limit_port_back_edge",
        "A loop cannot leave from its own limit port.",
      );
    }
  }
  if (sameJson(edge.back ?? null, back)) {
    return { ok: true, graph, prunedEdgeIds: [] };
  }
  const { back: _previous, ...plain } = edge;
  const next: WorkflowEdge = back
    ? { ...plain, back: { maxIterations: back.maxIterations } }
    : plain;
  const updated: WorkflowGraph = {
    ...graph,
    edges: graph.edges.map((candidate) =>
      candidate.id === edgeId ? next : candidate,
    ),
  };
  const pruned = pruneDeadPorts(updated, [edge.from.node]);
  return { ok: true, graph: pruned.graph, prunedEdgeIds: pruned.prunedEdgeIds };
}

/**
 * Replaces a node's settings with a validated copy: the contract's schema
 * parses the whole node, so a settings value that does not fit its kind is
 * refused and the graph is left as it was.
 */
export function updateNodeSettings(
  graph: WorkflowGraph,
  nodeId: string,
  settings: WorkflowNodeSettings,
): GraphEdit<{ node: WorkflowNode; prunedEdgeIds: string[] }> {
  const node = nodeById(graph, nodeId);
  if (!node) return reject("unknown_node", `No node "${nodeId}".`);
  const parsed = workflowNodeSchema.safeParse({ ...node, settings });
  if (!parsed.success) {
    const issues: SettingsIssue[] = parsed.error.issues.map((issue) => ({
      path: (issue.path[0] === "settings"
        ? issue.path.slice(1)
        : issue.path
      ).map((segment) =>
        typeof segment === "symbol" ? String(segment) : segment,
      ),
      message: issue.message,
    }));
    return reject(
      "invalid_settings",
      issues[0]?.message ?? "The settings are not valid.",
      issues,
    );
  }
  const next = parsed.data;
  if (sameJson(node.settings, next.settings)) {
    return { ok: true, graph, node, prunedEdgeIds: [] };
  }
  const pruned = pruneDeadPorts(withNode(graph, next), [nodeId]);
  return {
    ok: true,
    graph: pruned.graph,
    node: next,
    prunedEdgeIds: pruned.prunedEdgeIds,
  };
}
