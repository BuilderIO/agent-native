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
  claimAgentHarnessSessionApprovalResolution,
  claimAgentHarnessSessionFollowUp: claimAgentHarnessSessionFollowUpInStore,
  finalizeAgentHarnessSessionApprovalResolution,
  failAgentHarnessSessionApprovalResolution,
  finishAgentHarnessSessionExpiryCleanup,
  failAgentHarnessSessionFollowUp,
  getAgentHarnessSession,
  listAgentHarnessSessionEvents,
  listExpiredAgentHarnessApprovalResolutions,
  listExpiredAgentHarnessFollowUps,
  markAgentHarnessSessionFollowUpDispatched,
  markAgentHarnessSessionStopped,
  markAgentHarnessSessionStoppedIfUnclaimed,
  persistAgentHarnessApprovalEvent,
  persistAgentHarnessFollowUpEvent,
  reconcileExpiredAgentHarnessFollowUp,
  reconcileExpiredAgentHarnessApprovalResolution,
  renewAgentHarnessSessionApprovalResolutionClaim,
  renewAgentHarnessSessionFollowUpClaim,
  saveAgentHarnessSession,
  startAgentHarnessSessionApprovalDispatch,
  startAgentHarnessSessionExpiryCleanup,
  startAgentHarnessSessionFollowUpDispatch,
  updateAgentHarnessSessionAtGeneration,
  updateAgentHarnessSessionIfFollowUpClaim,
} = await import("./store.js");

function claimAgentHarnessSessionFollowUp(
  id: string,
  expectedGeneration: number,
  claimId: string,
) {
  const now = Date.now();
  return claimAgentHarnessSessionFollowUpInStore(
    id,
    expectedGeneration,
    claimId,
    {
      followUpId: claimId,
      prompt: `Follow-up ${claimId}`,
      claimExpiresAt: now + 60_000,
      deadlineAt: now + 24 * 60 * 60 * 1_000,
    },
  );
}

describe("agent harness session store", () => {
  it("indexes run ID lookup used by the transcript order trigger", async () => {
    __resetStoreLedgerSnapshotForTests();
    await saveAgentHarnessSession({
      id: "session-run-id-index",
      harnessName: "fake",
      threadId: "thread-run-id-index",
      runId: "run-run-id-index",
      status: "idle",
    });

    const { rows } = await rawClient.execute({
      sql: "SELECT indexdef FROM pg_indexes WHERE indexname = ?",
      args: ["agent_harness_sessions_run_id_idx"],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain("(run_id, id)");
  });

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

  it("persists follow-up intent before dispatch and records dispatched outcomes as unknown after recovery", async () => {
    const id = "session-follow-up-recovery-dispatched";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-follow-up-recovery-dispatched",
      runId: "run-follow-up-recovery-dispatched",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const now = Date.now();
    const claim = await claimAgentHarnessSessionFollowUpInStore(
      id,
      initial!.generation,
      "claim-dispatched",
      {
        followUpId: "follow-up-dispatched",
        prompt:
          "/workspace/project/packages/core/src/agent/harness/store.ts 123e4567-e89b-12d3-a456-426614174000",
        claimExpiresAt: now + 60_000,
        deadlineAt: now + 24 * 60 * 60 * 1_000,
      },
    );

    expect(claim).toMatchObject({
      status: "running",
      followUpId: "follow-up-dispatched",
      followUpPromptPresent: true,
      followUpClaimId: "claim-dispatched",
    });
    const { rows: promptRows } = await rawClient.execute({
      sql: "SELECT follow_up_prompt FROM agent_harness_sessions WHERE id = ?",
      args: [id],
    });
    expect(promptRows[0]?.follow_up_prompt).toBe("present");
    await expect(listAgentHarnessSessionEvents(id)).resolves.toMatchObject([
      {
        operationId: "follow-up:follow-up-dispatched",
        seq: 0,
        event: {
          type: "user_input",
          text: "/workspace/project/packages/core/src/agent/harness/store.ts 123e4567-e89b-12d3-a456-426614174000",
        },
      },
    ]);

    const dispatched = await markAgentHarnessSessionFollowUpDispatched(
      id,
      claim!.generation,
      "claim-dispatched",
      now + 1,
    );
    expect(dispatched?.followUpDispatchedAt).toBe(now + 1);
    await persistAgentHarnessFollowUpEvent(
      id,
      "follow-up-dispatched",
      "claim-dispatched",
      { type: "text", text: "Provider response" },
      now + 2,
    );
    const expiredAt = Date.now() - 1;
    await pglite
      .prepare(
        "UPDATE agent_harness_sessions SET follow_up_claim_expires_at = ? WHERE id = ?",
      )
      .run(expiredAt, id);

    const recovered = await reconcileExpiredAgentHarnessFollowUp(
      id,
      "claim-dispatched",
      dispatched!.generation,
      Date.now(),
    );
    expect(recovered).toMatchObject({
      status: "idle",
      followUpClaimId: null,
      followUpOutcome: "unknown",
    });
    const transcript = await listAgentHarnessSessionEvents(id);
    expect(transcript.map((entry) => entry.event)).toEqual([
      {
        type: "user_input",
        text: "/workspace/project/packages/core/src/agent/harness/store.ts 123e4567-e89b-12d3-a456-426614174000",
      },
      { type: "text", text: "Provider response" },
      expect.objectContaining({
        type: "error",
        errorCode: "harness_follow_up_outcome_unknown",
      }),
    ]);
    expect(
      transcript.filter((entry) => entry.event.type === "text"),
    ).toHaveLength(1);
    expect(
      transcript.filter((entry) => entry.event.type === "user_input"),
    ).toHaveLength(1);
  });

  it("journals a typed failure when follow-up admission is not dispatched", async () => {
    const id = "session-follow-up-not-dispatched";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-follow-up-not-dispatched",
      runId: "run-follow-up-not-dispatched",
      status: "idle",
    });
    const initial = await getAgentHarnessSession(id);
    const claimed = await claimAgentHarnessSessionFollowUp(
      id,
      initial!.generation,
      "claim-not-dispatched",
    );

    const failed = await failAgentHarnessSessionFollowUp({
      sessionId: id,
      claimId: "claim-not-dispatched",
      outcome: "not_dispatched",
    });

    expect(failed).toMatchObject({
      status: "idle",
      followUpClaimId: null,
      followUpOutcome: "not_dispatched",
    });
    expect(claimed).not.toBeNull();
    await expect(listAgentHarnessSessionEvents(id)).resolves.toMatchObject([
      { event: { type: "user_input", text: "Follow-up claim-not-dispatched" } },
      {
        event: {
          type: "error",
          errorCode: "harness_follow_up_not_dispatched",
        },
      },
    ]);
  });

  it("keeps a persisted provider error and atomically releases a failed follow-up", async () => {
    const id = "session-follow-up-provider-error";
    const followUpId = "follow-up-provider-error";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-follow-up-provider-error",
      runId: "run-follow-up-provider-error",
      status: "idle",
    });
    const initial = await getAgentHarnessSession(id);
    await claimAgentHarnessSessionFollowUpInStore(
      id,
      initial!.generation,
      "claim-provider-error",
      {
        followUpId,
        prompt: "continue",
        claimExpiresAt: Date.now() + 60_000,
        deadlineAt: Date.now() + 60_000,
      },
    );
    await persistAgentHarnessFollowUpEvent(
      id,
      followUpId,
      "claim-provider-error",
      {
        type: "error",
        error: "provider returned an error",
        errorCode: "provider_error",
      },
    );

    const failed = await failAgentHarnessSessionFollowUp({
      sessionId: id,
      claimId: "claim-provider-error",
      outcome: "unknown",
    });

    expect(failed).toMatchObject({
      status: "errored",
      followUpClaimId: null,
      followUpOutcome: "unknown",
    });
    await expect(listAgentHarnessSessionEvents(id)).resolves.toMatchObject([
      { event: { type: "user_input", text: "continue" } },
      {
        event: {
          type: "error",
          error: "provider returned an error",
          errorCode: "provider_error",
        },
      },
    ]);
  });

  it("keeps long journal text replayable while redacting embedded credentials", async () => {
    const id = "session-long-journal-text";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-long-journal-text",
      runId: "run-long-journal-text",
      status: "idle",
    });
    const initial = await getAgentHarnessSession(id);
    const claim = await claimAgentHarnessSessionFollowUp(
      id,
      initial!.generation,
      "claim-long-journal-text",
    );
    const longText = `${"x".repeat(12_000)} Authorization: Bearer example-secret-value`;
    await persistAgentHarnessFollowUpEvent(
      id,
      "claim-long-journal-text",
      "claim-long-journal-text",
      { type: "text", text: longText },
    );

    const events = await listAgentHarnessSessionEvents(id);
    expect(claim).not.toBeNull();
    expect(events[1]?.event).toEqual({
      type: "text",
      text: `${"x".repeat(12_000)} Authorization: Bearer [redacted]`,
    });
  });

  it("truncates oversized tool payloads without failing transcript persistence", async () => {
    const id = "session-oversized-tool-payload";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-oversized-tool-payload",
      runId: "run-oversized-tool-payload",
      status: "idle",
    });
    const initial = await getAgentHarnessSession(id);
    await claimAgentHarnessSessionFollowUpInStore(
      id,
      initial!.generation,
      "claim-oversized-tool-payload",
      {
        followUpId: "follow-up-oversized-tool-payload",
        prompt: "continue",
        claimExpiresAt: Date.now() + 60_000,
        deadlineAt: Date.now() + 60_000,
      },
    );

    await expect(
      persistAgentHarnessFollowUpEvent(
        id,
        "follow-up-oversized-tool-payload",
        "claim-oversized-tool-payload",
        {
          type: "tool_done",
          tool: "mcp.create",
          result: "completed",
          input: { destination: "document-1" },
          mcpApp: {
            serverId: "server-1",
            toolName: "create",
            originalToolName: "create",
            resourceUri: "resource://document-1",
            toolInput: {},
            toolResult: { content: "x".repeat(600 * 1024) },
          },
        },
      ),
    ).resolves.toBeUndefined();
    await expect(
      persistAgentHarnessFollowUpEvent(
        id,
        "follow-up-oversized-tool-payload",
        "claim-oversized-tool-payload",
        {
          type: "tool_done",
          tool: "mcp.aggregate",
          result: "saved",
          mcpApp: {
            serverId: "server-2",
            toolName: "aggregate",
            originalToolName: "aggregate",
            resourceUri: "resource://aggregate",
            toolInput: {},
            toolResult: {
              first: "a".repeat(300 * 1024),
              second: "b".repeat(300 * 1024),
            },
          },
        },
      ),
    ).resolves.toBeUndefined();
    await expect(
      persistAgentHarnessFollowUpEvent(
        id,
        "follow-up-oversized-tool-payload",
        "claim-oversized-tool-payload",
        {
          type: "tool_start",
          tool: "write_file",
          input: { content: "y".repeat(600 * 1024) },
        },
      ),
    ).resolves.toBeUndefined();

    const events = await listAgentHarnessSessionEvents(id);
    const boundedResult = events[1]?.event;
    expect(boundedResult).toMatchObject({
      type: "tool_done",
      tool: "mcp.create",
      result: "completed",
      mcpApp: {
        toolResult: {
          content: expect.stringContaining("more chars"),
        },
      },
    });
    expect(
      Buffer.byteLength(JSON.stringify(boundedResult), "utf8"),
    ).toBeLessThan(512_000);
    expect(events[2]?.event).toMatchObject({
      type: "tool_done",
      tool: "mcp.aggregate",
      result: "saved",
      journalTruncated: true,
      journalPreview: expect.any(String),
    });
    expect(events[3]?.event).toMatchObject({
      type: "tool_start",
      tool: "write_file",
      input: { content: expect.stringContaining("more chars") },
    });
  });

  it("recovers a persisted completion without appending an unknown outcome", async () => {
    const id = "session-follow-up-recovery-completed";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-follow-up-recovery-completed",
      runId: "run-follow-up-recovery-completed",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const now = Date.now();
    const claim = await claimAgentHarnessSessionFollowUpInStore(
      id,
      initial!.generation,
      "claim-completed",
      {
        followUpId: "follow-up-completed",
        prompt: "Finish the action",
        claimExpiresAt: now + 10_000,
        deadlineAt: now + 24 * 60 * 60 * 1_000,
      },
    );
    const dispatched = await markAgentHarnessSessionFollowUpDispatched(
      id,
      claim!.generation,
      "claim-completed",
    );
    await persistAgentHarnessFollowUpEvent(
      id,
      "follow-up-completed",
      "claim-completed",
      { type: "done" },
    );
    const expiredAt = Date.now() - 1;
    await pglite
      .prepare(
        "UPDATE agent_harness_sessions SET follow_up_claim_expires_at = ? WHERE id = ?",
      )
      .run(expiredAt, id);

    const recovered = await reconcileExpiredAgentHarnessFollowUp(
      id,
      "claim-completed",
      dispatched!.generation,
      Date.now(),
    );

    expect(recovered).toMatchObject({
      status: "idle",
      followUpClaimId: null,
      followUpOutcome: "completed",
    });
    const events = await listAgentHarnessSessionEvents(id);
    expect(events.map((entry) => entry.event)).toEqual([
      { type: "user_input", text: "Finish the action" },
      { type: "done" },
    ]);
    expect(events.some((entry) => entry.event.type === "error")).toBe(false);
  });

  it("makes an expired undispatched follow-up retryable and recovers legacy claims conservatively", async () => {
    const id = "session-follow-up-recovery-undispatched";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-follow-up-recovery-undispatched",
      runId: "run-follow-up-recovery-undispatched",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const now = Date.now();
    const claim = await claimAgentHarnessSessionFollowUpInStore(
      id,
      initial!.generation,
      "claim-undispatched",
      {
        followUpId: "follow-up-undispatched",
        prompt: "No action was dispatched",
        claimExpiresAt: now + 10_000,
        deadlineAt: now + 24 * 60 * 60 * 1_000,
      },
    );
    const expiredAt = Date.now() - 1;
    await pglite
      .prepare(
        "UPDATE agent_harness_sessions SET follow_up_claim_expires_at = ? WHERE id = ?",
      )
      .run(expiredAt, id);
    const recovered = await reconcileExpiredAgentHarnessFollowUp(
      id,
      "claim-undispatched",
      claim!.generation,
      Date.now(),
    );
    expect(recovered).toMatchObject({
      status: "idle",
      followUpClaimId: null,
      followUpOutcome: "not_dispatched",
    });
    await expect(listAgentHarnessSessionEvents(id)).resolves.toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          type: "error",
          errorCode: "harness_follow_up_not_dispatched",
        }),
      }),
    );

    const legacyId = "session-follow-up-recovery-legacy";
    await saveAgentHarnessSession({
      id: legacyId,
      harnessName: "fake",
      threadId: "thread-follow-up-recovery-legacy",
      runId: "run-follow-up-recovery-legacy",
      status: "running",
      followUpClaimId: "legacy-claim",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const legacy = await getAgentHarnessSession(legacyId);
    const legacyUpdatedAt = Date.now() - 16 * 60 * 1_000;
    await rawClient.execute({
      sql: "UPDATE agent_harness_sessions SET updated_at = ? WHERE id = ?",
      args: [legacyUpdatedAt, legacyId],
    });
    const recoveryAt = legacyUpdatedAt + 15 * 60 * 1_000;
    await expect(
      listExpiredAgentHarnessFollowUps(recoveryAt),
    ).resolves.toContainEqual(expect.objectContaining({ id: legacyId }));
    const recoveredLegacy = await reconcileExpiredAgentHarnessFollowUp(
      legacyId,
      "legacy-claim",
      legacy!.generation,
      recoveryAt,
    );
    expect(recoveredLegacy).toMatchObject({
      status: "idle",
      followUpClaimId: null,
      followUpId: "recovered:legacy-claim",
      followUpOutcome: "unknown",
    });
    await expect(
      listAgentHarnessSessionEvents(legacyId),
    ).resolves.toContainEqual(
      expect.objectContaining({
        operationId: "follow-up:recovered:legacy-claim",
        event: expect.objectContaining({
          type: "error",
          errorCode: "harness_follow_up_outcome_unknown",
        }),
      }),
    );
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

  it("rejects follow-up writes after the claim expires", async () => {
    const id = "session-follow-up-expired-claim";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-follow-up-expired-claim",
      runId: "run-follow-up-expired-claim",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const claimed = await claimAgentHarnessSessionFollowUp(
      id,
      initial!.generation,
      "expired-claim",
    );
    const expiredAt = Date.now() - 1;
    await pglite
      .prepare(
        "UPDATE agent_harness_sessions SET follow_up_claim_expires_at = ? WHERE id = ?",
      )
      .run(expiredAt, id);
    const now = Date.now();
    const start = vi.fn();

    await expect(
      renewAgentHarnessSessionFollowUpClaim(
        id,
        "expired-claim",
        now,
        now + 60_000,
      ),
    ).resolves.toBe(false);
    await expect(
      markAgentHarnessSessionFollowUpDispatched(
        id,
        claimed!.generation,
        "expired-claim",
        now,
      ),
    ).resolves.toBeNull();
    await expect(
      startAgentHarnessSessionFollowUpDispatch(
        id,
        claimed!.generation,
        "expired-claim",
        start,
      ),
    ).resolves.toBeNull();
    expect(start).not.toHaveBeenCalled();
    await expect(
      persistAgentHarnessFollowUpEvent(
        id,
        "expired-claim",
        "expired-claim",
        { type: "text", text: "late provider response" },
        now,
      ),
    ).rejects.toThrow("changed concurrently");
    await expect(
      updateAgentHarnessSessionIfFollowUpClaim(id, "expired-claim", {
        status: "idle",
        followUpClaimId: null,
        followUpOutcome: "completed",
      }),
    ).resolves.toBeNull();

    await expect(getAgentHarnessSession(id)).resolves.toMatchObject({
      status: "running",
      followUpClaimId: "expired-claim",
      followUpDispatchedAt: null,
      followUpOutcome: null,
    });
    await expect(listAgentHarnessSessionEvents(id)).resolves.toMatchObject([
      {
        operationId: "follow-up:expired-claim",
        seq: 0,
        event: { type: "user_input", text: "Follow-up expired-claim" },
      },
    ]);
  });

  it("does not recover a live claim because a scheduler clock is ahead", async () => {
    const id = "session-follow-up-live-claim-clock-skew";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-follow-up-live-claim-clock-skew",
      runId: "run-follow-up-live-claim-clock-skew",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const claimed = await claimAgentHarnessSessionFollowUp(
      id,
      initial!.generation,
      "clock-skew-claim",
    );
    const futureNow = Date.now() + 5 * 60_000;

    await expect(
      listExpiredAgentHarnessFollowUps(futureNow),
    ).resolves.not.toContainEqual(expect.objectContaining({ id }));
    await expect(
      reconcileExpiredAgentHarnessFollowUp(
        id,
        "clock-skew-claim",
        claimed!.generation,
        futureNow,
      ),
    ).resolves.toBeNull();
    await expect(getAgentHarnessSession(id)).resolves.toMatchObject({
      status: "running",
      followUpClaimId: "clock-skew-claim",
      generation: claimed!.generation,
    });
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
    const reserved = await claimAgentHarnessSessionApprovalResolution(
      id,
      approvalId,
      "idle",
      initial!.generation,
      null,
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
    const reserved = await claimAgentHarnessSessionApprovalResolution(
      id,
      approvalId,
      "idle",
      initial!.generation,
      null,
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
        "cleanup-under-row-lock",
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

  it("keeps follow-up claims fenced until expiry cleanup releases its reservation", async () => {
    const id = "session-expiry-cleanup-reservation";
    const cleanupId = "cleanup-expiry-reservation";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-expiry-cleanup-reservation",
      runId: "run-expiry-cleanup-reservation",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    let finishProviderCleanup!: () => void;
    const providerCleanup = new Promise<void>((resolve) => {
      finishProviderCleanup = resolve;
    });
    const cleanup = await startAgentHarnessSessionExpiryCleanup(
      id,
      "idle",
      initial!.generation,
      cleanupId,
      () => providerCleanup,
    );

    expect(cleanup?.session.expiryCleanupId).toBe(cleanupId);
    const reserved = await getAgentHarnessSession(id);
    expect(reserved?.generation).toBe(initial!.generation + 1);
    await expect(
      claimAgentHarnessSessionFollowUp(
        id,
        reserved!.generation,
        "follow-up-during-expiry-cleanup",
      ),
    ).resolves.toBeNull();

    const finished = await finishAgentHarnessSessionExpiryCleanup(
      id,
      cleanupId,
      cleanup!.session.generation,
    );
    expect(finished).toMatchObject({
      expiryCleanupId: null,
      generation: cleanup!.session.generation + 1,
    });
    await expect(
      claimAgentHarnessSessionFollowUp(
        id,
        finished!.generation,
        "follow-up-after-expiry-cleanup",
      ),
    ).resolves.toMatchObject({
      status: "running",
      followUpClaimId: "follow-up-after-expiry-cleanup",
    });
    finishProviderCleanup();
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
        "cleanup-follow-up-wins",
        start,
      ),
    ).resolves.toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it("does not advance a checkpoint while approval resolution is reserved", async () => {
    const id = "session-checkpoint-during-approval";
    const approvalId = "approval-checkpoint-during-approval";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-checkpoint-during-approval",
      runId: "run-checkpoint-during-approval",
      status: "idle",
      pendingApproval: { type: "approval-request", id: approvalId },
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const reserved = await claimAgentHarnessSessionApprovalResolution(
      id,
      approvalId,
      "idle",
      initial!.generation,
      null,
    );

    await expect(
      updateAgentHarnessSessionAtGeneration(
        id,
        "idle",
        reserved!.generation,
        { status: "idle", resumeState: { token: "checkpoint" } },
        undefined,
        true,
      ),
    ).resolves.toBeNull();
    await expect(getAgentHarnessSession(id)).resolves.toMatchObject({
      generation: reserved!.generation,
      approvalResolutionId: approvalId,
    });
  });

  it("does not start expiry cleanup while approval resolution is reserved", async () => {
    const id = "session-approval-wins-expiry-cleanup";
    const approvalId = "approval-wins-expiry-cleanup";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-approval-wins-expiry-cleanup",
      runId: "run-approval-wins-expiry-cleanup",
      status: "idle",
      pendingApproval: { type: "approval-request", id: approvalId },
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const reserved = await claimAgentHarnessSessionApprovalResolution(
      id,
      approvalId,
      "idle",
      initial!.generation,
      null,
    );
    const start = vi.fn();

    await expect(
      startAgentHarnessSessionExpiryCleanup(
        id,
        "idle",
        reserved!.generation,
        "cleanup-approval-wins",
        start,
      ),
    ).resolves.toBeNull();
    expect(start).not.toHaveBeenCalled();
    await expect(getAgentHarnessSession(id)).resolves.toMatchObject({
      status: "idle",
      approvalResolutionId: approvalId,
      generation: reserved!.generation,
    });
  });

  it("renews approval claims and recovers an expired unknown outcome once", async () => {
    const id = "session-expired-approval-resolution";
    const approvalId = "approval-expired-unknown";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-expired-approval-resolution",
      runId: "run-expired-approval-resolution",
      status: "idle",
      pendingApproval: { type: "approval-request", id: approvalId },
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const claimed = await claimAgentHarnessSessionApprovalResolution(
      id,
      approvalId,
      "idle",
      initial!.generation,
      null,
    );

    expect(await listExpiredAgentHarnessApprovalResolutions()).toEqual([]);
    await expect(
      renewAgentHarnessSessionApprovalResolutionClaim(id, approvalId),
    ).resolves.toBe(true);
    await pglite
      .prepare(
        "UPDATE agent_harness_sessions SET approval_resolution_claim_expires_at = 0 WHERE id = ?",
      )
      .run(id);
    const expired = await listExpiredAgentHarnessApprovalResolutions();
    expect(expired.map((session) => session.id)).toContain(id);

    const recovered = await reconcileExpiredAgentHarnessApprovalResolution(
      id,
      approvalId,
      claimed!.generation,
    );
    expect(recovered).toMatchObject({
      approvalResolutionId: null,
      approvalResolutionClaimExpiresAt: null,
      resolvedApprovalIds: [approvalId],
    });
    expect(recovered?.pendingApproval ?? null).toBeNull();
    await expect(
      renewAgentHarnessSessionApprovalResolutionClaim(id, approvalId),
    ).resolves.toBe(false);
    const events = await listAgentHarnessSessionEvents(id);
    expect(events.map((entry) => entry.event)).toEqual([
      expect.objectContaining({
        type: "error",
        errorCode: "harness_approval_outcome_unknown",
      }),
    ]);
    await expect(listExpiredAgentHarnessApprovalResolutions()).resolves.toEqual(
      [],
    );
  });

  it("commits approval completion with the claim release", async () => {
    const id = "session-approval-finalize-transaction";
    const approvalId = "approval-finalize-transaction";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-approval-finalize-transaction",
      runId: "run-approval-finalize-transaction",
      status: "idle",
      pendingApproval: { type: "approval-request", id: approvalId },
      resumeState: { token: "before" },
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const claimed = await claimAgentHarnessSessionApprovalResolution(
      id,
      approvalId,
      "idle",
      initial!.generation,
      null,
    );

    const finalized = await finalizeAgentHarnessSessionApprovalResolution({
      sessionId: id,
      approvalId,
      expectedStatus: "idle",
      expectedGeneration: claimed!.generation,
      expectedFollowUpClaimId: null,
      pendingApproval: null,
      resumeState: { token: "after" },
      resolvedApprovalIds: [approvalId],
    });

    expect(finalized).toMatchObject({
      approvalResolutionId: null,
      approvalResolutionClaimExpiresAt: null,
      resumeState: { token: "after" },
      resolvedApprovalIds: [approvalId],
    });
    const events = await listAgentHarnessSessionEvents(id);
    expect(events.map((entry) => entry.event)).toEqual([{ type: "done" }]);
  });

  it("releases an errored approval resolution without adding a second error", async () => {
    const id = "session-approval-provider-error";
    const approvalId = "approval-provider-error";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-approval-provider-error",
      runId: "run-approval-provider-error",
      status: "idle",
      pendingApproval: { type: "approval-request", id: approvalId },
    });
    const initial = await getAgentHarnessSession(id);
    await claimAgentHarnessSessionApprovalResolution(
      id,
      approvalId,
      "idle",
      initial!.generation,
      null,
    );
    await persistAgentHarnessApprovalEvent(id, approvalId, {
      type: "error",
      error: "provider returned an error",
      errorCode: "provider_error",
    });

    const failed = await failAgentHarnessSessionApprovalResolution({
      sessionId: id,
      approvalId,
    });

    expect(failed).toMatchObject({
      approvalResolutionId: null,
      approvalResolutionClaimExpiresAt: null,
      resolvedApprovalIds: [approvalId],
    });
    expect(failed?.pendingApproval ?? null).toBeNull();
    await expect(listAgentHarnessSessionEvents(id)).resolves.toMatchObject([
      {
        event: {
          type: "error",
          error: "provider returned an error",
          errorCode: "provider_error",
        },
      },
    ]);
  });

  it("commits an unknown approval outcome with claim release when no event exists", async () => {
    const id = "session-approval-failure-cleanup";
    const approvalId = "approval-failure-cleanup";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-approval-failure-cleanup",
      runId: "run-approval-failure-cleanup",
      status: "idle",
      pendingApproval: { type: "approval-request", id: approvalId },
    });
    const initial = await getAgentHarnessSession(id);
    await claimAgentHarnessSessionApprovalResolution(
      id,
      approvalId,
      "idle",
      initial!.generation,
      null,
    );

    const failed = await failAgentHarnessSessionApprovalResolution({
      sessionId: id,
      approvalId,
    });

    expect(failed).toMatchObject({
      approvalResolutionId: null,
      resolvedApprovalIds: [approvalId],
    });
    expect(failed?.pendingApproval ?? null).toBeNull();
    await expect(listAgentHarnessSessionEvents(id)).resolves.toMatchObject([
      {
        event: {
          type: "error",
          errorCode: "harness_approval_outcome_unknown",
        },
      },
    ]);
  });

  it("recovers a durable approval completion without adding an unknown outcome", async () => {
    const id = "session-expired-approval-completed";
    const approvalId = "approval-expired-completed";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-expired-approval-completed",
      runId: "run-expired-approval-completed",
      status: "idle",
      pendingApproval: { type: "approval-request", id: approvalId },
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const claimed = await claimAgentHarnessSessionApprovalResolution(
      id,
      approvalId,
      "idle",
      initial!.generation,
      null,
    );
    await persistAgentHarnessApprovalEvent(id, approvalId, { type: "done" });
    await pglite
      .prepare(
        "UPDATE agent_harness_sessions SET approval_resolution_claim_expires_at = 0 WHERE id = ?",
      )
      .run(id);

    const recovered = await reconcileExpiredAgentHarnessApprovalResolution(
      id,
      approvalId,
      claimed!.generation,
    );

    expect(recovered).toMatchObject({
      approvalResolutionId: null,
      resolvedApprovalIds: [approvalId],
    });
    expect(recovered?.pendingApproval ?? null).toBeNull();
    await expect(listAgentHarnessSessionEvents(id)).resolves.toMatchObject([
      { event: { type: "done" } },
    ]);
  });

  it("does not clear an active nested approval claim during follow-up recovery", async () => {
    const id = "session-expired-follow-up-with-approval";
    const followUpId = "follow-up-expired-with-approval";
    const approvalId = "approval-expired-with-follow-up";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-expired-follow-up-with-approval",
      runId: "run-expired-follow-up-with-approval",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const claimed = await claimAgentHarnessSessionFollowUp(
      id,
      initial!.generation,
      followUpId,
    );
    const pending = await updateAgentHarnessSessionIfFollowUpClaim(
      id,
      followUpId,
      { pendingApproval: { type: "approval-request", id: approvalId } },
    );
    const approval = await claimAgentHarnessSessionApprovalResolution(
      id,
      approvalId,
      "running",
      pending!.generation,
      followUpId,
    );
    await pglite
      .prepare(
        "UPDATE agent_harness_sessions SET follow_up_claim_expires_at = 0 WHERE id = ?",
      )
      .run(id);

    const expired = await listExpiredAgentHarnessFollowUps(Date.now());
    expect(expired).not.toContainEqual(expect.objectContaining({ id }));
    const stillClaimed = await reconcileExpiredAgentHarnessFollowUp(
      id,
      followUpId,
      approval!.generation,
      Date.now(),
    );
    expect(stillClaimed).toBeNull();
    await expect(getAgentHarnessSession(id)).resolves.toMatchObject({
      status: "running",
      followUpClaimId: followUpId,
      approvalResolutionId: approvalId,
      approvalResolutionClaimExpiresAt: expect.any(Number),
    });
    await expect(listAgentHarnessSessionEvents(id)).resolves.toMatchObject([
      { event: { type: "user_input" } },
    ]);

    await pglite
      .prepare(
        "UPDATE agent_harness_sessions SET approval_resolution_claim_expires_at = 0 WHERE id = ?",
      )
      .run(id);
    const recovered = await reconcileExpiredAgentHarnessFollowUp(
      id,
      followUpId,
      approval!.generation,
      Date.now(),
    );

    expect(recovered).toMatchObject({
      status: "idle",
      followUpClaimId: null,
      approvalResolutionId: null,
      approvalResolutionClaimExpiresAt: null,
      resolvedApprovalIds: [approvalId],
    });
    expect(recovered?.pendingApproval ?? null).toBeNull();
    const events = await listAgentHarnessSessionEvents(id);
    expect(
      events.some(
        (entry) =>
          entry.event.type === "error" &&
          entry.event.errorCode === "harness_approval_outcome_unknown",
      ),
    ).toBe(true);
    expect(
      events.some(
        (entry) =>
          entry.event.type === "error" &&
          entry.event.errorCode === "harness_follow_up_not_dispatched",
      ),
    ).toBe(true);
    expect(claimed).not.toBeNull();
  });

  it("lets an approval owner persist a chained request without finalizing early", async () => {
    const id = "session-follow-up-approval-resolution-reserved";
    const claimId = "follow-up-approval-resolution-reserved";
    const approvalId = "approval-resolution-reserved";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-follow-up-approval-resolution-reserved",
      runId: "run-follow-up-approval-resolution-reserved",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const initial = await getAgentHarnessSession(id);
    const claimed = await claimAgentHarnessSessionFollowUp(
      id,
      initial!.generation,
      claimId,
    );
    const pending = await updateAgentHarnessSessionIfFollowUpClaim(
      id,
      claimId,
      {
        pendingApproval: {
          type: "approval-request",
          id: approvalId,
        },
      },
    );
    const reserved = await claimAgentHarnessSessionApprovalResolution(
      id,
      approvalId,
      "running",
      pending!.generation,
      claimId,
    );
    await expect(
      updateAgentHarnessSessionIfFollowUpClaim(id, claimId, {
        pendingApproval: {
          type: "approval-request",
          id: "approval-chained",
        },
      }),
    ).resolves.toBeNull();

    const chained = await updateAgentHarnessSessionIfFollowUpClaim(
      id,
      claimId,
      {
        pendingApproval: {
          type: "approval-request",
          id: "approval-chained",
        },
      },
      { expectedApprovalResolutionId: approvalId },
    );
    expect(chained).toMatchObject({
      pendingApproval: { id: "approval-chained" },
      approvalResolutionId: approvalId,
    });

    const currentResolution = await updateAgentHarnessSessionIfFollowUpClaim(
      id,
      claimId,
      { pendingApproval: { type: "approval-request", id: "approval-next" } },
      { allowCurrentApprovalResolution: true },
    );
    expect(currentResolution).toMatchObject({
      pendingApproval: { id: "approval-next" },
      approvalResolutionId: approvalId,
    });

    let finalizeCalled = false;

    await expect(
      updateAgentHarnessSessionIfFollowUpClaim(
        id,
        claimId,
        async () => {
          finalizeCalled = true;
          return { status: "idle", followUpClaimId: null };
        },
        { requiresNoApprovalResolution: true },
      ),
    ).resolves.toBeNull();

    expect(finalizeCalled).toBe(false);
    await expect(getAgentHarnessSession(id)).resolves.toMatchObject({
      status: "running",
      followUpClaimId: claimId,
      approvalResolutionId: approvalId,
      pendingApproval: { id: "approval-next" },
      generation: reserved!.generation + 2,
    });
    expect(claimed).not.toBeNull();
  });

  it("keeps a terminal status when a checkpoint uses a stale status snapshot", async () => {
    const id = "session-terminal-checkpoint-race";
    await saveAgentHarnessSession({
      id,
      harnessName: "fake",
      threadId: "thread-terminal-checkpoint-race",
      runId: "run-terminal-checkpoint-race",
      status: "idle",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    const stored = await getAgentHarnessSession(id);
    const execute = rawClient.execute.getMockImplementation()!;
    let stoppedBetweenReadAndWrite = false;
    rawClient.execute.mockImplementation(async (input) => {
      if (
        !stoppedBetweenReadAndWrite &&
        typeof input !== "string" &&
        input.sql.includes("SET") &&
        input.sql.includes("resume_state = ?")
      ) {
        stoppedBetweenReadAndWrite = true;
        await pglite.exec(
          `UPDATE agent_harness_sessions SET status = 'stopped' WHERE id = '${id}'`,
        );
      }
      return execute(input);
    });

    try {
      await expect(
        updateAgentHarnessSessionAtGeneration(
          id,
          "idle",
          stored!.generation,
          { status: "idle", resumeState: { token: "late" } },
          undefined,
          true,
        ),
      ).rejects.toThrow("changed concurrently");
    } finally {
      rawClient.execute.mockImplementation(execute);
    }
    await expect(getAgentHarnessSession(id)).resolves.toMatchObject({
      status: "stopped",
      resumeState: undefined,
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
    const resolving = await claimAgentHarnessSessionApprovalResolution(
      id,
      "approval-in-progress",
      "idle",
      initial!.generation,
      null,
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
