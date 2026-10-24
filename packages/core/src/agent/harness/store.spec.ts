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
  transaction: pglite.transaction,
};

vi.mock("../../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
}));

const {
  claimAgentHarnessSessionFollowUp,
  getAgentHarnessSession,
  markAgentHarnessSessionStopped,
  markAgentHarnessSessionStoppedIfUnclaimed,
  saveAgentHarnessSession,
  startAgentHarnessSessionApprovalDispatch,
  startAgentHarnessSessionExpiryCleanup,
  startAgentHarnessSessionFollowUpDispatch,
  updateAgentHarnessSessionAtGeneration,
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

  it("starts provider work under the row lock before a concurrent stop", async () => {
    const id = "session-follow-up-dispatch-admission";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-follow-up-dispatch-admission",
      runId: "run-follow-up-dispatch-admission",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const claimed = await claimAgentHarnessSessionFollowUp(
      id,
      initial!.generation,
      "dispatch-claim",
    );

    let releaseCommit!: () => void;
    let notifyStart!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const providerStarted = new Promise<void>((resolve) => {
      notifyStart = resolve;
    });
    const originalTransaction = rawClient.transaction;
    rawClient.transaction = async (run) =>
      pglite.transaction(async (tx) => {
        const result = await run(tx);
        await commitGate;
        return result;
      });
    const order: string[] = [];
    let stopFinished = false;
    try {
      const dispatch = startAgentHarnessSessionFollowUpDispatch(
        id,
        claimed!.generation,
        "dispatch-claim",
        () => {
          order.push("provider-start");
          notifyStart();
        },
      );
      await providerStarted;
      const stop = markAgentHarnessSessionStopped(id, "stopped").then(
        (session) => {
          order.push("stop-complete");
          stopFinished = true;
          return session;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(stopFinished).toBe(false);
      releaseCommit();

      const admitted = await dispatch;
      await stop;
      expect(admitted?.session).toMatchObject({
        status: "running",
        followUpClaimId: "dispatch-claim",
        generation: claimed!.generation + 1,
      });
      expect(order).toEqual(["provider-start", "stop-complete"]);
    } finally {
      releaseCommit();
      rawClient.transaction = originalTransaction;
    }

    await expect(getAgentHarnessSession(id)).resolves.toMatchObject({
      status: "stopped",
      followUpClaimId: null,
    });
  });

  it("does not start provider work after a durable stop wins the row lock", async () => {
    const id = "session-follow-up-stop-wins-start";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-follow-up-stop-wins-start",
      runId: "run-follow-up-stop-wins-start",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const claimed = await claimAgentHarnessSessionFollowUp(
      id,
      initial!.generation,
      "stop-wins-claim",
    );
    await markAgentHarnessSessionStopped(id, "stopped");
    const start = vi.fn();

    await expect(
      startAgentHarnessSessionFollowUpDispatch(
        id,
        claimed!.generation,
        "stop-wins-claim",
        start,
      ),
    ).resolves.toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it("starts approval dispatch under the row lock before a concurrent stop", async () => {
    const id = "session-approval-dispatch-admission";
    const approvalId = "approval-dispatch-admission";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-approval-dispatch-admission",
      runId: "run-approval-dispatch-admission",
      status: "idle",
      pendingApproval: { type: "approval-request", id: approvalId },
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const reserved = await updateAgentHarnessSessionAtGeneration(
      id,
      "idle",
      initial!.generation,
      { approvalResolutionId: approvalId },
    );

    let releaseCommit!: () => void;
    let notifyStart!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const providerStarted = new Promise<void>((resolve) => {
      notifyStart = resolve;
    });
    const originalTransaction = rawClient.transaction;
    rawClient.transaction = async (run) =>
      pglite.transaction(async (tx) => {
        const result = await run(tx);
        await commitGate;
        return result;
      });
    const order: string[] = [];
    let stopFinished = false;
    try {
      const dispatch = startAgentHarnessSessionApprovalDispatch(
        id,
        "idle",
        reserved!.generation,
        approvalId,
        () => {
          order.push("provider-start");
          notifyStart();
        },
      );
      await providerStarted;
      const stop = markAgentHarnessSessionStopped(id, "stopped").then(
        (session) => {
          order.push("stop-complete");
          stopFinished = true;
          return session;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(stopFinished).toBe(false);
      releaseCommit();

      const admitted = await dispatch;
      await stop;
      expect(admitted?.session).toMatchObject({
        status: "idle",
        approvalResolutionId: approvalId,
        generation: reserved!.generation + 1,
      });
      expect(order).toEqual(["provider-start", "stop-complete"]);
    } finally {
      releaseCommit();
      rawClient.transaction = originalTransaction;
    }

    await expect(getAgentHarnessSession(id)).resolves.toMatchObject({
      status: "stopped",
      approvalResolutionId: null,
    });
  });

  it("does not start approval dispatch after a durable stop wins the row lock", async () => {
    const id = "session-approval-stop-wins-start";
    const approvalId = "approval-stop-wins-start";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-approval-stop-wins-start",
      runId: "run-approval-stop-wins-start",
      status: "idle",
      pendingApproval: { type: "approval-request", id: approvalId },
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const reserved = await updateAgentHarnessSessionAtGeneration(
      id,
      "idle",
      initial!.generation,
      { approvalResolutionId: approvalId },
    );
    await markAgentHarnessSessionStopped(id, "stopped");
    const start = vi.fn();

    await expect(
      startAgentHarnessSessionApprovalDispatch(
        id,
        "idle",
        reserved!.generation,
        approvalId,
        start,
      ),
    ).resolves.toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it("starts expiry cleanup under the row lock before a concurrent follow-up claim", async () => {
    const id = "session-expiry-cleanup-admission";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-expiry-cleanup-admission",
      runId: "run-expiry-cleanup-admission",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);

    let releaseCommit!: () => void;
    let notifyStart!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const cleanupStarted = new Promise<void>((resolve) => {
      notifyStart = resolve;
    });
    const originalTransaction = rawClient.transaction;
    rawClient.transaction = async (run) =>
      pglite.transaction(async (tx) => {
        const result = await run(tx);
        await commitGate;
        return result;
      });
    try {
      let claimFinished = false;
      const cleanup = startAgentHarnessSessionExpiryCleanup(
        id,
        "idle",
        initial!.generation,
        () => {
          notifyStart();
        },
      );
      await cleanupStarted;
      const claim = claimAgentHarnessSessionFollowUp(
        id,
        initial!.generation,
        "follow-up-during-expiry-cleanup",
      ).then((result) => {
        claimFinished = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(claimFinished).toBe(false);
      releaseCommit();

      const admitted = await cleanup;
      expect(admitted?.session.generation).toBe(initial!.generation + 1);
      await expect(claim).resolves.toBeNull();
    } finally {
      releaseCommit();
      rawClient.transaction = originalTransaction;
    }
  });

  it("does not start expiry cleanup after a follow-up claim wins", async () => {
    const id = "session-follow-up-wins-expiry-cleanup";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-follow-up-wins-expiry-cleanup",
      runId: "run-follow-up-wins-expiry-cleanup",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const claimed = await claimAgentHarnessSessionFollowUp(
      id,
      initial!.generation,
      "follow-up-wins-expiry-cleanup",
    );
    const start = vi.fn();

    await expect(
      startAgentHarnessSessionExpiryCleanup(
        id,
        "running",
        claimed!.generation,
        start,
      ),
    ).resolves.toBeNull();
    expect(start).not.toHaveBeenCalled();
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

  it("recomputes a claim-fenced update from the latest row after a generation conflict", async () => {
    const id = "session-follow-up-approval-race";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-follow-up-approval-race",
      runId: "run-follow-up-approval-race",
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
    await saveAgentHarnessSession({
      id,
      harnessName: claimed!.harnessName,
      threadId: claimed!.threadId,
      runId: claimed!.runId,
      status: "running",
      pendingApproval: { type: "approval-request", id: "approval-1" },
      followUpClaimId: "same-claim",
      expectedGeneration: claimed!.generation,
      existingSession: claimed!,
    });

    const execute = rawClient.execute.getMockImplementation()!;
    let resolutionApplied = false;
    rawClient.execute.mockImplementation(async (input) => {
      const result = await execute(input);
      if (
        !resolutionApplied &&
        typeof input !== "string" &&
        input.sql === "SELECT * FROM agent_harness_sessions WHERE id = ?" &&
        input.args?.[0] === id
      ) {
        resolutionApplied = true;
        await pglite
          .prepare(
            `UPDATE agent_harness_sessions
             SET pending_approval = NULL, resolved_approval_ids = ?,
                 generation = generation + 1
             WHERE id = ?`,
          )
          .run(JSON.stringify(["approval-1"]), id);
      }
      return result;
    });

    try {
      const updated = await updateAgentHarnessSessionIfFollowUpClaim(
        id,
        "same-claim",
        (current) => ({
          status: "idle",
          pendingApproval:
            current.pendingApproval &&
            !current.resolvedApprovalIds?.includes("approval-1")
              ? current.pendingApproval
              : null,
          followUpClaimId: null,
        }),
      );

      expect(resolutionApplied).toBe(true);
      expect(updated).toMatchObject({
        status: "idle",
        pendingApproval: null,
        resolvedApprovalIds: ["approval-1"],
        followUpClaimId: null,
      });
    } finally {
      rawClient.execute.mockImplementation(execute);
    }
  });

  it("recomputes claim-fenced updates after a concurrent approval resolution", async () => {
    const id = "session-follow-up-approval-conflict";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-follow-up-approval-conflict",
      runId: "run-follow-up-approval-conflict",
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
    await saveAgentHarnessSession({
      id,
      harnessName: claimed!.harnessName,
      threadId: claimed!.threadId,
      runId: claimed!.runId,
      status: "running",
      pendingApproval: { type: "approval-request", id: "approval-1" },
      followUpClaimId: "same-claim",
      expectedGeneration: claimed!.generation,
      existingSession: claimed!,
    });

    const execute = rawClient.execute.getMockImplementation()!;
    let resolutionApplied = false;
    rawClient.execute.mockImplementation(async (input) => {
      const result = await execute(input);
      if (
        !resolutionApplied &&
        typeof input !== "string" &&
        input.sql === "SELECT * FROM agent_harness_sessions WHERE id = ?" &&
        input.args?.[0] === id
      ) {
        resolutionApplied = true;
        await pglite
          .prepare(
            `UPDATE agent_harness_sessions
             SET pending_approval = NULL, resolved_approval_ids = ?,
                 generation = generation + 1
             WHERE id = ?`,
          )
          .run(JSON.stringify(["approval-1"]), id);
      }
      return result;
    });

    const snapshots: Array<{
      pendingApproval: unknown;
      resolvedApprovalIds: string[];
    }> = [];
    try {
      const updated = await updateAgentHarnessSessionIfFollowUpClaim(
        id,
        "same-claim",
        (current) => {
          snapshots.push({
            pendingApproval: current.pendingApproval,
            resolvedApprovalIds: current.resolvedApprovalIds ?? [],
          });
          const pending = current.pendingApproval as { id?: string } | null;
          return {
            status: "idle",
            pendingApproval:
              pending &&
              !current.resolvedApprovalIds?.includes(pending.id ?? "")
                ? current.pendingApproval
                : null,
            followUpClaimId: null,
          };
        },
      );

      expect(resolutionApplied).toBe(true);
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0]).toMatchObject({
        pendingApproval: { id: "approval-1" },
        resolvedApprovalIds: [],
      });
      expect(snapshots[1]).toMatchObject({
        pendingApproval: undefined,
        resolvedApprovalIds: ["approval-1"],
      });
      expect(updated).toMatchObject({
        status: "idle",
        pendingApproval: null,
        resolvedApprovalIds: ["approval-1"],
        followUpClaimId: null,
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

  it("does not expire a session after another worker claims a follow-up", async () => {
    const id = "session-expired-follow-up-claim";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-expired-follow-up-claim",
      runId: "run-expired-follow-up-claim",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const claimed = await claimAgentHarnessSessionFollowUp(
      id,
      initial!.generation,
      "new-worker-claim",
    );

    await expect(
      markAgentHarnessSessionStoppedIfUnclaimed(
        id,
        "idle",
        initial!.generation,
        "stopped",
      ),
    ).resolves.toBeNull();
    await expect(
      markAgentHarnessSessionStoppedIfUnclaimed(
        id,
        "running",
        claimed!.generation,
        "stopped",
      ),
    ).resolves.toBeNull();
    await expect(getAgentHarnessSession(id)).resolves.toMatchObject({
      status: "running",
      followUpClaimId: "new-worker-claim",
      generation: claimed!.generation,
    });
  });

  it("uses generation fencing for approval expiry without retaining stale claims", async () => {
    const id = "session-expired-approval-resolution";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-expired-approval-resolution",
      runId: "run-expired-approval-resolution",
      status: "idle",
      pendingApproval: { id: "approval-in-progress" },
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const resolving = await updateAgentHarnessSessionAtGeneration(
      id,
      "idle",
      initial!.generation,
      { approvalResolutionId: "approval-in-progress" },
    );

    await expect(
      markAgentHarnessSessionStoppedIfUnclaimed(
        id,
        "idle",
        initial!.generation,
        "stopped",
      ),
    ).resolves.toBeNull();

    await expect(
      markAgentHarnessSessionStoppedIfUnclaimed(
        id,
        "idle",
        resolving!.generation,
        "stopped",
      ),
    ).resolves.toMatchObject({
      status: "stopped",
      approvalResolutionId: null,
    });
  });

  it("stops the session even after a concurrent generation advance", async () => {
    const id = "session-follow-up-stop-race";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-follow-up-stop-race",
      runId: "run-follow-up-stop-race",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const stored = await getAgentHarnessSession(id);
    const claimed = await claimAgentHarnessSessionFollowUp(
      id,
      stored!.generation,
      "claim-to-stop-after-race",
    );
    const execute = rawClient.execute.getMockImplementation()!;
    let generationAdvanced = false;
    rawClient.execute.mockImplementation(async (input) => {
      if (
        !generationAdvanced &&
        typeof input !== "string" &&
        input.sql.includes("SET status = ?, stopped_at = ?")
      ) {
        generationAdvanced = true;
        await pglite.exec(
          `UPDATE agent_harness_sessions SET generation = generation + 1 WHERE id = '${id}'`,
        );
      }
      return execute(input);
    });

    try {
      const stopped = await markAgentHarnessSessionStopped(id, "stopped");

      expect(generationAdvanced).toBe(true);
      expect(stopped).toMatchObject({
        status: "stopped",
        followUpClaimId: null,
        generation: claimed!.generation + 2,
      });
    } finally {
      rawClient.execute.mockImplementation(execute);
    }
  });
});
