import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  StaleExecutionFenceError,
  withExecutionFence,
  withFencedExecutionWrite,
  type ExecutionFence,
} from "../agent/execution-fence.js";
import { claimTaskExecutionLease } from "../agent/run-store.js";
import { closeDbExec, getDbExec, withDbExec } from "../db/client.js";
import {
  claimAgentTeamRun,
  completeAgentTeamRun,
  enqueueAgentTeamRun,
  getAgentTeamRunDispatchState,
  withCurrentAgentTeamRunAttempt,
} from "./agent-teams-run-queue.js";

let previousDatabaseUrl: string | undefined;

beforeAll(async () => {
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "pglite:memory";
  await closeDbExec();
  await getDbExec().execute(
    "CREATE TABLE review_results (task_id TEXT PRIMARY KEY, result TEXT NOT NULL)",
  );
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

async function taskAttempt(taskId: string) {
  const threadId = `thread-${taskId}`;
  const turnId = `turn-${taskId}`;
  const runId = `run-${taskId}`;
  await enqueueAgentTeamRun({
    taskId,
    threadId,
    runId,
    payload: { description: "Read-only email review", turnId },
  });
  const claimed = await claimAgentTeamRun(taskId);
  if (!claimed) throw new Error("Task attempt was not claimed");
  const fence = await claimTaskExecutionLease(threadId, turnId, runId);
  return { attempts: claimed.attempts, fence };
}

function saveResult(taskId: string, fence: ExecutionFence) {
  return withFencedExecutionWrite(
    (tx) =>
      tx.execute({
        sql: "INSERT INTO review_results (task_id, result) VALUES (?, ?)",
        args: [taskId, "Reviewed the current email"],
      }),
    { threadId: fence.threadId },
  );
}

async function results(taskId: string) {
  return (
    await getDbExec().execute({
      sql: "SELECT result FROM review_results WHERE task_id = ?",
      args: [taskId],
    })
  ).rows;
}

describe("fenced writes inside an Agent Teams attempt transaction", () => {
  it("commits the result and terminal task state together", async () => {
    const taskId = "review-commit";
    const { attempts, fence } = await taskAttempt(taskId);
    const outcome = await withExecutionFence(fence, () =>
      withCurrentAgentTeamRunAttempt(taskId, attempts, async () => {
        await saveResult(taskId, fence);
        return completeAgentTeamRun(taskId, "done", attempts);
      }),
    );
    expect(outcome).toEqual({ current: true, value: true });
    expect(await results(taskId)).toEqual([
      { result: "Reviewed the current email" },
    ]);
    expect((await getAgentTeamRunDispatchState(taskId))?.status).toBe("done");
  });

  it("rolls back the result and terminal state when the caller fails", async () => {
    const taskId = "review-rollback";
    const { attempts, fence } = await taskAttempt(taskId);
    await expect(
      withExecutionFence(fence, () =>
        withCurrentAgentTeamRunAttempt(taskId, attempts, async () => {
          await saveResult(taskId, fence);
          await completeAgentTeamRun(taskId, "done", attempts);
          throw new Error("Result projection failed");
        }),
      ),
    ).rejects.toThrow("Result projection failed");
    expect(await results(taskId)).toEqual([]);
    expect((await getAgentTeamRunDispatchState(taskId))?.status).toBe(
      "running",
    );
  });

  it("checks every inherited fence before reusing the transaction", async () => {
    const taskId = "review-stale-parent";
    const { attempts, fence } = await taskAttempt(taskId);
    const parent = await claimTaskExecutionLease(
      "parent-thread",
      "parent-turn",
      "parent-run",
    );
    await getDbExec().execute({
      sql: "UPDATE agent_execution_leases SET lease_expires_at = clock_timestamp() - INTERVAL '1 millisecond' WHERE thread_id = ? AND turn_id = ?",
      args: [parent.threadId, parent.turnId],
    });
    await claimTaskExecutionLease(
      "parent-thread",
      "parent-turn",
      "new-parent-run",
    );
    await expect(
      withExecutionFence(parent, () =>
        withExecutionFence(fence, () =>
          withCurrentAgentTeamRunAttempt(taskId, attempts, () =>
            saveResult(taskId, fence),
          ),
        ),
      ),
    ).rejects.toBeInstanceOf(StaleExecutionFenceError);
    expect(await results(taskId)).toEqual([]);
  });

  it("does not borrow an active transaction for an unrelated scoped executor", async () => {
    const taskId = "review-unrelated-scope";
    const { fence } = await taskAttempt(taskId);
    let queries = 0;
    await getDbExec().transaction!(async () => {
      await expect(
        withDbExec(
          {
            execute: async () => {
              queries += 1;
              return { rows: [], rowsAffected: 0 };
            },
          },
          () => withExecutionFence(fence, () => saveResult(taskId, fence)),
        ),
      ).rejects.toThrow("Fenced execution writes require transaction support");
    });
    expect(queries).toBe(0);
    expect(await results(taskId)).toEqual([]);
  });

  it("does not reuse a scoped transaction after its callback has settled", async () => {
    const taskId = "review-detached";
    const { fence } = await taskAttempt(taskId);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let detached!: Promise<unknown>;
    await getDbExec().transaction!(async (tx) => {
      withDbExec(tx, () => {
        detached = gate.then(() =>
          withExecutionFence(fence, () => saveResult(taskId, fence)),
        );
      });
    });
    release();
    await expect(detached).rejects.toThrow(
      "Fenced execution writes require transaction support",
    );
    expect(await results(taskId)).toEqual([]);
  });
});
