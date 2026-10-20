import type { NodeExecutorFor } from "../types.js";

/**
 * Starts the walk. It carries no items: the sources below it start their own
 * lists. What it records is the window this run covers, which `run.windowStart`
 * and `run.windowEnd` read everywhere else.
 */
export const executeTrigger: NodeExecutorFor<"trigger"> = async ({
  ctx,
  step,
}) => {
  step.field("windowStart", ctx.window.start);
  step.field("windowEnd", ctx.window.end);
  step.field("firstRun", ctx.window.firstRun);
  if (ctx.scheduledFor !== null) step.field("scheduledFor", ctx.scheduledFor);
  return { itemsByPort: { out: [] } };
};
