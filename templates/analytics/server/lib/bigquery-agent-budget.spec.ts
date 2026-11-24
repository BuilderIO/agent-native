import { createRequire } from "node:module";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { resetPublicSchema } from "./testing/pglite-reset.js";

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

const {
  admitBigQueryAgentJob,
  approveBigQueryAgentDailyAllowance,
  BIGQUERY_AGENT_BUDGET_MIGRATION_SQL,
  BIGQUERY_AGENT_BUDGET_SETTING_KEY,
  BIGQUERY_AGENT_CREDENTIAL_FINGERPRINT_MIGRATION_SQL,
  BIGQUERY_MAX_JOB_RUNTIME_MS,
  BigQueryAgentBudgetUnavailableError,
  OUTSIDE_AGENT_JOB_CAP_BYTES,
  OUTSIDE_AGENT_ORG_LIMIT_BYTES,
  OUTSIDE_AGENT_PERSON_BASE_BYTES,
  OUTSIDE_AGENT_PERSON_CEILING_BYTES,
  markBigQueryAgentJobSubmission,
  pruneBigQueryAgentBudget,
  readBigQueryAgentBudget,
  reconcileStaleBigQueryAgentJobs,
  settleBigQueryAgentJob,
} = await import("./bigquery-agent-budget");
const { admissionLapsed, createOutsideAgentBigQueryGate } =
  await import("./bigquery-agent-context");
const { billedBytesForUsd } = await import("./bigquery-pricing");
type Reconciler = import("./bigquery-agent-budget").BigQueryAgentReconciler;

const alice = { ownerEmail: "alice@example.com", orgId: "org-1" };
const bob = { ownerEmail: "bob@example.com", orgId: "org-1" };
const JOB = OUTSIDE_AGENT_JOB_CAP_BYTES;
const PRINCIPAL =
  "sa:runner-a@builder-3b0a2.iam.gserviceaccount.com#0a1b2c3d4e5f6a7b";
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
      credentialFingerprint: PRINCIPAL,
      estimatedBytes: null,
      reservedBytes,
      leaseMs: 60_000,
      ...overrides,
    },
    { now },
  );
}

async function row(jobId: string) {
  const { rows } = await must(database.client).query(
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

beforeAll(async () => {
  database.client = await PGlite.create("memory://");
});

afterAll(async () => {
  await database.client?.close();
  database.client = null;
});

beforeEach(async () => {
  await resetPublicSchema(must(database.client));
  for (const statement of [
    ...BIGQUERY_AGENT_BUDGET_MIGRATION_SQL,
    ...BIGQUERY_AGENT_CREDENTIAL_FINGERPRINT_MIGRATION_SQL,
  ]) {
    await database.client.exec(statement);
  }
  orgSettings.clear();
  jobCounter = 0;
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
    let refusal: unknown;
    for (let index = 0; index < 20; index++) {
      const result = await admit(alice, JOB, NOON);
      if (result.status !== "admitted") {
        refusal = result;
        break;
      }
      admitted++;
    }
    expect(refusal).toMatchObject({
      code: "budget_exhausted",
      scope: "person",
    });
    expect(admitted).toBe(17);
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
    await must(database.client).query(
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
        credentialFingerprint: PRINCIPAL,
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

  it("admits against the day the budget rows were locked in, not the day it started reconciling", async () => {
    const lateEvening = new Date("2026-11-17T23:59:00.000Z");
    for (let index = 0; index < 3; index++) {
      await admit(alice, JOB, lateEvening);
      await settleBigQueryAgentJob(
        "builder-3b0a2",
        `job_${index + 1}`,
        { kind: "billed", billedBytes: JOB, cacheHit: false },
        lateEvening,
      );
    }
    const afterMidnight = new Date("2026-11-18T00:00:01.000Z");
    const admission = await admitBigQueryAgentJob(
      alice,
      {
        source: "test",
        projectId: "builder-3b0a2",
        jobId: "across_midnight",
        credentialScope: "default",
        credentialFingerprint: PRINCIPAL,
        estimatedBytes: null,
        reservedBytes: JOB,
        leaseMs: 60_000,
      },
      {
        now: new Date("2026-11-17T23:59:59.500Z"),
        clock: () => afterMidnight,
      },
    );
    expect(admission).toMatchObject({
      status: "admitted",
      budget: {
        utcDay: "2026-11-18",
        person: { settledBytes: 0, reservedBytes: JOB },
      },
    });
    const { rows } = await must(database.client).query(
      "SELECT utc_day, created_at FROM analytics_bigquery_agent_jobs WHERE job_id = 'across_midnight'",
    );
    expect(rows[0]).toEqual({
      utc_day: "2026-11-18",
      created_at: afterMidnight.toISOString(),
    });
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
      credentialFingerprint: PRINCIPAL,
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
      statementType: "SELECT",
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
        statementType: "SELECT",
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
        statementType: "SELECT",
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

  it("moves on to newer stale jobs when older ones cannot be resolved yet", async () => {
    for (let i = 0; i < 6; i++) {
      await admit(alice, 1024 ** 3, new Date(NOON.getTime() + i * 1_000));
    }
    const seen: string[] = [];
    const mostlyRunning: Reconciler = {
      credentialScope: "default",
      credentialFingerprint: PRINCIPAL,
      async observe(job) {
        seen.push(job.jobId);
        const done = job.jobId === "job_6";
        return {
          kind: "found",
          state: done ? "DONE" : "RUNNING",
          billedBytes: done ? 0 : null,
          cacheHit: done ? true : null,
          statementType: "SELECT",
          errorReason: null,
          location: "US",
        };
      },
    };
    const first = new Date(NOON.getTime() + 120_000);
    await reconcileStaleBigQueryAgentJobs(alice, mostlyRunning, first);
    expect(seen).toEqual(["job_1", "job_2", "job_3", "job_4", "job_5"]);
    await reconcileStaleBigQueryAgentJobs(
      alice,
      mostlyRunning,
      new Date(first.getTime() + 60_000),
    );
    expect(seen.slice(5)[0]).toBe("job_6");
    expect(await row("job_6")).toMatchObject({ state: "settled", billed: "0" });
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
        statementType: "SELECT",
        errorReason: null,
        location: "US",
      }),
      new Date(NOON.getTime() + 120_000),
    );
    expect(await row("job_1")).toMatchObject({ state: "settled", billed: "0" });
  });
});

describe("reconciliation of an abandoned call's execution record", () => {
  const found = (billedBytes: number): Reconciler => ({
    credentialScope: "default",
    credentialFingerprint: PRINCIPAL,
    async observe() {
      return {
        kind: "found",
        state: "DONE",
        billedBytes,
        cacheHit: false,
        statementType: "SELECT",
        errorReason: null,
        location: "US",
      };
    },
  });

  async function execution(id: string, jobId: string, status: string) {
    await must(database.client).query(
      `INSERT INTO analytics_bigquery_agent_executions (id, owner_email, org_id, caller, source, policy_version,
         query_hash, project_id, job_id, status, code, truncated, cancelled, started_at, duration_ms)
       VALUES ($1, 'alice@example.com', 'org-1', 'mcp', 'query-warehouse', 'test', 'hash', 'builder-3b0a2',
         $2, $3, NULL, false, false, $4, 0)`,
      [id, jobId, status, NOON.toISOString()],
    );
  }

  async function executionOf(id: string) {
    const { rows } = await must(database.client).query(
      "SELECT status, code, billed_bytes::text AS billed FROM analytics_bigquery_agent_executions WHERE id = $1",
      [id],
    );
    return rows[0];
  }

  it("finalizes a record left at submitting when it settles that job's reservation", async () => {
    await admit(alice, JOB, NOON);
    await execution("exec-1", "job_1", "submitting");
    const later = new Date(NOON.getTime() + 120_000);
    expect(
      await reconcileStaleBigQueryAgentJobs(alice, found(3 * 1024 ** 3), later),
    ).toBe(1);
    expect(await executionOf("exec-1")).toEqual({
      status: "abandoned",
      code: "billed",
      billed: String(3 * 1024 ** 3),
    });
  });

  it("finalizes it as abandoned when the job never existed", async () => {
    await admit(alice, JOB, NOON);
    await execution("exec-1", "job_1", "submitting");
    const absent: Reconciler = {
      credentialScope: "default",
      credentialFingerprint: PRINCIPAL,
      async observe() {
        return { kind: "absent" };
      },
    };
    await reconcileStaleBigQueryAgentJobs(
      alice,
      absent,
      new Date(NOON.getTime() + 120_000),
    );
    expect(await row("job_1")).toMatchObject({ state: "released" });
    expect(await executionOf("exec-1")).toEqual({
      status: "abandoned",
      code: "not_found",
      billed: null,
    });
  });

  it("keeps an uncertain record's outcome and adds the bytes its job settled for", async () => {
    await admit(alice, JOB, NOON);
    await execution("exec-1", "job_1", "uncertain");
    await reconcileStaleBigQueryAgentJobs(
      alice,
      found(3 * 1024 ** 3),
      new Date(NOON.getTime() + 120_000),
    );
    expect(await executionOf("exec-1")).toEqual({
      status: "uncertain",
      code: null,
      billed: String(3 * 1024 ** 3),
    });
  });

  it("leaves a record the call itself finished with a result alone", async () => {
    await admit(alice, JOB, NOON);
    await execution("exec-1", "job_1", "failed");
    await reconcileStaleBigQueryAgentJobs(
      alice,
      found(3 * 1024 ** 3),
      new Date(NOON.getTime() + 120_000),
    );
    expect(await executionOf("exec-1")).toEqual({
      status: "failed",
      code: null,
      billed: null,
    });
  });

  it("has the daily cleanup finish a record left at submitting after its call settled the job and lost its final write", async () => {
    await admit(alice, JOB, NOON);
    await execution("exec-1", "job_1", "submitting");
    await settleBigQueryAgentJob(
      "builder-3b0a2",
      "job_1",
      { kind: "billed", billedBytes: 3 * 1024 ** 3, cacheHit: false },
      NOON,
    );
    expect(await executionOf("exec-1")).toMatchObject({ status: "submitting" });
    const result = await pruneBigQueryAgentBudget(
      new Date(NOON.getTime() + 120_000),
    );
    expect(result.executionsFinalized).toBe(1);
    expect(await executionOf("exec-1")).toEqual({
      status: "abandoned",
      code: "billed",
      billed: String(3 * 1024 ** 3),
    });
  });

  it("leaves a submitting record to its call while the job's lease is still live", async () => {
    await admit(alice, JOB, NOON);
    await execution("exec-1", "job_1", "submitting");
    await settleBigQueryAgentJob(
      "builder-3b0a2",
      "job_1",
      { kind: "billed", billedBytes: 3 * 1024 ** 3, cacheHit: false },
      NOON,
    );
    const result = await pruneBigQueryAgentBudget(
      new Date(NOON.getTime() + 30_000),
    );
    expect(result.executionsFinalized).toBe(0);
    expect(await executionOf("exec-1")).toEqual({
      status: "submitting",
      code: null,
      billed: null,
    });
  });

  it("leaves a submitting record alone while its job is still pending", async () => {
    await admit(alice, JOB, NOON);
    await execution("exec-1", "job_1", "submitting");
    const result = await pruneBigQueryAgentBudget(
      new Date(NOON.getTime() + 120_000),
    );
    expect(result.executionsFinalized).toBe(0);
    expect(await executionOf("exec-1")).toMatchObject({ status: "submitting" });
  });
});

describe("settlement of finished jobs", () => {
  function finished(
    errorReason: string | null,
    statementType: string | null = "SELECT",
  ) {
    return {
      credentialScope: "default",
      credentialFingerprint: PRINCIPAL,
      observe: async () => ({
        kind: "found" as const,
        state: "DONE" as const,
        billedBytes: null,
        cacheHit: false,
        statementType,
        errorReason,
        location: "US",
      }),
    };
  }

  it("settles a statement that ended in an error at zero, and charges a cancelled job, a failed script or an unknown statement its reservation", async () => {
    const reserved = 10 * 1024 ** 3;
    for (let i = 0; i < 4; i++) await admit(alice, reserved, NOON);
    const later = new Date(NOON.getTime() + 120_000);
    const outcomes: Record<string, [string, string | null]> = {
      job_1: ["invalidQuery", "SELECT"],
      job_2: ["stopped", "SELECT"],
      job_3: ["invalidQuery", "SCRIPT"],
      job_4: ["invalidQuery", null],
    };
    await reconcileStaleBigQueryAgentJobs(
      alice,
      {
        credentialScope: "default",
        credentialFingerprint: PRINCIPAL,
        observe: async (job) =>
          finished(...must(outcomes[job.jobId])).observe(),
      },
      later,
    );
    expect(await row("job_1")).toMatchObject({ state: "settled", billed: "0" });
    for (const jobId of ["job_2", "job_3", "job_4"]) {
      expect(await row(jobId)).toMatchObject({
        state: "settled",
        billed: String(reserved),
        resolution: "billed_bytes_missing",
      });
    }
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
    await admit(alice, JOB, new Date(NOON.getTime() + 50_000), {
      jobId: "resumable_2",
    });
    await reconcileStaleBigQueryAgentJobs(
      alice,
      {
        credentialScope: "default",
        credentialFingerprint: PRINCIPAL,
        observe: async () => ({ kind: "absent" }),
      },
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

describe("the lease a job is sent under", () => {
  async function leaseOf(jobId: string): Promise<number> {
    const { rows } = await must(database.client).query(
      "SELECT lease_expires_at FROM analytics_bigquery_agent_jobs WHERE job_id = $1",
      [jobId],
    );
    return Date.parse(
      (rows[0] as { lease_expires_at: string }).lease_expires_at,
    );
  }

  function absentFor(credentialFingerprint: string | null): Reconciler {
    return {
      credentialScope: "default",
      credentialFingerprint,
      observe: async () => ({ kind: "absent" }),
    };
  }

  it("starts under the admission lock, so a slow admission never leaves its caller a deadline past it", async () => {
    await admit(bob, JOB, new Date(NOON.getTime() - 10 * 60_000), {
      jobId: "stale",
    });
    let clock = NOON.getTime();
    const slow: Reconciler = {
      credentialScope: "default",
      credentialFingerprint: PRINCIPAL,
      async observe() {
        clock += 20_000;
        return {
          kind: "found",
          state: "RUNNING",
          billedBytes: null,
          cacheHit: null,
          statementType: "SELECT",
          errorReason: null,
          location: "US",
        };
      },
    };
    const gate = createOutsideAgentBigQueryGate({
      identity: alice,
      source: "test",
      reservation: "full-cap",
      leaseMs: 60_000,
      now: () => new Date(clock),
    });
    const admission = await gate.admit({
      projectId: "builder-3b0a2",
      jobId: "late",
      credentialScope: "default",
      credentialFingerprint: PRINCIPAL,
      exclusive: true,
      capBytes: JOB,
      reconciler: slow,
    });

    const lease = await leaseOf("late");
    expect(lease).toBe(NOON.getTime() + 20_000 + 60_000);
    expect(admission.submitBy).toBeLessThanOrEqual(lease - 15_000);

    await reconcileStaleBigQueryAgentJobs(
      bob,
      absentFor(PRINCIPAL),
      new Date(admission.submitBy),
    );
    expect(await row("late")).toMatchObject({ state: "pending" });
    expect(admissionLapsed(admission, admission.submitBy)).toBe(false);

    const released = lease + 1_000;
    await reconcileStaleBigQueryAgentJobs(
      bob,
      absentFor(PRINCIPAL),
      new Date(released),
    );
    expect(await row("late")).toMatchObject({ state: "released" });
    expect(admissionLapsed(admission, released)).toBe(true);
  });

  it("returns the extended lease when a job ID is admitted again, never one it did not commit", async () => {
    const first = await admit(alice, JOB, NOON, { jobId: "resumable_3" });
    const again = await admitBigQueryAgentJob(
      alice,
      {
        source: "test",
        projectId: "builder-3b0a2",
        jobId: "resumable_3",
        credentialScope: "default",
        credentialFingerprint: PRINCIPAL,
        estimatedBytes: null,
        reservedBytes: JOB,
        leaseMs: 60_000,
      },
      {
        now: new Date(NOON.getTime() + 10_000),
        clock: () => new Date(NOON.getTime() + 45_000),
      },
    );
    expect(first).toMatchObject({
      leaseExpiresAt: new Date(NOON.getTime() + 60_000).toISOString(),
    });
    expect(again).toMatchObject({
      created: false,
      leaseExpiresAt: new Date(NOON.getTime() + 105_000).toISOString(),
    });
    expect(await leaseOf("resumable_3")).toBe(NOON.getTime() + 105_000);
  });
});

describe("a send BigQuery refused", () => {
  const gateAt = () =>
    createOutsideAgentBigQueryGate({
      identity: alice,
      source: "test",
      reservation: "full-cap",
      leaseMs: 60_000,
      now: () => NOON,
    });
  const job = (jobId: string, exclusive: boolean) => ({
    projectId: "builder-3b0a2",
    jobId,
    credentialScope: "default",
    credentialFingerprint: PRINCIPAL,
    exclusive,
    capBytes: JOB,
  });

  it("keeps a resumable job ID reserved when the call that created its admission is refused, since another call may still send it", async () => {
    const first = gateAt();
    const second = gateAt();
    const created = await first.admit(job("resumable_shared", false));
    const reused = await second.admit({
      ...job("resumable_shared", false),
      credentialFingerprint: "sa:runner-b@example.invalid#fake-key-hash",
    });
    expect(created.created).toBe(true);
    expect(reused.created).toBe(false);
    expect(admissionLapsed(reused, NOON.getTime())).toBe(false);

    await first.rejected(created);
    await second.rejected(reused);
    expect(await row("resumable_shared")).toMatchObject({ state: "pending" });
    expect(first.summary().jobs).toEqual([
      expect.objectContaining({ state: "reserved" }),
    ]);
    expect(first.summary().unsettledBytes).toBe(JOB);
  });

  it("releases an exclusive job ID's reservation when its one send is refused", async () => {
    const gate = gateAt();
    const admission = await gate.admit(job("random_once", true));
    await gate.rejected(admission);
    expect(await row("random_once")).toMatchObject({
      state: "released",
      resolution: "rejected",
    });
    expect(gate.summary().jobs).toEqual([
      expect.objectContaining({ state: "released" }),
    ]);
  });

  it("never treats a job ID already admitted as exclusive", async () => {
    await gateAt().admit(job("taken", true));
    const gate = gateAt();
    const again = await gate.admit(job("taken", true));
    await gate.rejected(again);
    expect(await row("taken")).toMatchObject({ state: "pending" });
  });
});

describe("proof of absence after the credentials change", () => {
  const OTHER_ACCOUNT =
    "sa:runner-b@builder-3b0a2.iam.gserviceaccount.com#9f8e7d6c5b4a3928";
  const ROTATED_KEY =
    "sa:runner-a@builder-3b0a2.iam.gserviceaccount.com#ffffffffffffffff";

  function listingAs(credentialFingerprint: string | null) {
    const asked: boolean[] = [];
    const reconciler: Reconciler = {
      credentialScope: "default",
      credentialFingerprint,
      async observe(_job, _signal, { mayConfirmAbsence }) {
        asked.push(mayConfirmAbsence);
        return { kind: "absent" };
      },
    };
    return { reconciler, asked };
  }

  it("keeps an unknown-outcome job reserved once the credentials name another principal, then charges it in full after six hours", async () => {
    const admitted = await admit(alice, JOB, NOON, { jobId: "unknown_a" });
    if (admitted.status !== "admitted") throw new Error("not admitted");
    await markBigQueryAgentJobSubmission(
      admitted.requestId,
      "unknown",
      undefined,
    );

    const replaced = listingAs(OTHER_ACCOUNT);
    await reconcileStaleBigQueryAgentJobs(
      alice,
      replaced.reconciler,
      new Date(NOON.getTime() + 120_000),
    );
    const rotated = listingAs(ROTATED_KEY);
    await reconcileStaleBigQueryAgentJobs(
      alice,
      rotated.reconciler,
      new Date(NOON.getTime() + 240_000),
    );
    expect(replaced.asked).toEqual([false]);
    expect(rotated.asked).toEqual([false]);
    expect(await row("unknown_a")).toMatchObject({ state: "pending" });
    expect(
      (await readBigQueryAgentBudget(alice, { now: NOON })).person
        .reservedBytes,
    ).toBe(JOB);

    await reconcileStaleBigQueryAgentJobs(
      alice,
      replaced.reconciler,
      new Date(NOON.getTime() + BIGQUERY_MAX_JOB_RUNTIME_MS + 1),
    );
    expect(await row("unknown_a")).toMatchObject({
      state: "settled",
      billed: String(JOB),
      resolution: "max_runtime_elapsed",
    });
  });

  it("releases it on a complete listing by the principal that sent it", async () => {
    await admit(alice, JOB, NOON, { jobId: "unknown_b" });
    const same = listingAs(PRINCIPAL);
    await reconcileStaleBigQueryAgentJobs(
      alice,
      same.reconciler,
      new Date(NOON.getTime() + 120_000),
    );
    expect(same.asked).toEqual([true]);
    expect(await row("unknown_b")).toMatchObject({
      state: "released",
      resolution: "not_found",
    });
  });

  it("never proves absent a job whose principal was unknown when it was admitted", async () => {
    await admit(alice, JOB, NOON, {
      jobId: "unknown_c",
      credentialFingerprint: null,
    });
    const unknown = listingAs(null);
    await reconcileStaleBigQueryAgentJobs(
      alice,
      unknown.reconciler,
      new Date(NOON.getTime() + 120_000),
    );
    expect(unknown.asked).toEqual([false]);
    expect(await row("unknown_c")).toMatchObject({ state: "pending" });
  });

  it("forgets the principal of a job ID a second call admits as another one", async () => {
    await admit(alice, JOB, NOON, { jobId: "resumable_4" });
    await admit(alice, JOB, NOON, {
      jobId: "resumable_4",
      credentialFingerprint: OTHER_ACCOUNT,
    });
    for (const fingerprint of [PRINCIPAL, OTHER_ACCOUNT]) {
      const listing = listingAs(fingerprint);
      await reconcileStaleBigQueryAgentJobs(
        alice,
        listing.reconciler,
        new Date(
          NOON.getTime() + 120_000 + (fingerprint === PRINCIPAL ? 0 : 60_000),
        ),
      );
      expect(listing.asked).toEqual([false]);
    }
    expect(await row("resumable_4")).toMatchObject({ state: "pending" });
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
