import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function must<T>(value: T | null | undefined, message = "Expected a value"): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const database = vi.hoisted(() => {
  const state = { queue: Promise.resolve() };
  return {
    client: null as null | PGliteClient,
    runExclusive: async <T>(operation: () => Promise<T>): Promise<T> => {
      const previous = state.queue;
      let release!: () => void;
      state.queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    },
  };
});
const orgSettings = vi.hoisted(() => new Map<string, unknown>());
const approval = vi.hoisted(() => ({
  value: undefined as "mcp-review-page" | "mcp-client" | undefined,
  askedAt: undefined as number | undefined,
}));

vi.mock("@agent-native/core/db", async (importOriginal) => {
  const query = async (
    run: (
      sql: string,
      args: unknown[],
    ) => Promise<{ rows: unknown[]; affectedRows?: number }>,
    { sql, args }: { sql: string; args?: unknown[] },
  ) => {
    const result = await run(sql, args ?? []);
    return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
  };
  return {
    ...(await importOriginal<typeof import("@agent-native/core/db")>()),
    getDbExec: () => ({
      execute: (input: { sql: string; args?: unknown[] }) =>
        database.runExclusive(() =>
          query((sql, args) => must(database.client).query(sql, args), input),
        ),
      transaction: <T>(callback: (tx: unknown) => Promise<T>) =>
        database.runExclusive(() =>
          must(database.client).transaction((tx: PGliteClient) =>
            callback({
              execute: (input: { sql: string; args?: unknown[] }) =>
                query((sql, args) => tx.query(sql, args), input),
            }),
          ),
        ),
    }),
  };
});
vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: async (orgId: string, key: string) => {
    const value = orgSettings.get(`${orgId}:${key}`);
    if (value instanceof Error) throw value;
    return value ?? null;
  },
}));
vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  currentActionApproval: () => approval.value,
  currentActionApprovalAskedAt: () => approval.askedAt,
}));

const {
  admitBigQueryAgentJob,
  approveBigQueryAgentDailyAllowance,
  BIGQUERY_AGENT_BUDGET_MIGRATION_SQL,
  BIGQUERY_AGENT_BUDGET_SETTING_KEY,
  BIGQUERY_AGENT_CREDENTIAL_FINGERPRINT_MIGRATION_SQL,
  OUTSIDE_AGENT_JOB_CAP_BYTES,
  OUTSIDE_AGENT_ORG_LIMIT_BYTES,
  OUTSIDE_AGENT_PERSON_CEILING_BYTES,
  readBigQueryAgentBudget,
} = await import("./bigquery-agent-budget");
const {
  allowanceApprovalNotice,
  allowanceBudget,
  needsAllowanceApproval,
  recordReviewedAllowance,
} = await import("./bigquery-agent-approval");
const { OutsideAgentBigQueryRefusalError } =
  await import("./bigquery-agent-context");
const { billedBytesForUsd, BYTES_PER_TIB, ON_DEMAND_USD_PER_TIB } =
  await import("./bigquery-pricing");

const alice = { ownerEmail: "alice@example.com", orgId: "org-1" };
const aliceOverMcp = {
  userEmail: "alice@example.com",
  orgId: "org-1",
  caller: "mcp" as const,
};
const JOB = OUTSIDE_AGENT_JOB_CAP_BYTES;
const NOON = new Date("2026-11-17T12:00:00.000Z");
let jobCounter = 0;

function admit(bytes: number, now: Date = NOON) {
  jobCounter++;
  return admitBigQueryAgentJob(
    alice,
    {
      source: "test",
      projectId: "builder-3b0a2",
      jobId: `job_${jobCounter}`,
      credentialScope: "default",
      credentialFingerprint: "sa:runner@example.iam#1",
      estimatedBytes: null,
      reservedBytes: bytes,
      leaseMs: 60_000,
    },
    { now },
  );
}

async function approvalRows() {
  const { rows } = await must(database.client).query(
    "SELECT utc_day, allowance_bytes::text AS allowance, approved_via, expires_at FROM analytics_bigquery_agent_allowance_approvals",
  );
  return rows;
}

async function needsNow(bytes: number) {
  const read = must(await allowanceBudget(aliceOverMcp));
  return needsAllowanceApproval(read.budget, bytes);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
  database.client = await PGlite.create("memory://");
  for (const statement of [
    ...BIGQUERY_AGENT_BUDGET_MIGRATION_SQL,
    ...BIGQUERY_AGENT_CREDENTIAL_FINGERPRINT_MIGRATION_SQL,
  ]) {
    await database.client.exec(statement);
  }
  orgSettings.clear();
  approval.value = undefined;
  approval.askedAt = undefined;
  jobCounter = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("an approval check must never call BigQuery");
    }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await database.client?.close();
  database.client = null;
});

describe("asking past the no-ask allowance", () => {
  it("asks only where admission would stop at the no-ask allowance, from the ledger alone", async () => {
    expect(await needsNow(JOB)).toBe(false);
    for (let index = 0; index < 3; index++) {
      expect((await admit(JOB)).status).toBe("admitted");
    }
    expect(await needsNow(billedBytesForUsd(0.1))).toBe(false);
    expect(await needsNow(JOB)).toBe(true);
    expect((await admit(JOB)).status).toBe("refused");

    expect(await needsNow(OUTSIDE_AGENT_PERSON_CEILING_BYTES)).toBe(false);

    await approveBigQueryAgentDailyAllowance(alice, "test", NOON);
    expect(await needsNow(JOB)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks nothing when the organization's $50 would stop the call anyway", async () => {
    await must(database.client).query(
      `INSERT INTO analytics_bigquery_agent_jobs (request_id, project_id, job_id, owner_email, org_id, org_key,
         credential_scope, source, utc_day, reserved_bytes, billed_bytes, state, submission_state, created_at, lease_expires_at, resolved_at)
       VALUES ('r-seed', 'builder-3b0a2', 'seed', 'carol@example.com', 'org-1', 'org:org-1', 'default', 'test',
         '2026-11-17', $1, $1, 'settled', 'accepted', $2, $2, $2)`,
      [OUTSIDE_AGENT_ORG_LIMIT_BYTES - 10 * 1024 ** 3, NOON.toISOString()],
    );
    for (let index = 0; index < 3; index++) await admit(1024 ** 3);
    expect(await needsNow(JOB)).toBe(false);
  });

  it("asks nothing when an admin-raised allowance already covers the call", async () => {
    orgSettings.set(`org-1:${BIGQUERY_AGENT_BUDGET_SETTING_KEY}`, {
      personDailyAllowanceBytes: { "alice@example.com": billedBytesForUsd(3) },
    });
    for (let index = 0; index < 3; index++) await admit(JOB);
    expect(await needsNow(JOB)).toBe(false);
    expect((await admit(JOB)).status).toBe("admitted");
  });

  it("reads an unreadable ledger as no answer, so the call reaches its own refusal", async () => {
    orgSettings.set(
      `org-1:${BIGQUERY_AGENT_BUDGET_SETTING_KEY}`,
      new Error("settings unavailable"),
    );
    expect(await allowanceBudget(aliceOverMcp)).toBeNull();
  });

  it("states the call's cost, today's spend and reservation, the $5 ceiling, the org limit and the 00:00 UTC expiry", async () => {
    await must(database.client).query(
      `INSERT INTO analytics_bigquery_agent_jobs (request_id, project_id, job_id, owner_email, org_id, org_key,
         credential_scope, source, utc_day, reserved_bytes, billed_bytes, state, submission_state, created_at, lease_expires_at, resolved_at)
       VALUES ('r-spent', 'builder-3b0a2', 'spent', 'alice@example.com', 'org-1', 'org:org-1', 'default', 'test',
         '2026-11-17', $1, $1, 'settled', 'accepted', $2, $2, $2)`,
      [billedBytesForUsd(0.8), NOON.toISOString()],
    );
    await admit(billedBytesForUsd(0.1));
    const { budget } = must(await allowanceBudget(aliceOverMcp));

    expect(allowanceApprovalNotice(budget, JOB).split("\n")).toEqual([
      "Allow up to $5.00 of BigQuery today?",
      "At today's limits, this call can bill up to $0.29. Today you have spent $0.80 and reserved $0.10 of your $1.00 no-ask allowance.",
      "Approving lets your outside agents spend up to $5.00 in total today (UTC), a hard stop. Your organization's $50.00 daily limit for outside agents is also a hard stop; it has spent $0.80 and reserved $0.10.",
      "The approval expires at 00:00 UTC (2026-11-18T00:00:00.000Z).",
    ]);
  });

  it.each([
    [150_000_000_000, "$0.86"],
    [billedBytesForUsd(0.85), "$0.85"],
    [100_000_000, "$0.01"],
    [0, "$0.00"],
  ])(
    "states a call of %d bytes as up to %s, never less than it can bill",
    async (bytes, stated) => {
      const { budget } = must(await allowanceBudget(aliceOverMcp));
      expect(allowanceApprovalNotice(budget, bytes)).toContain(
        `At today's limits, this call can bill up to ${stated}.`,
      );
      expect(Number(stated.slice(1))).toBeGreaterThanOrEqual(
        (bytes / BYTES_PER_TIB) * ON_DEMAND_USD_PER_TIB,
      );
    },
  );
});

describe("recording a review-page approval", () => {
  async function usedThreeJobs() {
    for (let index = 0; index < 3; index++) await admit(JOB);
  }
  function approvedOnReviewPage(askedAt: Date = NOON) {
    approval.value = "mcp-review-page";
    approval.askedAt = askedAt.getTime();
  }

  it("records $5 for today only after the review page approved, then admits past $1 up to the $5 stop", async () => {
    await usedThreeJobs();
    for (const value of [undefined, "mcp-client"] as const) {
      approval.value = value;
      approval.askedAt = NOON.getTime();
      await recordReviewedAllowance(alice, NOON);
    }
    expect(await approvalRows()).toEqual([]);

    approvedOnReviewPage();
    await recordReviewedAllowance(alice, NOON);
    expect(await approvalRows()).toEqual([
      {
        utc_day: "2026-11-17",
        allowance: String(OUTSIDE_AGENT_PERSON_CEILING_BYTES),
        approved_via: "mcp-review-page",
        expires_at: "2026-11-18T00:00:00.000Z",
      },
    ]);
    for (let index = 3; index < 17; index++) {
      expect((await admit(JOB)).status).toBe("admitted");
    }
    expect(await admit(JOB)).toMatchObject({
      status: "refused",
      code: "budget_exhausted",
      scope: "person",
    });
  });

  it("records once, and parallel approved calls never overshoot $5", async () => {
    await usedThreeJobs();
    approvedOnReviewPage();
    const results = await Promise.all(
      Array.from({ length: 20 }, async () => {
        await recordReviewedAllowance(alice, NOON);
        return admit(JOB);
      }),
    );
    expect(await approvalRows()).toHaveLength(1);
    expect(results.filter((r) => r.status === "admitted")).toHaveLength(14);
    const budget = await readBigQueryAgentBudget(alice, { now: NOON });
    expect(budget.person.reservedBytes).toBe(17 * JOB);
    expect(budget.person.reservedBytes).toBeLessThanOrEqual(
      OUTSIDE_AGENT_PERSON_CEILING_BYTES,
    );
  });

  it("records nothing for a new UTC day the person was not asked about, so the call asks again", async () => {
    const lateEvening = new Date("2026-11-17T23:55:00.000Z");
    for (let index = 0; index < 3; index++) await admit(JOB, lateEvening);
    approvedOnReviewPage(lateEvening);

    const justAfter = new Date("2026-11-18T00:00:05.000Z");
    vi.setSystemTime(justAfter);
    await recordReviewedAllowance(alice, justAfter);
    expect(await approvalRows()).toEqual([]);
    expect(await needsNow(JOB)).toBe(true);
    expect(await admit(JOB, justAfter)).toMatchObject({
      status: "refused",
      code: "approval_required",
    });
  });

  it("records the new day's allowance for a person asked after 00:00 UTC", async () => {
    const lateEvening = new Date("2026-11-17T23:55:00.000Z");
    for (let index = 0; index < 3; index++) await admit(JOB, lateEvening);
    const justAfter = new Date("2026-11-18T00:00:05.000Z");
    approvedOnReviewPage(justAfter);
    const later = new Date("2026-11-18T00:04:00.000Z");
    vi.setSystemTime(later);
    await recordReviewedAllowance(alice, later);
    expect(await approvalRows()).toEqual([
      expect.objectContaining({
        utc_day: "2026-11-18",
        expires_at: "2026-11-19T00:00:00.000Z",
      }),
    ]);
  });

  it("records nothing for a review-page approval whose ask time was not recorded", async () => {
    await usedThreeJobs();
    approval.value = "mcp-review-page";
    await recordReviewedAllowance(alice, NOON);
    expect(await approvalRows()).toEqual([]);
  });

  it("leaves the organization's $50 a hard stop", async () => {
    await must(database.client).query(
      `INSERT INTO analytics_bigquery_agent_jobs (request_id, project_id, job_id, owner_email, org_id, org_key,
         credential_scope, source, utc_day, reserved_bytes, billed_bytes, state, submission_state, created_at, lease_expires_at, resolved_at)
       VALUES ('r-seed', 'builder-3b0a2', 'seed', 'carol@example.com', 'org-1', 'org:org-1', 'default', 'test',
         '2026-11-17', $1, $1, 'settled', 'accepted', $2, $2, $2)`,
      [OUTSIDE_AGENT_ORG_LIMIT_BYTES - 3 * JOB - 1024 ** 3, NOON.toISOString()],
    );
    await usedThreeJobs();
    approvedOnReviewPage();
    await recordReviewedAllowance(alice, NOON);
    expect(await approvalRows()).toHaveLength(1);
    expect(await admit(JOB)).toMatchObject({
      status: "refused",
      code: "budget_exhausted",
      scope: "org",
    });
  });

  it("refuses with budget_unavailable when the ledger can't be read", async () => {
    approvedOnReviewPage();
    orgSettings.set(
      `org-1:${BIGQUERY_AGENT_BUDGET_SETTING_KEY}`,
      new Error("settings unavailable"),
    );
    const error = await recordReviewedAllowance(alice, NOON).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(OutsideAgentBigQueryRefusalError);
    expect(error).toMatchObject({ code: "budget_unavailable" });
  });
});
