import { and, desc, eq, inArray } from "drizzle-orm";

import {
  factoryWorkflowItemEvents,
  factoryWorkflowReceipts,
  factoryWorkflowRuns,
  factoryWorkflowSteps,
} from "../../db/schema.js";
import {
  WorkflowStoreError,
  type WorkflowScope,
} from "../../workflow/adapter.js";
import type {
  NodeKind,
  RunMode,
  RunTriggerKind,
  StepStatus,
  WorkflowErrorCode,
} from "../../workflow/contract.js";
import { assertScope } from "../../workflow/store-rules.js";
import {
  inboxRows,
  readVersionGraph,
  requireWorkflowRow,
  runInScope,
} from "./lookups.js";
import {
  eventDetailOf,
  receiptViewOf,
  stepOf,
  triggerKindOfRow,
  type ReceiptView,
} from "./mappers.js";
import {
  READ_LIMITS,
  WorkflowReadError,
  clipText,
  durationMs,
  percentile,
  scopeOf,
  takeWindow,
  type EventRow,
  type ReadDatabase,
} from "./shared.js";

const ev = factoryWorkflowItemEvents;
const runs = factoryWorkflowRuns;
const steps = factoryWorkflowSteps;

export interface NodeAuditStep {
  runId: string;
  mode: RunMode;
  status: StepStatus;
  graphVersion: number;
  triggerKind: RunTriggerKind;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  /** Items per output port. */
  ports: Record<string, number>;
  error: { code: string; message: string } | null;
  truncated: { totalAvailable: number } | null;
  inputTruncated: boolean;
  receiptKeyCount: number;
  agentThreadId: string | null;
}

export interface SampledItem {
  itemId: string;
  title: string | null;
  /** What the node recorded about this item in that run, clipped. */
  summary: string | null;
  summaryTruncated: boolean;
}

export interface NodeAuditInput {
  edgeId: string;
  fromNodeId: string;
  fromPort: string;
  count: number;
  items: SampledItem[];
  itemsTruncated: boolean;
}

export interface NodeAuditOutput {
  port: string;
  count: number;
  items: SampledItem[];
  itemsTruncated: boolean;
}

export interface NodeAudit {
  workflow: { id: string; name: string; version: number };
  /** The graph version the node was read from: the run's, or the current one. */
  graphVersion: number;
  node: { id: string; name: string; kind: NodeKind };
  runId: string | null;
  summary: {
    steps: number;
    statusCounts: Record<StepStatus, number>;
    modeCounts: Record<RunMode, number>;
    /** Failed steps over all steps; null when there are no steps. */
    failureRate: number | null;
    durationMs: { p50: number; p95: number; samples: number } | null;
  };
  steps: NodeAuditStep[];
  hasMoreSteps: boolean;
  latest:
    | (NodeAuditStep & { in: NodeAuditInput[]; out: NodeAuditOutput[] })
    | null;
  errors: {
    byCode: {
      code: string;
      steps: number;
      lastMessage: string;
      lastRunId: string;
      lastAt: string;
    }[];
    recentItemErrors: {
      runId: string;
      itemId: string;
      at: string;
      /** Why the item failed here. */
      code: WorkflowErrorCode | null;
      summary: string;
      summaryTruncated: boolean;
    }[];
  };
  receipts: ReceiptView[];
  receiptsTruncated: boolean;
  missingReceiptKeys: string[];
}

export interface NodeAuditQuery {
  workflowId: string;
  nodeId: string;
  runId?: string;
  mode?: RunMode;
  limit?: number;
}

export async function getNodeAudit(
  getDatabase: () => ReadDatabase,
  scope: WorkflowScope,
  input: NodeAuditQuery,
): Promise<NodeAudit> {
  assertScope(scope);
  const limit =
    input.limit === undefined ? READ_LIMITS.nodeAuditDefault : input.limit;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > READ_LIMITS.nodeAuditMax
  ) {
    throw new WorkflowReadError(
      "invalid_input",
      `Node audit limit must be a whole number from 1 to ${READ_LIMITS.nodeAuditMax}.`,
      { limit },
    );
  }
  const db = getDatabase();
  const workflow = await requireWorkflowRow(db, scope, input.workflowId);
  let graphVersion = workflow.version;
  if (input.runId !== undefined) {
    const run = await runInScope(db, scope, input.runId);
    if (!run || run.workflowId !== workflow.id) {
      throw new WorkflowReadError(
        "run_not_found",
        `Run "${input.runId}" was not found in workflow "${workflow.id}".`,
        { workflowId: workflow.id, runId: input.runId },
      );
    }
    graphVersion = run.graphVersion;
  }
  const graph = await readVersionGraph(db, scope, workflow.id, graphVersion);
  const node = graph.nodes.find((candidate) => candidate.id === input.nodeId);
  if (!node) {
    throw new WorkflowReadError(
      "node_not_found",
      `Node "${input.nodeId}" is not in version ${graphVersion} of workflow "${workflow.id}".`,
      { workflowId: workflow.id, nodeId: input.nodeId, graphVersion },
    );
  }
  const fetched = await db
    .select({ step: steps, run: runs })
    .from(steps)
    .leftJoin(runs, eq(runs.id, steps.runId))
    .where(
      and(
        eq(steps.workflowId, workflow.id),
        eq(steps.nodeId, node.id),
        scopeOf(steps, scope),
        input.runId === undefined ? undefined : eq(steps.runId, input.runId),
        input.mode === undefined ? undefined : eq(steps.mode, input.mode),
      ),
    )
    .orderBy(desc(steps.startedAt), desc(steps.id))
    .limit(limit + 1);
  const window = takeWindow(fetched, limit);
  const records = window.rows.map((row) => {
    if (!row.run) {
      throw new WorkflowStoreError(
        "corrupt_record",
        `factory_workflow_steps (run "${row.step.runId}", node "${row.step.nodeId}") has no run row.`,
      );
    }
    const record = stepOf(row.step);
    const view: NodeAuditStep = {
      runId: record.runId,
      mode: record.mode,
      status: record.status,
      graphVersion: row.run.graphVersion,
      triggerKind: triggerKindOfRow(row.run),
      startedAt: record.startedAt,
      finishedAt: record.finishedAt ?? null,
      durationMs: durationMs(record.startedAt, record.finishedAt),
      ports: Object.fromEntries(
        Object.entries(record.ports).map(([port, entry]) => [
          port,
          entry.count,
        ]),
      ),
      error: record.error ?? null,
      truncated: record.truncated ?? null,
      inputTruncated: record.inputTruncated ?? false,
      receiptKeyCount: record.receiptKeys?.length ?? 0,
      agentThreadId: record.agentThreadId ?? null,
    };
    return { record, view };
  });

  const statusCounts: Record<StepStatus, number> = {
    running: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    needs_check: 0,
  };
  const modeCounts: Record<RunMode, number> = { live: 0, dry: 0, test: 0 };
  const durations: number[] = [];
  const byCode = new Map<
    string,
    {
      code: string;
      steps: number;
      lastMessage: string;
      lastRunId: string;
      lastAt: string;
    }
  >();
  for (const { view } of records) {
    statusCounts[view.status] += 1;
    modeCounts[view.mode] += 1;
    if (view.durationMs !== null) durations.push(view.durationMs);
    if (view.error) {
      const known = byCode.get(view.error.code);
      if (known) known.steps += 1;
      else {
        // Newest first, so the first step seen with a code is its latest.
        byCode.set(view.error.code, {
          code: view.error.code,
          steps: 1,
          lastMessage: view.error.message,
          lastRunId: view.runId,
          lastAt: view.startedAt,
        });
      }
    }
  }

  // Samples: the items that went into and out of the newest step.
  const newest = records[0];
  let latest: NodeAudit["latest"] = null;
  if (newest) {
    const incoming = graph.edges.filter((edge) => edge.to.node === node.id);
    const upstreamIds = [...new Set(incoming.map((edge) => edge.from.node))];
    const upstreamRows =
      upstreamIds.length === 0
        ? []
        : await db
            .select()
            .from(steps)
            .where(
              and(
                eq(steps.runId, newest.record.runId),
                scopeOf(steps, scope),
                inArray(steps.nodeId, upstreamIds),
              ),
            )
            .limit(upstreamIds.length);
    const upstream = new Map(
      upstreamRows.map((row) => [row.nodeId, stepOf(row)]),
    );
    const inSamples = incoming.flatMap((edge) => {
      const port = upstream.get(edge.from.node)?.ports[edge.from.port];
      return port ? [{ edge, port }] : [];
    });
    const outSamples = Object.entries(newest.record.ports);
    const sampleIds = [
      ...new Set([
        ...inSamples.flatMap(({ port }) =>
          port.itemIds.slice(0, READ_LIMITS.sampleItemsPerPort),
        ),
        ...outSamples.flatMap(([, port]) =>
          port.itemIds.slice(0, READ_LIMITS.sampleItemsPerPort),
        ),
      ]),
    ];
    const [titles, notes] =
      sampleIds.length === 0
        ? [new Map<string, { title: string }>(), [] as EventRow[]]
        : await Promise.all([
            inboxRows(db, scope, sampleIds),
            db
              .select()
              .from(ev)
              .where(
                and(
                  scopeOf(ev, scope),
                  eq(ev.workflowId, workflow.id),
                  eq(ev.runId, newest.record.runId),
                  eq(ev.nodeId, node.id),
                  inArray(ev.itemId, sampleIds),
                ),
              )
              .orderBy(desc(ev.occurredAt), desc(ev.id))
              .limit(READ_LIMITS.sampleItemsPerPort * sampleIds.length * 4),
          ]);
    const noteByItem = new Map<string, string>();
    for (const row of notes) {
      if (!noteByItem.has(row.itemId)) noteByItem.set(row.itemId, row.summary);
    }
    const sample = (itemId: string, withSummary: boolean): SampledItem => {
      const note = withSummary ? noteByItem.get(itemId) : undefined;
      const summary =
        note === undefined
          ? null
          : clipText(note, READ_LIMITS.shortSummaryChars);
      return {
        itemId,
        title: titles.get(itemId)?.title ?? null,
        summary: summary?.text ?? null,
        summaryTruncated: summary?.truncated ?? false,
      };
    };
    latest = {
      ...newest.view,
      in: inSamples.map(({ edge, port }) => ({
        edgeId: edge.id,
        fromNodeId: edge.from.node,
        fromPort: edge.from.port,
        count: port.count,
        items: port.itemIds
          .slice(0, READ_LIMITS.sampleItemsPerPort)
          .map((itemId) => sample(itemId, false)),
        itemsTruncated: port.count > READ_LIMITS.sampleItemsPerPort,
      })),
      out: outSamples.map(([port, entry]) => ({
        port,
        count: entry.count,
        items: entry.itemIds
          .slice(0, READ_LIMITS.sampleItemsPerPort)
          .map((itemId) => sample(itemId, true)),
        itemsTruncated: entry.count > READ_LIMITS.sampleItemsPerPort,
      })),
    };
  }

  const runIds = records.map(({ record }) => record.runId);
  const [errorRows, receiptRows] = await Promise.all([
    runIds.length === 0
      ? []
      : db
          .select()
          .from(ev)
          .where(
            and(
              scopeOf(ev, scope),
              eq(ev.workflowId, workflow.id),
              eq(ev.nodeId, node.id),
              eq(ev.kind, "error"),
              inArray(ev.runId, runIds),
            ),
          )
          .orderBy(desc(ev.occurredAt), desc(ev.id))
          .limit(READ_LIMITS.nodeAuditItemErrors),
    (async () => {
      const keys: string[] = [];
      for (const { record } of records) {
        for (const key of record.receiptKeys ?? []) keys.push(key);
      }
      const unique = [...new Set(keys)];
      const wanted = unique.slice(0, READ_LIMITS.nodeAuditReceipts);
      const rows =
        wanted.length === 0
          ? []
          : await db
              .select()
              .from(factoryWorkflowReceipts)
              .where(
                and(
                  scopeOf(factoryWorkflowReceipts, scope),
                  inArray(factoryWorkflowReceipts.receiptKey, wanted),
                ),
              )
              .limit(wanted.length);
      return { rows, wanted, truncated: unique.length > wanted.length };
    })(),
  ]);
  const receipts = receiptRows.rows
    .map(receiptViewOf)
    .sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
  const found = new Set(receiptRows.rows.map((row) => row.receiptKey));

  return {
    workflow: {
      id: workflow.id,
      name: workflow.name,
      version: workflow.version,
    },
    graphVersion,
    node: { id: node.id, name: node.name, kind: node.kind },
    runId: input.runId ?? null,
    summary: {
      steps: records.length,
      statusCounts,
      modeCounts,
      failureRate:
        records.length === 0 ? null : statusCounts.failed / records.length,
      durationMs:
        durations.length === 0
          ? null
          : {
              p50: percentile(durations, 0.5) ?? 0,
              p95: percentile(durations, 0.95) ?? 0,
              samples: durations.length,
            },
    },
    steps: records.map(({ view }) => view),
    hasMoreSteps: window.more,
    latest,
    errors: {
      byCode: [...byCode.values()],
      recentItemErrors: errorRows.map((row) => {
        const summary = clipText(row.summary, READ_LIMITS.shortSummaryChars);
        return {
          runId: row.runId,
          itemId: row.itemId,
          at: row.occurredAt,
          code: eventDetailOf(row).code,
          summary: summary.text,
          summaryTruncated: summary.truncated,
        };
      }),
    },
    receipts,
    receiptsTruncated: receiptRows.truncated,
    missingReceiptKeys: receiptRows.wanted.filter((key) => !found.has(key)),
  };
}
