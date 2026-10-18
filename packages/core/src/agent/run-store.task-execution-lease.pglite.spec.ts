import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import { withExecutionFence } from "./execution-fence.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => getExecutor(),
}));

function getExecutor(): DbExec {
  return {
    async execute(input) {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await pglite.query(input.sql, input.args ?? []);
      return {
        rows: result.rows,
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
    transaction: pglite.transaction,
  };
}

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: async () => true,
  ensureIndexExists: async () => true,
  ensureTableExists: async () => true,
}));

const {
  beginAgentExecutionStep,
  claimTaskExecutionLease,
  ensureRunTables,
  renewTaskExecutionLease,
} = await import("./run-store.js");

beforeAll(async () => {
  pglite = await createTestPglite();
  await ensureRunTables();
});

afterAll(async () => {
  await pglite?.close();
});

describe("task execution leases", () => {
  it("claims and renews without an agent_runs row, then fences stale generations", async () => {
    const threadId = "a2a-task:lease-test";
    const turnId = "lease-test";
    const firstFence = await claimTaskExecutionLease(
      threadId,
      turnId,
      "a2a:worker-a",
    );

    const owner = await pglite.query("SELECT id FROM agent_runs WHERE id = ?", [
      firstFence.runId,
    ]);
    expect(owner.rows).toHaveLength(0);
    await renewTaskExecutionLease(firstFence);
    await expect(
      claimTaskExecutionLease(threadId, turnId, "a2a:worker-b"),
    ).rejects.toMatchObject({ code: "turn_execution_lease_busy" });

    await pglite.query(
      `UPDATE agent_execution_leases
          SET lease_expires_at = clock_timestamp() - INTERVAL '1 millisecond'
          WHERE thread_id = ? AND turn_id = ?`,
      [threadId, turnId],
    );
    const secondFence = await claimTaskExecutionLease(
      threadId,
      turnId,
      "a2a:worker-b",
    );
    expect(BigInt(secondFence.generation)).toBe(
      BigInt(firstFence.generation) + 1n,
    );

    const staleStep = {
      ...firstFence,
      stepId: "stale-step",
      operationId: "test:step",
      toolName: "test-step",
      inputJson: "{}",
      replayPolicy: "never" as const,
    };
    await expect(
      withExecutionFence(firstFence, () => beginAgentExecutionStep(staleStep)),
    ).rejects.toMatchObject({ code: "stale_execution_fence" });

    const currentStep = {
      ...secondFence,
      stepId: "current-step",
      operationId: "test:step",
      toolName: "test-step",
      inputJson: "{}",
      replayPolicy: "never" as const,
    };
    await expect(
      withExecutionFence(secondFence, () =>
        beginAgentExecutionStep(currentStep),
      ),
    ).resolves.toEqual({ status: "execute", wasDispatched: false });
  });
});
