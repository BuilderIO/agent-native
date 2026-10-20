import { and, desc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  factoryWorkflowItemEvents,
  factoryWorkflowReceipts,
  factoryWorkflowSteps,
} from "../../db/schema.js";
import {
  WorkflowStoreError,
  type WorkflowScope,
} from "../../workflow/adapter.js";
import {
  MAX_NODES,
  type EndOutcome,
  type ItemEventKind,
  type NodeKind,
  type RunMode,
  type StepStatus,
  type WorkflowErrorCode,
} from "../../workflow/contract.js";
import { assertScope, parseStoredValue } from "../../workflow/store-rules.js";
import { itemRowsOf, selectItemRows, type ItemRow } from "./items.js";
import { inboxRows, requireWorkflowRow, workflowInfos } from "./lookups.js";
import {
  eventDetailOf,
  eventKindOf,
  receiptViewOf,
  stepOf,
  type ReceiptView,
} from "./mappers.js";
import {
  READ_LIMITS,
  WorkflowReadError,
  clipText,
  decodeCursor,
  decodeReceiptKey,
  encodeCursor,
  eventsCursorSchema,
  httpUrl,
  scopeOf,
  takeWindow,
  type EventRow,
  type ReadDatabase,
} from "./shared.js";

const ev = factoryWorkflowItemEvents;
const steps = factoryWorkflowSteps;

export interface JourneyEvent {
  id: string;
  runId: string;
  at: string;
  kind: ItemEventKind;
  mode: RunMode;
  nodeId: string | null;
  nodeName: string | null;
  port: string | null;
  summary: string;
  summaryTruncated: boolean;
  receiptKey: string | null;
  threadId: string | null;
  /** How an `ended` event ended the item; null on every other kind. */
  outcome: EndOutcome | null;
  /** Why an `error` event failed the item; null on every other kind. */
  code: WorkflowErrorCode | null;
}

export interface JourneyStep {
  runId: string;
  nodeId: string;
  nodeName: string | null;
  status: StepStatus;
  mode: RunMode;
  startedAt: string;
  finishedAt: string | null;
  /** The ports whose item ids include this item. */
  ports: string[];
  /** A port listed fewer ids than it counted, so `ports` may be missing one. */
  portIdsTruncated: boolean;
  error: { code: string; message: string } | null;
  receiptKeys: string[];
  agentThreadId: string | null;
}

export interface PathNode {
  nodeId: string;
  nodeName: string | null;
  nodeKind: NodeKind | null;
  /** Distinct runs in which the item reached this node. */
  visits: number;
  firstAt: string;
  lastAt: string;
}

export interface ItemJourney {
  workflow: { id: string; name: string; version: number };
  item: {
    id: string;
    inbox: boolean;
    title: string | null;
    source: string | null;
    sourceUrl: string | null;
    status: string | null;
  };
  /** The item's live state; null when it only ever appeared in a dry or test run. */
  state: Omit<
    ItemRow,
    | "workflowId"
    | "workflowName"
    | "itemId"
    | "inbox"
    | "title"
    | "source"
    | "sourceUrl"
    | "status"
  > | null;
  /** Oldest first within this page. */
  events: JourneyEvent[];
  eventsHasMore: boolean;
  /** Cursor for the older events; null when this page reaches the first one. */
  olderCursor: string | null;
  steps: JourneyStep[];
  /** Nodes the item reached, by first visit, across all its events. */
  path: PathNode[];
  receipts: ReceiptView[];
  receiptsTruncated: boolean;
}

export interface JourneyQuery {
  workflowId: string;
  itemId: string;
  limit?: number;
  cursor?: string;
}

export async function getItemJourney(
  getDatabase: () => ReadDatabase,
  clock: () => Date,
  scope: WorkflowScope,
  input: JourneyQuery,
): Promise<ItemJourney> {
  assertScope(scope);
  const limit =
    input.limit === undefined ? READ_LIMITS.journeyEventsDefault : input.limit;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > READ_LIMITS.journeyEventsMax
  ) {
    throw new WorkflowReadError(
      "invalid_input",
      `Journey limit must be a whole number from 1 to ${READ_LIMITS.journeyEventsMax}.`,
      { limit },
    );
  }
  const before =
    input.cursor === undefined
      ? null
      : decodeCursor("events", input.cursor, eventsCursorSchema);
  const db = getDatabase();
  const workflow = await requireWorkflowRow(db, scope, input.workflowId);
  const itemEvents = and(
    eq(ev.workflowId, workflow.id),
    eq(ev.itemId, input.itemId),
    scopeOf(ev, scope),
  );

  const [stateRows, eventRows, pathRows, inboxById, infos] = await Promise.all([
    selectItemRows(
      db,
      scope,
      { workflowId: workflow.id, itemIds: [input.itemId] },
      1,
      null,
    ),
    db
      .select()
      .from(ev)
      .where(
        and(
          itemEvents,
          before === null
            ? undefined
            : or(
                lt(ev.occurredAt, before.at),
                and(eq(ev.occurredAt, before.at), lt(ev.id, before.id)),
              ),
        ),
      )
      .orderBy(desc(ev.occurredAt), desc(ev.id))
      .limit(limit + 1),
    db
      .select({
        nodeId: ev.nodeId,
        visits: sql<number>`count(DISTINCT ${ev.runId})`.mapWith(Number),
        firstAt: sql<string>`min(${ev.occurredAt})`,
        lastAt: sql<string>`max(${ev.occurredAt})`,
      })
      .from(ev)
      .where(and(itemEvents, isNotNull(ev.nodeId)))
      .groupBy(ev.nodeId)
      .limit(MAX_NODES + 1),
    inboxRows(db, scope, [input.itemId]),
    workflowInfos(db, scope, [workflow.id]),
  ]);
  const info = infos.get(workflow.id);
  const nodes = info?.nodes;

  const stateRow = stateRows[0];
  if (!stateRow && eventRows.length === 0 && before === null) {
    throw new WorkflowReadError(
      "item_not_found",
      `Item "${input.itemId}" has no state or events in workflow "${workflow.id}".`,
      { workflowId: workflow.id, itemId: input.itemId },
    );
  }

  const window = takeWindow(eventRows, limit);
  const newestFirst = window.rows;
  const events: JourneyEvent[] = [...newestFirst].reverse().map((row) => {
    const summary = clipText(row.summary, READ_LIMITS.eventSummaryChars);
    const node = row.nodeId === null ? undefined : nodes?.get(row.nodeId);
    return {
      id: row.id,
      runId: row.runId,
      at: row.occurredAt,
      kind: eventKindOf(
        row.kind,
        `factory_workflow_item_events "${row.id}" kind`,
      ),
      mode: parseStoredValue(
        row.mode,
        z.enum(["live", "dry", "test"]),
        `factory_workflow_item_events "${row.id}" mode`,
      ),
      nodeId: row.nodeId,
      nodeName: node?.name ?? null,
      port: row.port,
      summary: summary.text,
      summaryTruncated: summary.truncated,
      receiptKey: row.receiptKey,
      threadId: row.threadId,
      ...eventDetailOf(row),
    };
  });
  const oldest = newestFirst[newestFirst.length - 1];

  // Steps this page's events point at, matched on the exact (run, node) pair.
  const pairs = new Set(
    newestFirst
      .filter(
        (row): row is EventRow & { nodeId: string } => row.nodeId !== null,
      )
      .map((row) => `${row.runId}\u0000${row.nodeId}`),
  );
  const runIds = [...new Set(newestFirst.map((row) => row.runId))];
  const nodeIds = [
    ...new Set(
      newestFirst.flatMap((row) => (row.nodeId === null ? [] : [row.nodeId])),
    ),
  ];
  const stepRows =
    pairs.size === 0
      ? []
      : await db
          .select()
          .from(steps)
          .where(
            and(
              scopeOf(steps, scope),
              inArray(steps.runId, runIds),
              inArray(steps.nodeId, nodeIds),
            ),
          )
          .limit(runIds.length * nodeIds.length);
  const journeySteps: JourneyStep[] = [];
  const receiptKeys = new Set<string>();
  for (const row of stepRows) {
    if (!pairs.has(`${row.runId}\u0000${row.nodeId}`)) continue;
    const record = stepOf(row);
    const stepPorts = Object.entries(record.ports);
    for (const key of record.receiptKeys ?? []) {
      const decoded = decodeReceiptKey(key);
      if (!decoded) {
        throw new WorkflowStoreError(
          "corrupt_record",
          `factory_workflow_steps (run "${row.runId}", node "${row.nodeId}") lists "${key}", which is not a workflow receipt key.`,
        );
      }
      if (decoded.itemId === input.itemId) receiptKeys.add(key);
    }
    journeySteps.push({
      runId: record.runId,
      nodeId: record.nodeId,
      nodeName: nodes?.get(record.nodeId)?.name ?? null,
      status: record.status,
      mode: record.mode,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt ?? null,
      ports: stepPorts
        .filter(([, entry]) => entry.itemIds.includes(input.itemId))
        .map(([port]) => port),
      portIdsTruncated: stepPorts.some(
        ([, entry]) => entry.itemIds.length < entry.count,
      ),
      error: record.error ?? null,
      receiptKeys: (record.receiptKeys ?? []).filter(
        (key) => decodeReceiptKey(key)?.itemId === input.itemId,
      ),
      agentThreadId: record.agentThreadId ?? null,
    });
  }
  journeySteps.sort(
    (a, b) =>
      a.startedAt.localeCompare(b.startedAt) ||
      a.nodeId.localeCompare(b.nodeId),
  );
  for (const row of newestFirst) {
    if (row.receiptKey !== null) receiptKeys.add(row.receiptKey);
  }
  const keys = [...receiptKeys];
  const receiptRows =
    keys.length === 0
      ? []
      : await db
          .select()
          .from(factoryWorkflowReceipts)
          .where(
            and(
              scopeOf(factoryWorkflowReceipts, scope),
              inArray(
                factoryWorkflowReceipts.receiptKey,
                keys.slice(0, READ_LIMITS.journeyReceipts),
              ),
            ),
          )
          .limit(READ_LIMITS.journeyReceipts);
  const receipts = receiptRows
    .map(receiptViewOf)
    .sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));

  if (pathRows.length > MAX_NODES) {
    throw new WorkflowStoreError(
      "corrupt_record",
      `Item "${input.itemId}" reached more than ${MAX_NODES} nodes in workflow "${workflow.id}", which no graph can have.`,
    );
  }
  const path: PathNode[] = pathRows
    .flatMap((row) =>
      row.nodeId === null
        ? []
        : [
            {
              nodeId: row.nodeId,
              nodeName: nodes?.get(row.nodeId)?.name ?? null,
              nodeKind: nodes?.get(row.nodeId)?.kind ?? null,
              visits: row.visits,
              firstAt: row.firstAt,
              lastAt: row.lastAt,
            },
          ],
    )
    .sort(
      (a, b) =>
        a.firstAt.localeCompare(b.firstAt) || a.nodeId.localeCompare(b.nodeId),
    );

  const [row] = stateRow ? itemRowsOf(clock, [stateRow], infos) : [];
  const inboxRow = inboxById.get(input.itemId);
  return {
    workflow: {
      id: workflow.id,
      name: workflow.name,
      version: workflow.version,
    },
    item: {
      id: input.itemId,
      inbox: inboxRow !== undefined,
      title: inboxRow?.title ?? null,
      source: inboxRow?.source ?? null,
      sourceUrl: httpUrl(inboxRow?.sourceUrl ?? null),
      status: inboxRow?.status ?? null,
    },
    state: row
      ? {
          graphVersion: row.graphVersion,
          parked: row.parked,
          lease: row.lease,
          attempts: row.attempts,
          needsYouReasons: row.needsYouReasons,
          lastNode: row.lastNode,
          lastEvent: row.lastEvent,
          lastActivityAt: row.lastActivityAt,
        }
      : null,
    events,
    eventsHasMore: window.more,
    olderCursor:
      window.more && oldest
        ? encodeCursor("events", { at: oldest.occurredAt, id: oldest.id })
        : null,
    steps: journeySteps,
    path,
    receipts,
    receiptsTruncated: keys.length > READ_LIMITS.journeyReceipts,
  };
}
