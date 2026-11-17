import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A local PGlite database runs the ledger's real SQL. PGlite has one
// connection, so transactions run one at a time, as row locks would order them.
const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const database = vi.hoisted(() => {
  const state = { queue: Promise.resolve() };
  return {
    client: null as null | PGliteClient,
    failWrites: false,
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
          query((sql, args) => database.client!.query(sql, args), input),
        ),
      transaction: <T>(callback: (tx: unknown) => Promise<T>) =>
        database.runExclusive(() =>
          database.client!.transaction((tx: PGliteClient) =>
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

const {
  admitBigQueryAgentJob,
  approveBigQueryAgentDailyAllowance,
  BIGQUERY_AGENT_BUDGET_MIGRATION_SQL,
  BIGQUERY_AGENT_BUDGET_SETTING_KEY,
  BIGQUERY_MAX_JOB_RUNTIME_MS,
  BigQueryAgentBudgetUnavailableError,
  OUTSIDE_AGENT_JOB_CAP_BYTES,
  OUTSIDE_AGENT_ORG_LIMIT_BYTES,
  OUTSIDE_AGENT_PERSON_BASE_BYTES,
  OUTSIDE_AGENT_PERSON_CEILING_BYTES,
  pruneBigQueryAgentBudget,
  readBigQueryAgentBudget,
  reconcileStaleBigQueryAgentJobs,
  settleBigQueryAgentJob,
} = await import("./bigquery-agent-budget");
const { billedBytesForUsd } = await import("./bigquery-pricing");
type Reconciler = import("./bigquery-agent-budget").BigQueryAgentReconciler;

const alice = { ownerEmail: "alice@example.com", orgId: "org-1" };
const bob = { ownerEmail: "bob@example.com", orgId: "org-1" };
const JOB = OUTSIDE_AGENT_JOB_CAP_BYTES;
let jobCounter = 0;

function admit(
  identity: typeof alice,
  reservedBytes: number,
  now: Date,
  overrides: Partial<Parameters<typeof admitBigQueryAgentJob>[1]> = {},
) {
  jobCounter += 1;
  return admitBigQueryAgentJob(
    identity,
    {
      source: "test",
      projectId: "builder-3b0a2",
      jobId: `job_${jobCounter}`,
      credentialScope: "default",
      estimatedBytes: null,
      reservedBytes,
      leaseMs: 60_000,
      ...overrides,
    },
    { now },
  );
}

async function row(jobId: string) {
  const { rows } = await database.client!.query(
    "SELECT state, reserved_bytes::text AS reserved, billed_bytes::text AS billed, resolution FROM analytics_bigquery_agent_jobs WHERE job_id = $1",
    [jobId],
  );
  return rows[0] as
    | {
        state: string;
        reserved: string;
        billed: string | null;
        resolution: string | null;
      }
    | undefined;
}

const NOON = new Date("2026-11-17T12:00:00.000Z");

beforeEach(async () => {
  database.client = await PGlite.create("memory://");
  for (const statement of BIGQUERY_AGENT_BUDGET_MIGRATION_SQL) {
    await database.client.exec(statement);
  }
  orgSettings.clear();
  jobCounter = 0;
});

afterEach(async () => {
  await database.client?.close();
  database.client = null;
});

describe("outside-agent BigQuery limits", () => {
  it("are the approved byte counts at $6.25 per TiB", () => {
    expect(OUTSIDE_AGENT_JOB_CAP_BYTES).toBe(50_000_000_000);
    expect(OUTSIDE_AGENT_PERSON_BASE_BYTES).toBe(billedBytesForUsd(1));
    expect(OUTSIDE_AGENT_PERSON_BASE_BYTES).toBe(175_921_860_444);
    expect(OUTSIDE_AGENT_PERSON_CEILING_BYTES).toBe(billedBytesForUsd(5));
    expect(OUTSIDE_AGENT_PERSON_CEILING_BYTES).toBe(879_609_302_220);
    expect(OUTSIDE_AGENT_ORG_LIMIT_BYTES).toBe(billedBytesForUsd(50));
    expect(OUTSIDE_AGENT_ORG_LIMIT_BYTES).toBe(8_796_093_022_208);
  });
});

describe("admission", () => {
  it("runs a person's first $1 without asking, then asks", async () => {
    for (let index = 0; index < 3; index++) {
      expect((await admit(alice, JOB, NOON)).status).toBe("admitted");
    }
    const fourth = await admit(alice, JOB, NOON);
    expect(fourth).toMatchObject({
      status: "refused",
      code: "approval_required",
      scope: "person",
    });
    expect(await row(`job_4`)).toBeUndefined();
  });

  it("refuses one job over the 50 GB per-job cap", async () => {
    expect(await admit(alice, JOB + 1, NOON)).toMatchObject({
      status: "refused",
      code: "over_job_cap",
      scope: "job",
    });
  });

  it("after approval, runs up to $5 total for the day and then stops hard", async () => {
    await approveBigQueryAgentDailyAllowance(alice, "test", NOON);
    let admitted = 0;
    for (let index = 0; index < 20; index++) {
      const result = await admit(alice, JOB, NOON);
      if (result.status === "admitted") admitted++;
      else {
        expect(result).toMatchObject({
          code: "budget_exhausted",
          scope: "person",
        });
        break;
      }
    }
    // 17 × 50 GB = 850 GB fits under 879.6 GB; an 18th does not.
    expect(admitted).toBe(17);
    // Approving again cannot raise the ceiling.
    await approveBigQueryAgentDailyAllowance(alice, "test", NOON);
    expect(await admit(alice, billedBytesForUsd(0.2), NOON)).toMatchObject({
      status: "refused",
      code: "budget_exhausted",
    });
    const budget = await readBigQueryAgentBudget(alice, { now: NOON });
    expect(budget.person.reservedBytes).toBe(17 * JOB);
    expect(budget.person.limitBytes).toBe(OUTSIDE_AGENT_PERSON_CEILING_BYTES);
  });

  it("stops everyone in the org at $50 a day", async () => {
    // Earlier settled spend by other members, just under the org limit.
    await database.client!.query(
      `INSERT INTO analytics_bigquery_agent_jobs (request_id, project_id, job_id, owner_email, org_id, org_key,
         credential_scope, source, utc_day, reserved_bytes, billed_bytes, state, submission_state, created_at, lease_expires_at, resolved_at)
       VALUES ('r-seed', 'builder-3b0a2', 'seed', 'carol@example.com', 'org-1', 'org:org-1', 'default', 'test',
         '2026-11-17', $1, $1, 'settled', 'accepted', $2, $2, $2)`,
      [OUTSIDE_AGENT_ORG_LIMIT_BYTES - 10 * 1024 ** 3, NOON.toISOString()],
    );
    expect(await admit(bob, JOB, NOON)).toMatchObject({
      status: "refused",
      code: "budget_exhausted",
      scope: "org",
    });
    // Another org is unaffected.
    expect(
      (
        await admit(
          { ownerEmail: "dana@example.com", orgId: "org-2" },
          JOB,
          NOON,
        )
      ).status,
    ).toBe("admitted");
  });

  it("never overshoots under concurrency: 20 × $0.28 against $5 admits 17", async () => {
    await approveBigQueryAgentDailyAllowance(alice, "test", NOON);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => admit(alice, JOB, NOON)),
    );
    expect(
      results.filter((result) => result.status === "admitted"),
    ).toHaveLength(17);
    const budget = await readBigQueryAgentBudget(alice, { now: NOON });
    expect(budget.person.reservedBytes).toBeLessThanOrEqual(
      OUTSIDE_AGENT_PERSON_CEILING_BYTES,
    );
    expect(budget.person.reservedBytes).toBe(17 * JOB);
  });

  it("does not reserve again for a job ID already admitted", async () => {
    const first = await admit(alice, JOB, NOON, { jobId: "resumable_1" });
    const again = await admitBigQueryAgentJob(
      alice,
      {
        source: "test",
        projectId: "builder-3b0a2",
        jobId: "resumable_1",
        credentialScope: "default",
        estimatedBytes: null,
        reservedBytes: JOB,
        leaseMs: 60_000,
      },
      { now: NOON },
    );
    expect(first).toMatchObject({ status: "admitted", created: true });
    expect(again).toMatchObject({ status: "admitted", created: false });
    expect(
      (await readBigQueryAgentBudget(alice, { now: NOON })).person
        .reservedBytes,
    ).toBe(JOB);
  });

  it("applies admin overrides and fails closed on an unreadable one", async () => {
    orgSettings.set(`org-1:${BIGQUERY_AGENT_BUDGET_SETTING_KEY}`, {
      personDailyAllowanceBytes: { "alice@example.com": billedBytesForUsd(10) },
      orgDailyLimitBytes: billedBytesForUsd(100),
    });
    const budget = await readBigQueryAgentBudget(alice, { now: NOON });
    expect(budget.person.limitBytes).toBe(billedBytesForUsd(10));
    expect(budget.person.ceilingBytes).toBe(billedBytesForUsd(10));
    expect(budget.org.limitBytes).toBe(billedBytesForUsd(100));
    expect(budget.limitsSource).toEqual({ person: "admin", org: "admin" });
    expect(
      (await readBigQueryAgentBudget(bob, { now: NOON })).person.limitBytes,
    ).toBe(OUTSIDE_AGENT_PERSON_BASE_BYTES);

    orgSettings.set(`org-1:${BIGQUERY_AGENT_BUDGET_SETTING_KEY}`, {
      orgDailyLimitBytes: "lots",
    });
    await expect(admit(alice, JOB, NOON)).rejects.toBeInstanceOf(
      BigQueryAgentBudgetUnavailableError,
    );
  });
});

describe("settlement", () => {
  it("settles once from billed bytes and returns the unused reservation", async () => {
    await admit(alice, JOB, NOON);
    expect(
      await settleBigQueryAgentJob(
        "builder-3b0a2",
        "job_1",
        { kind: "billed", billedBytes: 2 * 1024 ** 3, cacheHit: false },
        NOON,
      ),
    ).toBe(true);
    expect(
      await settleBigQueryAgentJob(
        "builder-3b0a2",
        "job_1",
        { kind: "billed", billedBytes: JOB, cacheHit: false },
        NOON,
      ),
    ).toBe(false);
    const budget = await readBigQueryAgentBudget(alice, { now: NOON });
    expect(budget.person.reservedBytes).toBe(0);
    expect(budget.person.settledBytes).toBe(2 * 1024 ** 3);
  });

  it("settles a confirmed cache hit at zero", async () => {
    await admit(alice, JOB, NOON);
    await settleBigQueryAgentJob(
      "builder-3b0a2",
      "job_1",
      { kind: "billed", billedBytes: 0, cacheHit: true },
      NOON,
    );
    expect(await row("job_1")).toMatchObject({
      state: "settled",
      billed: "0",
      resolution: "cache_hit",
    });
    const budget = await readBigQueryAgentBudget(alice, { now: NOON });
    expect(budget.person.remainingBytes).toBe(OUTSIDE_AGENT_PERSON_BASE_BYTES);
  });

  it("releases a reservation BigQuery definitively rejected", async () => {
    await admit(alice, JOB, NOON);
    await settleBigQueryAgentJob(
      "builder-3b0a2",
      "job_1",
      { kind: "rejected" },
      NOON,
    );
    expect(await row("job_1")).toMatchObject({ state: "released" });
    expect(
      (await readBigQueryAgentBudget(alice, { now: NOON })).person
        .reservedBytes,
    ).toBe(0);
  });

  it("keeps an unknown outcome reserved across the UTC midnight rollover", async () => {
    const lateEvening = new Date("2026-11-17T23:59:30.000Z");
    await admit(alice, JOB, lateEvening);
    const nextDay = new Date("2026-11-18T00:00:30.000Z");
    const budget = await readBigQueryAgentBudget(alice, { now: nextDay });
    expect(budget.utcDay).toBe("2026-11-18");
    expect(budget.person.reservedBytes).toBe(JOB);
    expect(budget.org.reservedBytes).toBe(JOB);
    expect(budget.person.remainingBytes).toBe(
      OUTSIDE_AGENT_PERSON_BASE_BYTES - JOB,
    );
    // It still blocks today's admissions that would not fit beside it.
    await admit(alice, JOB, nextDay);
    await admit(alice, JOB, nextDay);
    expect((await admit(alice, JOB, nextDay)).status).toBe("refused");
  });
});

describe("reconciler", () => {
  function reconciler(
    observation: Awaited<ReturnType<Reconciler["observe"]>>,
    credentialScope = "default",
  ): Reconciler & { calls: number } {
    const result = {
      credentialScope,
      calls: 0,
      async observe() {
        result.calls++;
        return observation;
      },
    };
    return result;
  }

  it("leaves rows inside their lease alone", async () => {
    await admit(alice, JOB, NOON);
    const done = reconciler({
      kind: "found",
      state: "DONE",
      billedBytes: 1,
      cacheHit: false,
      errorReason: null,
      location: "US",
    });
    expect(await reconcileStaleBigQueryAgentJobs(alice, done, NOON)).toBe(0);
    expect(done.calls).toBe(0);
  });

  it("settles a finished job from BigQuery's billed bytes", async () => {
    await admit(alice, JOB, NOON);
    const later = new Date(NOON.getTime() + 120_000);
    const resolved = await reconcileStaleBigQueryAgentJobs(
      alice,
      reconciler({
        kind: "found",
        state: "DONE",
        billedBytes: 3 * 1024 ** 3,
        cacheHit: false,
        errorReason: null,
        location: "US",
      }),
      later,
    );
    expect(resolved).toBe(1);
    expect(await row("job_1")).toMatchObject({
      state: "settled",
      billed: String(3 * 1024 ** 3),
    });
  });

  it("releases a job a listing by the same credentials proves absent", async () => {
    await admit(alice, JOB, NOON);
    const later = new Date(NOON.getTime() + 120_000);
    await reconcileStaleBigQueryAgentJobs(
      alice,
      reconciler({ kind: "absent" }),
      later,
    );
    expect(await row("job_1")).toMatchObject({
      state: "released",
      resolution: "not_found",
    });
  });

  it("keeps a running job, an unreadable one, and another principal's absence", async () => {
    await admit(alice, JOB, NOON);
    const later = new Date(NOON.getTime() + 120_000);
    await reconcileStaleBigQueryAgentJobs(
      alice,
      reconciler({
        kind: "found",
        state: "RUNNING",
        billedBytes: null,
        cacheHit: null,
        errorReason: null,
        location: "US",
      }),
      later,
    );
    await reconcileStaleBigQueryAgentJobs(
      alice,
      reconciler({ kind: "unreadable" }),
      new Date(later.getTime() + 60_000),
    );
    await reconcileStaleBigQueryAgentJobs(
      alice,
      reconciler({ kind: "absent" }, "org"),
      new Date(later.getTime() + 120_000),
    );
    expect(await row("job_1")).toMatchObject({ state: "pending" });
  });

  it("charges the whole reservation once BigQuery's six-hour limit has passed unconfirmed", async () => {
    await admit(alice, JOB, NOON);
    await reconcileStaleBigQueryAgentJobs(
      alice,
      reconciler({ kind: "unreadable" }),
      new Date(NOON.getTime() + BIGQUERY_MAX_JOB_RUNTIME_MS + 1),
    );
    expect(await row("job_1")).toMatchObject({
      state: "settled",
      billed: String(JOB),
      resolution: "max_runtime_elapsed",
    });
  });

  it("reconciles another member's stale reservation in the same org", async () => {
    await admit(bob, JOB, NOON);
    await reconcileStaleBigQueryAgentJobs(
      alice,
      reconciler({
        kind: "found",
        state: "DONE",
        billedBytes: 0,
        cacheHit: true,
        errorReason: null,
        location: "US",
      }),
      new Date(NOON.getTime() + 120_000),
    );
    expect(await row("job_1")).toMatchObject({ state: "settled", billed: "0" });
  });
});

describe("settlement of finished jobs", () => {
  function finished(errorReason: string | null) {
    return {
      credentialScope: "default",
      observe: async () => ({
        kind: "found" as const,
        state: "DONE" as const,
        billedBytes: null,
        cacheHit: false,
        errorReason,
        location: "US",
      }),
    };
  }

  it("settles a job that ended in an error at zero, and charges a cancelled one its reservation", async () => {
    await admit(alice, JOB, NOON);
    await admit(alice, JOB, NOON);
    const later = new Date(NOON.getTime() + 120_000);
    await reconcileStaleBigQueryAgentJobs(
      alice,
      {
        credentialScope: "default",
        observe: async (job) =>
          finished(
            job.jobId === "job_1" ? "invalidQuery" : "stopped",
          ).observe(),
      },
      later,
    );
    expect(await row("job_1")).toMatchObject({ state: "settled", billed: "0" });
    expect(await row("job_2")).toMatchObject({
      state: "settled",
      billed: String(JOB),
      resolution: "billed_bytes_missing",
    });
  });

  it("never resubmits a job ID that was charged without BigQuery confirming the job", async () => {
    await admit(alice, JOB, NOON, { jobId: "unconfirmed" });
    await settleBigQueryAgentJob(
      "builder-3b0a2",
      "unconfirmed",
      { kind: "charged_reservation", reason: "max_runtime_elapsed" },
      NOON,
    );
    await expect(
      admit(alice, JOB, NOON, { jobId: "unconfirmed" }),
    ).rejects.toBeInstanceOf(BigQueryAgentBudgetUnavailableError);
  });

  it("does not let a reconciler release a reservation another admission is about to send again", async () => {
    await admit(alice, JOB, NOON, { jobId: "resumable_2" });
    // A second call reuses the admission 50 s later and extends its lease.
    await admit(alice, JOB, new Date(NOON.getTime() + 50_000), {
      jobId: "resumable_2",
    });
    await reconcileStaleBigQueryAgentJobs(
      alice,
      { credentialScope: "default", observe: async () => ({ kind: "absent" }) },
      new Date(NOON.getTime() + 90_000),
    );
    expect(await row("resumable_2")).toMatchObject({ state: "pending" });
    expect(
      await settleBigQueryAgentJob(
        "builder-3b0a2",
        "resumable_2",
        { kind: "not_found" },
        new Date(NOON.getTime() + 90_000),
        { leaseExpiredAt: new Date(NOON.getTime() + 90_000) },
      ),
    ).toBe(false);
  });
});

describe("approval", () => {
  it("expires at 00:00 UTC", async () => {
    const lateEvening = new Date("2026-11-17T23:00:00.000Z");
    const approved = await approveBigQueryAgentDailyAllowance(
      alice,
      "test",
      lateEvening,
    );
    expect(approved.person.limitBytes).toBe(OUTSIDE_AGENT_PERSON_CEILING_BYTES);
    expect(approved.person.approvedToday).toBe(true);

    const justAfter = new Date("2026-11-18T00:00:01.000Z");
    const nextDay = await readBigQueryAgentBudget(alice, { now: justAfter });
    expect(nextDay.person.approvedToday).toBe(false);
    expect(nextDay.person.limitBytes).toBe(OUTSIDE_AGENT_PERSON_BASE_BYTES);
    for (let index = 0; index < 3; index++) await admit(alice, JOB, justAfter);
    expect(await admit(alice, JOB, justAfter)).toMatchObject({
      code: "approval_required",
    });
  });
});

describe("retention", () => {
  it("never prunes an unresolved reservation, however old", async () => {
    const longAgo = new Date("2026-06-01T12:00:00.000Z");
    await admit(alice, JOB, longAgo);
    await admit(alice, JOB, longAgo);
    await settleBigQueryAgentJob(
      "builder-3b0a2",
      "job_2",
      { kind: "billed", billedBytes: 1, cacheHit: false },
      longAgo,
    );
    const result = await pruneBigQueryAgentBudget(NOON);
    expect(result.admissionsDeleted).toBe(1);
    expect(await row("job_1")).toMatchObject({ state: "pending" });
    expect(await row("job_2")).toBeUndefined();
  });
});
