import {
  addNode,
  connect,
  createNode,
  disconnect,
  fitNewNodePosition,
  nextNodeIdentity,
  nodeSize,
  portsFor,
  reject,
  type NewNodeOptions,
  type NodeKind,
  type Point,
  type Rejection,
  type WorkflowCatalog,
  type WorkflowGraph,
  type WorkflowNode,
} from "@/lib/workflow-editor";

import { buildPalette, type PaletteEntry } from "../palette";
import { providerIdentity } from "../provider-identity";
import type { WorkflowCanvasStrings } from "../strings";

/** Where a new step goes: after one output of a step, or into a connection between two steps. */
export type CreatorTarget =
  | { kind: "append"; after?: { nodeId: string; port: string } }
  | { kind: "insert"; edgeId: string };

/** `unknown` is a check that failed or has not run. It is never read as `not connected`. */
export type ProviderLinkStatus = "connected" | "not connected" | "unknown";

export type CreatorGroupId = "triggers" | "actions" | "flow" | "ai";

export type CreatorRow =
  | { type: "entry"; id: string; entry: PaletteEntry; detail: string }
  | { type: "provider"; id: string; provider: string }
  | { type: "describe"; id: "describe" };

interface CreatorGroup {
  /** Null when the rows need no heading: one provider's list, or the fallback row. */
  heading: CreatorGroupId | null;
  rows: CreatorRow[];
}

export interface CreatorBrowse {
  query: string;
  /** The provider whose operations are listed, or null for the top level. */
  provider: string | null;
}

type InsertOutcome =
  | { ok: true; graph: WorkflowGraph; node: WorkflowNode }
  | { ok: false; reason: "loop" }
  | { ok: false; rejection: Rejection };

type ProviderEntry = PaletteEntry & { provider: string };

function groupOf(kind: NodeKind): CreatorGroupId {
  switch (kind) {
    case "trigger":
    case "source":
      return "triggers";
    case "lookup":
    case "action":
      return "actions";
    case "filter":
    case "switch":
    case "combine":
    case "split":
    case "wait":
    case "end":
      return "flow";
    case "ai":
    case "agent":
      return "ai";
  }
}

/**
 * What may sit at the target. A trigger has no input, so it only starts a
 * workflow, and never follows a port. A connection that is split takes only
 * steps with an input and an output, so no source (it starts item flow) and no
 * end (it has no output).
 */
function allowedAt(
  kind: NodeKind,
  target: CreatorTarget,
  hasTrigger: boolean,
): boolean {
  if (target.kind === "insert") {
    return kind !== "trigger" && kind !== "source" && kind !== "end";
  }
  if (kind === "trigger") return target.after === undefined && !hasTrigger;
  return true;
}

/** Every word typed must appear in one of the fields, ignoring case. */
function matches(query: string, fields: readonly string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = fields.join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}

function providerLabel(provider: string): string {
  return providerIdentity(provider).label;
}

function isProviderEntry(entry: PaletteEntry): entry is ProviderEntry {
  return (
    (entry.kind === "lookup" || entry.kind === "action") &&
    entry.provider !== undefined
  );
}

function entryRow(entry: PaletteEntry, detail: string): CreatorRow {
  return { type: "entry", id: entry.id, entry, detail };
}

/** Drops empty groups. When nothing is left, the one row that hands the query to the agent. */
function settle(groups: CreatorGroup[], describable: boolean): CreatorGroup[] {
  const filled = groups.filter((group) => group.rows.length > 0);
  if (filled.length > 0 || !describable) return filled;
  return [{ heading: null, rows: [{ type: "describe", id: "describe" }] }];
}

/**
 * The creator's list: the top level, sections of steps and provider rows, or
 * one provider's operations once a provider row is opened. A query matches
 * across the top level, so an operation shows up without opening its provider.
 */
export function creatorGroups({
  catalog,
  target,
  hasTrigger,
  browse,
  describable,
  strings,
}: {
  catalog: WorkflowCatalog;
  target: CreatorTarget;
  hasTrigger: boolean;
  browse: CreatorBrowse;
  /** Whether a query nothing matches can be handed to the agent. */
  describable: boolean;
  strings: WorkflowCanvasStrings;
}): CreatorGroup[] {
  const query = browse.query.trim();
  const entries = buildPalette(catalog, { hasTrigger: false }, strings)
    .flatMap((section) => section.entries)
    .filter((entry) => allowedAt(entry.kind, target, hasTrigger));
  const operations = entries.filter(isProviderEntry);
  const matching = (entry: PaletteEntry) =>
    matches(query, [entry.label, entry.keywords, entry.category]);
  const inGroup = (id: CreatorGroupId): CreatorRow[] =>
    entries
      .filter((entry) => groupOf(entry.kind) === id && matching(entry))
      .map((entry) => entryRow(entry, entry.category));

  if (browse.provider !== null) {
    const rows = operations
      .filter((entry) => entry.provider === browse.provider && matching(entry))
      .map((entry) => entryRow(entry, entry.category));
    return settle([{ heading: null, rows }], describable);
  }

  const providers = [
    ...new Set(operations.map((entry) => entry.provider)),
  ].sort((a, b) => providerLabel(a).localeCompare(providerLabel(b)));
  const providerRows: CreatorRow[] = providers
    .filter((provider) => matches(query, [providerLabel(provider), provider]))
    .map(
      (provider): CreatorRow => ({
        type: "provider",
        id: `provider:${provider}`,
        provider,
      }),
    );
  const operationRows: CreatorRow[] =
    query === ""
      ? []
      : operations
          .filter(matching)
          .map((entry) => entryRow(entry, providerLabel(entry.provider)));

  return settle(
    [
      { heading: "triggers", rows: inGroup("triggers") },
      { heading: "actions", rows: [...providerRows, ...operationRows] },
      { heading: "flow", rows: inGroup("flow") },
      { heading: "ai", rows: inGroup("ai") },
    ],
    describable,
  );
}

/** The row a key press acts on: the one the person moved to, else the first. */
export function highlightedRow(
  rows: readonly CreatorRow[],
  highlight: string | null,
): CreatorRow | undefined {
  return rows.find((row) => row.id === highlight) ?? rows[0];
}

/** Where an arrow key moves from `current`. It stops at either end instead of wrapping. */
export function moveHighlight(
  rows: readonly CreatorRow[],
  current: string | null,
  step: 1 | -1,
): string | null {
  if (rows.length === 0) return null;
  const index = rows.findIndex((row) => row.id === current);
  if (index < 0) {
    return rows[step > 0 ? 0 : rows.length - 1]?.id ?? null;
  }
  return rows[Math.min(rows.length - 1, Math.max(0, index + step))]?.id ?? null;
}

function centreOf(graph: WorkflowGraph, node: WorkflowNode): Point {
  const size = nodeSize(graph, node);
  return {
    x: node.position.x + size.width / 2,
    y: node.position.y + size.height / 2,
  };
}

/**
 * Puts a new step into a connection: the source keeps its output port and
 * feeds the new step, and the new step's first output feeds the old target.
 * Built from the same pure commands the editor uses, so the result is one
 * graph to swap in as a single undo step.
 */
export function insertOnEdge(
  graph: WorkflowGraph,
  catalog: WorkflowCatalog,
  edgeId: string,
  kind: NodeKind,
  options: Omit<NewNodeOptions, "after" | "position"> = {},
): InsertOutcome {
  const edge = graph.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return reject("unknown_edge", `No edge "${edgeId}".`);
  // A loop's back-edge runs against the flow, so a step cannot sit between its ends.
  if (edge.back) return { ok: false, reason: "loop" };
  const from = graph.nodes.find((node) => node.id === edge.from.node);
  const to = graph.nodes.find((node) => node.id === edge.to.node);
  if (!from || !to) {
    return reject("unknown_node", `Edge "${edgeId}" points at a missing step.`);
  }

  const identity = nextNodeIdentity(graph, kind);
  const sized = createNode(
    kind,
    { id: identity, name: identity, position: { x: 0, y: 0 } },
    catalog,
    options,
  );
  if (!sized.ok) return sized;
  // Checked before the graph changes: a step with no output would drop the old target.
  const [output] = portsFor(sized.node);
  if (output === undefined) {
    return reject(
      "unknown_port",
      `"${identity}" has no output to continue from.`,
    );
  }

  const detached = disconnect(graph, edgeId);
  if (!detached.ok) return detached;
  const fromAt = centreOf(graph, from);
  const toAt = centreOf(graph, to);
  const position = fitNewNodePosition(detached.graph, {
    near: { x: (fromAt.x + toAt.x) / 2, y: (fromAt.y + toAt.y) / 2 },
    size: nodeSize(detached.graph, sized.node),
  });
  const added = addNode(detached.graph, catalog, kind, {
    ...options,
    position,
  });
  if (!added.ok) return added;
  const inbound = connect(
    added.graph,
    { node: edge.from.node, port: edge.from.port },
    added.node.id,
    { back: "auto" },
  );
  if (!inbound.ok) return inbound;
  const outbound = connect(
    inbound.graph,
    { node: added.node.id, port: output },
    edge.to.node,
    { back: "auto" },
  );
  if (!outbound.ok) return outbound;
  return { ok: true, graph: outbound.graph, node: added.node };
}
