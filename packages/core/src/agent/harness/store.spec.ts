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
});
