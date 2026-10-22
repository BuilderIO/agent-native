import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import {
  answerMcpApprovalPrompt,
  consumeMcpApprovalGrant,
  consumeReviewedMcpApprovalGrant,
  createMcpApprovalGrant,
  decideMcpApproval,
  ensureApprovalTable,
  findRecentMcpApprovalRun,
  getMcpApprovalForOwner,
  recordMcpApprovalRun,
  storedApprovalArguments,
  type McpApprovalCall,
  type NewMcpApprovalGrant,
} from "./approval-store.js";

// Real PGlite behind getDbExec, so every grant transition runs as genuine SQL
// against the table this store's own migrations build.
let pglite: Awaited<ReturnType<typeof createTestPglite>>;

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => executor,
}));

// No `transaction`: on a fresh database the store registry then runs this
// store's migrations one by one rather than installing the generated schema
// snapshot, so the table under test is the one the migrations declare.
const executor = {
  execute: async (input: string | { sql: string; args?: unknown[] }) => {
    const result =
      typeof input === "string"
        ? await pglite.query(input)
        : await pglite.query(input.sql, input.args ?? []);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowsAffected: result.affectedRows ?? 0,
    };
  },
};

beforeAll(async () => {
  pglite = await createTestPglite();
  await ensureApprovalTable();
});

afterAll(async () => {
  await pglite?.close();
});

beforeEach(async () => {
  await pglite.exec("DELETE FROM mcp_action_approvals");
});

afterEach(() => {
  vi.useRealTimers();
});

const OWNER = "owner@example.com";
const ORG = "org-1";
const TEN_MINUTES = 10 * 60_000;

let sequence = 0;

function newGrant(
  overrides: Partial<NewMcpApprovalGrant> = {},
): NewMcpApprovalGrant {
  sequence++;
  return {
    nonce: globalThis.crypto.randomUUID(),
    callerKey: "caller-1",
    actionName: "create-event",
    argumentsHash: `arguments-${sequence}`,
    expiresAt: Date.now() + TEN_MINUTES,
    ownerEmail: OWNER,
    orgId: ORG,
    appId: "calendar",
    argumentsJson: storedApprovalArguments({ title: "Team sync" }),
    oauthClientId: undefined,
    retrySafe: false,
    ...overrides,
  };
}

async function created(
  overrides: Partial<NewMcpApprovalGrant> = {},
): Promise<NewMcpApprovalGrant> {
  const grant = newGrant(overrides);
  await createMcpApprovalGrant(grant);
  return grant;
}

function callOf(grant: NewMcpApprovalGrant): McpApprovalCall {
  return {
    callerKey: grant.callerKey,
    actionName: grant.actionName,
    argumentsHash: grant.argumentsHash,
  };
}

async function storedRow(nonce: string): Promise<Record<string, unknown>> {
  const { rows } = await pglite.query(
    "SELECT * FROM mcp_action_approvals WHERE nonce = ?",
    [nonce],
  );
  expect(rows).toHaveLength(1);
  return rows[0] as Record<string, unknown>;
}

function approve(grant: NewMcpApprovalGrant, until = Date.now() + TEN_MINUTES) {
  return decideMcpApproval(grant.nonce, OWNER, ORG, "approve", until);
}

describe("creating a grant", () => {
  it("stores a pending grant for its owner with the arguments redacted", async () => {
    const grant = await created({
      ownerEmail: "  Owner@Example.COM ",
      argumentsJson: storedApprovalArguments({
        title: "Team sync",
        apiKey: "sk-live-1234567890",
      }),
      oauthClientId: "client-1",
      retrySafe: true,
    });

    const row = await storedRow(grant.nonce);
    expect(row).toMatchObject({
      caller_key: grant.callerKey,
      action_name: grant.actionName,
      arguments_hash: grant.argumentsHash,
      expires_at: grant.expiresAt,
      status: "pending",
      owner_email: OWNER,
      org_id: ORG,
      app_id: "calendar",
      oauth_client_id: "client-1",
      retry_safe: true,
      consumed_at: null,
      approver_email: null,
      run_status: null,
    });
    expect(JSON.parse(String(row.call_arguments))).toEqual({
      title: "Team sync",
      apiKey: "[redacted]",
    });
    expect(String(row.call_arguments)).not.toContain("sk-live");
    expect(Number(row.created_at)).toBeGreaterThan(0);
  });
});

describe("the client's own approval", () => {
  it("approves and uses a pending grant once", async () => {
    const grant = await created();

    await expect(consumeMcpApprovalGrant(grant)).resolves.toBe(true);
    await expect(consumeMcpApprovalGrant(grant)).resolves.toBe(false);

    const row = await storedRow(grant.nonce);
    expect(row).toMatchObject({ status: "approved", run_status: "running" });
    expect(row.consumed_at).not.toBeNull();
    expect(row.approved_at).not.toBeNull();
    expect(row.approver_email).toBeNull();
  });

  it.each([
    ["caller", { callerKey: "caller-2" }],
    ["arguments", { argumentsHash: "other-arguments" }],
    ["action", { actionName: "delete-event" }],
  ])(
    "refuses a call from another %s, then still takes the bound one",
    async (_label, mismatch) => {
      const grant = await created();

      await expect(
        consumeMcpApprovalGrant({ ...grant, ...mismatch }),
      ).resolves.toBe(false);
      expect((await storedRow(grant.nonce)).status).toBe("pending");
      await expect(consumeMcpApprovalGrant(grant)).resolves.toBe(true);
    },
  );

  it("refuses an expired grant", async () => {
    const grant = await created({ expiresAt: Date.now() - 1 });

    await expect(consumeMcpApprovalGrant(grant)).resolves.toBe(false);
    expect((await storedRow(grant.nonce)).consumed_at).toBeNull();
  });

  it.each(["declined", "denied"] as const)(
    "refuses a grant whose prompt was %s",
    async (answer) => {
      const grant = await created();
      await expect(answerMcpApprovalPrompt(grant, answer)).resolves.toBe(true);

      await expect(consumeMcpApprovalGrant(grant)).resolves.toBe(false);
      expect((await storedRow(grant.nonce)).consumed_at).toBeNull();
    },
  );
});

describe("answering the client prompt without approving", () => {
  it("declined closes the grant for good", async () => {
    const grant = await created();

    await expect(answerMcpApprovalPrompt(grant, "declined")).resolves.toBe(
      true,
    );
    expect((await storedRow(grant.nonce)).status).toBe("declined");

    await expect(approve(grant)).resolves.toBe(false);
    expect((await storedRow(grant.nonce)).status).toBe("declined");
    await expect(
      consumeReviewedMcpApprovalGrant(callOf(grant)),
    ).resolves.toBeNull();
  });

  it("denied records the person's no", async () => {
    const grant = await created();

    await expect(answerMcpApprovalPrompt(grant, "denied")).resolves.toBe(true);

    const row = await storedRow(grant.nonce);
    expect(row.status).toBe("denied");
    expect(row.denied_at).not.toBeNull();
    await expect(approve(grant)).resolves.toBe(false);
  });

  it("opened leaves the grant pending for the review page", async () => {
    const grant = await created();

    await expect(answerMcpApprovalPrompt(grant, "opened")).resolves.toBe(true);

    const row = await storedRow(grant.nonce);
    expect(row.status).toBe("pending");
    expect(row.prompt_answered_at).not.toBeNull();
    // The client already answered, so only the page can approve it now.
    await expect(consumeMcpApprovalGrant(grant)).resolves.toBe(false);
    await expect(approve(grant)).resolves.toBe(true);
    await expect(
      consumeReviewedMcpApprovalGrant(callOf(grant)),
    ).resolves.toMatchObject({ nonce: grant.nonce });
  });

  it("takes only the client's first answer", async () => {
    const grant = await created();

    await expect(answerMcpApprovalPrompt(grant, "opened")).resolves.toBe(true);
    await expect(answerMcpApprovalPrompt(grant, "declined")).resolves.toBe(
      false,
    );
    expect((await storedRow(grant.nonce)).status).toBe("pending");
  });
});

describe("the owner's decision on the review page", () => {
  it("approving records the approver and moves the expiry to the approval window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_800_000_000_000);
    const grant = await created({ expiresAt: Date.now() + 60_000 });
    vi.setSystemTime(1_800_000_030_000);
    const approvedUntil = Date.now() + TEN_MINUTES;

    await expect(
      decideMcpApproval(grant.nonce, OWNER, ORG, "approve", approvedUntil),
    ).resolves.toBe(true);

    expect(await storedRow(grant.nonce)).toMatchObject({
      status: "approved",
      approver_email: OWNER,
      approved_at: 1_800_000_030_000,
      expires_at: approvedUntil,
      consumed_at: null,
    });
  });

  it("is the grant's owner's, in any case, and only in its organization", async () => {
    const grant = await created();
    const decide = (email: string, orgId: string | null) =>
      decideMcpApproval(grant.nonce, email, orgId, "approve", Date.now() + 1);

    await expect(decide("other@example.com", ORG)).resolves.toBe(false);
    await expect(decide(OWNER, "org-2")).resolves.toBe(false);
    await expect(decide(OWNER, null)).resolves.toBe(false);
    expect((await storedRow(grant.nonce)).status).toBe("pending");

    await expect(decide("OWNER@Example.com", ORG)).resolves.toBe(true);
    expect((await storedRow(grant.nonce)).approver_email).toBe(OWNER);
  });

  it("decides a grant made outside an organization only outside one", async () => {
    const grant = await created({ orgId: null });
    const decide = (orgId: string | null) =>
      decideMcpApproval(grant.nonce, OWNER, orgId, "deny", Date.now());

    await expect(decide(ORG)).resolves.toBe(false);
    await expect(decide(null)).resolves.toBe(true);
    expect((await storedRow(grant.nonce)).status).toBe("denied");
  });

  it("takes one decision: a replay or a change of mind does nothing", async () => {
    const approved = await created();
    await expect(approve(approved)).resolves.toBe(true);
    const approvedRow = await storedRow(approved.nonce);

    await expect(approve(approved, Date.now() + 2 * TEN_MINUTES)).resolves.toBe(
      false,
    );
    await expect(
      decideMcpApproval(approved.nonce, OWNER, ORG, "deny", Date.now()),
    ).resolves.toBe(false);
    expect(await storedRow(approved.nonce)).toEqual(approvedRow);

    const denied = await created();
    await expect(
      decideMcpApproval(denied.nonce, OWNER, ORG, "deny", Date.now()),
    ).resolves.toBe(true);
    await expect(approve(denied)).resolves.toBe(false);
    expect((await storedRow(denied.nonce)).status).toBe("denied");
  });

  it("refuses to decide an expired grant", async () => {
    const grant = await created({ expiresAt: Date.now() - 1 });

    await expect(approve(grant)).resolves.toBe(false);
    await expect(
      decideMcpApproval(grant.nonce, OWNER, ORG, "deny", Date.now()),
    ).resolves.toBe(false);
    expect((await storedRow(grant.nonce)).status).toBe("pending");
  });
});

describe("using a page approval", () => {
  it("gives the approved grant to the identical call exactly once", async () => {
    const grant = await created();
    await approve(grant);

    const used = await consumeReviewedMcpApprovalGrant(callOf(grant));
    expect(used).toMatchObject({
      nonce: grant.nonce,
      status: "approved",
      approverEmail: OWNER,
      runStatus: "running",
    });
    expect(used?.consumedAt).toEqual(expect.any(Number));
    expect((await storedRow(grant.nonce)).consumed_at).toBe(used?.consumedAt);

    await expect(
      consumeReviewedMcpApprovalGrant(callOf(grant)),
    ).resolves.toBeNull();
  });

  it("gives nothing for a grant nobody approved, or one that was denied", async () => {
    const pending = await created();
    const denied = await created();
    await decideMcpApproval(denied.nonce, OWNER, ORG, "deny", Date.now());

    await expect(
      consumeReviewedMcpApprovalGrant(callOf(pending)),
    ).resolves.toBeNull();
    await expect(
      consumeReviewedMcpApprovalGrant(callOf(denied)),
    ).resolves.toBeNull();
    expect((await storedRow(pending.nonce)).consumed_at).toBeNull();
    expect((await storedRow(denied.nonce)).consumed_at).toBeNull();
  });

  it("gives nothing to another caller or other arguments", async () => {
    const grant = await created();
    await approve(grant);

    await expect(
      consumeReviewedMcpApprovalGrant({ ...callOf(grant), callerKey: "x" }),
    ).resolves.toBeNull();
    await expect(
      consumeReviewedMcpApprovalGrant({ ...callOf(grant), argumentsHash: "x" }),
    ).resolves.toBeNull();
    expect((await storedRow(grant.nonce)).consumed_at).toBeNull();
  });

  it("gives nothing once the approval window has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_800_000_000_000);
    const grant = await created();
    await approve(grant, Date.now() + 60_000);

    vi.setSystemTime(1_800_000_060_001);

    await expect(
      consumeReviewedMcpApprovalGrant(callOf(grant)),
    ).resolves.toBeNull();
    expect((await storedRow(grant.nonce)).consumed_at).toBeNull();
  });

  it("with a nonce, uses only that grant", async () => {
    const first = await created();
    const second = await created({ argumentsHash: first.argumentsHash });
    await approve(first);
    await approve(second);

    await expect(
      consumeReviewedMcpApprovalGrant(callOf(first), second.nonce),
    ).resolves.toMatchObject({ nonce: second.nonce });
    await expect(
      consumeReviewedMcpApprovalGrant(callOf(first), second.nonce),
    ).resolves.toBeNull();
    expect((await storedRow(first.nonce)).consumed_at).toBeNull();
    await expect(
      consumeReviewedMcpApprovalGrant(callOf(first)),
    ).resolves.toMatchObject({ nonce: first.nonce });
  });

  it("gives a grant to only one of two concurrent retries", async () => {
    const grant = await created();
    await approve(grant);

    const results = await Promise.all([
      consumeReviewedMcpApprovalGrant(callOf(grant)),
      consumeReviewedMcpApprovalGrant(callOf(grant)),
    ]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });
});

describe("the runs used grants allowed", () => {
  async function usedGrant() {
    const grant = await created();
    await consumeMcpApprovalGrant(grant);
    const consumedAt = Number((await storedRow(grant.nonce)).consumed_at);
    return { grant, consumedAt };
  }

  it.each(["running", "completed", "unknown"] as const)(
    "reports a %s run of the same call",
    async (status) => {
      const { grant, consumedAt } = await usedGrant();
      if (status !== "running") await recordMcpApprovalRun(grant.nonce, status);

      const run = await findRecentMcpApprovalRun(callOf(grant), consumedAt);

      expect(run).toMatchObject({
        nonce: grant.nonce,
        consumedAt,
        runStatus: status,
      });
      if (status !== "running") expect(run?.runSettledAt).not.toBeNull();
    },
  );

  it("does not report a failed run", async () => {
    const { grant, consumedAt } = await usedGrant();
    await recordMcpApprovalRun(grant.nonce, "failed");

    await expect(
      findRecentMcpApprovalRun(callOf(grant), consumedAt),
    ).resolves.toBeNull();
  });

  it("does not report a run from before `since`", async () => {
    const { grant, consumedAt } = await usedGrant();
    await recordMcpApprovalRun(grant.nonce, "completed");

    await expect(
      findRecentMcpApprovalRun(callOf(grant), consumedAt + 1),
    ).resolves.toBeNull();
  });

  it("settles a run once", async () => {
    const { grant, consumedAt } = await usedGrant();
    await recordMcpApprovalRun(grant.nonce, "completed");
    await recordMcpApprovalRun(grant.nonce, "failed");

    await expect(
      findRecentMcpApprovalRun(callOf(grant), consumedAt),
    ).resolves.toMatchObject({ runStatus: "completed" });
  });
});

describe("reading a grant for its owner", () => {
  it("shows a grant only to its owner in its organization", async () => {
    const grant = await created();

    await expect(
      getMcpApprovalForOwner(grant.nonce, "Owner@Example.com", ORG),
    ).resolves.toMatchObject({ nonce: grant.nonce, status: "pending" });
    await expect(
      getMcpApprovalForOwner(grant.nonce, "other@example.com", ORG),
    ).resolves.toBeNull();
    await expect(
      getMcpApprovalForOwner(grant.nonce, OWNER, "org-2"),
    ).resolves.toBeNull();
    await expect(
      getMcpApprovalForOwner(grant.nonce, OWNER, null),
    ).resolves.toBeNull();
  });
});
