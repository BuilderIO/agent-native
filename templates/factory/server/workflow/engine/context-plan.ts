import {
  nodeScopeKey,
  type NodeKind,
  type WorkflowGraph,
  type WorkflowNode,
} from "../contract.js";
import {
  parsePath,
  type ParsedPath,
  type PathSegment,
} from "../expressions.js";
import { operationArgs, pathsReadBy } from "../graph-validation.js";
import { isRecord } from "./bounds.js";
import { MEMBER_FIELDS } from "./members.js";
import type { FlowItem } from "./types.js";

/**
 * What a parked item keeps. An item waits with up to 8 KB, and most of what it
 * carried in (a Slack thread, a provider response) is read once, before the
 * Wait. So the context holds only what a node that can run after the Wait
 * reads: this module works that out from the graph, once per graph and Wait.
 *
 * A node "reads" a path when its settings name it, and reads everything when it
 * hands the item to a model: an AI node, or an argument the model writes. Only
 * a result a node before the Wait can have left is in question, and it is not
 * needed when the node that writes it is always passed before any node that
 * reads it, because the Wait's way on rewrites it first (the loop head that
 * reads a thread again, for one).
 */

/** Paths to keep as a tree: a node marked `all` keeps everything below it. */
interface KeepTree {
  all: boolean;
  readonly children: Map<PathSegment, KeepTree>;
}

export interface ContextPlan {
  /** The item's own fields (`item.*`). */
  readonly data: KeepTree;
  /** Results by the name a node's output is read under (`nodes.<key>.*`). */
  readonly nodes: ReadonlyMap<string, KeepTree>;
  /** The same plan as paths, written into the parked context. */
  readonly kept: readonly string[];
}

const newTree = (): KeepTree => ({ all: false, children: new Map() });

function keep(tree: KeepTree, segments: readonly PathSegment[]): void {
  let at = tree;
  for (const segment of segments) {
    if (at.all) return;
    let next = at.children.get(segment);
    if (!next) {
      next = newTree();
      at.children.set(segment, next);
    }
    at = next;
  }
  at.all = true;
  at.children.clear();
}

const isEmpty = (tree: KeepTree): boolean =>
  !tree.all && tree.children.size === 0;

function format(segment: PathSegment): string {
  return typeof segment === "number" ? `[${segment}]` : `.${segment}`;
}

function listPaths(tree: KeepTree, prefix: string, out: string[]): void {
  if (tree.all) {
    out.push(prefix);
    return;
  }
  for (const [segment, child] of tree.children) {
    listPaths(child, `${prefix}${format(segment)}`, out);
  }
}

/** The nodes whose output is attached under their own name, so a pass through one rewrites it. */
const WRITES_RESULT: ReadonlySet<NodeKind> = new Set([
  "lookup",
  "action",
  "agent",
  "ai",
  "wait",
]);

interface NodeReads {
  readonly paths: readonly ParsedPath[];
  /** Reads the whole item and every earlier result. */
  readonly whole: boolean;
}

function readsOf(
  node: WorkflowNode,
  graph: WorkflowGraph,
  options: { parking: boolean },
): NodeReads {
  const paths = pathsReadBy(node).filter(
    (path) => path.root === "item" || path.root === "nodes",
  );
  const args = operationArgs(node);
  const whole =
    node.kind === "ai" ||
    (args !== undefined &&
      Object.values(args).some((binding) => binding.mode === "ai"));
  const itemField = (field: string): ParsedPath => ({
    root: "item",
    segments: [field],
  });

  // Reads the engine does outside any path.
  if (node.kind === "combine") {
    const { mode, field, summarize } = node.settings;
    if ((mode === "list" && field === undefined) || mode === "groupBy") {
      paths.push(...MEMBER_FIELDS.map(itemField));
    }
    if (summarize?.baseline) paths.push(itemField("occurredAt"));
  }
  // A reply Wait finds its thread when an item parks; after that it reads the thread from its wake.
  if (
    options.parking &&
    node.kind === "wait" &&
    node.settings.wait === "reply"
  ) {
    const { watch } = node.settings;
    const upstream = watch
      ? graph.nodes.find((candidate) => candidate.id === watch.fromNode)
      : undefined;
    if (upstream) {
      paths.push({ root: "nodes", segments: [nodeScopeKey(upstream)] });
    } else if (!watch) {
      paths.push(itemField("thread"));
    }
  }
  return { paths, whole };
}

/**
 * `wait`: the item parks at a Wait and leaves by its ports. `retry`: the item
 * failed at a node and re-enters that node's input, so the node itself reads
 * from the item too.
 */
type ParkReason = "wait" | "retry";

function build(
  graph: WorkflowGraph,
  waitId: string,
  reason: ParkReason,
): ContextPlan {
  const reads = new Map(
    graph.nodes.map((node) => [
      node.id,
      readsOf(node, graph, { parking: true }),
    ]),
  );
  const onward = new Map<string, string[]>();
  const before = new Map<string, string[]>();
  for (const edge of graph.edges) {
    onward.set(edge.from.node, [
      ...(onward.get(edge.from.node) ?? []),
      edge.to.node,
    ]);
    before.set(edge.to.node, [
      ...(before.get(edge.to.node) ?? []),
      edge.from.node,
    ]);
  }
  const waitNode = graph.nodes.find((node) => node.id === waitId);
  if (!waitNode) throw new Error(`Node "${waitId}" is not in the graph.`);
  // What the Wait reads from its parked item when it wakes it: a condition's arguments and rule.
  const wait = readsOf(waitNode, graph, { parking: false });
  const retry = reason === "retry";

  /**
   * What every node that can run after the Wait reads, back edges included, and
   * the Wait itself (a condition Wait reads its parked item on every check).
   * A walk does not go on past `rewrittenBy`: whatever it writes is rewritten
   * before anything beyond it runs.
   */
  const readAfter = (rewrittenBy?: string): NodeReads[] => {
    // A retried node runs again from its input, so it is read like any node after it.
    const found: NodeReads[] = retry ? [] : [wait];
    const seen = new Set<string>();
    const queue = retry ? [waitId] : [...(onward.get(waitId) ?? [])];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (seen.has(id)) continue;
      seen.add(id);
      const node = reads.get(id);
      if (node) found.push(node);
      if (id !== rewrittenBy) queue.push(...(onward.get(id) ?? []));
    }
    return found;
  };

  /** The nodes an item can have passed before it parks here, through a loop or not. */
  const passedBefore = new Set<string>();
  const behind = [...(before.get(waitId) ?? [])];
  for (let id = behind.shift(); id !== undefined; id = behind.shift()) {
    if (passedBefore.has(id)) continue;
    passedBefore.add(id);
    behind.push(...(before.get(id) ?? []));
  }

  const data = newTree();
  for (const node of readAfter()) {
    if (node.whole) keep(data, []);
    for (const path of node.paths) {
      if (path.root === "item") keep(data, path.segments);
    }
  }

  const nodes = new Map<string, KeepTree>();
  for (const writer of graph.nodes) {
    // The Wait writes its own result as it wakes an item, before anything after it runs.
    if (
      !WRITES_RESULT.has(writer.kind) ||
      !passedBefore.has(writer.id) ||
      writer.id === waitId
    ) {
      continue;
    }
    const key = nodeScopeKey(writer);
    const tree = newTree();
    for (const node of readAfter(writer.id)) {
      if (node.whole) keep(tree, []);
      for (const path of node.paths) {
        if (path.root === "nodes" && path.segments[0] === key) {
          keep(tree, path.segments.slice(1));
        }
      }
    }
    // The next Wait the item parks at starts its reply search after the last
    // reply it was woken by, which it reads from this result.
    if (writer.kind === "wait") {
      keep(tree, ["outcome"]);
      keep(tree, ["lastReplyAt"]);
    }
    if (!isEmpty(tree)) nodes.set(key, tree);
  }

  const kept: string[] = [];
  listPaths(data, "item", kept);
  for (const [key, tree] of nodes) listPaths(tree, `nodes.${key}`, kept);
  return { data, nodes, kept: kept.sort() };
}

const plans = new WeakMap<WorkflowGraph, Map<string, ContextPlan>>();

/**
 * What an item parking at `nodeId` keeps, for `reason`; worked out once for
 * each node and reason of a loaded graph.
 */
export function contextPlanFor(
  graph: WorkflowGraph,
  nodeId: string,
  reason: ParkReason = "wait",
): ContextPlan {
  let byNode = plans.get(graph);
  if (!byNode) {
    byNode = new Map();
    plans.set(graph, byNode);
  }
  const key = `${reason}:${nodeId}`;
  let plan = byNode.get(key);
  if (!plan) {
    plan = build(graph, nodeId, reason);
    byNode.set(key, plan);
  }
  return plan;
}

function pruneValue(value: unknown, tree: KeepTree): unknown {
  if (tree.all) return value;
  if (Array.isArray(value)) {
    const indexes = [...tree.children.keys()]
      .filter((segment): segment is number => typeof segment === "number")
      .sort((a, b) => a - b);
    const out: unknown[] = [];
    for (const index of indexes) {
      const child = tree.children.get(index);
      if (!child || index >= value.length) continue;
      const kept = pruneValue(value[index], child);
      if (kept === undefined) continue;
      // Earlier positions stay so an index still means the same entry.
      while (out.length < index) out.push(null);
      out[index] = kept;
    }
    return out.length > 0 ? out : undefined;
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [segment, child] of tree.children) {
      if (
        typeof segment !== "string" ||
        !Object.prototype.hasOwnProperty.call(value, segment)
      ) {
        continue;
      }
      const kept = pruneValue(value[segment], child);
      if (kept !== undefined) out[segment] = kept;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  // A path below a text or a number would find nothing there either way.
  return undefined;
}

/** The item as a node after the Wait reads it, less what none of them read. */
export function pruneItem(
  item: FlowItem,
  plan: ContextPlan,
): { data: Record<string, unknown>; nodes: Record<string, unknown> } {
  const data = plan.data.all
    ? { ...item.data }
    : ((pruneValue(item.data, plan.data) as
        | Record<string, unknown>
        | undefined) ?? {});
  const nodes: Record<string, unknown> = {};
  for (const [key, tree] of plan.nodes) {
    if (!Object.prototype.hasOwnProperty.call(item.nodes, key)) continue;
    const kept = pruneValue(item.nodes[key], tree);
    if (kept !== undefined) nodes[key] = kept;
  }
  return { data, nodes };
}

interface StoredPlan {
  readonly data: KeepTree;
  readonly nodes: Map<string, KeepTree>;
}

function storedPlan(kept: readonly string[]): StoredPlan {
  const data = newTree();
  const nodes = new Map<string, KeepTree>();
  for (const text of kept) {
    const path = parsePath(text);
    if (path.root === "item") {
      keep(data, path.segments);
      continue;
    }
    const [key, ...rest] = path.segments;
    let tree = nodes.get(String(key));
    if (!tree) {
      tree = newTree();
      nodes.set(String(key), tree);
    }
    keep(tree, rest);
  }
  return { data, nodes };
}

/** True for a list of paths a plan could have written: each parses and starts at `item` or at `nodes.<name>`. */
export function isKeptPaths(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  return value.every((text) => {
    if (typeof text !== "string") return false;
    try {
      const path = parsePath(text);
      return (
        path.root === "item" ||
        (path.root === "nodes" && typeof path.segments[0] === "string")
      );
    } catch {
      // coercion-ok: text that does not parse as a path is the unreadable answer this check gives
      return false;
    }
  });
}

function gapOf(
  have: KeepTree | undefined,
  need: KeepTree,
  path: string,
): string | null {
  if (have?.all) return null;
  if (need.all) return path;
  for (const [segment, child] of need.children) {
    const gap = gapOf(
      have?.children.get(segment),
      child,
      path + format(segment),
    );
    if (gap !== null) return gap;
  }
  return null;
}

/**
 * The first path the graph as it is now needs from an item parked at `waitId`
 * that the item did not keep when it parked, or null when it kept everything.
 * `kept` is what the parked context says it kept, from `isKeptPaths`.
 */
export function coverageGap(
  graph: WorkflowGraph,
  waitId: string,
  kept: readonly string[],
  reason: ParkReason = "wait",
): string | null {
  const plan = contextPlanFor(graph, waitId, reason);
  const stored = storedPlan(kept);
  const dataGap = gapOf(stored.data, plan.data, "item");
  if (dataGap !== null) return dataGap;
  for (const [key, tree] of plan.nodes) {
    const gap = gapOf(stored.nodes.get(key), tree, `nodes.${key}`);
    if (gap !== null) return gap;
  }
  return null;
}
