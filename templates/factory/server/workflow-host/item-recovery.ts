import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import {
  factoryWorkflowItemEvents,
  factoryWorkflowItemState,
  triageItems,
} from "../db/schema.js";
import { orgFactoryItemFilter } from "../lib/factory-scope.js";
import { mergeTriageMetadata } from "../triage/metadata.js";
import type { WorkflowScope } from "../workflow/adapter.js";
import { ATTEMPTS_COUNTER } from "../workflow/engine/constants.js";
import { prepareEvent, readCounters } from "../workflow/store-rules.js";
import { ITEM_METADATA, queueStatusFor, type ItemsDatabase } from "./items.js";

/** Statuses a person can send back to the workflow's queue: handed off, failed, or dismissed by mistake. */
const REQUEUEABLE_STATUSES: ReadonlySet<string> = new Set([
  "needs_manual",
  "failed",
  "dismissed",
]);

/** Statuses a person can close for good: the ones waiting on a person. */
const DISMISSABLE_STATUSES: ReadonlySet<string> = new Set([
  "needs_manual",
  "failed",
]);

type RecoveryFailure =
  | { ok: false; reason: "item_not_found"; message: string }
  | {
      ok: false;
      reason: "status_not_allowed";
      message: string;
      currentStatus: string;
    }
  | { ok: false; reason: "item_unreadable"; message: string };

export type RecoveryResult =
  | {
      ok: true;
      itemId: string;
      status: string;
      previousStatus: string;
      /** False when the item was already where the move would put it. */
      changed: boolean;
      /** The workflows whose trail of this item got an event. */
      workflowIds: string[];
    }
  | RecoveryFailure;

interface RecoveryRequest {
  scope: WorkflowScope;
  itemId: string;
  /** The person (or the agent acting for them) who asked, as the trail names them. */
  actor: string;
  now?: () => string;
}

type ItemRow = typeof triageItems.$inferSelect;
type Transaction = Parameters<Parameters<ItemsDatabase["transaction"]>[0]>[0];

interface Move {
  /** Statuses the move may start from; the target status is always allowed to repeat. */
  from: ReadonlySet<string>;
  targetStatus(row: ItemRow): string;
  outcome: "released" | "dismissed";
  /** Whether attempts a spent run left on the item's state are cleared with the move. */
  clearAttempts: boolean;
  summary(actor: string): string;
  /** What the row's metadata drops or sets so the next poll treats it as the move says. */
  metadata(row: ItemRow, at: string, reason: string): Record<string, unknown>;
}

function newEventId(): string {
  return [
    "wfe",
    Date.now().toString(36).padStart(9, "0"),
    "recovery",
    randomUUID().slice(0, 8),
  ].join("_");
}

const requeue: Move = {
  from: REQUEUEABLE_STATUSES,
  targetStatus: (row) => queueStatusFor(row.source),
  outcome: "released",
  clearAttempts: true,
  summary: (actor) => `Requeued by ${actor}`,
  metadata: (row) => ({
    // The marker of the end that handed the item off no longer holds.
    [ITEM_METADATA.workflowEnd]: undefined,
    ...(row.source === "slack" ? { slackReactionName: undefined } : {}),
    ...(row.source === "github" ? { prBabysitState: undefined } : {}),
  }),
};

const dismiss: Move = {
  from: DISMISSABLE_STATUSES,
  targetStatus: () => "dismissed",
  outcome: "dismissed",
  clearAttempts: false,
  summary: (actor) => `Dismissed by ${actor}`,
  metadata: (row, at, reason) => ({
    [ITEM_METADATA.workflowEnd]: {
      status: "dismissed",
      outcome: "dismissed",
      reason,
      at,
    },
    // A parked pull request is reselected by this key whatever its status.
    ...(row.source === "github" ? { prBabysitState: undefined } : {}),
  }),
};

function notAllowed(
  row: ItemRow,
  move: Move,
  verb: string,
): RecoveryFailure | null {
  if (row.status === move.targetStatus(row) || move.from.has(row.status)) {
    return null;
  }
  return {
    ok: false,
    reason: "status_not_allowed",
    currentStatus: row.status,
    message: `Item "${row.id}" is ${row.status}, so it cannot be ${verb}.`,
  };
}

/**
 * Moves one item the way a person asked, in one transaction: the inbox status
 * and its metadata, the attempts its workflow state spent, and an `ended` event
 * on the trail of every workflow that has one for the item. The event is the latest
 * signal the Items list reads, so "needs a person" clears with the move.
 * Receipt counters are left alone: a write that already went out is not
 * repeated, and one that may have gone out is held for a person again.
 */
async function moveItem(
  db: ItemsDatabase,
  request: RecoveryRequest,
  move: Move,
  verb: string,
): Promise<RecoveryResult> {
  const { scope, itemId, actor } = request;
  const now = request.now ?? (() => new Date().toISOString());
  const state = factoryWorkflowItemState;
  const events = factoryWorkflowItemEvents;

  return db.transaction(async (tx: Transaction) => {
    const row = (
      await tx
        .select()
        .from(triageItems)
        .where(
          and(
            eq(triageItems.id, itemId),
            orgFactoryItemFilter(scope.orgId, scope.factoryId),
          ),
        )
        .limit(1)
        .for("update")
    )[0];
    if (!row) {
      return {
        ok: false,
        reason: "item_not_found",
        message: `Item "${itemId}" is not in this factory's inbox.`,
      } satisfies RecoveryFailure;
    }
    const refused = notAllowed(row, move, verb);
    if (refused) return refused;

    const target = move.targetStatus(row);
    const states = await tx
      .select({
        workflowId: state.workflowId,
        countersJson: state.countersJson,
      })
      .from(state)
      .where(
        and(
          eq(state.itemId, itemId),
          eq(state.orgId, scope.orgId),
          eq(state.factoryId, scope.factoryId),
        ),
      );
    const spent = move.clearAttempts
      ? states.filter(
          (held) =>
            (readCounters(held.countersJson, `Item "${itemId}" counters`)[
              ATTEMPTS_COUNTER
            ] ?? 0) > 0,
        )
      : [];
    if (row.status === target && spent.length === 0) {
      return {
        ok: true,
        itemId,
        status: row.status,
        previousStatus: row.status,
        changed: false,
        workflowIds: [],
      };
    }

    const at = now();
    const reason = move.summary(actor);
    let metadataJson: string;
    try {
      metadataJson = mergeTriageMetadata(
        row.metadataJson,
        move.metadata(row, at, reason),
      );
    } catch (error) {
      return {
        ok: false,
        reason: "item_unreadable",
        message: `The stored metadata of item "${itemId}" cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      } satisfies RecoveryFailure;
    }
    await tx
      .update(triageItems)
      .set({ status: target, metadataJson, updatedAt: at })
      .where(
        and(
          eq(triageItems.id, itemId),
          orgFactoryItemFilter(scope.orgId, scope.factoryId),
        ),
      );

    if (move.clearAttempts) {
      for (const held of states) {
        await tx
          .update(state)
          .set({
            countersJson: sql`(${state.countersJson}::jsonb - ${ATTEMPTS_COUNTER}::text)::text`,
            updatedAt: at,
          })
          .where(
            and(
              eq(state.workflowId, held.workflowId),
              eq(state.itemId, itemId),
              eq(state.orgId, scope.orgId),
              eq(state.factoryId, scope.factoryId),
            ),
          );
      }
    }

    // An item ended through a combined item has a trail and no state row, so
    // the trails, not the state rows, say which workflows to write to; each
    // event joins the run that wrote the trail's last one.
    const trails = await tx
      .selectDistinctOn([events.workflowId], {
        workflowId: events.workflowId,
        runId: events.runId,
      })
      .from(events)
      .where(
        and(
          eq(events.itemId, itemId),
          eq(events.orgId, scope.orgId),
          eq(events.factoryId, scope.factoryId),
        ),
      )
      .orderBy(events.workflowId, desc(events.occurredAt), desc(events.id));
    const workflowIds: string[] = [];
    for (const trail of trails) {
      const event = prepareEvent({
        workflowId: trail.workflowId,
        runId: trail.runId,
        itemId,
        kind: "ended",
        at,
        mode: "live",
        summary: `${move.outcome}: ${reason} (status ${target})`,
        outcome: move.outcome,
      });
      await tx.insert(events).values({
        id: newEventId(),
        workflowId: event.workflowId,
        runId: event.runId,
        itemId: event.itemId,
        nodeId: null,
        kind: event.kind,
        occurredAt: event.at,
        mode: event.mode,
        summary: event.summary,
        port: null,
        receiptKey: null,
        threadId: null,
        outcome: event.outcome ?? null,
        code: null,
        orgId: scope.orgId,
        factoryId: scope.factoryId,
      });
      workflowIds.push(trail.workflowId);
    }
    return {
      ok: true,
      itemId,
      status: target,
      previousStatus: row.status,
      changed: true,
      workflowIds,
    } satisfies RecoveryResult;
  });
}

/**
 * Sends an item a person was handed back to its workflow: its inbox status
 * returns to the queue the next poll or status source reads, and its spent
 * attempts clear. A repeat finds it already queued and changes nothing.
 */
export function requeueItem(
  db: ItemsDatabase,
  request: RecoveryRequest,
): Promise<RecoveryResult> {
  return moveItem(db, request, requeue, "requeued");
}

/** Closes an item waiting on a person. A repeat finds it dismissed and changes nothing. */
export function dismissItem(
  db: ItemsDatabase,
  request: RecoveryRequest,
): Promise<RecoveryResult> {
  return moveItem(db, request, dismiss, "dismissed");
}
