import { and, asc, desc, eq, lt, or } from "drizzle-orm";

import {
  factoryWorkflowRuns,
  factoryWorkflowSteps,
  factoryWorkflows,
} from "../../db/schema.js";
import type { WorkflowScope } from "../../workflow/adapter.js";
import {
  MAX_NODES,
  type NodeKind,
  type RunMode,
  type RunStatus,
  type StepRecord,
  type StepStatus,
} from "../../workflow/contract.js";
import { assertScope } from "../../workflow/store-rules.js";
import {
  namesOf,
  nodeIndexOf,
  readVersionGraph,
  requireWorkflowRow,
  runInScope,
  type NodeInfo,
} from "./lookups.js";
import { runViewOf, stepOf, type RunView } from "./mappers.js";
import {
  READ_LIMITS,
  decodeCursor,
  durationMs,
  encodeCursor,
  pageLimit,
  runsCursorSchema,
  scopeOf,
  takeWindow,
  type ReadDatabase,
  type ReadPage,
} from "./shared.js";

const runs = factoryWorkflowRuns;
const steps = factoryWorkflowSteps;

export interface StepPortView {
  count: number;
  itemIds: string[];
  /** True when `itemIds` holds fewer ids than `count`. */
  itemIdsTruncated: boolean;
}

export interface StepView {
  nodeId: string;
  nodeName: string | null;
  nodeKind: NodeKind | null;
  status: StepStatus;
  mode: RunMode;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  ports: Record<string, StepPortView>;
  fields: Record<string, unknown> | null;
  /** The step's fields were over the size bound, so they are not returned here. */
  fieldsOmitted: boolean;
  truncated: { totalAvailable: number } | null;
  inputTruncated: boolean;
  error: { code: string; message: string } | null;
  receiptKeys: string[];
  receiptKeysTruncated: boolean;
  agentThreadId: string | null;
}

export interface RunDetail {
  run: RunView;
  steps: StepView[];
  /** More steps than a graph can have; never true for a healthy run. */
  stepsTruncated: boolean;
}

export interface RunListQuery {
  workflowId?: string;
  status?: RunStatus;
  mode?: RunMode;
  limit?: number;
  cursor?: string;
}

function stepViewOf(
  record: StepRecord,
  nodes: Map<string, NodeInfo> | undefined,
): StepView {
  const node = nodes?.get(record.nodeId);
  const ports: Record<string, StepPortView> = {};
  for (const [port, entry] of Object.entries(record.ports)) {
    const itemIds = entry.itemIds.slice(0, READ_LIMITS.runListPerStep);
    ports[port] = {
      count: entry.count,
      itemIds,
      itemIdsTruncated: itemIds.length < entry.count,
    };
  }
  let fields: Record<string, unknown> | null = null;
  let fieldsOmitted = false;
  if (record.fields !== undefined) {
    if (
      new TextEncoder().encode(JSON.stringify(record.fields)).length >
      READ_LIMITS.runStepFieldsBytes
    ) {
      fieldsOmitted = true;
    } else {
      fields = record.fields;
    }
  }
  const receiptKeys = record.receiptKeys ?? [];
  return {
    nodeId: record.nodeId,
    nodeName: node?.name ?? null,
    nodeKind: node?.kind ?? null,
    status: record.status,
    mode: record.mode,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt ?? null,
    durationMs: durationMs(record.startedAt, record.finishedAt),
    ports,
    fields,
    fieldsOmitted,
    truncated: record.truncated ?? null,
    inputTruncated: record.inputTruncated ?? false,
    error: record.error ?? null,
    receiptKeys: receiptKeys.slice(0, READ_LIMITS.runListPerStep),
    receiptKeysTruncated: receiptKeys.length > READ_LIMITS.runListPerStep,
    agentThreadId: record.agentThreadId ?? null,
  };
}

export async function listRuns(
  getDatabase: () => ReadDatabase,
  scope: WorkflowScope,
  input: RunListQuery,
): Promise<ReadPage<RunView>> {
  assertScope(scope);
  const limit = pageLimit(input.limit, "Run list");
  const after =
    input.cursor === undefined
      ? null
      : decodeCursor("runs", input.cursor, runsCursorSchema);
  const db = getDatabase();
  if (input.workflowId !== undefined) {
    await requireWorkflowRow(db, scope, input.workflowId);
  }
  const fetched = await db
    .select({ run: runs, workflowName: factoryWorkflows.name })
    .from(runs)
    .leftJoin(
      factoryWorkflows,
      and(
        eq(factoryWorkflows.id, runs.workflowId),
        scopeOf(factoryWorkflows, scope),
      ),
    )
    .where(
      and(
        scopeOf(runs, scope),
        input.workflowId === undefined
          ? undefined
          : eq(runs.workflowId, input.workflowId),
        input.status === undefined ? undefined : eq(runs.status, input.status),
        input.mode === undefined ? undefined : eq(runs.mode, input.mode),
        after === null
          ? undefined
          : or(
              lt(runs.startedAt, after.at),
              and(eq(runs.startedAt, after.at), lt(runs.id, after.id)),
            ),
      ),
    )
    .orderBy(desc(runs.startedAt), desc(runs.id))
    .limit(limit + 1);
  const window = takeWindow(fetched, limit);
  const items = window.rows.map((row) => runViewOf(row.run, row.workflowName));
  const last = window.rows[window.rows.length - 1]?.run;
  return {
    items,
    hasMore: window.more,
    nextCursor:
      window.more && last
        ? encodeCursor("runs", { at: last.startedAt, id: last.id })
        : null,
  };
}

export async function getRun(
  getDatabase: () => ReadDatabase,
  scope: WorkflowScope,
  runId: string,
): Promise<RunDetail | null> {
  assertScope(scope);
  const db = getDatabase();
  // run-factory-workflow answers with the scheduler's history id, which is how
  // a queued run is addressed until its own id is known.
  const row =
    (await runInScope(db, scope, runId)) ??
    (
      await db
        .select()
        .from(runs)
        .where(and(eq(runs.historyRowId, runId), scopeOf(runs, scope)))
        .limit(1)
    )[0];
  if (!row) return null;
  const [names, stepRows] = await Promise.all([
    namesOf(db, scope, [row.workflowId]),
    db
      .select()
      .from(steps)
      .where(and(eq(steps.runId, row.id), scopeOf(steps, scope)))
      .orderBy(asc(steps.startedAt), asc(steps.nodeId))
      .limit(MAX_NODES + 1),
  ]);
  // Steps belong to the version the run used, which may not be the current one.
  const graph = await readVersionGraph(
    db,
    scope,
    row.workflowId,
    row.graphVersion,
  );
  const nodes = nodeIndexOf(graph);
  const window = takeWindow(stepRows, MAX_NODES);
  return {
    run: runViewOf(row, names.get(row.workflowId) ?? null),
    steps: window.rows.map((stepRow) => stepViewOf(stepOf(stepRow), nodes)),
    stepsTruncated: window.more,
  };
}
