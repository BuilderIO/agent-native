/**
 * Execution frames, and the evidence a dispatcher puts on the frame of the one
 * invocation it vouches for. Not in the package exports: app code cannot hand
 * an invocation an approval or an audit override.
 */
import type { ActionRunContext } from "./action.js";
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
};
export type ActionExecutionFrame = {
  key: object;
  run: ActionExecutionRun;
  parent?: ActionExecutionFrame;
  handlerEntered: boolean;
  descendantWriteEntered: boolean;
  boundaryPending?: boolean;
  evidence?: ActionInvocationEvidence;
  /** The invocation settled; work it left running records none of its evidence. */
  finished?: boolean;
};
export type ActionExecutionState = {
  frame?: ActionExecutionFrame;
  failures: WeakMap<object, ActionExecutionFrame>;
};
const ActionExecutionStorage = getAsyncLocalStorageCtor();
export const actionExecutionStorage = ActionExecutionStorage
  ? new ActionExecutionStorage<ActionExecutionState>()
  : undefined;

/** `runActionWithExecutionOutcome`, for a dispatcher that vouches for the call. */
export async function runInvocationWithOutcome(
  run: ActionExecutionRun,
  args: unknown,
  ctx: ActionRunContext | undefined,
  outcome: { refused: boolean },
  entry?: object,
  evidence?: ActionInvocationEvidence,
): Promise<any> {
  outcome.refused = false;
  // A mutable async stack cannot safely attribute overlapping invocations,
  // so without one no row records this invocation's evidence.
  if (!actionExecutionStorage) return run(args, ctx);
  const parent = actionExecutionStorage.getStore();
  const entryKey = entry
    ? (entry as Record<symbol, unknown>)[ACTION_EXECUTION_KEY]
    : undefined;
  const frame: ActionExecutionFrame = {
    // The entry's own key lets its boundary adopt this frame when an app has
    // wrapped `run`; an unkeyed entry gets a placeholder nothing can match.
    key: entryKey !== null && typeof entryKey === "object" ? entryKey : {},
    run,
    parent: parent?.frame,
    handlerEntered: true,
    descendantWriteEntered: false,
    boundaryPending: true,
    ...(evidence ? { evidence } : {}),
  };
  const state: ActionExecutionState = {
    frame,
    failures: parent?.failures ?? new WeakMap(),
  };
  return actionExecutionStorage.run(state, async () => {
    try {
      return await run(args, ctx);
    } catch (error) {
      const failure =
        error !== null && typeof error === "object"
          ? state.failures.get(error)
          : undefined;
      // Error types cannot prove non-execution once the handler has entered.
      // A keyed entry whose boundary was never entered threw in an app
      // wrapper around `run`, before any handler could start.
      outcome.refused =
        !frame.descendantWriteEntered &&
        ((!frame.handlerEntered && failure === frame) ||
          (frame.key !== undefined &&
            frame.boundaryPending === true &&
            entryKey !== null &&
            typeof entryKey === "object"));
      throw error;
    } finally {
      // A timer or unawaited promise keeps this frame after the call settles.
      frame.finished = true;
    }
  });
}

/** Run one invocation of `entry` in its own frame, as a dispatcher. */
export function runActionInvocation(
  entry: { run: (args: any, ctx?: ActionRunContext) => any },
  args: unknown,
  ctx: ActionRunContext | undefined,
  evidence?: ActionInvocationEvidence,
): Promise<any> {
  return runInvocationWithOutcome(
    entry.run as ActionExecutionRun,
    args,
    ctx,
    { refused: false },
    entry,
    evidence,
  );
}

/** The evidence of the invocation running now, never a caller's or a settled one's. */
export function currentInvocationEvidence():
  | ActionInvocationEvidence
  | undefined {
  const frame = actionExecutionStorage?.getStore()?.frame;
  return frame?.finished ? undefined : frame?.evidence;
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
