import { and, desc, eq, inArray } from "drizzle-orm";

import {
  factoryWorkflowRuns,
  factoryWorkflowSteps,
  triageItems,
} from "../../db/schema.js";
import { redactDeep } from "../../tripwire/redact.js";
import {
  WorkflowStoreError,
  type WorkflowScope,
} from "../../workflow/adapter.js";
import type {
  NodeKind,
  RunMode,
  StepStatus,
  ThreadRef,
} from "../../workflow/contract.js";
import { jsonByteLength } from "../../workflow/items.js";
import { assertScope } from "../../workflow/store-rules.js";
import { RowUnreadable, rowToNormalizedItem } from "../inbox.js";
import { readVersionGraph, requireWorkflowRow, runInScope } from "./lookups.js";
import { stepOf } from "./mappers.js";
import {
  READ_LIMITS,
  WorkflowReadError,
  clipText,
  scopeOf,
  type ReadDatabase,
  type StepRow,
} from "./shared.js";

const runs = factoryWorkflowRuns;
const steps = factoryWorkflowSteps;

/** Room kept in the response for everything that is not an item: the node, the run, the port headers. */
const ENVELOPE_BYTES = 4 * 1024;

/** An item with a stored row: the fields a workflow reads as `item.<field>`. */
export interface NodeDataStoredItem {
  itemId: string;
  synthetic: false;
  title: string;
  text: string | null;
  url: string | null;
  author: string | null;
  occurredAt: string;
  thread: ThreadRef | null;
  extras: Record<string, unknown>;
  /** The text, the extras, or a field was cut to fit the per-item size cap, or was already cut when stored. */
  truncated: boolean;
}

/** An id with no stored row, such as a group or a list a node made: nothing to show but the id. */
export interface NodeDataSyntheticItem {
  itemId: string;
  synthetic: true;
}

export type NodeDataItem = NodeDataStoredItem | NodeDataSyntheticItem;

interface NodeDataPortBase {
  /** Items the step recorded on this port. */
  count: number;
  /** At most `portLimit` of them, in the order the step recorded them. */
  items: NodeDataItem[];
  /** `count` is more than `items` holds: the limit, the ids a step records, or the response size cap. */
  itemsTruncated: boolean;
}

/** Items that arrived over one incoming edge, read from the upstream node's step. */
export interface NodeDataInPort extends NodeDataPortBase {
  edgeId: string;
  fromNodeId: string;
  fromPort: string;
  /** The upstream node's step in this run; null when it has none, which is not the same as a step that took no items. */
  upstreamStatus: StepStatus | null;
}

/** Items the node's own step put on one output port. */
export interface NodeDataOutPort extends NodeDataPortBase {
  port: string;
}

export interface NodeData {
  workflow: { id: string; name: string; version: number };
  /** The graph version the node was read from: the run's, or the current one when no run was read. */
  graphVersion: number;
  node: { id: string; name: string; kind: NodeKind };
  /** The run read: the one asked for, else the newest with a step for this node. Null when the node has never run. */
  run: { id: string; mode: RunMode; startedAt: string } | null;
  /** This node's own step in that run; null when the run did not reach it. */
  step: {
    status: StepStatus;
    startedAt: string;
    finishedAt: string | null;
  } | null;
  /** Null when only `out` was asked for. */
  in: NodeDataInPort[] | null;
  /** Null when only `in` was asked for. */
  out: NodeDataOutPort[] | null;
  /** The response size cap left items out; each port that lost some says so in `itemsTruncated`. */
  truncated: boolean;
}

export interface NodeDataQuery {
  workflowId: string;
  nodeId: string;
  runId?: string;
  side?: "in" | "out";
  portLimit?: number;
}

function byteSize(value: unknown): number {
  return jsonByteLength(value);
}

function clipToBytes(text: string, maxBytes: number): string {
  let chars = Math.min(text.length, Math.max(0, maxBytes));
  let clipped = clipText(text, chars).text;
  while (chars > 0 && byteSize(clipped) > maxBytes) {
    chars = Math.floor(chars * 0.8);
    clipped = clipText(text, chars).text;
  }
  return clipped;
}

/**
 * Brings one item under the per-item byte cap and says so. The extras go
 * first, a whole key at a time, then the text; the fixed fields are bounded
 * where they are stored, and a view they alone overflow keeps only the id and a
 * clipped title.
 */
function fitItem(
  item: NodeDataStoredItem,
  maxBytes: number,
): NodeDataStoredItem {
  if (byteSize(item) <= maxBytes) return item;
  const fixed: NodeDataStoredItem = { ...item, text: null, extras: {} };
  const room = maxBytes - byteSize(fixed);
  if (room < 0) {
    return {
      itemId: item.itemId,
      synthetic: false,
      title: clipToBytes(item.title, 512),
      text: null,
      url: null,
      author: null,
      occurredAt: item.occurredAt,
      thread: null,
      extras: {},
      truncated: true,
    };
  }
  const extras: Record<string, unknown> = {};
  let used = 0;
  for (const [key, value] of Object.entries(item.extras)) {
    const cost = byteSize(key) + byteSize(value) + 2;
    if (used + cost > room / 2) continue;
    extras[key] = value;
    used += cost;
  }
  const text =
    item.text === null ? null : clipToBytes(item.text, room - used - 16);
  return { ...fixed, text, extras, truncated: true };
}

function storedItemOf(
  row: typeof triageItems.$inferSelect,
): NodeDataStoredItem {
  let normalized: ReturnType<typeof rowToNormalizedItem>;
  try {
    normalized = rowToNormalizedItem(row);
  } catch (error) {
    if (!(error instanceof RowUnreadable)) throw error;
    throw new WorkflowStoreError(
      "corrupt_record",
      `factory_items row "${row.id}" cannot be read: ${error.message}`,
      { itemId: row.id },
    );
  }
  // Redacted before it is measured, so the cap is on what leaves.
  const view = redactDeep({
    title: normalized.title,
    text: normalized.text ?? null,
    url: normalized.url ?? null,
    author: normalized.author ?? null,
    occurredAt: normalized.occurredAt,
    thread: normalized.thread ?? null,
    extras: normalized.extras,
  });
  return fitItem(
    {
      itemId: row.id,
      synthetic: false,
      ...view,
      truncated: normalized.textTruncated === true,
    },
    READ_LIMITS.nodeDataItemBytes,
  );
}

interface SideBudget {
  left: number;
  cut: boolean;
}

function takeItems(
  ids: readonly string[],
  views: ReadonlyMap<string, NodeDataItem>,
  budget: SideBudget,
): NodeDataItem[] {
  const taken: NodeDataItem[] = [];
  for (const itemId of ids) {
    const view = views.get(itemId) ?? { itemId, synthetic: true as const };
    const cost = byteSize(view) + 1;
    if (cost > budget.left) {
      // Nothing after this one is returned either, so a later small item never
      // jumps the queue past a large one that did not fit.
      budget.cut = true;
      budget.left = 0;
      break;
    }
    budget.left -= cost;
    taken.push(view);
  }
  return taken;
}

function portOf(
  count: number,
  ids: readonly string[],
  limit: number,
  views: ReadonlyMap<string, NodeDataItem>,
  budget: SideBudget,
): NodeDataPortBase {
  const items = takeItems(ids.slice(0, limit), views, budget);
  return { count, items, itemsTruncated: count > items.length };
}

export async function getNodeData(
  getDatabase: () => ReadDatabase,
  scope: WorkflowScope,
  input: NodeDataQuery,
): Promise<NodeData> {
  assertScope(scope);
  const limit =
    input.portLimit === undefined
      ? READ_LIMITS.nodeDataPortDefault
      : input.portLimit;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > READ_LIMITS.nodeDataPortMax
  ) {
    throw new WorkflowReadError(
      "invalid_input",
      `Node data portLimit must be a whole number from 1 to ${READ_LIMITS.nodeDataPortMax}.`,
      { portLimit: limit },
    );
  }
  const db = getDatabase();
  const workflow = await requireWorkflowRow(db, scope, input.workflowId);

  let run: typeof runs.$inferSelect | undefined;
  let stepRow: StepRow | undefined;
  if (input.runId !== undefined) {
    run = await runInScope(db, scope, input.runId);
    if (!run || run.workflowId !== workflow.id) {
      throw new WorkflowReadError(
        "run_not_found",
        `Run "${input.runId}" was not found in workflow "${workflow.id}".`,
        { workflowId: workflow.id, runId: input.runId },
      );
    }
    stepRow = (
      await db
        .select()
        .from(steps)
        .where(
          and(
            eq(steps.runId, run.id),
            eq(steps.nodeId, input.nodeId),
            scopeOf(steps, scope),
          ),
        )
        .limit(1)
    )[0];
  } else {
    const newest = (
      await db
        .select({ step: steps, run: runs })
        .from(steps)
        .leftJoin(runs, eq(runs.id, steps.runId))
        .where(
          and(
            eq(steps.workflowId, workflow.id),
            eq(steps.nodeId, input.nodeId),
            scopeOf(steps, scope),
          ),
        )
        .orderBy(desc(steps.startedAt), desc(steps.id))
        .limit(1)
    )[0];
    if (newest) {
      if (!newest.run) {
        throw new WorkflowStoreError(
          "corrupt_record",
          `factory_workflow_steps (run "${newest.step.runId}", node "${newest.step.nodeId}") has no run row.`,
        );
      }
      run = newest.run;
      stepRow = newest.step;
    }
  }

  const graphVersion = run?.graphVersion ?? workflow.version;
  const graph = await readVersionGraph(db, scope, workflow.id, graphVersion);
  const node = graph.nodes.find((candidate) => candidate.id === input.nodeId);
  if (!node) {
    throw new WorkflowReadError(
      "node_not_found",
      `Node "${input.nodeId}" is not in version ${graphVersion} of workflow "${workflow.id}".`,
      { workflowId: workflow.id, nodeId: input.nodeId, graphVersion },
    );
  }

  const own = stepRow ? stepOf(stepRow) : undefined;
  const wantIn = input.side !== "out";
  const wantOut = input.side !== "in";

  const incoming = wantIn
    ? graph.edges.filter((edge) => edge.to.node === node.id)
    : [];
  const upstreamIds = [...new Set(incoming.map((edge) => edge.from.node))];
  const upstreamRows =
    run === undefined || upstreamIds.length === 0
      ? []
      : await db
          .select()
          .from(steps)
          .where(
            and(
              eq(steps.runId, run.id),
              scopeOf(steps, scope),
              inArray(steps.nodeId, upstreamIds),
            ),
          )
          .limit(upstreamIds.length);
  const upstream = new Map(
    upstreamRows.map((row) => [row.nodeId, stepOf(row)]),
  );

  const inPorts = incoming.map((edge) => {
    const step = upstream.get(edge.from.node);
    const port = step?.ports[edge.from.port];
    return { edge, step, port };
  });
  const outPorts = wantOut && own ? Object.entries(own.ports) : [];

  const wanted = [
    ...new Set([
      ...inPorts.flatMap(({ port }) => port?.itemIds.slice(0, limit) ?? []),
      ...outPorts.flatMap(([, port]) => port.itemIds.slice(0, limit)),
    ]),
  ];
  // The scope is the item's own org and factory, as for every inbox read.
  const itemRows =
    wanted.length === 0
      ? []
      : await db
          .select()
          .from(triageItems)
          .where(
            and(
              eq(triageItems.orgId, scope.orgId),
              eq(triageItems.factoryId, scope.factoryId),
              inArray(triageItems.id, wanted),
            ),
          )
          .limit(wanted.length);
  const views = new Map<string, NodeDataItem>(
    itemRows.map((row) => [row.id, storedItemOf(row)]),
  );

  const sides = (wantIn ? 1 : 0) + (wantOut ? 1 : 0);
  const sideBytes = Math.floor(
    (READ_LIMITS.nodeDataResponseBytes - ENVELOPE_BYTES) / sides,
  );
  const inBudget: SideBudget = { left: sideBytes, cut: false };
  const outBudget: SideBudget = { left: sideBytes, cut: false };

  return {
    workflow: {
      id: workflow.id,
      name: workflow.name,
      version: workflow.version,
    },
    graphVersion,
    node: { id: node.id, name: node.name, kind: node.kind },
    run: run
      ? { id: run.id, mode: run.mode as RunMode, startedAt: run.startedAt }
      : null,
    step: own
      ? {
          status: own.status,
          startedAt: own.startedAt,
          finishedAt: own.finishedAt ?? null,
        }
      : null,
    in: wantIn
      ? inPorts.map(({ edge, step, port }) => ({
          edgeId: edge.id,
          fromNodeId: edge.from.node,
          fromPort: edge.from.port,
          upstreamStatus: step?.status ?? null,
          ...portOf(
            port?.count ?? 0,
            port?.itemIds ?? [],
            limit,
            views,
            inBudget,
          ),
        }))
      : null,
    out: wantOut
      ? outPorts.map(([name, port]) => ({
          port: name,
          ...portOf(port.count, port.itemIds, limit, views, outBudget),
        }))
      : null,
    truncated: inBudget.cut || outBudget.cut,
  };
}
