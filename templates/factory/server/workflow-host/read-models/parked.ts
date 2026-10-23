import { and, asc, eq, gt, isNotNull, or, sql } from "drizzle-orm";

import { factoryWorkflowItemState, triageItems } from "../../db/schema.js";
import {
  WorkflowStoreError,
  type WorkflowScope,
} from "../../workflow/adapter.js";
import { MAX_NODES } from "../../workflow/contract.js";
import { assertScope, readCounters } from "../../workflow/store-rules.js";
import { itemRowsOf, type ItemLease, type ItemParking } from "./items.js";
import { requireWorkflowRow, workflowInfos } from "./lookups.js";
import {
  decodeCursor,
  encodeCursor,
  pageLimit,
  parkedCursorSchema,
  scopeOf,
  takeWindow,
  type ReadDatabase,
  type ReadPage,
} from "./shared.js";

const state = factoryWorkflowItemState;
const inbox = triageItems;

export interface ParkedRow {
  itemId: string;
  inbox: boolean;
  title: string | null;
  source: string | null;
  sourceUrl: string | null;
  status: string | null;
  graphVersion: number;
  parked: ItemParking;
  counters: Record<string, number>;
  attempts: number;
  lease: ItemLease | null;
  updatedAt: string;
}

export interface ParkedByNode {
  nodeId: string;
  nodeName: string | null;
  count: number;
  nextDueAt: string;
}

export interface ParkedList extends ReadPage<ParkedRow> {
  workflowId: string;
  byNode: ParkedByNode[];
  byNodeTruncated: boolean;
}

export interface ParkedListQuery {
  workflowId: string;
  nodeId?: string;
  limit?: number;
  cursor?: string;
}

export async function listParked(
  getDatabase: () => ReadDatabase,
  clock: () => Date,
  scope: WorkflowScope,
  input: ParkedListQuery,
): Promise<ParkedList> {
  assertScope(scope);
  const limit = pageLimit(input.limit, "Parked list");
  const after =
    input.cursor === undefined
      ? null
      : decodeCursor("parked", input.cursor, parkedCursorSchema);
  const db = getDatabase();
  const workflow = await requireWorkflowRow(db, scope, input.workflowId);
  const parkedHere = and(
    eq(state.workflowId, workflow.id),
    scopeOf(state, scope),
    isNotNull(state.parkedAtNode),
  );
  const [fetched, groups, infos] = await Promise.all([
    db
      .select({
        workflowId: state.workflowId,
        itemId: state.itemId,
        graphVersion: state.graphVersion,
        parkedAtNode: state.parkedAtNode,
        wakeJson: state.wakeJson,
        dueAt: state.dueAt,
        countersJson: state.countersJson,
        leasedBy: state.leasedBy,
        leaseUntil: state.leaseUntil,
        updatedAt: state.updatedAt,
        inboxId: inbox.id,
        title: inbox.title,
        source: inbox.source,
        sourceUrl: inbox.sourceUrl,
        status: inbox.status,
      })
      .from(state)
      .leftJoin(
        inbox,
        and(
          eq(inbox.id, state.itemId),
          eq(inbox.orgId, state.orgId),
          eq(inbox.factoryId, state.factoryId),
        ),
      )
      .where(
        and(
          parkedHere,
          input.nodeId === undefined
            ? undefined
            : eq(state.parkedAtNode, input.nodeId),
          after === null
            ? undefined
            : or(
                gt(state.dueAt, after.due),
                and(eq(state.dueAt, after.due), gt(state.itemId, after.id)),
              ),
        ),
      )
      .orderBy(asc(state.dueAt), asc(state.itemId))
      .limit(limit + 1),
    db
      .select({
        nodeId: state.parkedAtNode,
        count: sql<number>`count(*)`.mapWith(Number),
        nextDueAt: sql<string>`min(${state.dueAt})`,
      })
      .from(state)
      .where(parkedHere)
      .groupBy(state.parkedAtNode)
      .orderBy(sql`min(${state.dueAt})`)
      .limit(MAX_NODES + 1),
    workflowInfos(db, scope, [workflow.id]),
  ]);
  const info = infos.get(workflow.id);
  const window = takeWindow(fetched, limit);
  const items: ParkedRow[] = window.rows.map((row) => {
    const label = `factory_workflow_item_state (workflow "${row.workflowId}", item "${row.itemId}")`;
    const counters = readCounters(row.countersJson, `${label} counters_json`);
    const [item] = itemRowsOf(
      clock,
      [
        {
          ...row,
          handedOff: false,
          needsCheck: false,
          exhausted: false,
          unreadable: false,
          lastAt: null,
          lastKind: null,
          lastNode: null,
          lastSummary: null,
        },
      ],
      infos,
    );
    if (!item?.parked) {
      throw new WorkflowStoreError(
        "corrupt_record",
        `${label} matched the parked list but is not parked.`,
      );
    }
    return {
      itemId: row.itemId,
      inbox: row.inboxId !== null,
      title: row.title,
      source: row.source,
      sourceUrl: item.sourceUrl,
      status: row.status,
      graphVersion: row.graphVersion,
      parked: item.parked,
      counters,
      attempts: counters.attempts ?? 0,
      lease: item.lease,
      updatedAt: row.updatedAt,
    };
  });
  const last = window.rows[window.rows.length - 1];
  const groupWindow = takeWindow(groups, MAX_NODES);
  return {
    workflowId: workflow.id,
    items,
    hasMore: window.more,
    nextCursor:
      window.more && last?.dueAt
        ? encodeCursor("parked", { due: last.dueAt, id: last.itemId })
        : null,
    byNode: groupWindow.rows.flatMap((group) =>
      group.nodeId === null
        ? []
        : [
            {
              nodeId: group.nodeId,
              nodeName: info?.nodes.get(group.nodeId)?.name ?? null,
              count: group.count,
              nextDueAt: group.nextDueAt,
            },
          ],
    ),
    byNodeTruncated: groupWindow.more,
  };
}
