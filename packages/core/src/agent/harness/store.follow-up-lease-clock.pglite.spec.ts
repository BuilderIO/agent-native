import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let databaseClockMs = 0;

function postgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function useDatabaseClock(sql: string): string {
  return sql.replaceAll(
    "clock_timestamp()",
    `to_timestamp(${databaseClockMs} / 1000.0)`,
  );
}

async function executeOn(
  client: {
    exec(sql: string): Promise<unknown>;
    query(
      sql: string,
      args?: unknown[],
    ): Promise<{
      affectedRows?: number;
      rowCount?: number;
      rows: unknown[];
    }>;
  },
  input: string | { sql: string; args?: unknown[] },
) {
  if (typeof input === "string") {
    await client.exec(useDatabaseClock(input));
    return { rows: [], rowsAffected: 0 };
  }
  const result = await client.query(
    postgresSql(useDatabaseClock(input.sql)),
    (input.args ?? []).map((value) => value ?? null),
  );
  return {
    rows: result.rows,
    rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
  };
}

const databaseExec = {
  execute: (input: string | { sql: string; args?: unknown[] }) =>
    executeOn(pglite.db, input),
  transaction: <T>(
    run: (tx: import("../../db/client.js").DbExec) => Promise<T>,
  ) =>
    pglite.db.transaction((tx) =>
      run({ execute: (input) => executeOn(tx, input) }),
    ),
};

vi.mock("../../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/client.js")>()),
  getDbExec: () => databaseExec,
}));

const store = await import("./store.js");

const DAY_MS = 24 * 60 * 60 * 1_000;

async function createIdleSession(id: string) {
  await store.saveAgentHarnessSession({
    id,
    harnessName: "clock-test",
    threadId: `thread-${id}`,
    status: "idle",
  });
}

describe("AgentHarness follow-up lease clock", () => {
  beforeAll(async () => {
    pglite = await createTestPglite();
    await store.ensureAgentHarnessSessionTables();
  }, 30_000);

  beforeEach(async () => {
    vi.restoreAllMocks();
    databaseClockMs = Date.now();
    await pglite.exec("DELETE FROM agent_harness_session_events");
    await pglite.exec("DELETE FROM agent_harness_sessions");
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await pglite.close();
  });

  it("uses database time across skewed callers and preserves claim ownership", async () => {
    await createIdleSession("clock-skew");
    const processNow = Date.now();
    const skewMs = 3 * DAY_MS;
    const processClock = vi
      .spyOn(Date, "now")
      .mockReturnValue(processNow + skewMs);

    const claimed = await store.claimAgentHarnessSessionFollowUp(
      "clock-skew",
      1,
      "owner-a",
      {
        followUpId: "follow-up-a",
        prompt: "run the follow-up",
        claimLeaseMs: 60_000,
        deadlineDurationMs: 5 * 60_000,
      },
    );
    expect(claimed).not.toBeNull();
    if (!claimed) throw new Error("Expected the follow-up claim to succeed");
    expect(claimed.followUpClaimExpiresAt! - claimed.updatedAt).toBe(60_000);
    expect(claimed.followUpDeadlineAt! - claimed.updatedAt).toBe(5 * 60_000);
    expect(Math.abs(claimed.updatedAt - processClock())).toBeGreaterThan(
      skewMs / 2,
    );

    processClock.mockReturnValue(processNow - skewMs);
    expect(
      await store.claimAgentHarnessSessionFollowUp(
        "clock-skew",
        claimed.generation,
        "owner-b",
        {
          followUpId: "follow-up-b",
          prompt: "competing follow-up",
          claimLeaseMs: 60_000,
          deadlineDurationMs: 5 * 60_000,
        },
      ),
    ).toBeNull();
    expect(
      await store.renewAgentHarnessSessionFollowUpClaim(
        "clock-skew",
        "owner-b",
        60_000,
      ),
    ).toBe(false);
    expect(
      await store.markAgentHarnessSessionFollowUpDispatched(
        "clock-skew",
        claimed.generation,
        "owner-b",
      ),
    ).toBeNull();
    expect(
      await store.updateAgentHarnessSessionIfFollowUpClaim(
        "clock-skew",
        "owner-b",
        { followUpMetadata: { writer: "owner-b" } },
      ),
    ).toBeNull();
    processClock.mockReturnValue(processNow + skewMs);
    const ownerUpdate = await store.updateAgentHarnessSessionIfFollowUpClaim(
      "clock-skew",
      "owner-a",
      { followUpMetadata: { writer: "owner-a" } },
    );
    expect(ownerUpdate).toMatchObject({
      followUpMetadata: { writer: "owner-a" },
    });
    if (!ownerUpdate) throw new Error("Expected the owner update to succeed");

    processClock.mockReturnValue(processNow - skewMs);
    databaseClockMs += 20_000;
    const renewed = await store.renewAgentHarnessSessionFollowUpClaim(
      "clock-skew",
      "owner-a",
      60_000,
    );
    expect(renewed).toBe(true);
    const afterRenewal = await store.getAgentHarnessSession("clock-skew");
    const nowAfterRenewal = databaseClockMs;
    expect(afterRenewal?.followUpClaimExpiresAt).toBe(nowAfterRenewal + 60_000);

    processClock.mockReturnValue(processNow + skewMs);
    const dispatched = await store.markAgentHarnessSessionFollowUpDispatched(
      "clock-skew",
      ownerUpdate.generation,
      "owner-a",
    );
    expect(dispatched?.followUpDispatchedAt).toBeDefined();
    const nowAfterDispatch = databaseClockMs;
    expect(
      Math.abs(dispatched!.followUpDispatchedAt! - nowAfterDispatch),
    ).toBeLessThan(1_000);
    expect(
      Math.abs(dispatched!.followUpDispatchedAt! - processClock()),
    ).toBeGreaterThan(skewMs / 2);

    await pglite.query(
      `UPDATE agent_harness_sessions
       SET follow_up_deadline_at = $1, follow_up_claim_expires_at = $2
       WHERE id = $3`,
      [databaseClockMs, databaseClockMs + 60_000, "clock-skew"],
    );
    expect(
      await store.renewAgentHarnessSessionFollowUpClaim(
        "clock-skew",
        "owner-a",
        60_000,
      ),
    ).toBe(false);
  });

  it("admits only one concurrent owner from the same generation", async () => {
    await createIdleSession("concurrent-claim");
    const [first, second] = await Promise.all([
      store.claimAgentHarnessSessionFollowUp("concurrent-claim", 1, "owner-a", {
        followUpId: "follow-up-a",
        prompt: "first claimant",
        claimLeaseMs: 60_000,
        deadlineDurationMs: 30_000,
      }),
      store.claimAgentHarnessSessionFollowUp("concurrent-claim", 1, "owner-b", {
        followUpId: "follow-up-b",
        prompt: "second claimant",
        claimLeaseMs: 60_000,
        deadlineDurationMs: 30_000,
      }),
    ]);

    const admitted = [first, second].filter(Boolean);
    expect(admitted).toHaveLength(1);
    expect(admitted[0]!.followUpClaimExpiresAt).toBe(
      admitted[0]!.updatedAt + 30_000,
    );
    const current = await store.getAgentHarnessSession("concurrent-claim");
    expect(["owner-a", "owner-b"]).toContain(current?.followUpClaimId);
  });

  it("lists and reconciles an expired claim using database time only", async () => {
    await createIdleSession("expired-claim");
    const claimed = await store.claimAgentHarnessSessionFollowUp(
      "expired-claim",
      1,
      "owner-a",
      {
        followUpId: "follow-up-expired",
        prompt: "run the follow-up",
        claimLeaseMs: 60_000,
        deadlineDurationMs: 5 * 60_000,
      },
    );
    expect(claimed).not.toBeNull();
    if (!claimed) throw new Error("Expected the follow-up claim to succeed");

    await pglite.query(
      `UPDATE agent_harness_sessions
       SET follow_up_claim_expires_at = $1
       WHERE id = $2`,
      [databaseClockMs - 1, "expired-claim"],
    );
    vi.spyOn(Date, "now").mockReturnValue(Date.now() - 3 * DAY_MS);

    expect(
      await store.renewAgentHarnessSessionFollowUpClaim(
        "expired-claim",
        "owner-a",
        60_000,
      ),
    ).toBe(false);

    expect(
      (await store.listExpiredAgentHarnessFollowUps(10)).map(
        (session) => session.id,
      ),
    ).toContain("expired-claim");

    const reconciled = await store.reconcileExpiredAgentHarnessFollowUp(
      "expired-claim",
      "owner-a",
      claimed.generation,
    );
    expect(reconciled).toMatchObject({
      status: "idle",
      followUpClaimId: null,
      followUpOutcome: "not_dispatched",
    });
    expect(reconciled?.updatedAt).toBe(databaseClockMs);
    const { rows } = await pglite.query(
      `SELECT event_at
       FROM agent_harness_session_events
       WHERE session_id = $1
       ORDER BY seq DESC
       LIMIT 1`,
      ["expired-claim"],
    );
    expect(Number((rows[0] as { event_at: number | string }).event_at)).toBe(
      databaseClockMs,
    );
  });
});
