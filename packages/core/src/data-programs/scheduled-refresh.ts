import type { SandboxCodeEvaluator } from "../coding-tools/run-code.js";
import {
  registerRecurringSweepHandler,
  type RecurringSweepContext,
} from "../jobs/sweep-hooks.js";
import {
  runScheduledDataProgram,
  scheduledDataProgramDueAt,
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
 * the next, so a slow program doesn't keep the rest waiting. A program whose
 * refresh threw doesn't stop the pass, but the pass then throws, so the sweep
 * reports the handler as failed.
 */
export async function runScheduledDataProgramRefreshes(
  appId: string,
  context: RecurringSweepContext,
  evaluator?: SandboxCodeEvaluator,
): Promise<Record<string, ScheduledRefreshOutcome>> {
  const outcomes: Record<string, ScheduledRefreshOutcome> = {};
  const errors: unknown[] = [];
  const threw: string[] = [];
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
      errors.push(error);
      threw.push(id);
      outcomes[id] = "failed";
    }
    if (outcomes[id] === "no_time") break;
  }
  if (errors.length) {
    throw new AggregateError(
      errors,
      `Scheduled refresh of ${threw.join(", ")} in ${appId} threw.`,
    );
  }
  return outcomes;
}

/**
 * When the app's next scheduled refresh is due, as epoch ms, or `null` when no
 * program has one. An idle app's sweep sleeps until then, so a shared run is
 * still refreshed before it goes stale while nobody uses the app.
 */
export async function nextScheduledDataProgramDueAt(
  appId: string,
  now: number = Date.now(),
): Promise<number | null> {
  let earliest: number | null = null;
  for (const program of await listScheduledDataPrograms(appId)) {
    const dueAt = await scheduledDataProgramDueAt(program, now);
    if (dueAt === null) continue;
    earliest = earliest === null ? dueAt : Math.min(earliest, dueAt);
    if (earliest <= now) break;
  }
  return earliest;
}

export function registerScheduledDataProgramRefresh(appId: string): () => void {
  return registerRecurringSweepHandler(
    `${SCHEDULED_REFRESH_SWEEP_ID}:${appId}`,
    async (context) => {
      await runScheduledDataProgramRefreshes(appId, context);
    },
    { nextDueAt: () => nextScheduledDataProgramDueAt(appId) },
  );
}
