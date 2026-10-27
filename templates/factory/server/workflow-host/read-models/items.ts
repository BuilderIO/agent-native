import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import {
  factoryWorkflowItemEvents,
  factoryWorkflowItemState,
  triageItems,
} from "../../db/schema.js";
import {
  WorkflowStoreError,
  type WorkflowScope,
} from "../../workflow/adapter.js";
import {
  END_OUTCOMES,
  WORKFLOW_ERROR_CODES,
  type ItemEventKind,
  type ThreadRef,
  type Wake,
} from "../../workflow/contract.js";
import { MAX_ITEM_ATTEMPTS } from "../../workflow/engine/constants.js";
import {
  assembleItemState,
  assertScope,
  readCounters,
  readWake,
} from "../../workflow/store-rules.js";
import {
  requireWorkflowRow,
  workflowInfos,
  type WorkflowInfo,
} from "./lookups.js";
import { eventKindOf } from "./mappers.js";
import {
  READ_LIMITS,
  clipText,
  decodeCursor,
  encodeCursor,
  httpUrl,
  itemsCursorSchema,
  pageLimit,
  scopeOf,
  takeWindow,
  type ReadDatabase,
  type ReadPage,
} from "./shared.js";

const ev = factoryWorkflowItemEvents;
const state = factoryWorkflowItemState;
const inbox = triageItems;

const SIGNAL_KINDS = ["ended", "taken", "woke", "error"] as const;
const INBOX_NEEDS_MANUAL = "needs_manual";

export type NeedsYouReason =
  | "handed_off"
  | "attempts_exhausted"
  | "effect_needs_check";

export interface ItemParking {
  nodeId: string;
  nodeName: string | null;
  /** The node is no longer in the workflow's current graph. */
  nodeMissingFromGraph: boolean;
  wait: Wake["wait"];
  dueAt: string;
  nextCheckAt: string | null;
  watching: ThreadRef | null;
}

export interface ItemLease {
  by: string;
  until: string;
  /** The lease has not expired. */
  live: boolean;
}

export interface ItemLastEvent {
  at: string;
  kind: ItemEventKind;
  nodeId: string | null;
  summary: string;
  summaryTruncated: boolean;
}

export interface ItemRow {
  workflowId: string;
  workflowName: string | null;
  itemId: string;
  /** A Factory inbox row backs this item; false for a synthetic one (a group or a list). */
  inbox: boolean;
  title: string | null;
  source: string | null;
  sourceUrl: string | null;
  /** The inbox status; null for a synthetic item. */
  status: string | null;
  graphVersion: number;
  parked: ItemParking | null;
  lease: ItemLease | null;
  attempts: number;
  /** Why a person has to look, empty when nobody does. */
  needsYouReasons: NeedsYouReason[];
  /** The node of the item's most recent live event. */
  lastNode: { nodeId: string; nodeName: string | null } | null;
  lastEvent: ItemLastEvent | null;
  lastActivityAt: string;
}

export interface ItemFilters {
  workflowId?: string;
  itemIds?: readonly string[];
  /** Inbox statuses; an item with no inbox row matches none of them. */
  status?: readonly string[];
  needsYou?: boolean;
  parked?: boolean;
  /** The inbox source: `slack`, `github`, `sentry`, ... */
  source?: string;
  /** Matches the title or the item id. */
  search?: string;
}

export interface ItemListQuery extends ItemFilters {
  limit?: number;
  cursor?: string;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// Item rows: the Items tab, the journey header, and the parked list share one query.

/**
 * The newest live event of an item, as one scalar subquery. It reads the
 * `(workflow, item, time)` index, so a long-lived item costs one probe, not
 * a scan of its trail.
 */
function latestLive<T = string | null>(
  pick: SQL | AnyPgColumn,
  kinds?: readonly string[],
): SQL<T> {
  return sql<T>`(SELECT ${pick} FROM ${ev}
    WHERE ${ev.workflowId} = ${state.workflowId}
      AND ${ev.itemId} = ${state.itemId}
      AND ${ev.mode} = 'live'
      ${kinds === undefined ? sql`` : sql`AND ${inArray(ev.kind, [...kinds])}`}
    ORDER BY ${ev.occurredAt} DESC, ${ev.id} DESC
    LIMIT 1)`;
}

/**
 * "A person has to look", decided by the item's newest live signal among
 * `ended`, `taken`, `woke`, and `error`, so a later restart or a later end
 * clears it. An inbox item answers by its status instead, which a person
 * changes when they resolve it. The attempts counter is read as text, so a
 * damaged counters column cannot fail the query; the row read reports it.
 */
function needsYouFragments() {
  // One probe of the trail, read by field: kind, how it ended, why it failed.
  const signal = latestLive<unknown>(
    sql`jsonb_build_object('kind', ${ev.kind}, 'outcome', ${ev.outcome}, 'code', ${ev.code})`,
    SIGNAL_KINDS,
  );
  const signalIs = (fields: Record<string, string>) =>
    sql<boolean>`COALESCE(${signal} @> ${JSON.stringify(fields)}::jsonb, false)`;
  const attempts = sql`COALESCE((substring(${state.countersJson} from '"attempts":\\s*([0-9]{1,9})'))::int, 0)`;
  const handedOff = sql<boolean>`COALESCE(CASE WHEN ${inbox.id} IS NOT NULL THEN ${inbox.status} = ${INBOX_NEEDS_MANUAL} ELSE ${signalIs({ kind: "ended", outcome: "needsManual" })} END, false)`;
  const needsCheck = signalIs({ kind: "error", code: "effect_needs_check" });
  const exhausted = sql<boolean>`COALESCE(${signalIs({ kind: "error" })} AND ${attempts} >= ${MAX_ITEM_ATTEMPTS}, false)`;
  // A stored outcome or code the contract does not have is not "nothing to see": it flags the row, and the row read refuses it.
  const outside = (field: string, known: readonly string[]) =>
    `@.${field} != null && ${known.map((value) => `@.${field} != "${value}"`).join(" && ")}`;
  const unreadable = sql<boolean>`COALESCE(jsonb_path_exists(${signal}, ${`$ ? ((${outside("outcome", END_OUTCOMES)}) || (${outside("code", WORKFLOW_ERROR_CODES)}))`}::jsonpath), false)`;
  return {
    handedOff,
    needsCheck,
    exhausted,
    unreadable,
    any: or(handedOff, needsCheck, exhausted, unreadable) as SQL,
  };
}

interface ItemsAfter {
  at: string;
  workflowId: string;
  itemId: string;
}

export async function selectItemRows(
  db: ReadDatabase,
  scope: WorkflowScope,
  filters: ItemFilters,
  limit: number,
  after: ItemsAfter | null,
) {
  const needs = needsYouFragments();
  const pattern =
    filters.search === undefined || filters.search === ""
      ? undefined
      : `%${escapeLike(filters.search)}%`;
  return db
    .select({
      workflowId: state.workflowId,
      itemId: state.itemId,
      graphVersion: state.graphVersion,
      parkedAtNode: state.parkedAtNode,
      wakeJson: state.wakeJson,
      countersJson: state.countersJson,
      leasedBy: state.leasedBy,
      leaseUntil: state.leaseUntil,
      updatedAt: state.updatedAt,
      inboxId: inbox.id,
      title: inbox.title,
      source: inbox.source,
      sourceUrl: inbox.sourceUrl,
      status: inbox.status,
      handedOff: needs.handedOff.as("handed_off"),
      needsCheck: needs.needsCheck.as("needs_check"),
      exhausted: needs.exhausted.as("attempts_exhausted"),
      unreadable: needs.unreadable.as("signal_unreadable"),
      lastAt: latestLive<string | null>(ev.occurredAt).as("last_event_at"),
      lastKind: latestLive<string | null>(ev.kind).as("last_event_kind"),
      lastNode: latestLive<string | null>(ev.nodeId).as("last_event_node"),
      lastSummary: latestLive<string | null>(ev.summary).as(
        "last_event_summary",
      ),
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
        scopeOf(state, scope),
        filters.workflowId === undefined
          ? undefined
          : eq(state.workflowId, filters.workflowId),
        filters.itemIds === undefined
          ? undefined
          : inArray(state.itemId, [...filters.itemIds]),
        filters.status === undefined
          ? undefined
          : inArray(inbox.status, [...filters.status]),
        filters.source === undefined
          ? undefined
          : eq(inbox.source, filters.source),
        filters.parked === undefined
          ? undefined
          : filters.parked
            ? isNotNull(state.parkedAtNode)
            : isNull(state.parkedAtNode),
        pattern === undefined
          ? undefined
          : or(ilike(inbox.title, pattern), ilike(state.itemId, pattern)),
        filters.needsYou === true ? needs.any : undefined,
        after === null
          ? undefined
          : or(
              lt(state.updatedAt, after.at),
              and(
                eq(state.updatedAt, after.at),
                or(
                  lt(state.workflowId, after.workflowId),
                  and(
                    eq(state.workflowId, after.workflowId),
                    lt(state.itemId, after.itemId),
                  ),
                ),
              ),
            ),
      ),
    )
    .orderBy(desc(state.updatedAt), desc(state.workflowId), desc(state.itemId))
    .limit(limit);
}

type ItemQueryRow = Awaited<ReturnType<typeof selectItemRows>>[number];

export function itemRowsOf(
  clock: () => Date,
  rows: ItemQueryRow[],
  infos: Map<string, WorkflowInfo>,
): ItemRow[] {
  const now = clock().toISOString();
  return rows.map((row) => {
    const label = `factory_workflow_item_state (workflow "${row.workflowId}", item "${row.itemId}")`;
    if (row.unreadable) {
      throw new WorkflowStoreError(
        "corrupt_record",
        `factory_workflow_item_events: the newest live event of item "${row.itemId}" in workflow "${row.workflowId}" has an outcome or code outside the contract.`,
        { workflowId: row.workflowId, itemId: row.itemId },
      );
    }
    const counters = readCounters(row.countersJson, `${label} counters_json`);
    const wake =
      row.wakeJson === null
        ? null
        : readWake(row.wakeJson, `${label} wake_json`);
    const itemState = assembleItemState({
      workflowId: row.workflowId,
      graphVersion: row.graphVersion,
      itemId: row.itemId,
      parkedAtNode: row.parkedAtNode,
      wake,
      context: {},
      counters,
      leasedBy: row.leasedBy,
      leaseUntil: row.leaseUntil,
      updatedAt: row.updatedAt,
    });
    const info = infos.get(row.workflowId);
    let parked: ItemParking | null = null;
    if (itemState.parkedAtNode !== undefined) {
      if (itemState.wake === undefined) {
        throw new WorkflowStoreError(
          "corrupt_record",
          `${label} is parked at "${itemState.parkedAtNode}" with no wake_json.`,
        );
      }
      const node = info?.nodes.get(itemState.parkedAtNode);
      parked = {
        nodeId: itemState.parkedAtNode,
        nodeName: node?.name ?? null,
        nodeMissingFromGraph: info !== undefined && node === undefined,
        wait: itemState.wake.wait,
        dueAt: itemState.wake.dueAt,
        nextCheckAt: itemState.wake.nextCheckAt ?? null,
        watching: itemState.wake.thread ?? null,
      };
    }
    const lease: ItemLease | null =
      itemState.leasedBy !== undefined && itemState.leaseUntil !== undefined
        ? {
            by: itemState.leasedBy,
            until: itemState.leaseUntil,
            live: itemState.leaseUntil > now,
          }
        : null;
    let lastEvent: ItemLastEvent | null = null;
    if (row.lastAt !== null) {
      const summary = clipText(
        row.lastSummary ?? "",
        READ_LIMITS.eventSummaryChars,
      );
      lastEvent = {
        at: row.lastAt,
        kind: eventKindOf(row.lastKind ?? "", `${label} newest event kind`),
        nodeId: row.lastNode,
        summary: summary.text,
        summaryTruncated: summary.truncated,
      };
    }
    const reasons: NeedsYouReason[] = [];
    if (row.handedOff) reasons.push("handed_off");
    if (row.exhausted) reasons.push("attempts_exhausted");
    if (row.needsCheck) reasons.push("effect_needs_check");
    return {
      workflowId: row.workflowId,
      workflowName: info?.name ?? null,
      itemId: row.itemId,
      inbox: row.inboxId !== null,
      title: row.title,
      source: row.source,
      sourceUrl: httpUrl(row.sourceUrl),
      status: row.status,
      graphVersion: row.graphVersion,
      parked,
      lease,
      attempts: counters.attempts ?? 0,
      needsYouReasons: reasons,
      lastNode:
        row.lastNode === null
          ? null
          : {
              nodeId: row.lastNode,
              nodeName: info?.nodes.get(row.lastNode)?.name ?? null,
            },
      lastEvent,
      lastActivityAt: itemState.updatedAt,
    };
  });
}

async function itemRowsFor(
  db: ReadDatabase,
  clock: () => Date,
  scope: WorkflowScope,
  filters: ItemFilters,
  limit: number,
  after: ItemsAfter | null,
): Promise<{ rows: ItemRow[]; more: boolean }> {
  const fetched = await selectItemRows(db, scope, filters, limit + 1, after);
  const window = takeWindow(fetched, limit);
  const infos = await workflowInfos(
    db,
    scope,
    window.rows.map((row) => row.workflowId),
  );
  return { rows: itemRowsOf(clock, window.rows, infos), more: window.more };
}

export async function listItems(
  getDatabase: () => ReadDatabase,
  clock: () => Date,
  scope: WorkflowScope,
  input: ItemListQuery,
): Promise<ReadPage<ItemRow>> {
  assertScope(scope);
  const limit = pageLimit(input.limit, "Item list");
  const after =
    input.cursor === undefined
      ? null
      : decodeCursor("items", input.cursor, itemsCursorSchema);
  const db = getDatabase();
  if (input.workflowId !== undefined) {
    await requireWorkflowRow(db, scope, input.workflowId);
  }
  const { rows, more } = await itemRowsFor(
    db,
    clock,
    scope,
    input,
    limit,
    after === null
      ? null
      : { at: after.at, workflowId: after.wf, itemId: after.id },
  );
  const last = rows[rows.length - 1];
  return {
    items: rows,
    hasMore: more,
    nextCursor:
      more && last
        ? encodeCursor("items", {
            at: last.lastActivityAt,
            wf: last.workflowId,
            id: last.itemId,
          })
        : null,
  };
}
