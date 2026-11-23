/**
 * The execution frame each action invocation runs in, and the evidence a
 * dispatcher vouched for that one invocation. Not in the package exports: the
 * action entry exposes no frame-evidence helpers but `noteExternalWrite`, which
 * can only add observed-write evidence, and `withoutWriteObservation`, which
 * can only keep a write from being counted. Request input or
 * `ActionRunContext` fields never become evidence. Trusted server dispatcher
 * APIs (`executeAgentToolCall`, `runAgentLoop`) can still supply approval and
 * attribution. Nothing here imports `action.ts` at runtime, so `action.ts` and
 * the audit helpers import it without a cycle.
 */
import type {
  ActionCallRecord,
  ActionCaller,
  ActionExecutionOutcome,
  ActionRunContext,
} from "./action.js";
import type { AuditOverride } from "./audit/attribution.js";
import { getAsyncLocalStorageCtor } from "./shared/optional-node-builtins.js";

/**
 * Carries an action's execution-frame key across `{ ...entry, run }` wrappers
 * and the registry rebuilds that copy named fields (`preserveActionFlags`).
 */
export const ACTION_EXECUTION_KEY = Symbol.for(
  "agent-native.action.executionKey",
);

export type ActionExecutionRun = (
  args: any,
  ctx?: ActionRunContext,
) => Promise<any>;
/**
 * What vouched for one invocation, and the ids its audit rows record in place
 * of its run's own. Only the dispatcher that opens the invocation's frame sets
 * it, and a child runs in a frame of its own, so no other invocation has it,
 * whatever context it is given.
 */
export type ActionInvocationEvidence = {
  approvedToolCallKey?: string;
  /** The MCP client accepted this exact call's approval elicitation. */
  mcpClientAccepted?: true;
  auditOverride?: AuditOverride;
  /** The MCP call consumed a grant its owner approved on the review page. */
  mcpReviewPageApproved?: true;
  /** When the server asked for that grant. */
  approvalAskedAt?: number;
  /** An admitted MCP user-turn grant covers this call, so provider gates may
   *  treat it as the person's own foreground turn. */
  providerInteractive?: true;
};
export type ActionExecutionFrame = {
  key: object;
  run: ActionExecutionRun;
  parent?: ActionExecutionFrame;
  handlerEntered: boolean;
  /** A write entered its handler in this call or in one nested in it. */
  writeEntered: boolean;
  /** One of those writes publishes action changes. */
  changeEntered: boolean;
  /** This call, or one nested in it, was seen to write. */
  writeObserved: boolean;
  /** Which channel saw it first, for diagnostics. */
  writeObservedChannel?: string;
  /** This call's classification, once validated arguments set it. */
  writes?: boolean;
  emitsChange?: boolean;
  boundaryPending?: boolean;
  /** Raw `intent` input captured before schema parsing can strip unknown keys. */
  navigationIntent?: string;
  /** Declared on an explicit UI-opening write action (never on a read). */
  allowsAgentNavigation?: boolean;
  /** True when this frame is executing the `navigate` action itself. */
  isNavigateAction?: boolean;
  /** The call's record, and the context it ran with, once validated. */
  record?: ActionCallRecord;
  context?: ActionRunContext;
  nestedWriteEntered?: boolean;
  /** The write was seen in a call nested in this one, not this call's own. */
  nestedWriteObserved?: boolean;
  raised?: unknown;
  /** The dispatcher's outcome, which takes the record as it is made. */
  outcome?: ActionExecutionOutcome;
};
export type ActionExecutionState = {
  frame?: ActionExecutionFrame;
  failures: WeakMap<object, ActionExecutionFrame>;
};
const ActionExecutionStorage = getAsyncLocalStorageCtor();
export const actionExecutionStorage = ActionExecutionStorage
  ? new ActionExecutionStorage<ActionExecutionState>()
  : undefined;

/** The frame whose writes are not observed, for the work that runs inside it. */
const unobservedFrame = ActionExecutionStorage
  ? new ActionExecutionStorage<ActionExecutionFrame>()
  : undefined;

/** Evidence vouched for a run, until that run opens its frame. */
const vouched = new WeakMap<object, ActionInvocationEvidence>();
/** Each frame's evidence, until its invocation settles. */
const held = new WeakMap<ActionExecutionFrame, ActionInvocationEvidence>();

/**
 * Vouch for the one call a dispatcher runs with `outcome`: the frame that run
 * opens holds `evidence` until the promise `run` returned settles, not until a
 * stream or iterator it returned is consumed.
 */
export function vouchedOutcome<T extends object>(
  outcome: T,
  evidence: ActionInvocationEvidence | undefined,
): T {
  if (evidence) vouched.set(outcome, evidence);
  else vouched.delete(outcome);
  return outcome;
}

/** The evidence vouched for the run observed by `outcome`, taken once. */
export function takeVouchedEvidence(
  outcome: object,
): ActionInvocationEvidence | undefined {
  const evidence = vouched.get(outcome);
  vouched.delete(outcome);
  return evidence;
}

export function holdInvocationEvidence(
  frame: ActionExecutionFrame,
  evidence: ActionInvocationEvidence | undefined,
): void {
  if (evidence) held.set(frame, evidence);
}

export function endInvocationEvidence(frame: ActionExecutionFrame): void {
  held.delete(frame);
}

/** The evidence of the invocation running now, never a caller's or a settled one's. */
export function currentInvocationEvidence():
  | ActionInvocationEvidence
  | undefined {
  const frame = actionExecutionStorage?.getStore()?.frame;
  return frame ? held.get(frame) : undefined;
}

/**
 * What approved the action call running now over MCP: the person on the
 * app's review page, or the client's own approval prompt. Undefined when
 * nothing did, and in any call nested in it, which runs in its own frame.
 * Read-only: it reports what the dispatcher vouched for, nothing a call sent.
 * Only the MCP call path that consumed a grant its owner approved on the
 * review page reports `"mcp-review-page"`; an audit label a trusted
 * dispatcher passes (`auditOverride`) reports nothing.
 */
export function currentActionApproval():
  | "mcp-review-page"
  | "mcp-client"
  | undefined {
  const evidence = currentInvocationEvidence();
  if (evidence?.mcpReviewPageApproved) return "mcp-review-page";
  return evidence?.mcpClientAccepted ? "mcp-client" : undefined;
}

/**
 * When the person was asked for the review-page approval of the action call
 * running now, in epoch milliseconds: its grant's creation time, which the
 * notice was dated from. Undefined unless the review page approved this call
 * and its grant recorded the time.
 */
export function currentActionApprovalAskedAt(): number | undefined {
  const evidence = currentInvocationEvidence();
  return evidence?.mcpReviewPageApproved ? evidence.approvalAskedAt : undefined;
}

/**
 * The caller that started the action calls running now: the outermost call's
 * `caller`, which a dispatcher set, never a nested call's own label or
 * anything the request sent. Undefined outside an action call.
 */
export function currentActionOriginCaller(): ActionCaller | undefined {
  let caller: ActionCaller | undefined;
  for (
    let frame = actionExecutionStorage?.getStore()?.frame;
    frame;
    frame = frame.parent
  ) {
    caller = frame.context?.caller ?? caller;
  }
  return caller;
}

/**
 * Whether a read-only action call is running now: the innermost call or any
 * call it runs inside, so a write nested in a read stays inside the read.
 */
export function insideReadOnlyAction(): boolean {
  for (
    let frame = actionExecutionStorage?.getStore()?.frame;
    frame;
    frame = frame.parent
  ) {
    if (frame.writes === false) return true;
  }
  return false;
}

/**
 * The raw `intent` argument on the running action or any ancestor frame,
 * preferring `"open"` if any caller in the chain asked to open the view.
 */
export function currentActionNavigationIntent(): string | undefined {
  let found: string | undefined;
  for (
    let frame = actionExecutionStorage?.getStore()?.frame;
    frame;
    frame = frame.parent
  ) {
    if (frame.navigationIntent === "keep") return "keep";
    if (
      frame.navigationIntent === "open" ||
      frame.navigationIntent === "reveal"
    )
      found = frame.navigationIntent;
    found ??= frame.navigationIntent;
  }
  return found;
}

/**
 * Whether the active action chain is authorized to navigate by an action's
 * declared `allowsAgentNavigation: true`. Only the outermost write action can
 * grant this: a nested action with `allowsAgentNavigation: true` (such as an
 * app's own `navigate` action) cannot bypass a parent write action that did
 * not declare it.
 */
export function currentActionAllowsAgentNavigation(): boolean {
  let outermostWrite: ActionExecutionFrame | undefined;
  for (
    let frame = actionExecutionStorage?.getStore()?.frame;
    frame;
    frame = frame.parent
  ) {
    if (frame.writes === true) {
      outermostWrite = frame;
    }
  }
  return outermostWrite?.allowsAgentNavigation === true;
}

/** Whether any write has already been observed in the active action chain. */
export function hasObservedWriteInActionChain(): boolean {
  for (
    let frame = actionExecutionStorage?.getStore()?.frame;
    frame;
    frame = frame.parent
  ) {
    if (frame.writeObserved) return true;
  }
  return false;
}

/**
 * Whether the current action is nested inside an outer write action (for
 * example, an edit action invoking `navigate`).
 */
export function insideParentWriteAction(): boolean {
  const current = actionExecutionStorage?.getStore()?.frame;
  for (let frame = current?.parent; frame; frame = frame.parent) {
    if (frame.writes === true) return true;
  }
  return false;
}

/** Whether the running action itself or any ancestor is classified as a write. */
export function insideWriteAction(): boolean {
  for (
    let frame = actionExecutionStorage?.getStore()?.frame;
    frame;
    frame = frame.parent
  ) {
    if (frame.writes === true) return true;
  }
  return false;
}

/**
 * Whether the running call is a top-level `navigate` action (no outer write
 * action). Lets hand-written `actions/navigate.ts` switch section/list views
 * while refusing non-navigate write actions that try to move the view.
 */
export function isStandaloneNavigateAction(): boolean {
  const current = actionExecutionStorage?.getStore()?.frame;
  if (!current || current.writes !== true) return false;
  if (insideParentWriteAction()) return false;
  return (
    current.isNavigateAction === true ||
    current.context?.actionName === "navigate"
  );
}

/**
 * Run a dispatcher's own work outside the invocation it runs inside. A frame's
 * evidence belongs only to rows about that frame's own call, so a row about
 * another call is recorded here.
 */
export function runOutsideActionInvocation<T>(fn: () => T): T {
  const state = actionExecutionStorage?.getStore();
  if (!actionExecutionStorage || !state?.frame) return fn();
  return actionExecutionStorage.run({ failures: state.failures }, fn);
}

/**
 * Whether a write seen now would add evidence: not outside a call, not inside
 * bookkeeping, and not once the call has already seen one. Lets a caller skip
 * work it would only do to classify a write.
 */
export function observingWrites(): boolean {
  const frame = actionExecutionStorage?.getStore()?.frame;
  return (
    frame !== undefined &&
    !frame.writeObserved &&
    unobservedFrame?.getStore() !== frame
  );
}

/**
 * Record that the running call, and every call it runs inside, was seen to
 * write through `channel`. Call it before the write is sent: a write still in
 * flight when its failure arrives must already count. Evidence is only added,
 * never cleared.
 */
export function noteObservedWrite(channel: string): void {
  const frame = actionExecutionStorage?.getStore()?.frame;
  if (!frame || unobservedFrame?.getStore() === frame) return;
  for (let f: ActionExecutionFrame | undefined = frame; f; f = f.parent) {
    f.writeObserved = true;
    f.writeObservedChannel ??= channel;
    if (f !== frame) f.nestedWriteObserved = true;
  }
}

/**
 * Run the framework's own bookkeeping, such as an audit row, a change marker or
 * an analytics event, without it counting as a write of the call it runs
 * inside. Scoped to that call's frame, so an action it runs still records its
 * own writes. Use it only for bookkeeping, or for a write a retry provably
 * cannot repeat, such as one keyed by a deterministic id or a dedup key. Never
 * wrap a write the call exists to make: a failure after it would read as
 * having saved nothing, and the agent would repeat it. The callback must await
 * the work inside itself: a Drizzle query builder is a thenable that runs when
 * awaited, after the callback returned, so `() => db.insert(t).values(v)`
 * exempts nothing.
 */
export function withoutWriteObservation<T>(fn: () => T): T {
  const frame = actionExecutionStorage?.getStore()?.frame;
  if (!frame || !unobservedFrame) return fn();
  return unobservedFrame.run(frame, fn);
}

export function observeNavigationCommand(key: string): void {
  if (key !== "navigate" && !/^navigate:[A-Za-z0-9_-]{1,96}$/.test(key)) return;
  for (
    let frame = actionExecutionStorage?.getStore()?.frame;
    frame;
    frame = frame.parent
  ) {
    if (frame.outcome) (frame.outcome.navigationKeys ??= new Set()).add(key);
  }
}
