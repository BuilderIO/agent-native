import type { ThreadReply } from "../adapter.js";
import {
  WorkflowError,
  type ItemState,
  type Wake,
  type WorkflowErrorCode,
  type WorkflowNodeOfKind,
} from "../contract.js";
import { assertWithinStepCap, jsonByteLength } from "../items.js";
import { buildScope, resolveBindings } from "./bindings.js";
import { fitText } from "./bounds.js";
import { callOperation, retrying } from "./call.js";
import {
  DEFAULT_ACK_REACTION,
  MAX_OBSERVED_BYTES,
  MAX_REPLY_TEXT_BYTES,
  READ_FAILURE_PATIENCE_MS,
} from "./constants.js";
import { evaluateRule } from "./rules.js";
import type { FlowItem, ItemFailure, NodeCall, TickContext } from "./types.js";

type WaitNode = WorkflowNodeOfKind<"wait">;

/** What looking at one parked item came to. */
type WakeDecision =
  /** The wait is over: send the item out of `port`, with `result` attached under the Wait's name. */
  | {
      kind: "wake";
      port: string;
      result: Record<string, unknown>;
      summary: string;
    }
  /** Looked at, nothing yet: park it again with this wake. */
  | { kind: "waiting"; wake: Wake }
  /** Not looked at: neither its deadline nor its check time has come. */
  | { kind: "not_due" }
  /**
   * The read failed in a way a later look may get past (Slack or the provider is
   * down). That is not "nothing yet" and not the item's fault: it stays parked
   * with its deadline, spends no attempt, and is looked at again at its next
   * check. `wake` is its wake as it stands, `since` when its looks began failing.
   */
  | { kind: "unreadable"; failure: ItemFailure; wake: Wake; since: string }
  /** Could not be looked at, and looking again will not help: the item goes to a person. */
  | { kind: "failed"; failure: ItemFailure };

const failed = (failure: ItemFailure): WakeDecision => ({
  kind: "failed",
  failure,
});

/**
 * A read that failed. One a later look can fix keeps the item waiting until
 * every look since the first failed one has failed for `READ_FAILURE_PATIENCE_MS`;
 * anything else, or a streak that long, ends it for a person with the reason.
 */
function readFailed(
  ctx: TickContext,
  wake: Wake,
  what: string,
  read: { code: WorkflowErrorCode; message: string; retryable: boolean },
): WakeDecision {
  const message = `${what}: ${read.message}`;
  if (!read.retryable) return failed({ code: read.code, message });
  const now = ctx.now();
  const since = wake.readFailingSince ?? now.toISOString();
  if (now.getTime() - Date.parse(since) >= READ_FAILURE_PATIENCE_MS) {
    return failed({
      code: read.code,
      message: `${message} (every look since ${since} has failed)`,
    });
  }
  return {
    kind: "unreadable",
    failure: { code: read.code, message, retryable: true },
    wake,
    since,
  };
}

function firstReply(replies: readonly ThreadReply[]): Record<string, unknown> {
  const [first] = [...replies].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
  return {
    id: first.id,
    at: first.at,
    kind: first.kind,
    ...(first.author === undefined ? {} : { author: first.author }),
    ...(first.text === undefined
      ? {}
      : { text: fitText(first.text, MAX_REPLY_TEXT_BYTES) }),
    ...(first.url === undefined ? {} : { url: first.url }),
  };
}

/** What a condition Wait saw, kept on the item only when small, and said so when not. */
function observed(output: unknown): Record<string, unknown> {
  const bytes = jsonByteLength(output);
  return bytes <= MAX_OBSERVED_BYTES
    ? { observed: output }
    : { observedDropped: true, observedBytes: bytes };
}

/**
 * Looks at one parked item and says whether its wait is over.
 *
 * A reply or condition Wait reads first, even at its deadline, and an answer
 * it finds then still counts. It never times an item out on a read that
 * failed, because "could not read" is not "nobody answered": a read a later
 * look may fix leaves the item waiting (`unreadable`); any other ends it for a
 * person (`failed`).
 */
export async function decideWake(
  call: Pick<NodeCall<WaitNode>, "ctx" | "node">,
  state: ItemState,
  item: FlowItem,
  waitSince: string,
): Promise<WakeDecision> {
  const { ctx, node } = call;
  const { wake } = state;
  if (!wake) {
    return failed({
      code: "engine_error",
      message: `Item "${state.itemId}" is parked at "${node.name}" with no wake.`,
    });
  }
  const deadlinePassed = ctx.dueNow().getTime() >= Date.parse(wake.dueAt);
  const settings = node.settings;

  if (settings.wait === "time") {
    return deadlinePassed
      ? {
          kind: "wake",
          port: "done",
          result: { outcome: "done", waitedUntil: wake.dueAt },
          summary: `waited until ${wake.dueAt}`,
        }
      : { kind: "not_due" };
  }

  if (settings.wait === "reply") {
    if (!wake.thread) {
      return failed({
        code: "engine_error",
        message: `Item "${state.itemId}" is parked at "${node.name}" with no thread to watch.`,
      });
    }
    const thread = wake.thread;
    const read = await retrying(
      ctx,
      () =>
        ctx.host.threads.readReplies({
          thread,
          since: waitSince,
          acceptFrom: settings.acceptFrom,
          ackReaction: settings.ackReaction ?? DEFAULT_ACK_REACTION,
          ownerEmail: ctx.ownerEmail,
          signal: ctx.signal,
        }),
      (result) => !result.ok && result.retryable,
    );
    if (!read.ok) {
      return readFailed(
        ctx,
        wake,
        "Could not read the thread to see whether anyone replied",
        read,
      );
    }
    if (read.replies.length > 0) {
      return {
        kind: "wake",
        port: "replied",
        result: {
          outcome: "replied",
          replies: read.replies.length,
          first: firstReply(read.replies),
          lastReplyAt: new Date(
            Math.max(...read.replies.map((reply) => Date.parse(reply.at))),
          ).toISOString(),
        },
        summary: `${read.replies.length} ${read.replies.length === 1 ? "reply" : "replies"}`,
      };
    }
    return deadlinePassed
      ? {
          kind: "wake",
          port: "timedOut",
          result: { outcome: "timedOut", waitedUntil: wake.dueAt },
          summary: `no reply by ${wake.dueAt}`,
        }
      : { kind: "waiting", wake };
  }

  const def = ctx.host.catalog.get(settings.operation);
  if (!def) {
    return failed({
      code: "graph_invalid",
      message: `Operation "${settings.operation}" is not in the catalog.`,
    });
  }
  const counters = await ctx.runtime.countersOf(item.id);
  const scope = buildScope(ctx, item, counters, node.id);
  const resolved = resolveBindings(settings.args, def, scope);
  if (!resolved.ok) return failed(resolved.failure);
  if (resolved.aiBindings.length > 0) {
    return failed({
      code: "graph_invalid",
      message: `"${node.name}" checks a condition and cannot have model-written arguments.`,
    });
  }
  const result = await callOperation(ctx, {
    operation: def,
    fields: resolved.fields,
    credentialSlot: def.credential.provider,
    mode: ctx.mode,
    signal: ctx.signal,
  });
  if (!result.ok) {
    return readFailed(
      ctx,
      wake,
      `Could not read ${def.id} to check the condition`,
      {
        ...result,
        retryable: result.retryable && result.sideEffect === "none",
      },
    );
  }
  if (result.output === undefined) {
    return failed({
      code: "lookup_failed",
      message: `${def.id} returned no output, which is not the same as the condition being false.`,
    });
  }
  try {
    assertWithinStepCap([result.output], { maxItems: 1 });
  } catch (error) {
    if (!(error instanceof WorkflowError)) throw error;
    return failed({ code: error.code, message: error.message });
  }
  // The rule reads the result as `item`, so `item.status` is the status it returned.
  const outcome = evaluateRule(
    settings.rule,
    { ...scope, item: result.output },
    ctx.now(),
  );
  if (!outcome.ok) {
    return failed({ code: "expression_failed", message: outcome.message });
  }
  if (outcome.matched) {
    return {
      kind: "wake",
      port: "met",
      result: { outcome: "met", ...observed(result.output) },
      summary: `${def.id} met its rule`,
    };
  }
  return deadlinePassed
    ? {
        kind: "wake",
        port: "timedOut",
        result: { outcome: "timedOut", waitedUntil: wake.dueAt },
        summary: `condition not met by ${wake.dueAt}`,
      }
    : { kind: "waiting", wake };
}
