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
const access = vi.hoisted(() => ({
  calls: [] as Array<{ projectId: string | undefined }>,
  stall: false,
}));
vi.mock("./gcloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gcloud")>()),
  getBigQueryAccessToken: async () => "unfrozen-token",
  getBigQueryAccess: async (options: {
    projectId?: string;
    signal?: AbortSignal;
  }) => {
    access.calls.push({ projectId: options.projectId });
    if (access.stall) {
      await new Promise((_resolve, reject) =>
        options.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      );
    }
    return {
      token: "test-token",
      principal:
        "sa:runner@builder-3b0a2.iam.gserviceaccount.com#0a1b2c3d4e5f6a7b",
    };
  },
}));

const {
  approveBigQueryAgentDailyAllowance,
  BIGQUERY_AGENT_BUDGET_MIGRATION_SQL,
  BIGQUERY_AGENT_CREDENTIAL_FINGERPRINT_MIGRATION_SQL,
  BIGQUERY_AGENT_EXECUTION_JOB_IDENTITY_MIGRATION_SQL,
  OUTSIDE_AGENT_JOB_CAP_BYTES,
} = await import("./bigquery-agent-budget");
const { BIGQUERY_USAGE_MIGRATION_SQL } = await import("./bigquery-usage");
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

interface JobInsert {
  jobReference: { jobId: string };
  configuration: { query: { query: string; maximumBytesBilled: string } };
}

interface DryRunBody {
  jobReference?: { projectId: string; location?: string };
  configuration: { query: { query: string } };
}

interface Scenario {
  dryRunStatistics: Record<string, unknown>;
  dryRun?: (signal?: AbortSignal | null) => Response | Promise<Response>;
  submit: (body: JobInsert, signal?: AbortSignal | null) => Promise<Response>;
  poll: (url: URL, signal?: AbortSignal | null) => Promise<Response>;
  jobsGet: (jobId: string) => Response | Promise<Response>;
  table: () => Response;
}

let scenario: Scenario;
const calls = {
  submissions: [] as JobInsert[],
  dryRuns: 0,
  dryRunBodies: [] as DryRunBody[],
  cancels: 0,
  cancelUrls: [] as URL[],
  polls: [] as URL[],
  authorizations: [] as string[],
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
  for (const statement of [
    ...BIGQUERY_AGENT_BUDGET_MIGRATION_SQL,
    ...BIGQUERY_AGENT_CREDENTIAL_FINGERPRINT_MIGRATION_SQL,
    ...BIGQUERY_AGENT_EXECUTION_JOB_IDENTITY_MIGRATION_SQL,
    BIGQUERY_USAGE_MIGRATION_SQL,
  ]) {
    await database.client.exec(statement);
  }
  calls.submissions = [];
  calls.dryRuns = 0;
  calls.dryRunBodies = [];
  calls.cancels = 0;
  calls.cancelUrls = [];
  calls.polls = [];
  calls.authorizations = [];
  access.calls = [];
  access.stall = false;
  scenario = {
    dryRunStatistics: {
      totalBytesProcessed: String(GIB),
      query: { statementType: "SELECT", referencedTables: [USERS] },
    },
    submit: async (body) =>
      json({ jobReference: { ...body.jobReference, location: "US" } }),
    poll: async () => completedPoll(rowsOf(3)),
    table: () => json({ type: "TABLE", location: "US" }),
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
      calls.authorizations.push(
        String(
          (init?.headers as Record<string, string> | undefined)
            ?.Authorization ?? "",
        ),
      );
      if (url.pathname.includes("/tables/")) {
        return scenario.table();
      }
      if (method === "POST" && url.pathname.endsWith("/cancel")) {
        calls.cancels++;
        calls.cancelUrls.push(url);
        return json({});
      }
      if (method === "POST" && url.pathname.endsWith("/jobs")) {
        const body = JSON.parse(String(init?.body));
        if (body.configuration?.dryRun) {
          calls.dryRuns++;
          calls.dryRunBodies.push(body);
          if (scenario.dryRun) return scenario.dryRun(init?.signal);
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
        return json({ kind: "bigquery#jobList", jobs: [] });
      }
      if (url.pathname.includes("/jobs/")) {
        return scenario.jobsGet(
          decodeURIComponent(url.pathname.split("/").pop() ?? ""),
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
  const { rows } = await must(database.client).query(
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
  const { rows } = await must(database.client).query(
    "SELECT status, code, job_id, estimated_bytes::text AS estimated, billed_bytes::text AS billed, truncated, cancelled, query_hash, policy_version FROM analytics_bigquery_agent_executions",
  );
  return rows as Array<Record<string, unknown>>;
}

async function seedPersonUsage(reservedBytes: number) {
  const now = new Date();
  await must(database.client).query(
    `INSERT INTO analytics_bigquery_agent_jobs (request_id, project_id, job_id, owner_email, org_id, org_key,
       credential_scope, source, utc_day, reserved_bytes, state, submission_state, created_at, lease_expires_at)
     VALUES ('seed', 'builder-3b0a2', 'seed', 'alice@example.com', 'org-1', 'org:org-1', 'default', 'test',
       $1, $2, 'pending', 'accepted', $3, $4)`,
    [
      now.toISOString().slice(0, 10),
      reservedBytes,
      now.toISOString(),
      new Date(now.getTime() + 3_600_000).toISOString(),
    ],
  );
}

describe("runBigQueryAgentQuery", () => {
  it("submits the job under its admitted ID with maximumBytesBilled = R ≤ 50 GB, then settles from totalBytesBilled", async () => {
    let admittedBeforeSubmit = false;
    scenario.submit = async (body) => {
      const rows = await admissions();
      admittedBeforeSubmit =
        rows.length === 1 &&
        must(rows[0]).state === "pending" &&
        must(rows[0]).job_id === body.jobReference.jobId;
      return json({ jobReference: { ...body.jobReference, location: "US" } });
    };
    const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });

    const expectedReservation = reservationForEstimate(
      GIB,
      OUTSIDE_AGENT_JOB_CAP_BYTES,
    );
    expect(calls.submissions).toHaveLength(1);
    const payload = must(calls.submissions[0]);
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
    expect(
      must(calls.submissions[0]).configuration.query.maximumBytesBilled,
    ).toBe(String(OUTSIDE_AGENT_JOB_CAP_BYTES));
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
    await seedPersonUsage(879_000_000_000);
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
    expect(Number(must(admission).reserved)).toBeGreaterThan(0);
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
    expect(must(calls.polls[0]).searchParams.get("maxResults")).toBe(
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

  function servePages(pages: Array<{ f: { v: unknown }[] }[]>) {
    scenario.poll = async (url) => {
      const index = Number(url.searchParams.get("pageToken") ?? 0);
      return completedPoll(
        must(pages[index]),
        index + 1 < pages.length ? { nextPageToken: String(index + 1) } : {},
      );
    };
  }

  it("fetches no further page once a page passes the byte cap", async () => {
    const page = rowsOf(50, "y".repeat(200));
    servePages([page, page, page]);
    const result = await runBigQueryAgentQuery({
      sql: SQL,
      source: "test",
      maxResultBytes: 2_000,
    });
    expect(calls.polls).toHaveLength(1);
    expect(result).toMatchObject({ truncated: true, truncation: "bytes" });
    if (result.status !== "completed") throw new Error("expected rows");
    expect(result.rows.map((row) => row.id)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(Buffer.byteLength(JSON.stringify(result.rows))).toBeLessThanOrEqual(
      2_000,
    );
  });

  it("cuts at the row cap across pages and fetches no page past it", async () => {
    servePages([rowsOf(3, "a"), rowsOf(3, "b"), rowsOf(3, "c")]);
    const cut = await runBigQueryAgentQuery({
      sql: SQL,
      source: "test",
      maxRows: 5,
    });
    expect(calls.polls).toHaveLength(2);
    expect(cut).toMatchObject({ rowCount: 5, truncation: "rows" });
    if (cut.status !== "completed") throw new Error("expected rows");
    expect(cut.rows.map((row) => row.name)).toEqual(["a", "a", "a", "b", "b"]);

    calls.polls = [];
    servePages([rowsOf(3, "a"), rowsOf(3, "b")]);
    expect(
      await runBigQueryAgentQuery({ sql: SQL, source: "test", maxRows: 6 }),
    ).toMatchObject({ rowCount: 6, truncation: null });
    expect(calls.polls).toHaveLength(2);
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
      executedSql: SQL,
      referencedTables: ["builder-3b0a2.dbt_mart.users"],
      bytesProcessed: GIB,
      cost: { estimatedBytes: GIB },
      budgetCheck: null,
      report: {
        thisCall: { jobsAdmitted: 0 },
        today: { person: { noAskAllowanceUsd: 1 }, org: { limitUsd: 50 } },
      },
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
    const { rows } = await must(database.client).query(
      "SELECT state, location, submission_state FROM analytics_bigquery_agent_jobs",
    );
    expect(rows).toEqual([
      { state: "pending", location: "US", submission_state: "accepted" },
    ]);
  });

  it("sends nothing when the deadline passes while admission reconciles", async () => {
    const now = new Date();
    await must(database.client).query(
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

  it("never makes its first send once the admission it committed has lapsed, even with time left on its deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const client = must(database.client);
      const transaction = client.transaction.bind(client);
      vi.spyOn(client, "transaction").mockImplementation((async (
        callback: Parameters<typeof transaction>[0],
      ) => {
        const result = await transaction(callback);
        vi.setSystemTime(Date.now() + 10 * 60_000);
        return result;
      }) as typeof client.transaction);
      const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
      expect(result).toMatchObject({
        status: "refused",
        code: "query_timeout",
      });
      expect(calls.submissions).toHaveLength(0);
      expect(await admissions()).toEqual([
        expect.objectContaining({ state: "released" }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the reservation when the resend of an ambiguous first send is refused", async () => {
    let sends = 0;
    scenario.submit = async () => {
      sends++;
      if (sends === 1) throw new TypeError("fetch failed");
      return json(
        {
          error: {
            code: 403,
            errors: [{ reason: "accessDenied", message: "Access Denied" }],
          },
        },
        403,
      );
    };
    scenario.jobsGet = () => json({ error: { code: 404 } }, 404);
    const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
    expect(calls.submissions).toHaveLength(2);
    expect(result).toMatchObject({
      status: "uncertain",
      code: "job_outcome_unknown",
    });
    expect(await admissions()).toEqual([
      expect.objectContaining({ state: "pending" }),
    ]);
  });

  it("calls a missing table an invalid query and still records the call", async () => {
    scenario.table = () =>
      json({ error: { code: 404, message: "Not found" } }, 404);
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
    await must(database.client).exec(
      "DROP TABLE analytics_bigquery_agent_executions",
    );
    const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
    expect(result).toMatchObject({
      status: "failed",
      code: "execution_record_unavailable",
    });
    expect(result).not.toHaveProperty("rows");
    expect(result.status === "failed" && result.message).toMatch(
      /do not resubmit/,
    );
    expect(await admissions()).toEqual([
      expect.objectContaining({ state: "settled" }),
    ]);
  });
});

describe("runBigQueryAgentQuery: one frozen query", () => {
  it("resolves the credential once and sends metadata, dry run, job, polls and cancel with that token, project and location", async () => {
    scenario.poll = (_url, signal) => untilAborted(signal);
    const result = await runBigQueryAgentQuery({
      sql: "SELECT id FROM @project.dbt_mart.users",
      source: "test",
      deadlineMs: 400,
    });
    expect(result).toMatchObject({
      status: "uncertain",
      code: "query_timeout",
    });
    expect(access.calls).toEqual([{ projectId: "builder-3b0a2" }]);
    expect(new Set(calls.authorizations)).toEqual(
      new Set(["Bearer test-token"]),
    );
    const dryRun = must(calls.dryRunBodies[0]);
    const job = must(calls.submissions[0]) as JobInsert & {
      jobReference: { projectId: string; location?: string };
    };
    expect(dryRun.jobReference).toEqual({
      projectId: "builder-3b0a2",
      location: "US",
    });
    expect(job.jobReference).toMatchObject({
      projectId: "builder-3b0a2",
      location: "US",
    });
    expect(dryRun.configuration.query.query).toBe(
      job.configuration.query.query,
    );
    expect(job.configuration.query.query).toBe(
      "SELECT id FROM `builder-3b0a2`.dbt_mart.users",
    );
    expect(
      calls.polls.every((url) => url.searchParams.get("location") === "US"),
    ).toBe(true);
    expect(calls.cancels).toBe(1);
    expect(must(calls.cancelUrls[0]).searchParams.get("location")).toBe("US");
  });

  it("returns the SQL it ran, the tables it read and BigQuery's bytes processed", async () => {
    scenario.poll = async () =>
      completedPoll(rowsOf(2), { totalBytesProcessed: String(GIB) });
    const result = await runBigQueryAgentQuery({
      sql: "SELECT id, name FROM @project.dbt_mart.users",
      source: "test",
    });
    expect(result).toMatchObject({
      status: "completed",
      executedSql: "SELECT id, name FROM `builder-3b0a2`.dbt_mart.users",
      referencedTables: ["builder-3b0a2.dbt_mart.users"],
      bytesProcessed: GIB,
      location: "US",
      rowCount: 2,
    });
    expect(must(calls.submissions[0]).configuration.query.query).toBe(
      "SELECT id, name FROM `builder-3b0a2`.dbt_mart.users",
    );
  });

  it("reports a query that returned no rows as completed with zero rows", async () => {
    scenario.poll = async () => completedPoll([]);
    const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
    expect(result).toMatchObject({
      status: "completed",
      rowCount: 0,
      rows: [],
      truncated: false,
    });
  });

  it("stops at its deadline while the credential is still resolving, and sends nothing", async () => {
    access.stall = true;
    const result = await runBigQueryAgentQuery({
      sql: SQL,
      source: "test",
      deadlineMs: 200,
    });
    expect(result).toMatchObject({ status: "refused", code: "query_timeout" });
    expect(calls.dryRuns).toBe(0);
    expect(calls.submissions).toHaveLength(0);
    expect(await admissions()).toEqual([]);
  });

  it("stops at its deadline during a stalled dry run, and sends no job", async () => {
    scenario.dryRun = (signal) => untilAborted(signal);
    const result = await runBigQueryAgentQuery({
      sql: SQL,
      source: "test",
      deadlineMs: 200,
    });
    expect(result).toMatchObject({ status: "refused", code: "query_timeout" });
    expect(calls.submissions).toHaveLength(0);
  });

  it("refuses tables that live in different locations before any dry run", async () => {
    let call = 0;
    scenario.table = () =>
      json({ type: "TABLE", location: call++ === 0 ? "US" : "EU" });
    const result = await runBigQueryAgentQuery({
      sql: "SELECT u.id FROM `builder-3b0a2.dbt_mart.users` u JOIN `builder-3b0a2.hubspot.companies` c ON c.id = u.id",
      source: "test",
    });
    expect(result).toMatchObject({ status: "refused", code: "query_invalid" });
    expect(calls.dryRuns).toBe(0);
  });

  it("fails closed when table metadata gives no location", async () => {
    scenario.table = () => json({ type: "TABLE" });
    const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
    expect(result).toMatchObject({
      status: "refused",
      code: "query_table_not_allowed",
    });
    expect(calls.dryRuns).toBe(0);
  });
});

describe("runBigQueryAgentQuery: the dry run must agree with the policy", () => {
  it.each([
    [
      "a missing statement type",
      {
        totalBytesProcessed: String(GIB),
        query: { referencedTables: [USERS] },
      },
      "query_statement_not_allowed",
    ],
    [
      "a script",
      {
        totalBytesProcessed: String(GIB),
        query: { statementType: "SCRIPT", referencedTables: [USERS] },
      },
      "query_statement_not_allowed",
    ],
    [
      "a missing table list",
      { totalBytesProcessed: String(GIB), query: { statementType: "SELECT" } },
      "query_table_not_allowed",
    ],
    [
      "an unreadable table list",
      {
        totalBytesProcessed: String(GIB),
        query: { statementType: "SELECT", referencedTables: [{ tableId: 1 }] },
      },
      "query_table_not_allowed",
    ],
    [
      "a table the SQL does not name",
      {
        totalBytesProcessed: String(GIB),
        query: {
          statementType: "SELECT",
          referencedTables: [
            USERS,
            { projectId: "builder-3b0a2", datasetId: "raw", tableId: "pii" },
          ],
        },
      },
      "query_table_not_allowed",
    ],
    [
      "a routine",
      {
        totalBytesProcessed: String(GIB),
        query: {
          statementType: "SELECT",
          referencedTables: [USERS],
          referencedRoutines: [
            {
              projectId: "builder-3b0a2",
              datasetId: "dbt_mart",
              routineId: "remote_fn",
            },
          ],
        },
      },
      "query_feature_not_allowed",
    ],
  ])(
    "refuses a dry run with %s and starts no job",
    async (_name, statistics, code) => {
      scenario.dryRunStatistics = statistics;
      const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
      expect(result).toMatchObject({ status: "refused", code });
      expect(calls.submissions).toHaveLength(0);
      expect(await admissions()).toEqual([]);
    },
  );

  it("fails closed on a truncated dry-run response body", async () => {
    scenario.dryRun = () =>
      new Response('{"statistics":{"totalBytesProcessed":"10', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const result = await runBigQueryAgentQuery({ sql: SQL, source: "test" });
    expect(result).toMatchObject({
      status: "refused",
      code: "query_statement_not_allowed",
    });
    expect(calls.submissions).toHaveLength(0);
  });

  it("refuses a statement the lexer reads as more than one SELECT without a dry run", async () => {
    // raw-sql-ok: a fixed two-statement probe the policy must refuse before anything runs.
    const result = await runBigQueryAgentQuery({
      sql: `${SQL}; DELETE FROM \`builder-3b0a2.dbt_mart.users\` WHERE TRUE`,
      source: "test",
    });
    expect(result).toMatchObject({
      status: "refused",
      code: "query_statement_not_allowed",
    });
    expect(calls.dryRuns).toBe(0);
  });
});

describe("runBigQueryAgentQuery: spend past the no-ask allowance", () => {
  it("asks through query-warehouse instead of running past $1", async () => {
    await seedPersonUsage(175_000_000_000);
    const result = await runBigQueryAgentQuery({
      sql: SQL,
      source: "query-warehouse",
      askVia: "query-warehouse",
    });
    expect(result).toMatchObject({
      status: "refused",
      code: "approval_required",
      report: { refusal: { code: "approval_required" } },
    });
    expect(result.status === "refused" && result.message).toMatch(
      /Calling query-warehouse with the same arguments asks you once/,
    );
    expect(calls.submissions).toHaveLength(0);
  });

  it("over A2A, where nothing can ask, says the approval is needed and does not run", async () => {
    await seedPersonUsage(175_000_000_000);
    const result = await runBigQueryAgentQuery({
      sql: SQL,
      source: "query-warehouse",
      caller: "a2a",
    });
    expect(result).toMatchObject({
      status: "refused",
      code: "approval_required",
    });
    expect(result.status === "refused" && result.message).toMatch(
      /query-warehouse/,
    );
    expect(calls.submissions).toHaveLength(0);
  });

  it("runs once the person has allowed more today", async () => {
    await seedPersonUsage(175_000_000_000);
    await approveBigQueryAgentDailyAllowance(
      { ownerEmail: "alice@example.com", orgId: "org-1" },
      "mcp-review-page",
    );
    const result = await runBigQueryAgentQuery({
      sql: SQL,
      source: "query-warehouse",
      askVia: "query-warehouse",
    });
    expect(result).toMatchObject({
      status: "completed",
      report: {
        thisCall: { jobsAdmitted: 1 },
        today: { person: { approvedToday: true } },
      },
    });
    expect(calls.submissions).toHaveLength(1);
  });

  it("names, in an estimate, the refusal a run would get", async () => {
    await seedPersonUsage(175_000_000_000);
    const result = await runBigQueryAgentQuery({
      sql: SQL,
      source: "query-warehouse",
      estimateOnly: true,
    });
    expect(result).toMatchObject({
      status: "ready",
      budgetCheck: { code: "approval_required", scope: "person" },
    });
    expect(calls.submissions).toHaveLength(0);
  });
});

describe("runBigQueryAgentQuery: what it records", () => {
  async function executionRows() {
    const { rows } = await must(database.client).query(
      "SELECT * FROM analytics_bigquery_agent_executions",
    );
    return rows as Array<Record<string, unknown>>;
  }

  it("records the caller, actor, org, job identity and bytes, and never the SQL or a row", async () => {
    scenario.poll = async () =>
      completedPoll(rowsOf(2, "secret-cell"), {
        totalBytesProcessed: String(GIB),
      });
    const result = await runBigQueryAgentQuery({
      sql: SQL,
      source: "query-warehouse",
      caller: "a2a",
    });
    if (result.status !== "completed") throw new Error("expected rows");
    const [row] = await executionRows();
    expect(row).toMatchObject({
      owner_email: "alice@example.com",
      org_id: "org-1",
      caller: "a2a",
      source: "query-warehouse",
      project_id: "builder-3b0a2",
      job_id: result.jobId,
      location: "US",
      status: "completed",
      row_count: 2,
      truncated: false,
      cancelled: false,
    });
    expect(Number(must(row).bytes_processed)).toBe(GIB);
    expect(must(row).query_hash).toMatch(/^[0-9a-f]{64}$/);
    const stored = JSON.stringify(row);
    expect(stored).not.toContain("SELECT");
    expect(stored).not.toContain("secret-cell");
  });

  it("records each submitted job in the per-job BigQuery usage records", async () => {
    const result = await runBigQueryAgentQuery({
      sql: SQL,
      source: "query-warehouse",
    });
    if (result.status !== "completed") throw new Error("expected rows");
    const { rows } = await must(database.client).query(
      "SELECT project_id, job_id, owner_email, org_id, workload FROM analytics_bigquery_usage",
    );
    expect(rows).toEqual([
      {
        project_id: "builder-3b0a2",
        job_id: result.jobId,
        owner_email: "alice@example.com",
        org_id: "org-1",
        workload: "outside-agent-query",
      },
    ]);
  });

  it("caps the job at the per-job limit even when the estimate is just under it", async () => {
    scenario.dryRunStatistics = {
      totalBytesProcessed: String(49_900_000_000),
      query: { statementType: "SELECT", referencedTables: [USERS] },
    };
    await approveBigQueryAgentDailyAllowance(
      { ownerEmail: "alice@example.com", orgId: "org-1" },
      "mcp-review-page",
    );
    await runBigQueryAgentQuery({ sql: SQL, source: "test" });
    expect(
      must(calls.submissions[0]).configuration.query.maximumBytesBilled,
    ).toBe(String(OUTSIDE_AGENT_JOB_CAP_BYTES));
  });
});
