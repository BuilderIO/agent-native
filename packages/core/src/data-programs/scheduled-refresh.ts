import type { SandboxCodeEvaluator } from "../coding-tools/run-code.js";
import {
  registerRecurringSweepHandler,
  type RecurringSweepContext,
} from "../jobs/sweep-hooks.js";
import {
  runScheduledDataProgram,
  type ScheduledRefreshOutcome,
} from "./execute.js";
import { listScheduledDataPrograms } from "./store.js";

export const SCHEDULED_REFRESH_SWEEP_ID = "data-program-scheduled-refresh";

const SWEEP_RESERVE_MS = 5_000;

/**
 * One pass over the app's programs with a scheduled refresh, refreshing each
 * that's due until the sweep's time runs out. Each program is read again just
 * before its turn, so one saved, archived or switched off while an earlier one
 * ran is refreshed as it is now. A program refreshed on one pass isn't due on
 * the next, so a slow program doesn't keep the rest waiting.
 */
export async function runScheduledDataProgramRefreshes(
  appId: string,
  context: RecurringSweepContext,
  evaluator?: SandboxCodeEvaluator,
): Promise<Record<string, ScheduledRefreshOutcome>> {
  const outcomes: Record<string, ScheduledRefreshOutcome> = {};
  const deadline = context.deadlineAt - SWEEP_RESERVE_MS;
  for (const { id } of await listScheduledDataPrograms(appId)) {
    if (context.signal?.aborted || Date.now() >= deadline) break;
    try {
      const program = (await listScheduledDataPrograms(appId, id)).find(
        (p) => p.id === id,
      );
      outcomes[id] = program
        ? await runScheduledDataProgram(program, {
            deadline,
            ...(context.signal ? { signal: context.signal } : {}),
            ...(evaluator ? { evaluator } : {}),
          })
        : "skipped";
    } catch (error) {
      console.error(
        `[data-programs] scheduled refresh of ${id} failed:`,
        error,
      );
      outcomes[id] = "failed";
    }
    if (outcomes[id] === "no_time") break;
  }
  return outcomes;
}

export function registerScheduledDataProgramRefresh(appId: string): () => void {
  return registerRecurringSweepHandler(
    `${SCHEDULED_REFRESH_SWEEP_ID}:${appId}`,
    async (context) => {
      await runScheduledDataProgramRefreshes(appId, context);
    },
  );
}
