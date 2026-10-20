import {
  and,
  desc,
  eq,
  gte,
  lt,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  factoryWorkflowItemEvents,
  factoryWorkflowRuns,
  factoryWorkflows,
  triageItems,
} from "../../db/schema.js";
import type { WorkflowScope } from "../../workflow/adapter.js";
import type { RunTriggerKind } from "../../workflow/contract.js";
import { assertScope } from "../../workflow/store-rules.js";
import { requireWorkflowRow } from "./lookups.js";
import {
  runViewOf,
  startedByOfRow,
  triggerKindOfRow,
  type RunView,
} from "./mappers.js";
import {
  READ_LIMITS,
  clipText,
  scopeOf,
  type ActivityPosition,
  type ReadDatabase,
} from "./shared.js";

const ev = factoryWorkflowItemEvents;
const runs = factoryWorkflowRuns;
const inbox = triageItems;

export interface ActivityRunEntry {
  atMs: number;
  run: RunView;
}

export interface ActivityNeedsYouEntry {
  atMs: number;
  eventId: string;
  runId: string;
  workflowId: string;
  workflowName: string | null;
  at: string;
  /** What started the run the hand-off happened in; null when that run row is gone. */
  triggerKind: RunTriggerKind | null;
  /** `schedule`, or the email of whoever started that run; null when the run row is gone. */
  startedBy: string | null;
  item: {
    id: string;
    inbox: boolean;
    title: string | null;
    source: string | null;
    /** The inbox status now; a person may have resolved it since. */
    status: string | null;
  };
  nodeId: string | null;
  reason: string;
  reasonTruncated: boolean;
}

export interface ActivityQuery {
  workflowId?: string;
  since?: string;
  until?: string;
  after?: ActivityPosition;
  /** Only runs the schedule started, or only runs a person started (a manual, dry, or test run). */
  starter?: "schedule" | "person";
  /** The most entries to return. */
  limit: number;
}

// Activity sources share one rule for "after the cursor".

function startedBy(starter: ActivityQuery["starter"]): SQL | undefined {
  if (starter === undefined) return undefined;
  return starter === "schedule"
    ? eq(runs.triggerKind, "schedule")
    : ne(runs.triggerKind, "schedule");
}

function runsAfter(position: ActivityPosition | undefined): SQL | undefined {
  if (position === undefined) return undefined;
  const at = new Date(position.atMs).toISOString();
  const seen = position.seen
    .filter((key) => key.startsWith("run:"))
    .map((key) => key.slice("run:".length));
  return or(
    lt(runs.startedAt, at),
    and(
      eq(runs.startedAt, at),
      seen.length === 0 ? undefined : notInArray(runs.id, seen),
    ),
  );
}

function eventsAfter(position: ActivityPosition | undefined): SQL | undefined {
  if (position === undefined) return undefined;
  const at = new Date(position.atMs).toISOString();
  const seen = position.seen
    .filter((key) => key.startsWith("needs_you:"))
    .map((key) => key.slice("needs_you:".length));
  return or(
    lt(ev.occurredAt, at),
    and(
      eq(ev.occurredAt, at),
      seen.length === 0 ? undefined : notInArray(ev.id, seen),
    ),
  );
}

export async function activityRuns(
  getDatabase: () => ReadDatabase,
  scope: WorkflowScope,
  query: ActivityQuery,
): Promise<ActivityRunEntry[]> {
  assertScope(scope);
  const db = getDatabase();
  if (query.workflowId !== undefined) {
    await requireWorkflowRow(db, scope, query.workflowId);
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
        query.workflowId === undefined
          ? undefined
          : eq(runs.workflowId, query.workflowId),
        query.since === undefined
          ? undefined
          : gte(runs.startedAt, new Date(query.since).toISOString()),
        query.until === undefined
          ? undefined
          : lt(runs.startedAt, new Date(query.until).toISOString()),
        startedBy(query.starter),
        runsAfter(query.after),
      ),
    )
    .orderBy(desc(runs.startedAt), desc(runs.id))
    .limit(query.limit);
  return fetched.map((row) => ({
    atMs: Date.parse(row.run.startedAt),
    run: runViewOf(row.run, row.workflowName),
  }));
}

export async function activityNeedsYou(
  getDatabase: () => ReadDatabase,
  scope: WorkflowScope,
  query: ActivityQuery,
): Promise<ActivityNeedsYouEntry[]> {
  assertScope(scope);
  const db = getDatabase();
  if (query.workflowId !== undefined) {
    await requireWorkflowRow(db, scope, query.workflowId);
  }
  const fetched = await db
    .select({
      event: ev,
      workflowName: factoryWorkflows.name,
      run: {
        id: runs.id,
        triggerKind: runs.triggerKind,
        startedBy: runs.startedBy,
      },
      inboxId: inbox.id,
      title: inbox.title,
      source: inbox.source,
      status: inbox.status,
    })
    .from(ev)
    .leftJoin(
      factoryWorkflows,
      and(
        eq(factoryWorkflows.id, ev.workflowId),
        scopeOf(factoryWorkflows, scope),
      ),
    )
    .leftJoin(runs, and(eq(runs.id, ev.runId), scopeOf(runs, scope)))
    .leftJoin(
      inbox,
      and(
        eq(inbox.id, ev.itemId),
        eq(inbox.orgId, ev.orgId),
        eq(inbox.factoryId, ev.factoryId),
      ),
    )
    .where(
      and(
        scopeOf(ev, scope),
        // Written out, not bound, so the planner can match the partial index on these two columns.
        sql`${ev.kind} = 'ended' AND ${ev.outcome} = 'needsManual'`,
        eq(ev.mode, "live"),
        query.workflowId === undefined
          ? undefined
          : eq(ev.workflowId, query.workflowId),
        query.since === undefined
          ? undefined
          : gte(ev.occurredAt, new Date(query.since).toISOString()),
        query.until === undefined
          ? undefined
          : lt(ev.occurredAt, new Date(query.until).toISOString()),
        startedBy(query.starter),
        eventsAfter(query.after),
      ),
    )
    .orderBy(desc(ev.occurredAt), desc(ev.id))
    .limit(query.limit);
  return fetched.map((row) => {
    const reason = clipText(row.event.summary, READ_LIMITS.shortSummaryChars);
    return {
      atMs: Date.parse(row.event.occurredAt),
      eventId: row.event.id,
      runId: row.event.runId,
      workflowId: row.event.workflowId,
      workflowName: row.workflowName,
      at: row.event.occurredAt,
      triggerKind: row.run === null ? null : triggerKindOfRow(row.run),
      startedBy: row.run === null ? null : startedByOfRow(row.run),
      item: {
        id: row.event.itemId,
        inbox: row.inboxId !== null,
        title: row.title,
        source: row.source,
        status: row.status,
      },
      nodeId: row.event.nodeId,
      reason: reason.text,
      reasonTruncated: reason.truncated,
    };
  });
}
