import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The BigQuery REST API is a fetch mock; the budget ledger is real SQL on a
// local PGlite database. No real project is ever contacted.
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
  getOrgSetting: async () => null,
}));
vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: () => ({
    userEmail: "alice@example.com",
    orgId: "org-1",
  }),
  getRequestUserEmail: () => "alice@example.com",
  getRequestOrgId: () => "org-1",
  getRequestRunContext: () => undefined,
  platformWaitUntil: () => undefined,
}));
vi.mock("./credentials", () => ({
  resolveCredential: async (key: string) =>
    key === "BIGQUERY_PROJECT_ID" ? "builder-3b0a2" : null,
}));
vi.mock("./gcloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gcloud")>()),
  getBigQueryAccessToken: async () => "test-token",
}));

const { BIGQUERY_AGENT_BUDGET_MIGRATION_SQL, OUTSIDE_AGENT_JOB_CAP_BYTES } =
  await import("./bigquery-agent-budget");
const { reservationForEstimate } = await import("./bigquery-agent-context");
const { runBigQueryAgentQuery, BIGQUERY_AGENT_MAX_ROWS } =
  await import("./bigquery-agent-runner");

const SQL = "SELECT id, name FROM `builder-3b0a2.dbt_mart.users`";
const USERS = {
  projectId: "builder-3b0a2",
  datasetId: "dbt_mart",
  tableId: "users",
};
const GIB = 1024 ** 3;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function untilAborted(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    );
  });
}

interface Scenario {
  dryRunStatistics: Record<string, unknown>;
  submit: (body: any, signal?: AbortSignal | null) => Promise<Response>;
  poll: (url: URL, signal?: AbortSignal | null) => Promise<Response>;
  jobsGet: (jobId: string) => Response | Promise<Response>;
  table: () => Response;
}

let scenario: Scenario;
const calls = {
  submissions: [] as any[],
  dryRuns: 0,
  cancels: 0,
  polls: [] as URL[],
};

function rowsOf(count: number, value = "x") {
  return Array.from({ length: count }, (_, index) => ({
    f: [{ v: String(index) }, { v: value }],
  }));
}

function completedPoll(rows: { f: { v: unknown }[] }[], extra = {}) {
  return json({
    jobComplete: true,
    schema: {
      fields: [
        { name: "id", type: "INT64" },
        { name: "name", type: "STRING" },
      ],
    },
    totalRows: String(rows.length),
    rows,
    ...extra,
  });
}

beforeEach(async () => {
  database.client = await PGlite.create("memory://");
  for (const statement of BIGQUERY_AGENT_BUDGET_MIGRATION_SQL) {
    await database.client.exec(statement);
  }
  calls.submissions = [];
  calls.dryRuns = 0;
  calls.cancels = 0;
  calls.polls = [];
  scenario = {
    dryRunStatistics: {
      totalBytesProcessed: String(GIB),
      query: { statementType: "SELECT", referencedTables: [USERS] },
    },
    submit: async (body) =>
      json({ jobReference: { ...body.jobReference, location: "US" } }),
    poll: async () => completedPoll(rowsOf(3)),
    table: () => json({ type: "TABLE" }),
    jobsGet: (jobId) =>
      json({
        jobReference: { projectId: "builder-3b0a2", jobId, location: "US" },
        status: { state: "DONE" },
        statistics: {
          query: {
            totalBytesProcessed: String(GIB),
            totalBytesBilled: String(512 * 1024 ** 2),
            cacheHit: false,
          },
        },
      }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (url.pathname.includes("/tables/")) {
        return scenario.table();
      }
      if (method === "POST" && url.pathname.endsWith("/cancel")) {
        calls.cancels++;
        return json({});
      }
      if (method === "POST" && url.pathname.endsWith("/jobs")) {
        const body = JSON.parse(String(init?.body));
        if (body.configuration?.dryRun) {
          calls.dryRuns++;
          return json({ statistics: scenario.dryRunStatistics });
        }
        calls.submissions.push(body);
        return scenario.submit(body, init?.signal);
      }
      if (url.pathname.includes("/queries/")) {
        calls.polls.push(url);
        return scenario.poll(url, init?.signal);
      }
      if (url.pathname.endsWith("/jobs")) {
        return json({ jobs: [] });
      }
      if (url.pathname.includes("/jobs/")) {
        return scenario.jobsGet(
          decodeURIComponent(url.pathname.split("/").pop()!),
        );
      }
      throw new Error(`Unexpected BigQuery request ${method} ${url}`);
    }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await database.client?.close();
  database.client = null;
});

async function admissions() {
  const { rows } = await database.client!.query(
    "SELECT job_id, state, reserved_bytes::text AS reserved, billed_bytes::text AS billed FROM analytics_bigquery_agent_jobs ORDER BY created_at",
  );
  return rows as Array<{
    job_id: string;
    state: string;
    reserved: string;
    billed: string | null;
  }>;
}

async function executions() {
  const { rows } = await database.client!.query(
    "SELECT status, code, job_id, estimated_bytes::text AS estimated, billed_bytes::text AS billed, truncated, cancelled, query_hash, policy_version FROM analytics_bigquery_agent_executions",
  );
  return rows as Array<Record<string, unknown>>;
}

describe("runBigQueryAgentQuery", () => {
  it("submits the job under its admitted ID with maximumBytesBilled = R ≤ 50 GB, then settles from totalBytesBilled", async () => {
    let admittedBeforeSubmit = false;
    scenario.submit = async (body) => {
      const rows = await admissions();
      admittedBeforeSubmit =
        rows.length === 1 &&
        rows[0]!.state === "pending" &&
        rows[0]!.job_id === body.jobReference.jobId;
      return json({ jobReference: { ...body.jobReference, location: "US" } });
    };
    const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });

    const expectedReservation = reservationForEstimate(
      GIB,
      OUTSIDE_AGENT_JOB_CAP_BYTES,
    );
    expect(calls.submissions).toHaveLength(1);
    const payload = calls.submissions[0];
    expect(payload.configuration.query.maximumBytesBilled).toBe(
      String(expectedReservation),
    );
    expect(
      Number(payload.configuration.query.maximumBytesBilled),
    ).toBeLessThanOrEqual(OUTSIDE_AGENT_JOB_CAP_BYTES);
    expect(payload.configuration.query.query).toBe(SQL);
    expect(admittedBeforeSubmit).toBe(true);
    expect(result).toMatchObject({
      status: "completed",
      rowCount: 3,
      truncated: false,
      cost: {
        estimatedBytes: GIB,
        reservedBytes: expectedReservation,
        billedBytes: 512 * 1024 ** 2,
      },
    });
    expect(await admissions()).toEqual([
      expect.objectContaining({
        state: "settled",
        billed: String(512 * 1024 ** 2),
      }),
    ]);
    expect(await executions()).toEqual([
      expect.objectContaining({
        status: "completed",
        code: "ready",
        billed: String(512 * 1024 ** 2),
        truncated: false,
      }),
    ]);
  });

  it.each([
    [
      "missing",
      { query: { statementType: "SELECT", referencedTables: [USERS] } },
    ],
    [
      "negative",
      {
        totalBytesProcessed: "-5",
        query: { statementType: "SELECT", referencedTables: [USERS] },
      },
    ],
    [
      "fractional",
      {
        totalBytesProcessed: "1.5",
        query: { statementType: "SELECT", referencedTables: [USERS] },
      },
    ],
    [
      "non-numeric",
      {
        totalBytesProcessed: "12abc",
        query: { statementType: "SELECT", referencedTables: [USERS] },
      },
    ],
    [
      "an object",
      {
        totalBytesProcessed: {},
        query: { statementType: "SELECT", referencedTables: [USERS] },
      },
    ],
  ])(
    "fails closed on %s dry-run byte statistics",
    async (_name, statistics) => {
      scenario.dryRunStatistics = statistics;
      const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
      expect(result).toMatchObject({
        status: "refused",
        code: "estimate_unavailable",
      });
      expect(calls.submissions).toHaveLength(0);
      expect(await admissions()).toEqual([]);
      expect(await executions()).toEqual([
        expect.objectContaining({
          status: "refused",
          code: "estimate_unavailable",
        }),
      ]);
    },
  );

  it("reserves, and caps the job at, the whole per-job limit when a dry run that reads tables reports zero bytes", async () => {
    scenario.dryRunStatistics = {
      totalBytesProcessed: "0",
      query: { statementType: "SELECT", referencedTables: [USERS] },
    };
    await runBigQueryAgentQuery({ sql: SQL, source: "test" });
    expect(calls.submissions[0].configuration.query.maximumBytesBilled).toBe(
      String(OUTSIDE_AGENT_JOB_CAP_BYTES),
    );
  });

  it("refuses a query estimated over 50 GB before admission", async () => {
    scenario.dryRunStatistics = {
      totalBytesProcessed: String(60_000_000_000),
      query: { statementType: "SELECT", referencedTables: [USERS] },
    };
    const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
    expect(result).toMatchObject({ status: "refused", code: "over_job_cap" });
    expect(result.status === "refused" && result.message).toMatch(
      /Narrow the date range/,
    );
    expect(calls.submissions).toHaveLength(0);
  });

  it("refuses by policy before any dry run, and records the refusal", async () => {
    const result = await runBigQueryAgentQuery({
      sql: "SELECT * FROM `builder-3b0a2.dbt_mart.INFORMATION_SCHEMA.TABLES`",
      source: "test",
    });
    expect(result).toMatchObject({
      status: "refused",
      code: "query_feature_not_allowed",
    });
    expect(calls.dryRuns).toBe(0);
    expect(await executions()).toEqual([
      expect.objectContaining({
        status: "refused",
        code: "query_feature_not_allowed",
        policy_version: expect.any(String),
        query_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    ]);
  });

  it("starts no job when the budget refuses it", async () => {
    await database.client!.query(
      `INSERT INTO analytics_bigquery_agent_jobs (request_id, project_id, job_id, owner_email, org_id, org_key,
         credential_scope, source, utc_day, reserved_bytes, state, submission_state, created_at, lease_expires_at)
       VALUES ('seed', 'builder-3b0a2', 'seed', 'alice@example.com', 'org-1', 'org:org-1', 'default', 'test',
         $1, 175000000000, 'pending', 'accepted', $2, $3)`,
      [
        new Date().toISOString().slice(0, 10),
        new Date().toISOString(),
        new Date(Date.now() + 3_600_000).toISOString(),
      ],
    );
    const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
    expect(result).toMatchObject({
      status: "refused",
      code: "budget_exhausted",
    });
    expect(result.status === "refused" && result.message).toMatch(
      /00:00 UTC.*|resets at/,
    );
    expect(calls.submissions).toHaveLength(0);
  });

  it("keeps the reservation when a stalled submission hits the deadline", async () => {
    scenario.submit = (_body, signal) => untilAborted(signal);
    const result = await runBigQueryAgentQuery({
      sql: SQL,
      source: "test",
      deadlineMs: 300,
    });
    expect(result).toMatchObject({
      status: "uncertain",
      code: "query_timeout",
    });
    expect(result.status === "uncertain" && result.message).toMatch(
      /may still be running.*stays reserved.*Do not resubmit/,
    );
    expect(calls.submissions).toHaveLength(1);
    expect(await admissions()).toEqual([
      expect.objectContaining({ state: "pending" }),
    ]);
    expect(await executions()).toEqual([
      expect.objectContaining({ status: "uncertain", cancelled: true }),
    ]);
  });

  it("keeps the reservation and requests a bounded cancel when a stalled poll hits the deadline", async () => {
    scenario.poll = (_url, signal) => untilAborted(signal);
    const result = await runBigQueryAgentQuery({
      sql: SQL,
      source: "test",
      deadlineMs: 300,
    });
    expect(result).toMatchObject({
      status: "uncertain",
      code: "query_timeout",
    });
    expect(calls.cancels).toBe(1);
    const [admission] = await admissions();
    expect(admission).toMatchObject({ state: "pending" });
    expect(Number(admission!.reserved)).toBeGreaterThan(0);
  });

  it("looks an ambiguous submission up by its ID and never resubmits under a new one", async () => {
    let attempts = 0;
    scenario.submit = async () => {
      attempts++;
      throw new TypeError("fetch failed");
    };
    const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
    expect(result.status).toBe("completed");
    expect(attempts).toBe(1);
    expect(
      new Set(calls.submissions.map((body) => body.jobReference.jobId)).size,
    ).toBe(1);
  });

  it("returns 5,000 rows with an honest truncated flag from a 5,001st sentinel row", async () => {
    scenario.poll = async () =>
      completedPoll(rowsOf(BIGQUERY_AGENT_MAX_ROWS + 1));
    const cut = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
    expect(calls.polls[0]!.searchParams.get("maxResults")).toBe(
      String(BIGQUERY_AGENT_MAX_ROWS + 1),
    );
    expect(cut).toMatchObject({
      status: "completed",
      rowCount: BIGQUERY_AGENT_MAX_ROWS,
      truncated: true,
      truncation: "rows",
    });

    scenario.poll = async () => completedPoll(rowsOf(BIGQUERY_AGENT_MAX_ROWS));
    const whole = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
    expect(whole).toMatchObject({
      rowCount: BIGQUERY_AGENT_MAX_ROWS,
      truncated: false,
      truncation: null,
    });
  });

  it("caps the serialized result bytes", async () => {
    scenario.poll = async () => completedPoll(rowsOf(50, "y".repeat(200)));
    const result = await runBigQueryAgentQuery({
      sql: SQL,
      source: "test",
      maxResultBytes: 2_000,
    });
    expect(result).toMatchObject({ truncated: true, truncation: "bytes" });
    if (result.status !== "completed") throw new Error("expected rows");
    expect(Buffer.byteLength(JSON.stringify(result.rows))).toBeLessThanOrEqual(
      2_000,
    );
    expect(result.rowCount).toBeGreaterThan(0);
  });

  it("settles a confirmed provider cache hit at zero", async () => {
    scenario.poll = async () => completedPoll(rowsOf(2), { cacheHit: true });
    scenario.jobsGet = (jobId) =>
      json({
        jobReference: { projectId: "builder-3b0a2", jobId, location: "US" },
        status: { state: "DONE" },
        statistics: {
          query: { totalBytesProcessed: String(GIB), cacheHit: true },
        },
      });
    const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
    expect(result).toMatchObject({
      cost: { billedBytes: 0, providerCacheHit: true },
    });
    expect(await admissions()).toEqual([
      expect.objectContaining({ state: "settled", billed: "0" }),
    ]);
  });

  it("estimates without submitting: the estimate, the reservation and what is left today", async () => {
    const result = await runBigQueryAgentQuery({
      sql: SQL,
      source: "test",
      estimateOnly: true,
    });
    expect(result).toMatchObject({
      status: "ready",
      code: "ready",
      cost: { estimatedBytes: GIB },
      budget: { person: { noAskAllowanceUsd: 1 }, org: { limitUsd: 50 } },
    });
    expect(calls.submissions).toHaveLength(0);
    expect(await admissions()).toEqual([]);
    expect(await executions()).toEqual([
      expect.objectContaining({ status: "ready", job_id: null }),
    ]);
  });

  it("saves the job's location once BigQuery accepts it, even when settlement can't read the bill", async () => {
    scenario.jobsGet = () => json({ error: { code: 500 } }, 500);
    const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
    expect(result).toMatchObject({
      status: "completed",
      cost: { billedBytes: null },
    });
    const { rows } = await database.client!.query(
      "SELECT state, location, submission_state FROM analytics_bigquery_agent_jobs",
    );
    expect(rows).toEqual([
      { state: "pending", location: "US", submission_state: "accepted" },
    ]);
  });

  it("sends nothing when the deadline passes while admission reconciles", async () => {
    const now = new Date();
    await database.client!.query(
      `INSERT INTO analytics_bigquery_agent_jobs (request_id, project_id, job_id, owner_email, org_id, org_key,
         credential_scope, source, utc_day, reserved_bytes, state, submission_state, created_at, lease_expires_at)
       VALUES ('stale', 'builder-3b0a2', 'stale_job', 'alice@example.com', 'org-1', 'org:org-1', 'default', 'test',
         $1, 1000, 'pending', 'unknown', $2, $2)`,
      [
        now.toISOString().slice(0, 10),
        new Date(now.getTime() - 600_000).toISOString(),
      ],
    );
    scenario.jobsGet = (jobId) =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve(
              json({
                jobReference: {
                  projectId: "builder-3b0a2",
                  jobId,
                  location: "US",
                },
                status: { state: "RUNNING" },
              }),
            ),
          400,
        ),
      );
    const result = await runBigQueryAgentQuery({
      sql: SQL,
      source: "test",
      deadlineMs: 250,
    });
    expect(result).toMatchObject({ status: "refused", code: "query_timeout" });
    expect(result.status === "refused" && result.message).toMatch(
      /nothing ran/,
    );
    expect(calls.submissions).toHaveLength(0);
    const released = (await admissions()).find(
      (row) => row.job_id !== "stale_job",
    );
    expect(released).toMatchObject({ state: "released" });
  });

  it("calls a missing table an invalid query and still records the call", async () => {
    scenario.table = () =>
      json({ error: { code: 404, message: "Not found" } }, 404);
    // Table metadata is cached in-process, so this table is one no other case reads.
    const result = await runBigQueryAgentQuery({
      sql: "SELECT id FROM `builder-3b0a2.dbt_mart.never_created`",
      source: "test",
    });
    expect(result).toMatchObject({ status: "refused", code: "query_invalid" });
    expect(calls.dryRuns).toBe(0);
    expect(await executions()).toEqual([
      expect.objectContaining({ status: "refused", code: "query_invalid" }),
    ]);
  });

  it("returns no rows when the execution record cannot be written", async () => {
    await database.client!.exec(
      "DROP TABLE analytics_bigquery_agent_executions",
    );
    const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
    expect(result).toMatchObject({
      status: "failed",
      code: "execution_record_unavailable",
    });
    expect(result).not.toHaveProperty("rows");
    // The job did run and was settled, so the agent is told not to resubmit.
    expect(result.status === "failed" && result.message).toMatch(
      /do not resubmit/,
    );
    expect(await admissions()).toEqual([
      expect.objectContaining({ state: "settled" }),
    ]);
  });
});
