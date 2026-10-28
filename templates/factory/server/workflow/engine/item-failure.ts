import type { Wake } from "../contract.js";
import {
  ATTEMPTS_COUNTER,
  END_STATUS,
  MAX_ITEM_ATTEMPTS,
  RETRY_PARK_BASE_MS,
  UNHELD_COUNTER,
} from "./constants.js";
import { contextPlanFor } from "./context-plan.js";
import type { FlowItem, ItemFailure, NodeCall, StopReason } from "./types.js";
import { contextOverflow, encodeContext } from "./wait-park.js";

/**
 * Ends an item for a person. A status write that fails leaves the item as it
 * was, with that failure on its trail; the answer says whether it ended.
 */
async function handOff(
  call: Pick<NodeCall, "ctx" | "node">,
  item: FlowItem,
  reason: string,
): Promise<boolean> {
  const { ctx, node } = call;
  const ended = await ctx.runtime.end(item, {
    nodeId: node.id,
    outcome: "needsManual",
    status: END_STATUS.needsManual,
    reason,
  });
  if (ended.ok) return true;
  ctx.runtime.record({
    itemId: item.id,
    nodeId: node.id,
    kind: "error",
    code: ended.failure.code,
    summary: `${ended.failure.code}: ${ended.failure.message}`,
  });
  return false;
}

/**
 * An item that cannot be parked for a later run: what it carries is more than
 * a parked row holds. An inbox row goes to a person, which its status says. Any
 * other item (a list, a group, something from a window) has no row to carry
 * the fact, and ending it would drop it while the window and the cursors move
 * on past what it was built from. It is left to be built again from its source
 * and the run is left unsettled so they stay where they were. A run that
 * finds it too big again and again gives up the third time, hands it to a
 * person and lets the window move on, so one oversized item cannot hold a
 * workflow back for ever.
 */
async function cannotPark(
  call: Pick<NodeCall, "ctx" | "node">,
  item: FlowItem,
  overflow: { bytes: number; maxBytes: number },
  handOffReason: string,
  what: string,
): Promise<void> {
  const { ctx, node } = call;
  const runtime = ctx.runtime;
  const cannot = `"${node.name}" cannot hold this item ${what}: what it carries is ${overflow.bytes} bytes and a parked item holds ${overflow.maxBytes}`;
  if (item.inbox) {
    runtime.record({
      itemId: item.id,
      nodeId: node.id,
      kind: "error",
      code: "context_truncated",
      summary: `context_truncated: ${cannot}.`,
    });
    await handOff(call, item, handOffReason);
    return;
  }
  const tries = await runtime.bump(item.id, UNHELD_COUNTER);
  if (tries < MAX_ITEM_ATTEMPTS) {
    runtime.holdBack(
      `${cannot}, so the window and the cursors stay where they were and the next run builds it again.`,
    );
    runtime.record({
      itemId: item.id,
      nodeId: node.id,
      kind: "error",
      code: "context_truncated",
      summary: `context_truncated: ${cannot}. It is built again from its source in the next run (try ${tries} of ${MAX_ITEM_ATTEMPTS}); the window stays where it was.`,
    });
    return;
  }
  runtime.record({
    itemId: item.id,
    nodeId: node.id,
    kind: "error",
    code: "context_truncated",
    summary: `context_truncated: ${cannot}, and ${tries} runs in a row have found it so.`,
  });
  runtime.failed += 1;
  await handOff(
    call,
    item,
    `${handOffReason}; given up after ${tries} runs, so the window moved on without it`,
  );
}

/**
 * One item failed at a node. It records why, leaves the batch (it appears in
 * no output), and spends an attempt, and then one of three things holds, so a
 * failed item is never left where nobody will look:
 *
 * - the failure had no effect outside and is worth another try (`retryable`),
 *   with attempts left: the item parks at this node's input with a due time,
 *   so it comes back whatever its source does;
 * - the failure cannot be fixed by trying again, or the attempts are spent: the
 *   item ends for a person at once. Leaving it for its source to offer again
 *   would lose it behind a cursor or a window, which never do;
 * - the write may already have happened (`needsCheck`): retrying could repeat
 *   it, so the item ends for a person at once without spending attempts.
 */
export async function failItem(
  call: Pick<NodeCall, "ctx" | "node" | "step">,
  item: FlowItem,
  failure: ItemFailure,
  options: { needsCheck?: boolean } = {},
): Promise<void> {
  const { ctx, node, step } = call;
  const runtime = ctx.runtime;
  runtime.record({
    itemId: item.id,
    nodeId: node.id,
    kind: "error",
    code: failure.code,
    summary: `${failure.code}: ${failure.message}`,
  });

  if (options.needsCheck) {
    step.itemNeedsCheck(failure);
    runtime.needsCheck += 1;
    await handOff(call, item, failure.message);
    return;
  }

  step.itemFailed(failure);
  runtime.failed += 1;
  const attempts = await runtime.bump(item.id, ATTEMPTS_COUNTER);
  if (failure.retryable !== true || attempts >= MAX_ITEM_ATTEMPTS) {
    const last = `${failure.code}: ${failure.message}`;
    const ended = await handOff(
      call,
      item,
      attempts > 1 ? `Failed ${attempts} times; last: ${last}` : last,
    );
    // Items lists an item whose last event is an error and whose attempts are
    // spent as needing a person, so a hand-off that could not be written still shows.
    if (!ended && runtime.live && attempts < MAX_ITEM_ATTEMPTS) {
      await runtime.bump(
        item.id,
        ATTEMPTS_COUNTER,
        MAX_ITEM_ATTEMPTS - attempts,
      );
    }
    return;
  }
  if (!runtime.live) return;

  const dueAt = new Date(
    ctx.now().getTime() + RETRY_PARK_BASE_MS * 2 ** (attempts - 1),
  ).toISOString();
  const wake: Wake = { wait: "retry", dueAt };
  const context = {
    ...encodeContext(
      item,
      ctx.run.startedAt,
      contextPlanFor(ctx.graph, node.id, "retry"),
    ),
    retryKind: node.kind,
  };
  const overflow = contextOverflow(context);
  if (overflow) {
    // Parked with something missing, the retry would fail for a reason that hides this one.
    await cannotPark(
      call,
      item,
      overflow,
      `Could not be held for a retry (${overflow.bytes} bytes); last: ${failure.code}: ${failure.message}`,
      "for a retry",
    );
    return;
  }
  await runtime.park(item, { nodeId: node.id, wake, context });
  runtime.retryParked += 1;
  runtime.record({
    itemId: item.id,
    nodeId: node.id,
    kind: "parked",
    summary: `parked for a retry at "${node.name}" until ${dueAt}: attempt ${attempts} of ${MAX_ITEM_ATTEMPTS} failed (${failure.code})`,
  });
}

/**
 * An item a stopped run has not finished with: one a node did not get to, or
 * one that came out of a node and has no node left that can take it this tick.
 * It parks at `node`'s input, due at once, so the next tick picks it up where
 * this one stopped and nothing it already went through runs again. Nothing
 * failed, so no attempt is spent.
 */
export async function setItemAside(
  call: Pick<NodeCall, "ctx" | "node">,
  item: FlowItem,
  stop: StopReason,
): Promise<void> {
  const { ctx, node } = call;
  const runtime = ctx.runtime;
  if (!runtime.live) {
    runtime.record({
      itemId: item.id,
      nodeId: node.id,
      kind: "parked",
      summary: `would set aside at "${node.name}" for the next run: ${stop.message}`,
    });
    return;
  }
  const context = {
    ...encodeContext(
      item,
      ctx.run.startedAt,
      contextPlanFor(ctx.graph, node.id, "retry"),
    ),
    retryKind: node.kind,
    continued: true,
  };
  const overflow = contextOverflow(context);
  if (overflow) {
    if (item.inbox) runtime.failed += 1;
    await cannotPark(
      call,
      item,
      overflow,
      `Could not be set aside when the run stopped (${overflow.bytes} bytes): ${stop.message}`,
      "for the next run",
    );
    return;
  }
  const wake: Wake = { wait: "retry", dueAt: ctx.now().toISOString() };
  await runtime.park(item, { nodeId: node.id, wake, context });
  runtime.setAside += 1;
  runtime.record({
    itemId: item.id,
    nodeId: node.id,
    kind: "parked",
    summary: `set aside at "${node.name}" for the next run: ${stop.message}`,
  });
}

/**
 * A parked item's thread or condition could not be read, and a later look may
 * work. The item itself did not fail, so no attempt is spent: this records the
 * failure on its trail and in the run's counts, and the caller parks it again
 * with its deadline unchanged.
 */
export function recordFailedRead(
  call: Pick<NodeCall, "ctx" | "node" | "step">,
  item: FlowItem,
  failure: ItemFailure,
  since: string,
): void {
  const { ctx, node, step } = call;
  step.itemFailed(failure);
  ctx.runtime.failed += 1;
  ctx.runtime.record({
    itemId: item.id,
    nodeId: node.id,
    kind: "error",
    code: failure.code,
    summary: `${failure.code}: ${failure.message}; still waiting, no attempt spent (reads failing since ${since})`,
  });
}
