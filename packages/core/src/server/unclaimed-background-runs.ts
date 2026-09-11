import {
  AGENT_CHAT_BACKGROUND_RUN_FIELD,
  resolveAgentChatProcessRunDispatchPath,
} from "../agent/durable-background.js";
import {
  listUnclaimedBackgroundRunRows,
  reapUnclaimedBackgroundRun,
  shouldRedispatchUnclaimedBackgroundRun,
  UNCLAIMED_BACKGROUND_RUN_SWEEP_BATCH_LIMIT,
  updateRunHeartbeat,
} from "../agent/run-store.js";
import { fireInternalDispatch } from "./self-dispatch.js";

export interface UnclaimedBackgroundRunSweepResult {
  scanned: number;
  attempted: number;
  redispatched: number;
  reaped: number;
  failed: number;
  truncated: boolean;
}

/**
 * Redispatch unclaimed background runs from either a durable scheduler or an
 * in-process backstop. The scheduler also reaps rows outside the bounded
 * redispatch window; the fast backstop passes `reapExpired: false` so it never
 * turns a transient dispatch outage into an early terminal error.
 */
export async function sweepUnclaimedBackgroundRuns(options?: {
  now?: number;
  reapExpired?: boolean;
}): Promise<UnclaimedBackgroundRunSweepResult> {
  const rows = await listUnclaimedBackgroundRunRows({
    limit: UNCLAIMED_BACKGROUND_RUN_SWEEP_BATCH_LIMIT + 1,
  });
  const pending = rows.length > UNCLAIMED_BACKGROUND_RUN_SWEEP_BATCH_LIMIT;
  const result: UnclaimedBackgroundRunSweepResult = {
    scanned: Math.min(rows.length, UNCLAIMED_BACKGROUND_RUN_SWEEP_BATCH_LIMIT),
    attempted: 0,
    redispatched: 0,
    reaped: 0,
    failed: 0,
    truncated: pending,
  };
  for (const row of rows.slice(0, UNCLAIMED_BACKGROUND_RUN_SWEEP_BATCH_LIMIT)) {
    if (
      row.hasDispatchPayload &&
      shouldRedispatchUnclaimedBackgroundRun(row, options?.now)
    ) {
      result.attempted += 1;
      try {
        await updateRunHeartbeat(row.id);
      } catch (error) {
        result.failed += 1;
        console.error(
          "[agent-chat] unclaimed background run heartbeat failed:",
          row.id,
          error instanceof Error ? error.message : error,
        );
      }
      try {
        // This marker intentionally omits continuationCount: the sweep is a
        // chain break and must start the recovered worker at depth zero.
        await fireInternalDispatch({
          path: resolveAgentChatProcessRunDispatchPath(),
          taskId: row.id,
          body: {
            internalContinuation: true,
            [AGENT_CHAT_BACKGROUND_RUN_FIELD]: {
              runId: row.id,
              payloadRef: true,
            },
          },
          awaitResponse: true,
          responseTimeoutMs: 15_000,
        });
        result.redispatched += 1;
        console.error(
          "[agent-chat] redispatched unclaimed background run (handoff recovery):",
          row.id,
        );
      } catch (error) {
        result.failed += 1;
        console.error(
          "[agent-chat] unclaimed background run redispatch attempt failed:",
          row.id,
          error instanceof Error ? error.message : error,
        );
      }
      continue;
    }
    if (!options?.reapExpired) continue;
    try {
      if (await reapUnclaimedBackgroundRun(row.id)) result.reaped += 1;
    } catch (error) {
      result.failed += 1;
      console.error(
        "[agent-chat] unclaimed background run reap failed:",
        row.id,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return result;
}
