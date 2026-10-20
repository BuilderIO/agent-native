import { nodeScopeKey, type WorkflowNodeOfKind } from "../../contract.js";
import { portsFor } from "../../ports.js";
import { contextPlanFor } from "../context-plan.js";
import { failItem, recordFailedRead } from "../item-failure.js";
import type {
  FlowItem,
  NodeCall,
  NodeExecutorFor,
  StopReason,
} from "../types.js";
import {
  buildWake,
  contextOverflow,
  decodeContext,
  encodeContext,
  laterCheck,
  waitSinceFor,
} from "../wait-park.js";
import { decideWake } from "../wait-resume.js";

/** Stands in for an item whose parked context cannot be read, so its failure can still be recorded and its attempt counted. */
function unreadable(itemId: string): FlowItem {
  return { id: itemId, data: {}, nodes: {}, inbox: false };
}

async function wakeParked(
  call: NodeCall<WorkflowNodeOfKind<"wait">>,
  out: Record<string, FlowItem[]>,
): Promise<{ stop?: StopReason; deferred: number }> {
  const { ctx, node, parked, step } = call;
  const scopeKey = nodeScopeKey(node);
  let woke = 0;
  let waiting = 0;
  for (const [index, state] of parked.entries()) {
    const reason = ctx.stopReason();
    if (reason) {
      step.field("woke", woke);
      step.field("stillWaiting", waiting);
      return { stop: reason, deferred: parked.length - index };
    }
    const decoded = decodeContext(state.itemId, state.context);
    if (!decoded.ok) {
      ctx.invariantBroken({
        invariant: "wake_without_context",
        severity: "error",
        nodeId: node.id,
        details: { itemId: state.itemId, problem: decoded.message },
      });
      await failItem(call, unreadable(state.itemId), {
        code: "engine_error",
        message: decoded.message,
      });
      continue;
    }
    const { item, waitSince } = decoded;
    const decision = await decideWake(call, state, item, waitSince);
    switch (decision.kind) {
      case "wake": {
        out[decision.port].push({
          ...item,
          nodes: { ...item.nodes, [scopeKey]: decision.result },
        });
        woke += 1;
        ctx.runtime.woke += 1;
        ctx.runtime.record({
          itemId: item.id,
          nodeId: node.id,
          kind: "woke",
          port: decision.port,
          summary: `woke at "${node.name}": ${decision.summary}`,
        });
        break;
      }
      case "waiting": {
        await ctx.runtime.park(item, {
          nodeId: node.id,
          wake: laterCheck(ctx, node, decision.wake),
          context: state.context,
        });
        waiting += 1;
        ctx.runtime.stillWaiting += 1;
        break;
      }
      case "unreadable": {
        recordFailedRead(call, item, decision.failure, decision.since);
        await ctx.runtime.park(item, {
          nodeId: node.id,
          wake: {
            ...laterCheck(ctx, node, decision.wake),
            readFailingSince: decision.since,
          },
          context: state.context,
        });
        waiting += 1;
        ctx.runtime.stillWaiting += 1;
        break;
      }
      case "not_due":
        break;
      case "failed":
        await failItem(call, item, decision.failure);
        break;
    }
  }
  step.field("woke", woke);
  step.field("stillWaiting", waiting);
  return { deferred: 0 };
}

/**
 * A Wait pauses one item, not the run. An item that arrives is parked: its row
 * keeps the item, what upstream nodes added, and when and why to look again,
 * and it leaves this tick. The items the resume pass hands in are the ones
 * whose time or check has come; each is looked at and either sent out of the
 * port that says how its wait ended, or parked again with a later check.
 *
 * What it keeps is what a node after the Wait reads (`context-plan.ts`). An
 * item whose context would still not fit a parked row fails with
 * `context_truncated` instead of being parked with something missing. A dry or
 * test run parks nothing and says what it would have done.
 */
export const executeWait: NodeExecutorFor<"wait"> = async (call) => {
  const { ctx, node, input, step } = call;
  const out: Record<string, FlowItem[]> = Object.fromEntries(
    portsFor(node).map((port) => [port, []]),
  );
  step.field("wait", node.settings.wait);

  let stop: StopReason | undefined;
  let deferred = 0;
  if (call.parked.length > 0) {
    step.field("due", call.parked.length);
    const woken = await wakeParked(call, out);
    stop = woken.stop;
    deferred = woken.deferred;
  }

  const parkedNow: FlowItem[] = [];
  let unfinished: readonly FlowItem[] | undefined;
  for (const [index, item] of input.entries()) {
    const reason = stop ?? ctx.stopReason();
    if (reason) {
      stop = reason;
      deferred += input.length - index;
      unfinished = input.slice(index);
      break;
    }
    const built = buildWake(ctx, node, item);
    if (!built.ok) {
      await failItem(call, item, built.failure);
      continue;
    }
    const context = encodeContext(
      item,
      waitSinceFor(ctx, item),
      contextPlanFor(ctx.graph, node.id),
    );
    const overflow = contextOverflow(context);
    if (overflow) {
      await failItem(call, item, {
        code: "context_truncated",
        message: `"${node.name}" cannot park this item: what it carries is ${overflow.bytes} bytes and a parked item holds ${overflow.maxBytes}.`,
      });
      continue;
    }
    await ctx.runtime.park(item, {
      nodeId: node.id,
      wake: built.wake,
      context,
    });
    ctx.runtime.record({
      itemId: item.id,
      nodeId: node.id,
      kind: "parked",
      summary: `${ctx.runtime.live ? "parked" : "would park"} at "${node.name}": ${built.summary}`,
    });
    if (ctx.runtime.live) ctx.runtime.parked += 1;
    parkedNow.push(item);
  }

  step.summaryPort("parked", parkedNow);
  step.field(ctx.runtime.live ? "parked" : "wouldPark", parkedNow.length);
  if (deferred > 0) step.field("deferred", deferred);
  return {
    itemsByPort: out,
    ...(stop ? { stop, unfinished: unfinished ?? input } : {}),
  };
};
