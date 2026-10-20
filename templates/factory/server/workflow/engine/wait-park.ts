import {
  nodeScopeKey,
  threadRefSchema,
  type ThreadRef,
  type Wake,
  type WorkflowNodeOfKind,
} from "../contract.js";
import { MAX_ITEM_CONTEXT_BYTES, jsonByteLength } from "../items.js";
import { isRecord } from "./bounds.js";
import { isKeptPaths, pruneItem, type ContextPlan } from "./context-plan.js";
import type { FlowItem, ItemFailure, TickContext } from "./types.js";

type WaitNode = WorkflowNodeOfKind<"wait">;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DURATION_MS = { minutes: MINUTE_MS, hours: HOUR_MS, days: 24 * HOUR_MS };

/**
 * What an item carries into a Wait and out again: the item as the nodes after
 * it will read it, less what none of them read (`plan` says which), plus when
 * the wait began, which is where a reply search starts, and `kept`, the paths
 * the plan kept, so a changed graph can tell whether it needs more than this
 * holds. The store keeps it under 8 KB.
 */
export function encodeContext(
  item: FlowItem,
  waitSince: string,
  plan: ContextPlan,
): Record<string, unknown> {
  const { data, nodes } = pruneItem(item, plan);
  return {
    data,
    nodes,
    inbox: item.inbox,
    ...(item.members === undefined ? {} : { members: [...item.members] }),
    ...(item.receiptSalt === undefined
      ? {}
      : { receiptSalt: item.receiptSalt }),
    ...(item.cut === undefined ? {} : { cut: item.cut }),
    waitSince,
    kept: [...plan.kept],
  };
}

/**
 * The instant this tick began. A wake is measured from here, not from the
 * moment an item reaches its Wait: a tick that spends a minute on the items
 * ahead of it would otherwise push every check a minute past the next tick,
 * which then finds nothing due and leaves the item waiting a whole cadence more.
 */
function tickStart(ctx: TickContext): number {
  return Date.parse(ctx.run.startedAt);
}

/**
 * When a new wait for replies begins: when the item's last write this tick
 * went out (the question the wait is for, which is later than the start of a
 * tick that spent time on other items first, so a message posted before it
 * does not answer it), never before this tick began, and later when the item
 * has just been woken by a reply that arrived while the tick ran. Without that,
 * the reply that sent the item back around a loop would also answer the
 * question it was sent back to ask. It is not the moment the item reaches the
 * Wait: every item of a batch is parked together, after the last question, and
 * an early answer to the first would be lost.
 */
export function waitSinceFor(ctx: TickContext, item: FlowItem): string {
  let since = tickStart(ctx);
  const wrote = Date.parse(ctx.runtime.lastWriteAt(item.id) ?? "");
  if (!Number.isNaN(wrote)) since = Math.max(since, wrote);
  for (const node of ctx.graph.nodes) {
    if (node.kind !== "wait") continue;
    const result = item.nodes[nodeScopeKey(node)];
    if (isRecord(result) && result.outcome === "replied") {
      const last = Date.parse(String(result.lastReplyAt));
      if (!Number.isNaN(last)) since = Math.max(since, last);
    }
  }
  return new Date(since).toISOString();
}

/** Null when the context fits what a parked row may hold; otherwise how far over it is. */
export function contextOverflow(
  context: Record<string, unknown>,
): { bytes: number; maxBytes: number } | null {
  const bytes = jsonByteLength(context);
  return bytes > MAX_ITEM_CONTEXT_BYTES
    ? { bytes, maxBytes: MAX_ITEM_CONTEXT_BYTES }
    : null;
}

type DecodedContext =
  | {
      ok: true;
      item: FlowItem;
      waitSince: string;
      /** The paths the item kept when it parked; absent on a context written before items were pruned, which holds everything. */
      kept?: string[];
    }
  | { ok: false; message: string };

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/** A context that does not read back as an item is a failure, never an empty item. */
export function decodeContext(
  itemId: string,
  context: Readonly<Record<string, unknown>>,
): DecodedContext {
  const { data, nodes, inbox, members, receiptSalt, cut, waitSince, kept } =
    context;
  const bad = (what: string): DecodedContext => ({
    ok: false,
    message: `The parked context of "${itemId}" is unreadable: ${what}.`,
  });
  if (!isRecord(data)) return bad('"data" is not an object');
  if (!isRecord(nodes)) return bad('"nodes" is not an object');
  if (typeof inbox !== "boolean") return bad('"inbox" is not true or false');
  if (members !== undefined && !isStringList(members)) {
    return bad('"members" is not a list of ids');
  }
  if (receiptSalt !== undefined && typeof receiptSalt !== "string") {
    return bad('"receiptSalt" is not text');
  }
  if (
    cut !== undefined &&
    !(
      isRecord(cut) &&
      typeof cut.taken === "number" &&
      typeof cut.totalAvailable === "number"
    )
  ) {
    return bad('"cut" is not a pair of counts');
  }
  if (typeof waitSince !== "string" || Number.isNaN(Date.parse(waitSince))) {
    return bad('"waitSince" is not a date-time');
  }
  if (kept !== undefined && !isKeptPaths(kept)) {
    return bad('"kept" is not a list of paths');
  }
  return {
    ok: true,
    waitSince,
    ...(kept === undefined ? {} : { kept }),
    item: {
      id: itemId,
      data,
      nodes,
      inbox,
      ...(members === undefined ? {} : { members }),
      ...(receiptSalt === undefined ? {} : { receiptSalt }),
      ...(cut === undefined
        ? {}
        : {
            cut: cut as { taken: number; totalAvailable: number },
          }),
    },
  };
}

function usableThread(thread: ThreadRef): boolean {
  return (
    (thread.channelId !== undefined && thread.threadTs !== undefined) ||
    (thread.repo !== undefined && thread.number !== undefined) ||
    thread.ticketId !== undefined
  );
}

/**
 * The thread a message a node posted opened. A result that carries a `thread`
 * says it; a Slack post carries `channel` and `ts` (`threadTs` when it was a
 * reply, and the receipt's `externalRef` is the same `ts`).
 */
function threadOfResult(result: unknown): ThreadRef | undefined {
  if (!isRecord(result)) return undefined;
  if (result.thread !== undefined) {
    const parsed = threadRefSchema.safeParse(result.thread);
    return parsed.success && usableThread(parsed.data)
      ? parsed.data
      : undefined;
  }
  const channel = result.channel ?? result.channelId;
  const ts = result.threadTs ?? result.ts ?? result.externalRef;
  return typeof channel === "string" && typeof ts === "string"
    ? { channelId: channel, threadTs: ts }
    : undefined;
}

type ThreadToWatch =
  | { ok: true; thread: ThreadRef }
  | { ok: false; failure: ItemFailure };

function threadToWatch(
  ctx: TickContext,
  node: WaitNode,
  item: FlowItem,
): ThreadToWatch {
  const none = (message: string): ThreadToWatch => ({
    ok: false,
    failure: { code: "expression_failed", message },
  });
  if (node.settings.wait !== "reply") {
    throw new Error(`"${node.name}" is not a reply Wait.`);
  }
  const { watch } = node.settings;
  if (watch) {
    const upstream = ctx.graph.nodes.find(
      (candidate) => candidate.id === watch.fromNode,
    );
    if (!upstream) {
      return none(
        `"${node.name}" watches "${watch.fromNode}", which is not in the graph.`,
      );
    }
    const thread = threadOfResult(item.nodes[nodeScopeKey(upstream)]);
    return thread
      ? { ok: true, thread }
      : none(
          `"${upstream.name}" left no thread to watch: its result has no channel and message time.`,
        );
  }
  const own = threadRefSchema.safeParse(item.data.thread);
  return own.success && usableThread(own.data)
    ? { ok: true, thread: own.data }
    : none(
        `There is no thread to watch: the item has none, and "${node.name}" names no upstream message to watch.`,
      );
}

type WakeBuild =
  | { ok: true; wake: Wake; summary: string }
  | { ok: false; failure: ItemFailure };

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * When an item at this Wait is next looked at, and when it gives up. A time
 * Wait has only a deadline. A reply or condition Wait also has a check time:
 * the graph's check cadence for a reply, the node's own for a condition.
 */
export function buildWake(
  ctx: TickContext,
  node: WaitNode,
  item: FlowItem,
): WakeBuild {
  const now = tickStart(ctx);
  const settings = node.settings;
  if (settings.wait === "time") {
    const { amount, unit } = settings.duration;
    return {
      ok: true,
      wake: {
        wait: "time",
        dueAt: iso(now + Math.round(amount * DURATION_MS[unit])),
      },
      summary: `waits ${amount} ${unit}`,
    };
  }
  const dueAt = now + Math.round(settings.limitHours * HOUR_MS);
  const checkAt =
    now +
    (settings.wait === "condition"
      ? settings.everyMinutes
      : ctx.graph.settings.checkCadenceMinutes) *
      MINUTE_MS;
  const nextCheckAt = checkAt < dueAt ? { nextCheckAt: iso(checkAt) } : {};
  if (settings.wait === "condition") {
    return {
      ok: true,
      wake: { wait: "condition", dueAt: iso(dueAt), ...nextCheckAt },
      summary: `waits for ${settings.operation} to meet its rule, up to ${settings.limitHours} hours`,
    };
  }
  const watched = threadToWatch(ctx, node, item);
  if (!watched.ok) return watched;
  return {
    ok: true,
    wake: {
      wait: "reply",
      dueAt: iso(dueAt),
      ...nextCheckAt,
      thread: watched.thread,
    },
    summary: `waits for a reply, up to ${settings.limitHours} hours`,
  };
}

/** The wake of an item that was looked at and is still waiting: the same deadline, a later check. */
export function laterCheck(ctx: TickContext, node: WaitNode, wake: Wake): Wake {
  const settings = node.settings;
  if (settings.wait === "time") return wake;
  const every =
    settings.wait === "condition"
      ? settings.everyMinutes
      : ctx.graph.settings.checkCadenceMinutes;
  const next = tickStart(ctx) + every * MINUTE_MS;
  const base: Wake = {
    wait: wake.wait,
    dueAt: wake.dueAt,
    ...(wake.thread === undefined ? {} : { thread: wake.thread }),
  };
  return next < Date.parse(wake.dueAt)
    ? { ...base, nextCheckAt: iso(next) }
    : base;
}
