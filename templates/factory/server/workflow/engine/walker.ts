import {
  WorkflowError,
  loopCounterKey,
  type ItemState,
  type StepRecord,
  type WorkflowErrorCode,
  type WorkflowNode,
} from "../contract.js";
import { assertWithinStepCap } from "../items.js";
import { LIMIT_REACHED_PORT, portsWithLimit } from "../ports.js";
import { capView, emittedItems } from "./cap.js";
import { ROUNDS_COUNTER } from "./constants.js";
import type { GraphPlan } from "./graph-order.js";
import { setItemAside } from "./item-failure.js";
import { executorFor } from "./nodes/registry.js";
import { StepBuilder } from "./step-builder.js";
import { mergeStepRecords } from "./step-merge.js";
import type {
  FlowItem,
  NodeOutcome,
  PortItems,
  StopReason,
  TickContext,
} from "./types.js";

/**
 * Where a walk begins. `input` hands items to a node as if upstream had just
 * sent them; `output` sends items out of a node's port without running it;
 * `wake` runs a Wait over the parked items whose time has come, before any
 * other node, so what it releases flows on with everything else this tick.
 */
export type WalkSeed =
  | { kind: "input"; nodeId: string; items: readonly FlowItem[] }
  | { kind: "output"; nodeId: string; itemsByPort: PortItems }
  | { kind: "wake"; nodeId: string; parked: readonly ItemState[] };

export interface WalkResult {
  status: "completed" | "paused" | "failed";
  error?: { code: WorkflowErrorCode; message: string };
  steps: StepRecord[];
  /**
   * What the run took is accounted for: it completed, or it paused with every
   * item still in flight set aside for the next tick and every source that was
   * due having run, and none of them was too big to be set aside. Only then
   * may the cursors and the window move on.
   */
  settled: boolean;
}

// Each pass of a loop needs a Wait, and a Wait parks its items, so a walk goes
// back at most once per loop per item batch; this only catches a bug.
const MAX_REWINDS = 200;

/** A node that has to see its whole batch at once, so it cannot run while some of that batch is still held back upstream. */
function needsWholeBatch(node: WorkflowNode): boolean {
  return (
    node.kind === "combine" ||
    (node.kind === "ai" && node.settings.mode === "wholeList")
  );
}

/**
 * Runs every node reachable from the seeds, upstream first, over whatever
 * reached it, even an empty list. A node that fails ends the walk, and the
 * nodes after it are recorded as skipped with the reason, so a run that did
 * not finish never reads as one that did. What nodes ask to persist
 * (`commit`) is written only when the walk is settled.
 * `downstream: false` runs only the seeded nodes (a test of one node).
 *
 * A node that stops early (the model-call cap) sets aside the items it did not
 * reach, and what it did finish goes on through the rest of the graph; the run
 * ends `paused`. A Combine or a whole-list AI node waits for the rest of its
 * batch instead of running over part of it: what reaches it is set aside too.
 * When the soft deadline or the hard abort comes, nothing more can run, so
 * every item still waiting for a node is set aside and the rest are skipped.
 * Either way the next tick picks the items up where this one stopped, and
 * nothing they went through runs again.
 *
 * An item that leaves a node by a loop back-edge goes back to the node the
 * edge returns to, and the walk runs on from there, so a node on the loop can
 * run again in the same tick (its step row then totals both). An item that has
 * used all its passes leaves by the node's `limitReached` port instead.
 */
export async function walkGraph(
  ctx: TickContext,
  plan: GraphPlan,
  seeds: readonly WalkSeed[],
  options: {
    downstream: boolean;
    /** The resume pass left set-aside items behind, so no node that needs a whole batch can have one. */
    holdBarriers?: boolean;
  },
): Promise<WalkResult> {
  const inboxes = new Map<string, FlowItem[]>();
  /** Nodes that were sent something (even nothing) and have not run since. */
  const owed = new Set<string>();
  const wakes = new Map<string, readonly ItemState[]>();
  const stepByNode = new Map<string, StepRecord>();
  const commits: (() => Promise<void>)[] = [];
  const positionOf = new Map(plan.order.map((id, index) => [id, index]));
  /** Why the walk stopped early, in the order it happened. */
  const stops: StopReason[] = [];
  /** Nodes that must not run this tick because part of their batch is held back upstream. */
  const heldBack = new Set<string>(
    options.holdBarriers
      ? [...plan.nodes.values()].filter(needsWholeBatch).map((node) => node.id)
      : [],
  );
  const notAllResumed: StopReason = {
    code: "budget_paused",
    message:
      "More items were set aside than one tick picks up again, so what needs a whole batch waits for the next tick.",
  };
  /** The position of the node being run; a back-edge moves it back. */
  let pointer = -1;
  let rewinds = 0;

  const collect = (): StepRecord[] =>
    plan.order.flatMap((id) => {
      const step = stepByNode.get(id);
      return step ? [step] : [];
    });

  const put = async (record: StepRecord): Promise<void> => {
    const earlier = stepByNode.get(record.nodeId);
    const kept = earlier ? mergeStepRecords(earlier, record) : record;
    await ctx.host.store.putStep(ctx.scope, kept);
    stepByNode.set(record.nodeId, kept);
  };

  const deliver = (fromNode: string, itemsByPort: PortItems): void => {
    for (const edge of plan.outgoing.get(fromNode) ?? []) {
      owed.add(edge.to.node);
      const items = itemsByPort[edge.from.port] ?? [];
      if (items.length > 0) {
        inboxes.set(edge.to.node, [
          ...(inboxes.get(edge.to.node) ?? []),
          ...items,
        ]);
      }
    }
  };

  /**
   * Sends the items on a back-edge's port back to where it returns, each at
   * most `maxIterations` times. The rest are added to the node's
   * `limitReached` port, which the caller delivers like any other.
   */
  const routeBack = async (
    node: WorkflowNode,
    itemsByPort: PortItems,
  ): Promise<PortItems> => {
    const limited: FlowItem[] = [];
    for (const edge of plan.backEdges.get(node.id) ?? []) {
      const max = edge.back?.maxIterations ?? 0;
      const head = plan.nodes.get(edge.to.node);
      const sent: FlowItem[] = [];
      for (const item of itemsByPort[edge.from.port] ?? []) {
        const counters = await ctx.runtime.countersOf(item.id);
        const used = counters[loopCounterKey(edge.id)] ?? 0;
        const rounds = counters[ROUNDS_COUNTER] ?? 0;
        // A pass round a loop adds a round too, so loop passes never outnumber rounds.
        if (used > rounds) {
          ctx.invariantBroken({
            invariant: "loop_counter_mismatch",
            severity: "warn",
            nodeId: node.id,
            details: { itemId: item.id, edgeId: edge.id, passes: used, rounds },
          });
        }
        if (used >= max) {
          limited.push(item);
          ctx.runtime.loopLimited += 1;
          ctx.runtime.record({
            itemId: item.id,
            nodeId: node.id,
            kind: "decision",
            port: LIMIT_REACHED_PORT,
            summary: `loop limit reached: already sent back ${used} of ${max} times`,
          });
          continue;
        }
        const pass = await ctx.runtime.sendBack(item.id, edge.id);
        ctx.runtime.sentBack += 1;
        ctx.runtime.record({
          itemId: item.id,
          nodeId: node.id,
          kind: "decision",
          port: edge.from.port,
          summary: `sent back to "${head?.name ?? edge.to.node}": pass ${pass} of ${max}`,
        });
        sent.push(item);
      }
      if (sent.length === 0) continue;
      owed.add(edge.to.node);
      inboxes.set(edge.to.node, [
        ...(inboxes.get(edge.to.node) ?? []),
        ...sent,
      ]);
      pointer = Math.min(pointer, (positionOf.get(edge.to.node) ?? 0) - 1);
      rewinds += 1;
      if (rewinds > MAX_REWINDS) {
        throw new Error(
          `The walk went back around a loop ${rewinds} times in one tick; a loop passes through a Wait, so this is a bug.`,
        );
      }
    }
    return limited.length === 0
      ? itemsByPort
      : {
          ...itemsByPort,
          [LIMIT_REACHED_PORT]: [
            ...(itemsByPort[LIMIT_REACHED_PORT] ?? []),
            ...limited,
          ],
        };
  };

  for (const seed of seeds) {
    if (seed.kind === "input") {
      owed.add(seed.nodeId);
      inboxes.set(seed.nodeId, [
        ...(inboxes.get(seed.nodeId) ?? []),
        ...seed.items,
      ]);
    } else if (seed.kind === "wake") {
      wakes.set(seed.nodeId, seed.parked);
    } else {
      const node = plan.nodes.get(seed.nodeId);
      if (!node) throw new Error(`Node "${seed.nodeId}" is not in the graph.`);
      deliver(
        seed.nodeId,
        options.downstream
          ? await routeBack(node, seed.itemsByPort)
          : seed.itemsByPort,
      );
    }
  }

  /**
   * Records every node that was due to run and did not, and says which. A
   * node is due when something was sent to it, and so is everything after it.
   */
  const skipRest = async (
    from: number,
    why: { reason: string; error?: StopReason },
    leftBy?: string,
  ): Promise<string[]> => {
    const due = new Set([...owed, ...wakes.keys()]);
    const queue = [...due, ...(leftBy === undefined ? [] : [leftBy])];
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      for (const edge of plan.outgoing.get(next) ?? []) {
        if (!due.has(edge.to.node)) {
          due.add(edge.to.node);
          queue.push(edge.to.node);
        }
      }
    }
    const skipped: string[] = [];
    for (const nodeId of plan.order.slice(from)) {
      if (!due.has(nodeId) || nodeId === leftBy) continue;
      if (
        !options.downstream &&
        !seeds.some((seed) => seed.nodeId === nodeId)
      ) {
        continue;
      }
      const at = ctx.now().toISOString();
      await put({
        runId: ctx.run.id,
        nodeId,
        status: "skipped",
        mode: ctx.mode,
        startedAt: at,
        finishedAt: at,
        ports: {},
        fields: { reason: why.reason },
        ...(why.error
          ? { error: { code: why.error.code, message: why.error.message } }
          : {}),
      });
      skipped.push(nodeId);
    }
    return skipped;
  };

  /** Sets aside every item still waiting for a node that will not run this tick. */
  const setAsideInboxes = async (stop: StopReason): Promise<void> => {
    for (const nodeId of plan.order) {
      const items = inboxes.get(nodeId);
      const node = plan.nodes.get(nodeId);
      if (!items || items.length === 0 || !node) continue;
      inboxes.delete(nodeId);
      for (const item of items) await setItemAside({ ctx, node }, item, stop);
    }
    await ctx.runtime.flushEvents();
  };

  const paused = (settled: boolean): WalkResult => ({
    status: "paused",
    error: { code: "budget_paused", message: stops[0].message },
    steps: collect(),
    settled,
  });

  /** Items too big to be set aside were left to be built again: the run has not accounted for what it took. */
  const leftToRebuild = (): string | undefined =>
    ctx.runtime.heldBack > 0 ? ctx.runtime.heldBackMessage : undefined;

  /**
   * The walk accounted for everything it took: what was parked for items it
   * folded together or took apart is let go, and what the nodes asked to
   * persist is written.
   */
  const settle = async (): Promise<void> => {
    await ctx.runtime.settleConsumed();
    await ctx.runtime.flushEvents();
    for (const commit of commits) await commit();
  };

  /** A run that could not set everything aside says so, and leaves the window and the cursors where they were. */
  const unsettled = (note: string): WalkResult => {
    const more = ctx.runtime.heldBack - 1;
    return {
      status: "paused",
      error: {
        code: "context_truncated",
        message: `${note}${more > 0 ? ` ${more} more item${more === 1 ? " was" : "s were"} left to be built again too.` : ""}${stops.length > 0 ? ` The run also stopped early: ${stops[0].message}` : ""}`,
      },
      steps: collect(),
      settled: false,
    };
  };

  /**
   * Nothing more can run: the soft deadline came or the run was aborted. What
   * is waiting is set aside and the nodes that would have run are skipped.
   * The run took everything its sources offered only if every source that was
   * due had run; otherwise the window and the cursors stay where they were.
   */
  const stopNow = async (
    from: number,
    stop: StopReason,
  ): Promise<WalkResult> => {
    stops.push(stop);
    await setAsideInboxes(stop);
    const skipped = await skipRest(from, {
      reason: "the run paused",
      error: stop,
    });
    const sourcesRan = !skipped.some((nodeId) => {
      const kind = plan.nodes.get(nodeId)?.kind;
      return kind === "trigger" || kind === "source";
    });
    const note = leftToRebuild();
    if (note !== undefined) return unsettled(note);
    if (sourcesRan) await settle();
    return paused(sourcesRan);
  };

  /** Marks the nodes after `fromNode` that need a whole batch: this tick cannot give them one. */
  const holdBackBelow = (fromNode: string): void => {
    const seen = new Set([fromNode]);
    const queue = [fromNode];
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const edges = [
        ...(plan.outgoing.get(next) ?? []),
        ...(plan.backEdges.get(next) ?? []),
      ];
      for (const edge of edges) {
        if (seen.has(edge.to.node)) continue;
        seen.add(edge.to.node);
        queue.push(edge.to.node);
        const node = plan.nodes.get(edge.to.node);
        if (node && needsWholeBatch(node)) heldBack.add(node.id);
      }
    }
  };

  /** The items a stopping node did not reach. */
  const unfinishedOf = (
    node: WorkflowNode,
    outcome: NodeOutcome,
    input: readonly FlowItem[],
    step: StepBuilder,
  ): readonly FlowItem[] => {
    if (outcome.unfinished) return outcome.unfinished;
    const deferred = step.fieldValue("deferred");
    if (
      typeof deferred !== "number" ||
      !Number.isInteger(deferred) ||
      deferred < 0 ||
      deferred > input.length
    ) {
      throw new Error(
        `"${node.name}" stopped without saying which of its ${input.length} items it left, so they cannot be set aside.`,
      );
    }
    return input.slice(input.length - deferred);
  };

  /**
   * One execution of one node. Returns a result when the walk must end here:
   * the node failed as a whole.
   */
  const runNode = async (
    node: WorkflowNode,
    input: readonly FlowItem[],
    parked: readonly ItemState[],
    skipFrom: number,
  ): Promise<WalkResult | undefined> => {
    const step = new StepBuilder({
      runId: ctx.run.id,
      nodeId: node.id,
      mode: ctx.mode,
      startedAt: ctx.now().toISOString(),
    });
    step.field("in", input.length);

    let outcome: NodeOutcome;
    try {
      outcome = await executorFor(node)({ ctx, node, input, step, parked });
      const ports = new Set(portsWithLimit(ctx.graph, node));
      for (const port of Object.keys(outcome.itemsByPort)) {
        // An item sent out of a port the node does not have would reach no edge and vanish.
        if (!ports.has(port)) {
          throw new Error(
            `"${node.name}" sent items out of "${port}", which a ${node.kind} node does not have.`,
          );
        }
      }
      assertWithinStepCap(emittedItems(outcome.itemsByPort).map(capView));
    } catch (error) {
      // A WorkflowError is a failure of this step; anything else is a bug or a dead
      // dependency, and it stops the whole run loudly instead.
      if (!(error instanceof WorkflowError)) throw error;
      await put(
        step.finish({
          finishedAt: ctx.now().toISOString(),
          failure: { code: error.code, message: error.message },
        }),
      );
      await ctx.runtime.flushEvents();
      await skipRest(skipFrom, { reason: `"${node.name}" failed` }, node.id);
      return {
        status: "failed",
        error: { code: error.code, message: error.message },
        steps: collect(),
        settled: false,
      };
    }

    await ctx.runtime.passed(emittedItems(outcome.itemsByPort));
    const routed = options.downstream
      ? await routeBack(node, outcome.itemsByPort)
      : outcome.itemsByPort;
    step.setPorts(routed);
    await put(
      step.finish({
        finishedAt: ctx.now().toISOString(),
        ...(outcome.stop ? { stop: outcome.stop } : {}),
      }),
    );
    await ctx.runtime.flushEvents();

    if (outcome.commit) commits.push(outcome.commit);
    if (outcome.stop) {
      stops.push(outcome.stop);
      for (const item of unfinishedOf(node, outcome, input, step)) {
        await setItemAside({ ctx, node }, item, outcome.stop);
      }
      holdBackBelow(node.id);
    }
    if (options.downstream) deliver(node.id, routed);
    return undefined;
  };

  for (const nodeId of plan.order) {
    const parked = wakes.get(nodeId);
    if (!parked) continue;
    const node = plan.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node "${nodeId}" is in the plan but not the graph.`);
    }
    const stopped = ctx.stopReason();
    if (stopped) return stopNow(0, stopped);
    wakes.delete(nodeId);
    const early = await runNode(node, [], parked, 0);
    if (early) return early;
  }

  for (pointer = 0; pointer < plan.order.length; pointer += 1) {
    const nodeId = plan.order[pointer];
    if (!owed.has(nodeId)) continue;
    const node = plan.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node "${nodeId}" is in the plan but not the graph.`);
    }

    const stopped = ctx.stopReason();
    if (stopped) return stopNow(pointer, stopped);

    const input = inboxes.get(nodeId) ?? [];
    owed.delete(nodeId);
    inboxes.delete(nodeId);
    if (heldBack.has(nodeId)) {
      if (stops.length === 0) stops.push(notAllResumed);
      for (const item of input) {
        await setItemAside({ ctx, node }, item, stops[0]);
      }
      const at = ctx.now().toISOString();
      await put({
        runId: ctx.run.id,
        nodeId,
        status: "skipped",
        mode: ctx.mode,
        startedAt: at,
        finishedAt: at,
        ports: {},
        fields: {
          reason: "waiting for the rest of its batch",
          deferred: input.length,
        },
        error: { code: stops[0].code, message: stops[0].message },
      });
      await ctx.runtime.flushEvents();
      continue;
    }
    const early = await runNode(node, input, [], pointer + 1);
    if (early) return early;
  }
  const note = leftToRebuild();
  if (note !== undefined) return unsettled(note);
  await settle();
  return stops.length === 0
    ? { status: "completed", steps: collect(), settled: true }
    : paused(true);
}
