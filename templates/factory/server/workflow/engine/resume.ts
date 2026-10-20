import { WORKFLOW_STORE_LIMITS } from "../adapter.js";
import type { ItemState, WorkflowNode } from "../contract.js";
import { END_STATUS, MAX_RESUMED_ITEMS } from "./constants.js";
import { coverageGap } from "./context-plan.js";
import { heldByOf } from "./holds.js";
import type { FlowItem, TickContext } from "./types.js";
import { decodeContext } from "./wait-park.js";
import type { WalkSeed } from "./walker.js";

/** Parked by a stopped run that did not get to it, not by a failure or a Wait. */
const isSetAside = (state: ItemState): boolean =>
  state.wake?.wait === "retry" && state.context.continued === true;

export interface ResumePlan {
  /**
   * One `wake` seed per Wait that has items to look at, and one `input` seed
   * per node that has items to try again.
   */
  seeds: WalkSeed[];
  /** How many due parked items it looked at, across every page. */
  listed: number;
  /**
   * Every set-aside item that is due was taken. When it is not, a node that
   * needs its whole batch must wait for the next tick, or it would run over
   * part of it.
   */
  complete: boolean;
}

/**
 * The first thing a tick does. Takes the parked items whose deadline or check
 * time has come, and sorts them: an item whose Wait is gone, or is now a
 * different kind of wait, or that did not keep something the graph now reads
 * after its Wait, ends for a person with `graph_changed_while_waiting`; every
 * other item goes to its Wait to be looked at. Nothing here reads a thread or
 * runs a condition, so a failure to look is recorded by the Wait's own step.
 *
 * A tick looks at one page of due items, so a Wait never costs more than a
 * page of reads. Items a stopped run set aside are different: they are a batch
 * the run has to get back whole, or a Combine would run over part of it. So it
 * goes on asking for pages, taking only those, until a page has none or the
 * tick has `MAX_RESUMED_ITEMS`. What it leased is no longer listed.
 */
export async function prepareResume(
  ctx: TickContext,
  due: readonly ItemState[],
): Promise<ResumePlan> {
  const won: ItemState[] = [];
  let listed = 0;
  let firstPage = true;
  let complete = true;
  for (
    let page = due;
    page.length > 0;
    page = await ctx.host.store.listDueParked(ctx.scope, {
      workflowId: ctx.workflowId,
      now: ctx.dueNow().toISOString(),
      limit: WORKFLOW_STORE_LIMITS.dueParkedMax,
    })
  ) {
    const wanted = firstPage ? page : page.filter(isSetAside);
    firstPage = false;
    if (wanted.length === 0) {
      // A page of other due items hides whatever comes after it.
      complete = page.length < WORKFLOW_STORE_LIMITS.dueParkedMax;
      break;
    }
    const leased = await ctx.runtime.leaseParked(wanted);
    // A list, a group or an answer built from rows holds those rows while it waits.
    for (const state of leased) await ctx.runtime.adoptHolds(state);
    listed += wanted.length;
    won.push(...leased);
    // Listed as free a moment ago and taken since: another tick is on this workflow.
    if (wanted.length > leased.length) {
      ctx.invariantBroken({
        invariant: "tick_overlap",
        severity: "warn",
        details: {
          reason: "parked_items_leased_elsewhere",
          listed: wanted.length,
          won: leased.length,
        },
      });
    }
    if (page.length < WORKFLOW_STORE_LIMITS.dueParkedMax) break;
    if (listed >= MAX_RESUMED_ITEMS) {
      complete = false;
      break;
    }
  }
  const byNode = new Map<string, ItemState[]>();
  const retries = new Map<string, FlowItem[]>();
  for (const state of won) {
    // Another tick finished it between the list and the lease.
    if (state.parkedAtNode === undefined || state.wake === undefined) continue;
    // A row held for an item that was built from it: nothing to look at, unless the hold has run out.
    if (heldByOf(state) !== undefined) {
      await ctx.runtime.reconsiderHold(state);
      continue;
    }
    const node = ctx.graph.nodes.find(
      (candidate) => candidate.id === state.parkedAtNode,
    );
    if (state.wake.wait === "retry") {
      const retried = readRetry(ctx, state, node);
      if (retried.ok) {
        retries.set(state.parkedAtNode, [
          ...(retries.get(state.parkedAtNode) ?? []),
          retried.item,
        ]);
        // An item a stopped run set aside has not failed: it goes on where that run left it.
        const continued = state.context.continued === true;
        if (continued) ctx.runtime.continued += 1;
        else ctx.runtime.retried += 1;
        ctx.runtime.record({
          itemId: state.itemId,
          nodeId: state.parkedAtNode,
          kind: "woke",
          summary: continued
            ? `back at "${node?.name ?? state.parkedAtNode}", where the last run stopped`
            : `back at "${node?.name ?? state.parkedAtNode}" for a retry: attempt ${(state.counters.attempts ?? 0) + 1}`,
        });
        continue;
      }
      await endForChangedGraph(
        ctx,
        state,
        state.parkedAtNode,
        retried.detail,
        retried.code,
      );
      continue;
    }
    if (node?.kind === "wait" && node.settings.wait === state.wake.wait) {
      const gap = missingSinceParked(ctx, state, node.id);
      if (gap === null) {
        byNode.set(node.id, [...(byNode.get(node.id) ?? []), state]);
        continue;
      }
      reportCoverageGap(ctx, state, node.id, "wait");
      await endForChangedGraph(
        ctx,
        state,
        state.parkedAtNode,
        `"${gap}" is read after "${node.name}" now, and the item did not keep it when it began waiting`,
      );
      continue;
    }
    await endForChangedGraph(
      ctx,
      state,
      state.parkedAtNode,
      node === undefined
        ? `"${state.parkedAtNode}" is no longer in the workflow`
        : `"${state.parkedAtNode}" is now a ${node.kind}${node.kind === "wait" ? " that waits for something else" : ""}`,
    );
  }
  return {
    listed,
    complete,
    seeds: [
      ...[...byNode].map(([nodeId, parked]) => ({
        kind: "wake" as const,
        nodeId,
        parked,
      })),
      ...[...retries].map(([nodeId, items]) => ({
        kind: "input" as const,
        nodeId,
        items,
      })),
    ],
  };
}

type RetryRead =
  | { ok: true; item: FlowItem }
  | { ok: false; detail: string; code?: "engine_error" };

/**
 * The item an item parked for a retry goes back as, or why it cannot: the node
 * it failed at is gone or is a different kind of node now, the graph now reads
 * something after it that the item did not keep, or its context is unreadable.
 */
function readRetry(
  ctx: TickContext,
  state: ItemState,
  node: WorkflowNode | undefined,
): RetryRead {
  const nodeId = state.parkedAtNode ?? "";
  if (node === undefined) {
    return { ok: false, detail: `"${nodeId}" is no longer in the workflow` };
  }
  const decoded = decodeContext(state.itemId, state.context);
  if (!decoded.ok) {
    ctx.invariantBroken({
      invariant: "wake_without_context",
      severity: "error",
      nodeId,
      details: { itemId: state.itemId, problem: decoded.message },
    });
    return { ok: false, detail: decoded.message, code: "engine_error" };
  }
  const was = state.context.retryKind;
  if (node.kind === "trigger" || node.kind === "source") {
    return {
      ok: false,
      detail: `"${node.name}" is now a ${node.kind}, which takes no items to retry`,
    };
  }
  if (was !== undefined && was !== node.kind) {
    return {
      ok: false,
      detail: `"${node.name}" was a ${String(was)} when this failed and is now a ${node.kind}`,
    };
  }
  const gap =
    decoded.kept === undefined
      ? null
      : coverageGap(ctx.graph, node.id, decoded.kept, "retry");
  if (gap !== null) {
    reportCoverageGap(ctx, state, nodeId, "retry");
    return {
      ok: false,
      detail: `"${gap}" is read from "${node.name}" on now, and the item did not keep it when it was set aside for a retry`,
    };
  }
  return { ok: true, item: decoded.item };
}

/** The item was parked with less than the graph now reads after it. */
function reportCoverageGap(
  ctx: TickContext,
  state: ItemState,
  nodeId: string,
  parkedFor: "wait" | "retry",
): void {
  ctx.invariantBroken({
    invariant: "wake_without_context",
    severity: "warn",
    nodeId,
    details: { itemId: state.itemId, problem: "pruned_past_use", parkedFor },
  });
}

/**
 * A path the graph reads after this Wait that the item did not keep, or null.
 * A context that cannot be read is left for the Wait to fail with its own
 * message, and one with no list of kept paths predates pruning and holds
 * everything.
 */
function missingSinceParked(
  ctx: TickContext,
  state: ItemState,
  waitId: string,
): string | null {
  const decoded = decodeContext(state.itemId, state.context);
  if (!decoded.ok || decoded.kept === undefined) return null;
  return coverageGap(ctx.graph, waitId, decoded.kept);
}

async function endForChangedGraph(
  ctx: TickContext,
  state: ItemState,
  nodeId: string,
  detail: string,
  code:
    | "graph_changed_while_waiting"
    | "engine_error" = "graph_changed_while_waiting",
): Promise<void> {
  const decoded = decodeContext(state.itemId, state.context);
  // Without a readable context the item cannot be told apart from a plain one,
  // so it is ended without moving any inbox status.
  const item: FlowItem = decoded.ok
    ? decoded.item
    : { id: state.itemId, data: {}, nodes: {}, inbox: false };
  ctx.runtime.record({
    itemId: item.id,
    nodeId,
    kind: "error",
    code,
    summary: `${code}: ${detail}`,
  });
  const ended = await ctx.runtime.end(item, {
    nodeId,
    outcome: "needsManual",
    status: END_STATUS.needsManual,
    reason:
      code === "engine_error"
        ? `This could not be picked up again: ${detail}.`
        : `The workflow changed while this was waiting: ${detail}.`,
  });
  if (ended.ok) {
    ctx.runtime.graphChanged += 1;
    return;
  }
  // The status could not be written, so the item stays parked and is tried again next tick.
  ctx.runtime.record({
    itemId: item.id,
    nodeId,
    kind: "error",
    code: ended.failure.code,
    summary: `${ended.failure.code}: ${ended.failure.message}`,
  });
}
