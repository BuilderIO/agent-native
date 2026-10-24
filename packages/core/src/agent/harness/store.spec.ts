import { afterAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";
import { __resetStoreLedgerSnapshotForTests } from "../../db/store-registry.js";

const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql) || /\breturning\b/i.test(input.sql)) {
      const rows = await stmt.all(...args);
      return { rows, rowsAffected: rows.length };
    }
    const result = await stmt.run(...args);
    return { rows: [], rowsAffected: result.changes };
  }),
};

vi.mock("../../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
}));

const {
  claimAgentHarnessSessionFollowUp,
  getAgentHarnessSession,
  markAgentHarnessSessionStopped,
  saveAgentHarnessSession,
  updateAgentHarnessSessionIfFollowUpClaim,
} = await import("./store.js");

describe("agent harness session store", () => {
  it("allows only one follow-up claim for a session generation", async () => {
    __resetStoreLedgerSnapshotForTests();
    await saveAgentHarnessSession({
      id: "session-follow-up-claim",
      harnessName: "fake",
      threadId: "thread-follow-up-claim",
      runId: "run-follow-up-claim",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const stored = await getAgentHarnessSession("session-follow-up-claim");
    expect(stored).not.toBeNull();

    const claimIds = ["claim-a", "claim-b"];
    const claims = await Promise.all([
      claimAgentHarnessSessionFollowUp(
        "session-follow-up-claim",
        stored!.generation,
        claimIds[0]!,
      ),
      claimAgentHarnessSessionFollowUp(
        "session-follow-up-claim",
        stored!.generation,
        claimIds[1]!,
      ),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    const claimed = await getAgentHarnessSession("session-follow-up-claim");
    expect(claimed).toMatchObject({
      status: "running",
      generation: stored!.generation + 1,
    });
    expect(claimIds).toContain(claimed!.followUpClaimId);
    await expect(
      updateAgentHarnessSessionIfFollowUpClaim(
        "session-follow-up-claim",
        "stale-claim",
        { status: "errored" },
      ),
    ).resolves.toBeNull();
    await expect(
      getAgentHarnessSession("session-follow-up-claim"),
    ).resolves.toMatchObject({
      status: "running",
      followUpClaimId: claimed!.followUpClaimId,
    });
    await updateAgentHarnessSessionIfFollowUpClaim(
      "session-follow-up-claim",
      claimed!.followUpClaimId!,
      { status: "idle", followUpClaimId: null },
    );
    await expect(
      getAgentHarnessSession("session-follow-up-claim"),
    ).resolves.toMatchObject({ status: "idle", followUpClaimId: null });
  });

  it("returns the existing claim when admission is retried after commit", async () => {
    await saveAgentHarnessSession({
      id: "session-follow-up-claim-retry",
      harnessName: "fake",
      threadId: "thread-follow-up-claim-retry",
      runId: "run-follow-up-claim-retry",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const before = await getAgentHarnessSession(
      "session-follow-up-claim-retry",
    );

    const first = await claimAgentHarnessSessionFollowUp(
      "session-follow-up-claim-retry",
      before!.generation,
      "retryable-claim",
    );
    const retried = await claimAgentHarnessSessionFollowUp(
      "session-follow-up-claim-retry",
      before!.generation,
      "retryable-claim",
    );

    expect(retried).toEqual(first);
    expect(retried).toMatchObject({
      status: "running",
      followUpClaimId: "retryable-claim",
      generation: before!.generation + 1,
    });
  });

  it("retries a claim-fenced update after the same claim advances generation", async () => {
    const id = "session-follow-up-update-retry";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-follow-up-update-retry",
      runId: "run-follow-up-update-retry",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const before = await getAgentHarnessSession(id);
    const claimed = await claimAgentHarnessSessionFollowUp(
      id,
      before!.generation,
      "same-claim",
    );
    const execute = rawClient.execute.getMockImplementation()!;
    let generationBumped = false;
    rawClient.execute.mockImplementation(async (input) => {
      const result = await execute(input);
      if (
        !generationBumped &&
        typeof input !== "string" &&
        input.sql === "SELECT * FROM agent_harness_sessions WHERE id = ?" &&
        input.args?.[0] === id
      ) {
        generationBumped = true;
        await pglite.exec(
          `UPDATE agent_harness_sessions SET generation = generation + 1 WHERE id = '${id}'`,
        );
      }
      return result;
    });

    try {
      const updated = await updateAgentHarnessSessionIfFollowUpClaim(
        id,
        "same-claim",
        { pendingApproval: { type: "approval-request", id: "approval-1" } },
      );

      expect(generationBumped).toBe(true);
      expect(updated).toMatchObject({
        status: "running",
        followUpClaimId: "same-claim",
        pendingApproval: { id: "approval-1" },
        generation: claimed!.generation + 2,
      });
    } finally {
      rawClient.execute.mockImplementation(execute);
    }
  });

  it("does not claim a session while it has a pending approval", async () => {
    await saveAgentHarnessSession({
      id: "session-pending-approval",
      harnessName: "fake",
      threadId: "thread-pending-approval",
      runId: "run-pending-approval",
      status: "idle",
      pendingApproval: { type: "approval-request", id: "approval-1" },
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const stored = await getAgentHarnessSession("session-pending-approval");
    expect(stored).not.toBeNull();

    await expect(
      claimAgentHarnessSessionFollowUp(
        "session-pending-approval",
        stored!.generation,
        "claim-pending-approval",
      ),
    ).resolves.toBeNull();
    await expect(
      getAgentHarnessSession("session-pending-approval"),
    ).resolves.toMatchObject({
      status: "idle",
      pendingApproval: expect.any(Object),
    });
  });

  it("publishes a durable stop by clearing the active follow-up claim", async () => {
    await saveAgentHarnessSession({
      id: "session-follow-up-stop",
      harnessName: "fake",
      threadId: "thread-follow-up-stop",
      runId: "run-follow-up-stop",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const stored = await getAgentHarnessSession("session-follow-up-stop");
    await claimAgentHarnessSessionFollowUp(
      "session-follow-up-stop",
      stored!.generation,
      "claim-to-stop",
    );

    await markAgentHarnessSessionStopped("session-follow-up-stop", "stopped");

    await expect(
      getAgentHarnessSession("session-follow-up-stop"),
    ).resolves.toMatchObject({
      status: "stopped",
      followUpClaimId: null,
    });
  });
});
