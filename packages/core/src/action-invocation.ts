/**
 * A framework dispatcher's entry for running one action invocation in its own
 * frame. Not in the package exports; the frame and its evidence are in
 * `action-frame.ts`.
 */
import {
  vouchedOutcome,
  type ActionExecutionRun,
  type ActionInvocationEvidence,
} from "./action-frame.js";
import { runActionWithExecutionOutcome } from "./action.js";
import type { ActionRunContext } from "./action.js";

/** Run one invocation of `entry` in its own frame, as a dispatcher. */
export function runActionInvocation(
  entry: { run: (args: any, ctx?: ActionRunContext) => any },
  args: unknown,
  ctx: ActionRunContext | undefined,
  evidence?: ActionInvocationEvidence,
): Promise<any> {
  return runActionWithExecutionOutcome(
    entry.run as ActionExecutionRun,
    args,
    ctx,
    vouchedOutcome({ refused: false }, evidence),
    entry,
  );
}
