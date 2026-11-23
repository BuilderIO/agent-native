import { defineAction } from "@agent-native/core/action";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { OutsideAgentBigQueryReport } from "../server/lib/bigquery-agent-calls";

function must<T>(value: T | null | undefined, message = "Expected a value"): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve: (value: T) => must(resolve)(value) };
}

const budget = vi.hoisted(() => ({
  admit: vi.fn(),
  mark: vi.fn(async () => undefined),
  settle: vi.fn(async () => true),
  read: vi.fn(),
}));
const journey = vi.hoisted(() => ({
  args: [] as Array<Record<string, unknown>>,
}));
const dryRun = vi.hoisted(() => ({
  response: null as null | (() => Response),
}));
const send = vi.hoisted(() => ({
  response: null as null | (() => Response),
}));
const after = vi.hoisted(() => ({
  firstJob: null as null | (() => Promise<unknown>),
}));
const captureState = vi.hoisted(() => ({
  email: "alice@example.com" as string | null,
  accessible: true,
  cached: false,
  chartType: "table",
  trackingError: false,
  keyDatesError: null as Error | null,
  exceptions: [] as Array<{ error: unknown; context: unknown }>,
  trackEvents: [] as string[],
}));
vi.mock("../server/lib/open-dashboard", () => ({
  openDashboard: async () =>
    captureState.accessible
      ? {
          saved: {
            id: "capture-test",
            kind: "sql",
            title: "Capture test",
            ownerEmail: "alice@example.com",
            orgId: "org-1",
            visibility: "org",
            config: {
              name: "Capture test",
              panels: [
                {
                  id: "cost",
                  title: "Cost",
                  source: "bigquery",
                  chartType: captureState.chartType,
                  sql: "SELECT 1 AS capture_budget_test",
                  config: {},
                },
              ],
            },
          },
        }
      : null,
  openedDashboardVisibility: async () => "org",
}));
vi.mock("../server/lib/key-dates-store", () => ({
  listKeyDateSets: async () => {
    if (captureState.keyDatesError) throw captureState.keyDatesError;
    return [];
  },
}));
const PRINCIPAL =
  "sa:runner@builder-3b0a2.iam.gserviceaccount.com#0a1b2c3d4e5f6a7b";

vi.mock("../server/lib/bigquery-agent-budget", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/bigquery-agent-budget")
  >()),
  admitBigQueryAgentJob: budget.admit,
  markBigQueryAgentJobSubmission: budget.mark,
  settleBigQueryAgentJob: budget.settle,
  readBigQueryAgentBudget: budget.read,
}));
vi.mock("../server/lib/bigquery-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/bigquery-usage")>()),
  persistBigQueryJobUsage: async () => true,
  finalizeBigQueryJobUsage: async (usage: {
    projectId: string;
    jobId: string;
  }) => ({
    status: "recorded",
    projectId: usage.projectId,
    jobId: usage.jobId,
  }),
}));
vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getDbExec: () => ({
    execute: async (request: { sql: string }) => {
      if (
        captureState.cached &&
        request.sql.startsWith("SELECT generation, fence_token")
      )
        return { rows: [] };
      if (
        captureState.cached &&
        request.sql.startsWith("SELECT result, created_at FROM bigquery_cache")
      ) {
        return {
          rows: [
            {
              result: JSON.stringify({
                rows: [{ x: 7 }],
                schema: [{ name: "x", type: "INT64" }],
                totalRows: 1,
                bytesProcessed: 0,
                cacheHit: true,
              }),
            },
          ],
        };
      }
      throw new Error("no cache database in this spec");
    },
  }),
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getCredentialContext: () => ({
    userEmail: "alice@example.com",
    orgId: "org-1",
  }),
  getRequestUserEmail: () => captureState.email,
  getRequestOrgId: () => "org-1",
  getRequestRunContext: () => undefined,
  platformWaitUntil: () => undefined,
}));
vi.mock("@agent-native/core/credentials", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/credentials")>()),
  resolveCredential: async (key: string) =>
    key === "BIGQUERY_PROJECT_ID" ? "builder-3b0a2" : null,
}));
vi.mock("../server/lib/credentials", () => ({
  resolveCredential: async (key: string) =>
    key === "BIGQUERY_PROJECT_ID" ? "builder-3b0a2" : null,
}));
vi.mock("../server/lib/gcloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/gcloud")>()),
  getBigQueryAccessToken: async () => "test-token",
  getBigQueryAccess: async () => ({
    token: "test-token",
    principal:
      "sa:runner@builder-3b0a2.iam.gserviceaccount.com#0a1b2c3d4e5f6a7b",
  }),
}));
vi.mock("@agent-native/core/tracking", () => ({
  captureException: (error: unknown, context: unknown) => {
    captureState.exceptions.push({ error, context });
  },
  track: (event: string) => {
    captureState.trackEvents.push(event);
    if (captureState.trackingError) throw new Error("Tracking unavailable");
  },
}));
vi.mock("../server/lib/onboarding-journey", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/onboarding-journey")>();
  return {
    ...actual,
    getOnboardingJourney: async (
      _scope: unknown,
      args: Record<string, unknown>,
    ) => {
      journey.args.push(args);
      const { runQuery } = await import("../server/lib/bigquery");
      await runQuery("SELECT 1 AS journey_page", {
        maxBytesBilled: actual.ONBOARDING_EVENTS_MAX_BYTES_BILLED,
      });
      await after.firstJob?.();
      return {
        window: { from: "2026-11-01", to: "2026-11-02" },
        app: "all",
        rootN: 0,
        coverage: {
          sessionsWithEvents: 0,
          sessionsWithReplay: 0,
          truncated: false,
        },
        nodes: [],
      };
    },
  };
});
vi.mock(
  "../server/lib/first-party-analytics-health",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../server/lib/first-party-analytics-health")
      >();
    return {
      ...actual,
      getFirstPartyAnalyticsHealth: async () => {
        const { runQuery } = await import("../server/lib/bigquery");
        await runQuery("SELECT 1 AS event_count", {
          maxBytesBilled: 100_000_000,
        });
        await after.firstJob?.();
        return actual.unavailableFirstPartyAnalyticsHealth(
          "health_read_failed",
        );
      },
    };
  },
);

vi.mock(
  "../server/lib/first-party-analytics-backend",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/lib/first-party-analytics-backend")
    >()),
    getFirstPartyAnalyticsBackend: async () => ({ sink: "bigquery" }),
  }),
);

vi.mock("../server/lib/first-party-analytics", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../server/lib/first-party-analytics")
    >();
  return {
    ...actual,
    queryFirstPartyAnalyticsWithBackend: async () => {
      const { runQuery } = await import("../server/lib/bigquery");
      await runQuery("SELECT 1 AS events", { maxBytesBilled: 100_000_000 });
      await after.firstJob?.();
      return { rows: [{ events: 1 }], schema: [], backend: "bigquery" };
    },
  };
});

const { default: capturePanel } = await import("./capture-dashboard-panel");
const { runQuery } = await import("../server/lib/bigquery");
const { OutsideAgentBigQueryRefusalError } =
  await import("../server/lib/bigquery-agent-context");
const {
  OUTSIDE_AGENT_JOB_CAP_BYTES,
  OUTSIDE_AGENT_ORG_LIMIT_BYTES,
  OUTSIDE_AGENT_PERSON_BASE_BYTES,
  OUTSIDE_AGENT_PERSON_CEILING_BYTES,
} = await import("../server/lib/bigquery-agent-budget");
const { default: getOnboardingJourney } =
  await import("./get-onboarding-journey");
const { default: getHealth } =
  await import("./get-first-party-analytics-health");
const { default: bigquery } = await import("./bigquery");
const { default: queryFirstParty } =
  await import("./query-agent-native-analytics");
const { OnboardingJourneyReadError } =
  await import("../server/lib/onboarding-journey");
const {
  createOutsideAgentBigQueryCall,
  outsideAgentCallReportOf,
  reportOutsideAgentBigQueryCall,
  runOutsideAgentBigQueryCall,
} = await import("../server/lib/bigquery-agent-calls");
const { withOutsideAgentBigQueryGate } =
  await import("../server/lib/bigquery-agent-context");

interface Submission {
  jobReference: { jobId: string };
  configuration: { query: { maximumBytesBilled: string } };
}

interface BudgetedResult {
  bigQueryBudget: OutsideAgentBigQueryReport;
  metrics: { coverage: unknown };
}

const submissions: Submission[] = [];
const duplicate = { jobId: null as string | null };

function snapshot(personRemaining = OUTSIDE_AGENT_PERSON_BASE_BYTES) {
  return {
    utcDay: "2026-11-17",
    resetsAt: "2026-11-18T00:00:00.000Z",
    jobCapBytes: OUTSIDE_AGENT_JOB_CAP_BYTES,
    person: {
      limitBytes: OUTSIDE_AGENT_PERSON_BASE_BYTES,
      settledBytes: OUTSIDE_AGENT_PERSON_BASE_BYTES - personRemaining,
      reservedBytes: 0,
      remainingBytes: personRemaining,
      baseAllowanceBytes: OUTSIDE_AGENT_PERSON_BASE_BYTES,
      ceilingBytes: OUTSIDE_AGENT_PERSON_CEILING_BYTES,
      approvedToday: false,
    },
    org: {
      limitBytes: OUTSIDE_AGENT_ORG_LIMIT_BYTES,
      settledBytes: 0,
      reservedBytes: 0,
      remainingBytes: OUTSIDE_AGENT_ORG_LIMIT_BYTES,
    },
    limitsSource: { person: "default", org: "default" },
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

const accessDenied = () =>
  json(
    {
      error: {
        code: 403,
        message: "Access Denied: Project builder-3b0a2",
        errors: [{ reason: "accessDenied", message: "Access Denied" }],
      },
    },
    403,
  );

beforeEach(() => {
  captureState.email = "alice@example.com";
  captureState.accessible = true;
  captureState.cached = false;
  captureState.chartType = "table";
  captureState.trackingError = false;
  captureState.keyDatesError = null;
  captureState.exceptions.length = 0;
  captureState.trackEvents.length = 0;
  submissions.length = 0;
  duplicate.jobId = null;
  journey.args.length = 0;
  dryRun.response = null;
  send.response = null;
  after.firstJob = null;
  budget.admit.mockReset();
  budget.admit.mockImplementation(async (_identity, request) => ({
    status: "admitted",
    requestId: `request-${request.jobId}`,
    reservedBytes: request.reservedBytes,
    created: true,
    leaseExpiresAt: new Date(Date.now() + request.leaseMs).toISOString(),
    budget: snapshot(),
  }));
  budget.read.mockReset();
  budget.read.mockResolvedValue(snapshot());
  budget.mark.mockClear();
  budget.settle.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === "POST" && url.pathname.endsWith("/jobs")) {
        const body = JSON.parse(String(init.body));
        if (body.configuration?.dryRun) {
          if (!dryRun.response) throw new Error("Unexpected dry run");
          return dryRun.response();
        }
        submissions.push(body);
        if (send.response) return send.response();
        if (duplicate.jobId === "next")
          duplicate.jobId = body.jobReference.jobId;
        if (body.jobReference.jobId === duplicate.jobId) {
          return json(
            {
              error: {
                code: 409,
                message: `Already Exists: Job builder-3b0a2:US.${duplicate.jobId}`,
                errors: [{ reason: "duplicate" }],
              },
            },
            409,
          );
        }
        return json({ jobReference: { ...body.jobReference, location: "US" } });
      }
      if (
        url.pathname.includes("/jobs/") &&
        url.searchParams.get("fields")?.includes("configuration")
      ) {
        const jobId = url.pathname.split("/").pop();
        return json({
          jobReference: { projectId: "builder-3b0a2", jobId, location: "US" },
          configuration: { query: { query: "SELECT 1 AS resumable" } },
          status: { state: "RUNNING" },
          statistics: { creationTime: String(Date.now() - 1_000) },
        });
      }
      if (url.pathname.includes("/queries/")) {
        return json({
          jobComplete: true,
          schema: { fields: [{ name: "x", type: "INT64" }] },
          totalRows: "1",
          rows: [{ f: [{ v: "1" }] }],
          totalBytesProcessed: "1048576",
          cacheHit: false,
        });
      }
      if (url.pathname.includes("/jobs/")) {
        const jobId = url.pathname.split("/").pop();
        return json({
          jobReference: { projectId: "builder-3b0a2", jobId, location: "US" },
          status: { state: "DONE" },
          statistics: {
            query: {
              totalBytesProcessed: "20971520",
              totalBytesBilled: "10485760",
              cacheHit: false,
            },
          },
        });
      }
      throw new Error(`Unexpected request ${url}`);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const journeyArgs = { dateFrom: "2026-11-01", dateTo: "2026-11-02" };

describe("outside-agent (MCP) jobs go through admission", () => {
  it("get-onboarding-journey admits each job before submitting it, under its reservation", async () => {
    const result = (await getOnboardingJourney.run(journeyArgs, {
      caller: "mcp",
    })) as BudgetedResult;

    expect(budget.admit).toHaveBeenCalledTimes(1);
    const [identity, request] = must(budget.admit.mock.calls[0]);
    expect(identity).toEqual({
      ownerEmail: "alice@example.com",
      orgId: "org-1",
    });
    expect(request).toMatchObject({
      source: "get-onboarding-journey",
      reservedBytes: 25_000_000_000,
      estimatedBytes: null,
    });
    expect(submissions).toHaveLength(1);
    expect(must(submissions[0]).jobReference.jobId).toBe(request.jobId);
    expect(must(submissions[0]).configuration.query.maximumBytesBilled).toBe(
      "25000000000",
    );
    expect(budget.settle).toHaveBeenCalledWith(
      "builder-3b0a2",
      request.jobId,
      { kind: "billed", billedBytes: 10_485_760, cacheHit: false },
      expect.any(Date),
    );
    expect(journey.args[0]).toMatchObject({
      maxTotalBytesBilled: 125_000_000_000,
    });
    expect(result.bigQueryBudget).toMatchObject({
      thisCall: { jobsAdmitted: 1, billedUsd: expect.any(Number) },
      maxTotalBytesBilled: {
        requested: 125_000_000_000,
        applied: 125_000_000_000,
      },
      today: { person: { noAskAllowanceUsd: 1 } },
    });
  });

  it("caps a raised maxTotalBytesBilled at what today's budget can pay for", async () => {
    budget.read.mockResolvedValue(snapshot(70_000_000_000));
    await getOnboardingJourney.run(
      { ...journeyArgs, maxTotalBytesBilled: 1_275_000_000_000 },
      { caller: "mcp" },
    );
    expect(journey.args[0]).toMatchObject({
      maxTotalBytesBilled: 25_000_000_000,
    });
  });

  it("sets nothing aside for follow-ups a cohort journey does not run", async () => {
    budget.read.mockResolvedValue(snapshot(70_000_000_000));
    await getOnboardingJourney.run(
      {
        ...journeyArgs,
        format: "tree",
        experimentId: "first_run_builder_credits",
        maxTotalBytesBilled: 1_275_000_000_000,
      },
      { caller: "mcp" },
    );
    expect(journey.args[0]).toMatchObject({
      maxTotalBytesBilled: 50_000_000_000,
    });
  });

  it("refuses a journey whose page fits but whose follow-up does not, before any job", async () => {
    budget.read.mockResolvedValue(snapshot(40_000_000_000));
    await expect(
      getOnboardingJourney.run(journeyArgs, { caller: "mcp" }),
    ).rejects.toMatchObject({ errorCode: "approval_required" });
    expect(budget.admit).not.toHaveBeenCalled();
    expect(journey.args).toHaveLength(0);
    expect(submissions).toHaveLength(0);
  });

  it("get-onboarding-journey reports a budget refusal with its reset time and starts no job", async () => {
    budget.admit.mockImplementation(async (_identity, request) => ({
      status: "refused",
      code: "approval_required",
      scope: "person",
      reservedBytes: request.reservedBytes,
      budget: snapshot(0),
    }));
    await expect(
      getOnboardingJourney.run(journeyArgs, { caller: "mcp" }),
    ).rejects.toMatchObject({
      errorCode: "approval_required",
      message: expect.stringMatching(/00:00 UTC.*|admin can raise/),
    });
    expect(submissions).toHaveLength(0);
  });

  it("query-agent-native-analytics admits another app's agent's job at its dry-run estimate and reports it", async () => {
    dryRun.response = () =>
      json({
        statistics: {
          totalBytesProcessed: "20971520",
          query: { totalBytesProcessed: "20971520", referencedTables: [] },
        },
      });
    const result = (await queryFirstParty.run(
      { sql: "SELECT 1" },
      { caller: "a2a" },
    )) as BudgetedResult;

    expect(budget.admit).toHaveBeenCalledTimes(1);
    expect(must(budget.admit.mock.calls[0])[1]).toMatchObject({
      source: "query-agent-native-analytics",
      estimatedBytes: 20_971_520,
    });
    expect(submissions).toHaveLength(1);
    expect(result).toMatchObject({
      rows: [{ events: 1 }],
      backend: "bigquery",
      bigQueryBudget: { thisCall: { jobsAdmitted: 1 } },
    });
  });

  it("query-agent-native-analytics answers another app's agent with a budget refusal", async () => {
    dryRun.response = () =>
      json({
        statistics: {
          totalBytesProcessed: "20971520",
          query: { totalBytesProcessed: "20971520", referencedTables: [] },
        },
      });
    budget.admit.mockImplementation(async (_identity, request) => ({
      status: "refused",
      code: "approval_required",
      scope: "person",
      reservedBytes: request.reservedBytes,
      budget: snapshot(0),
    }));
    await expect(
      queryFirstParty.run({ sql: "SELECT 1" }, { caller: "a2a" }),
    ).rejects.toMatchObject({
      errorCode: "approval_required",
      statusCode: 429,
    });
    expect(submissions).toHaveLength(0);
  });

  it("get-first-party-analytics-health admits its job with the small health cap", async () => {
    const result = (await getHealth.run(
      {},
      { caller: "mcp" },
    )) as BudgetedResult;
    expect(budget.admit).toHaveBeenCalledTimes(1);
    expect(must(budget.admit.mock.calls[0])[1]).toMatchObject({
      source: "get-first-party-analytics-health",
      reservedBytes: 100_000_000,
    });
    expect(must(submissions[0]).configuration.query.maximumBytesBilled).toBe(
      "100000000",
    );
    expect(result.bigQueryBudget).toMatchObject({
      thisCall: { jobsAdmitted: 1 },
    });
  });

  it("get-first-party-analytics-health answers a refusal with unavailable coverage, not an error", async () => {
    budget.admit.mockImplementation(async (_identity, request) => ({
      status: "refused",
      code: "budget_exhausted",
      scope: "org",
      reservedBytes: request.reservedBytes,
      budget: snapshot(),
    }));
    const result = (await getHealth.run(
      {},
      { caller: "mcp" },
    )) as BudgetedResult;
    expect(result.metrics.coverage).toEqual({
      kind: "unavailable",
      reason: "outside_agent_budget",
    });
    expect(result.bigQueryBudget.refusal).toMatchObject({
      code: "budget_exhausted",
    });
    expect(submissions).toHaveLength(0);
  });

  it("admits a job another app's agent starts over A2A the same way", async () => {
    const result = (await getHealth.run(
      {},
      { caller: "a2a" },
    )) as BudgetedResult;
    expect(budget.admit).toHaveBeenCalledTimes(1);
    expect(must(submissions[0]).configuration.query.maximumBytesBilled).toBe(
      "100000000",
    );
    expect(result.bigQueryBudget).toMatchObject({
      thisCall: { jobsAdmitted: 1 },
    });
  });

  it("refuses a job an A2A caller's tool starts without a budget", async () => {
    const unbudgeted = defineAction({
      description: "A tool that forgot its budget.",
      schema: z.object({}),
      run: async () => runQuery("SELECT 1"),
    });
    await expect(unbudgeted.run({}, { caller: "a2a" })).rejects.toMatchObject({
      code: "budget_required",
    });
    expect(submissions).toHaveLength(0);
  });

  it("refuses a job an outside agent's tool starts without a budget, before anything is sent", async () => {
    const unbudgeted = defineAction({
      description: "A tool that forgot its budget.",
      schema: z.object({}),
      run: async () => runQuery("SELECT 1"),
    });
    const error = await unbudgeted
      .run({}, { caller: "mcp" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OutsideAgentBigQueryRefusalError);
    expect(error).toMatchObject({ code: "budget_required" });
    expect(submissions).toHaveLength(0);
    expect(budget.admit).not.toHaveBeenCalled();
  });
});

describe("submission stays inside the admission", () => {
  const read = defineAction({
    description: "A read an outside agent's tool starts.",
    schema: z.object({}),
    run: async () => runQuery("SELECT 1 AS lease_test"),
  });

  async function runBudgeted(reservation: "full-cap" | "dry-run") {
    const { runOutsideAgentBigQueryCall } =
      await import("../server/lib/bigquery-agent-calls");
    return runOutsideAgentBigQueryCall(
      {
        identity: { ownerEmail: "alice@example.com", orgId: "org-1" },
        source: "test",
        reservation,
        leaseMs: 60_000,
      },
      () => read.run({}, { caller: "mcp" }),
    );
  }

  it("records the Google principal that sends each job with its admission", async () => {
    await runBudgeted("full-cap");
    expect(must(budget.admit.mock.calls[0])[1]).toMatchObject({
      credentialScope: expect.any(String),
      credentialFingerprint: PRINCIPAL,
    });
  });

  it("sends nothing when admission returns too close to the lease it committed", async () => {
    budget.admit.mockImplementation(async (_identity, request) => ({
      status: "admitted",
      requestId: `request-${request.jobId}`,
      reservedBytes: request.reservedBytes,
      created: true,
      leaseExpiresAt: new Date(Date.now() + 10_000).toISOString(),
      budget: snapshot(),
    }));
    await expect(runBudgeted("full-cap")).rejects.toMatchObject({
      code: "admission_expired",
    });
    expect(submissions).toHaveLength(0);
    expect(budget.settle).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { kind: "rejected" },
      expect.anything(),
    );
  });

  it("releases a job's reservation when BigQuery refuses the one send of its random ID", async () => {
    send.response = accessDenied;
    await expect(runBudgeted("full-cap")).rejects.toMatchObject({
      backendStatus: 403,
    });
    expect(submissions).toHaveLength(1);
    expect(must(submissions[0]).jobReference.jobId).not.toMatch(
      /^agent_native_r_/,
    );
    expect(budget.settle).toHaveBeenCalledWith(
      "builder-3b0a2",
      must(submissions[0]).jobReference.jobId,
      { kind: "rejected" },
      expect.any(Date),
    );
  });

  it("reserves a dry-run job from its own estimate and caps the job at that reservation", async () => {
    dryRun.response = () =>
      json({
        statistics: {
          totalBytesProcessed: "20971520",
          query: { totalBytesProcessed: "20971520", referencedTables: [] },
        },
      });
    const { report } = await runBudgeted("dry-run");
    expect(must(budget.admit.mock.calls[0])[1]).toMatchObject({
      estimatedBytes: 20 * 1024 ** 2,
      reservedBytes: 22 * 1024 ** 2,
    });
    expect(must(submissions[0]).configuration.query.maximumBytesBilled).toBe(
      String(22 * 1024 ** 2),
    );
    expect(report.jobs).toEqual([
      expect.objectContaining({
        jobId: must(submissions[0]).jobReference.jobId,
        billedUsd: expect.any(Number),
        state: "settled",
      }),
    ]);
  });

  it.each([
    [
      "an error",
      () =>
        json(
          { error: { code: 400, message: "Syntax error", errors: [] } },
          400,
        ),
    ],
    ["no byte statistics", () => json({ statistics: { query: {} } })],
    [
      "malformed byte statistics",
      () =>
        json({
          statistics: {
            totalBytesProcessed: "about 20 MB",
            query: { totalBytesProcessed: "about 20 MB" },
          },
        }),
    ],
  ])(
    "refuses a dry-run job whose dry run returns %s, and submits nothing",
    async (_label, response) => {
      dryRun.response = response;
      await expect(runBudgeted("dry-run")).rejects.toMatchObject({
        code: "estimate_unavailable",
      });
      expect(budget.admit).not.toHaveBeenCalled();
      expect(submissions).toHaveLength(0);
    },
  );
});

describe("resumable jobs", () => {
  const resumable = defineAction({
    description: "A resumable read, as the onboarding journey makes.",
    schema: z.object({}),
    run: async () =>
      runQuery("SELECT 1 AS resumable", {
        maxBytesBilled: 25_000_000_000,
        resumeAfter: new AbortController().signal,
      }),
  });

  it("keeps the reservation on a job a 409 says already exists, and settles it from that job", async () => {
    const { runOutsideAgentBigQueryCall } =
      await import("../server/lib/bigquery-agent-calls");
    duplicate.jobId = "next";
    await runOutsideAgentBigQueryCall(
      {
        identity: { ownerEmail: "alice@example.com", orgId: "org-1" },
        source: "test",
        reservation: "full-cap",
        leaseMs: 60_000,
      },
      () => resumable.run({}, { caller: "mcp" }),
    );
    expect(submissions).toHaveLength(1);
    const jobId = must(submissions[0]).jobReference.jobId;
    expect(budget.settle).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { kind: "rejected" },
      expect.anything(),
    );
    expect(budget.settle).toHaveBeenCalledWith(
      "builder-3b0a2",
      jobId,
      { kind: "billed", billedBytes: 10_485_760, cacheHit: false },
      expect.any(Date),
    );
  });

  it("keeps the reservation when BigQuery refuses a resumable job's send, since an identical call may send the same ID", async () => {
    const { runOutsideAgentBigQueryCall } =
      await import("../server/lib/bigquery-agent-calls");
    send.response = accessDenied;
    await expect(
      runOutsideAgentBigQueryCall(
        {
          identity: { ownerEmail: "alice@example.com", orgId: "org-1" },
          source: "test",
          reservation: "full-cap",
          leaseMs: 60_000,
        },
        () => resumable.run({}, { caller: "mcp" }),
      ),
    ).rejects.toMatchObject({ backendStatus: 403 });
    expect(submissions).toHaveLength(1);
    expect(must(submissions[0]).jobReference.jobId).toMatch(/^agent_native_r_/);
    expect(budget.settle).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { kind: "rejected" },
      expect.anything(),
    );
  });

  it("gives an outside agent's resumable job an ID no in-app job shares", async () => {
    const { runOutsideAgentBigQueryCall } =
      await import("../server/lib/bigquery-agent-calls");
    await resumable.run({}, { caller: "tool" });
    await runOutsideAgentBigQueryCall(
      {
        identity: { ownerEmail: "alice@example.com", orgId: "org-1" },
        source: "test",
        reservation: "full-cap",
        leaseMs: 60_000,
      },
      () => resumable.run({}, { caller: "mcp" }),
    );
    expect(submissions).toHaveLength(2);
    expect(must(submissions[0]).jobReference.jobId).toMatch(/^agent_native_r_/);
    expect(must(submissions[1]).jobReference.jobId).toMatch(/^agent_native_r_/);
    expect(must(submissions[1]).jobReference.jobId).not.toBe(
      must(submissions[0]).jobReference.jobId,
    );
  });
});

describe("a call that fails after its first job still reports that job", () => {
  const SPEND =
    "BigQuery jobs this call ran against your outside-agent budget: 1, reserved ";

  function refuseTheSecondJob(maxBytesBilled: number) {
    const admitted = must(budget.admit.getMockImplementation());
    budget.admit
      .mockImplementationOnce(admitted)
      .mockImplementationOnce(async (_identity, request) => ({
        status: "refused",
        code: "approval_required",
        scope: "person",
        reservedBytes: request.reservedBytes,
        budget: snapshot(0),
      }));
    after.firstJob = () =>
      runQuery("SELECT 2 AS second_job", { maxBytesBilled });
  }

  it("get-onboarding-journey names the first job's spend when the budget refuses a later page", async () => {
    refuseTheSecondJob(25_000_000_000);
    const second = must(after.firstJob);
    after.firstJob = () =>
      second().catch((error: unknown) => {
        throw new OnboardingJourneyReadError(error, 2);
      });
    const error = await getOnboardingJourney
      .run(journeyArgs, { caller: "mcp" })
      .catch((caught: unknown) => caught);
    expect(budget.admit).toHaveBeenCalledTimes(2);
    expect(submissions).toHaveLength(1);
    expect(error).toMatchObject({ errorCode: "approval_required" });
    const message = (error as Error).message;
    expect(message).toContain(SPEND);
    expect(message.split(SPEND)).toHaveLength(2);
    expect(message).toMatch(/Left today: .*00:00 UTC/);
  });

  it("get-onboarding-journey names the first job's spend when a later read fails", async () => {
    after.firstJob = async () => {
      throw new OnboardingJourneyReadError(new Error("socket hang up"), 2);
    };
    const error = await getOnboardingJourney
      .run(journeyArgs, { caller: "mcp" })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      errorCode: expect.stringMatching(/^journey_events_read/),
    });
    const message = (error as Error).message;
    expect(message).toMatch(
      /^The scoped onboarding journey read failed during journey_events;/,
    );
    expect(message).toContain(SPEND);
    expect(message.split(SPEND)).toHaveLength(2);
  });

  it("get-first-party-analytics-health lists the job that ran before a refusal", async () => {
    refuseTheSecondJob(100_000_000);
    const result = (await getHealth.run(
      {},
      { caller: "mcp" },
    )) as BudgetedResult;
    const firstJobId = must(budget.admit.mock.calls[0])[1].jobId;
    expect(result.metrics.coverage).toEqual({
      kind: "unavailable",
      reason: "outside_agent_budget",
    });
    expect(result.bigQueryBudget).toMatchObject({
      thisCall: { jobsAdmitted: 1, stillReservedUsd: 0 },
      jobs: [{ jobId: firstJobId, state: "settled", cacheHit: false }],
      today: { person: { noAskAllowanceUsd: 1 } },
      refusal: { code: "approval_required" },
    });
    expect(result.bigQueryBudget.thisCall.reservedUsd).toBeGreaterThan(0);
  });

  it("get-first-party-analytics-health reports the job that ran before its read failed", async () => {
    after.firstJob = async () => {
      throw new Error("rollup read failed");
    };
    const result = (await getHealth.run(
      {},
      { caller: "mcp" },
    )) as BudgetedResult;
    expect(result.metrics.coverage).toEqual({
      kind: "unavailable",
      reason: "health_read_failed",
    });
    expect(result.bigQueryBudget).toMatchObject({
      thisCall: { jobsAdmitted: 1 },
      jobs: [
        { jobId: must(budget.admit.mock.calls[0])[1].jobId, state: "settled" },
      ],
    });
    expect(result.bigQueryBudget.refusal).toBeUndefined();
  });

  describe("any tool call", () => {
    const options = {
      identity: { ownerEmail: "alice@example.com", orgId: "org-1" },
      source: "test",
      reservation: "full-cap" as const,
      leaseMs: 60_000,
    };
    const read = defineAction({
      description: "A read an outside agent's tool starts.",
      schema: z.object({}),
      run: async () => runQuery("SELECT 1 AS first_job"),
    });
    class StoreError extends Error {}

    it("keeps a later failure as it was and names the spend on it", async () => {
      const failure = new StoreError("store unavailable");
      const error = await runOutsideAgentBigQueryCall(options, async () => {
        await read.run({}, { caller: "mcp" });
        throw failure;
      }).catch((caught: unknown) => caught);
      expect(error).toBe(failure);
      expect(failure.message).toMatch(
        new RegExp(`^store unavailable ${SPEND}`),
      );
      expect(outsideAgentCallReportOf(failure)).toMatchObject({
        thisCall: { jobsAdmitted: 1 },
        jobs: [{ state: "settled" }],
      });
    });

    it("names the spend once when the failure passes through a call nested in another", async () => {
      const outer = createOutsideAgentBigQueryCall(options);
      const failure = new StoreError("store unavailable");
      const error = await reportOutsideAgentBigQueryCall(outer, async () => {
        await withOutsideAgentBigQueryGate(outer.gate, () =>
          read.run({}, { caller: "mcp" }),
        );
        return runOutsideAgentBigQueryCall(options, async () => {
          await read.run({}, { caller: "mcp" });
          throw failure;
        });
      }).catch((caught: unknown) => caught);
      expect(error).toBe(failure);
      expect(budget.admit).toHaveBeenCalledTimes(2);
      expect(failure.message.split(SPEND)).toHaveLength(2);
    });
  });
});

describe("in-app paths keep today's caps", () => {
  it("the in-app bigquery action submits with the 750 GB default and no admission", async () => {
    await bigquery.run({ sql: "SELECT 1" }, { caller: "tool" });
    expect(submissions).toHaveLength(1);
    expect(must(submissions[0]).configuration.query.maximumBytesBilled).toBe(
      "750000000000",
    );
    expect(budget.admit).not.toHaveBeenCalled();
  });

  it("the in-app onboarding journey keeps its 275 GB default and 25 GB pages, with no admission", async () => {
    const result = (await getOnboardingJourney.run(journeyArgs, {
      caller: "tool",
    })) as Record<string, unknown>;
    expect(journey.args[0]).toMatchObject({
      maxTotalBytesBilled: 275_000_000_000,
    });
    expect(must(submissions[0]).configuration.query.maximumBytesBilled).toBe(
      "25000000000",
    );
    expect(budget.admit).not.toHaveBeenCalled();
    expect(budget.read).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("bigQueryBudget");
  });

  it("in-app health keeps its 100 MB cap with no admission", async () => {
    await getHealth.run({}, { caller: "frontend" });
    expect(must(submissions[0]).configuration.query.maximumBytesBilled).toBe(
      "100000000",
    );
    expect(budget.admit).not.toHaveBeenCalled();
  });
});

describe("saved-panel capture outside-agent budget adapter", () => {
  const args = { dashboardId: "capture-test", panelId: "cost" };

  beforeEach(() => {
    dryRun.response = () =>
      json({
        statistics: {
          query: {
            totalBytesProcessed: "20971520",
            referencedTables: [],
          },
        },
      });
  });

  it.each(["mcp", "a2a"] as const)(
    "%s captures the saved query with admission and settled costs",
    async (caller) => {
      const result = await capturePanel.run(args, { caller });
      expect(result.rows).toEqual([[1]]);
      expect(result.bigQueryBudget).toMatchObject({
        provisional: false,
        thisCall: { jobsAdmitted: 1, stillReservedUsd: 0 },
        jobs: [{ state: "settled", billedUsd: expect.any(Number) }],
      });
      expect(budget.admit).toHaveBeenCalledWith(
        { ownerEmail: "alice@example.com", orgId: "org-1" },
        expect.objectContaining({
          source: "capture-dashboard-panel",
          estimatedBytes: 20971520,
          reservedBytes: 23068672,
        }),
        expect.objectContaining({ reconcile: expect.any(Object) }),
      );
      expect(submissions).toHaveLength(1);
      expect(must(submissions[0]).configuration.query.maximumBytesBilled).toBe(
        "23068672",
      );
      expect(budget.mark).toHaveBeenCalled();
      expect(budget.settle).toHaveBeenCalledWith(
        "builder-3b0a2",
        must(submissions[0]).jobReference.jobId,
        { kind: "billed", billedBytes: 10485760, cacheHit: false },
        expect.any(Date),
      );
      expect(capturePanel.outputSchema.parse(result)).toEqual(result);
      expect(captureState.trackEvents).toEqual(["dashboard_panel_captured"]);
    },
  );

  it("returns an explicit budget refusal without submission", async () => {
    budget.admit.mockImplementation(async (_identity, request) => ({
      status: "refused",
      code: "approval_required",
      scope: "person",
      reservedBytes: request.reservedBytes,
      budget: snapshot(0),
    }));
    await expect(
      capturePanel.run(args, { caller: "mcp" }),
    ).rejects.toMatchObject({
      errorCode: "approval_required",
      statusCode: 429,
      details: {
        bigQueryBudget: {
          refusal: { code: "approval_required" },
          thisCall: { jobsAdmitted: 0 },
        },
      },
    });
    expect(submissions).toHaveLength(0);
    expect(budget.settle).not.toHaveBeenCalled();
  });

  it("returns a non-retryable refusal when the saved query exceeds the per-job cap", async () => {
    dryRun.response = () =>
      json({
        statistics: {
          query: { totalBytesProcessed: "100000000000", referencedTables: [] },
        },
      });
    await expect(
      capturePanel.run(args, { caller: "mcp" }),
    ).rejects.toMatchObject({
      errorCode: "over_job_cap",
      statusCode: 422,
      details: {
        bigQueryBudget: {
          refusal: { code: "over_job_cap" },
          thisCall: { jobsAdmitted: 0 },
        },
      },
    });
    expect(submissions).toHaveLength(0);
    expect(budget.admit).not.toHaveBeenCalled();
    expect(budget.settle).not.toHaveBeenCalled();
  });

  it("uses the same over-cap request status for the first-party query action", async () => {
    dryRun.response = () =>
      json({
        statistics: {
          query: { totalBytesProcessed: "100000000000", referencedTables: [] },
        },
      });
    await expect(
      queryFirstParty.run({ sql: "SELECT 1" }, { caller: "a2a" }),
    ).rejects.toMatchObject({ errorCode: "over_job_cap", statusCode: 422 });
    expect(submissions).toHaveLength(0);
    expect(budget.admit).not.toHaveBeenCalled();
  });

  it("checks sign-in and dashboard access before warehouse work", async () => {
    captureState.email = null;
    await expect(
      capturePanel.run(args, { caller: "mcp" }),
    ).rejects.toMatchObject({ errorCode: "unauthenticated" });
    captureState.email = "alice@example.com";
    captureState.accessible = false;
    await expect(
      capturePanel.run(args, { caller: "a2a" }),
    ).rejects.toMatchObject({ errorCode: "dashboard_not_found" });
    expect(fetch).not.toHaveBeenCalled();
    expect(budget.admit).not.toHaveBeenCalled();
  });

  it("serves cached rows without admission or submission", async () => {
    captureState.cached = true;
    const result = await capturePanel.run(args, { caller: "mcp" });
    expect(result.rows).toEqual([[7]]);
    expect(result.bigQueryBudget?.thisCall.jobsAdmitted).toBe(0);
    expect(budget.admit).not.toHaveBeenCalled();
    expect(submissions).toHaveLength(0);
  });

  it("fails visibly and releases the reservation on provider rejection", async () => {
    send.response = accessDenied;
    await expect(
      capturePanel.run(args, { caller: "mcp" }),
    ).rejects.toMatchObject({
      errorCode: "query_failed",
      statusCode: 502,
      details: { bigQueryBudget: { jobs: [{ state: "released" }] } },
    });
    expect(submissions).toHaveLength(1);
    expect(budget.settle).toHaveBeenCalledWith(
      "builder-3b0a2",
      must(submissions[0]).jobReference.jobId,
      { kind: "rejected" },
      expect.any(Date),
    );
  });

  it("records the original cause and spend receipt if post-query metadata fails", async () => {
    const cause = new Error("Key dates unavailable");
    captureState.keyDatesError = cause;
    await expect(
      capturePanel.run(args, { caller: "mcp" }),
    ).rejects.toMatchObject({
      message: "This panel could not be captured.",
      errorCode: "capture_failed",
      statusCode: 500,
      details: {
        bigQueryBudget: {
          provisional: false,
          thisCall: { jobsAdmitted: 1, stillReservedUsd: 0 },
          jobs: [{ state: "settled", billedUsd: expect.any(Number) }],
        },
      },
    });
    expect(submissions).toHaveLength(1);
    expect(captureState.exceptions).toEqual([
      {
        error: cause,
        context: {
          route: "capture-dashboard-panel",
          tags: { stage: "capture_result" },
          handled: true,
        },
      },
    ]);
  });

  it("returns a billed capture when outside-agent success tracking fails", async () => {
    captureState.trackingError = true;
    const result = await capturePanel.run(args, { caller: "mcp" });
    expect(result.rows).toEqual([[1]]);
    expect(result.bigQueryBudget).toMatchObject({
      provisional: false,
      thisCall: { jobsAdmitted: 1, stillReservedUsd: 0 },
      jobs: [{ state: "settled", billedUsd: expect.any(Number) }],
    });
    expect(submissions).toHaveLength(1);
    expect(captureState.exceptions).toEqual([
      {
        error: expect.objectContaining({ message: "Tracking unavailable" }),
        context: {
          route: "capture-dashboard-panel",
          tags: { stage: "success_tracking" },
          level: "warning",
          handled: true,
        },
      },
    ]);
  });

  it("preserves in-app tracking failure behavior", async () => {
    captureState.trackingError = true;
    await expect(
      capturePanel.run(args, { caller: "frontend" }),
    ).rejects.toThrow("Tracking unavailable");
    expect(budget.admit).not.toHaveBeenCalled();
    expect(captureState.exceptions).toEqual([]);
  });

  it.each([
    [
      "mcp",
      {
        errorCode: "query_cancelled",
        statusCode: 499,
        message: "Panel capture was cancelled.",
      },
    ],
    ["frontend", { errorCode: "query_timed_out", statusCode: 504 }],
  ] as const)(
    "honors %s cancellation before warehouse submission",
    async (caller, failure) => {
      const controller = new AbortController();
      controller.abort(new Error("capture cancelled"));
      await expect(
        capturePanel.run(args, { caller, signal: controller.signal }),
      ).rejects.toMatchObject(failure);
      expect(submissions).toHaveLength(0);
      expect(budget.admit).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["deadline", "query_timed_out", 504],
    ["caller abort", "query_cancelled", 499],
  ] as const)(
    "marks a receipt provisional when %s precedes cancellation settlement",
    async (stop, errorCode, statusCode) => {
      vi.useFakeTimers();
      const queryStarted = deferred<void>();
      const cancelResponse = deferred<Response>();
      const settled = deferred<void>();
      const originalFetch = globalThis.fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith("/cancel")) return cancelResponse.promise;
          if (url.pathname.includes("/queries/")) {
            queryStarted.resolve();
            return json({ jobComplete: false });
          }
          return originalFetch(input, init);
        }),
      );
      budget.settle.mockImplementationOnce(async () => {
        settled.resolve();
        return true;
      });
      const controller = new AbortController();
      const result = capturePanel.run(args, {
        caller: "mcp",
        signal: controller.signal,
      });
      const failure = result.catch((error: unknown) => error);
      await queryStarted.promise;
      if (stop === "caller abort")
        controller.abort(new Error("capture cancelled"));
      await vi.advanceTimersByTimeAsync(45_000);
      const error = await failure;
      try {
        expect(error).toMatchObject({
          errorCode,
          statusCode,
          details: {
            bigQueryBudget: {
              provisional: true,
              thisCall: {
                jobsAdmitted: 1,
                stillReservedUsd: expect.any(Number),
              },
              jobs: [{ state: "reserved", billedUsd: null }],
            },
          },
        });
        expect(submissions).toHaveLength(1);
        expect(budget.settle).not.toHaveBeenCalled();
      } finally {
        cancelResponse.resolve(json({}));
        await settled.promise;
      }
      expect(budget.settle).toHaveBeenCalledTimes(1);
      expect(error).toMatchObject({
        details: { bigQueryBudget: { provisional: true } },
      });
    },
  );

  it("keeps the spend receipt when budget overhead makes a metric too large", async () => {
    captureState.chartType = "metric";
    const plain = await capturePanel.run(args, { caller: "frontend" });
    const maxResultChars = JSON.stringify(plain, null, 2).length + 1_000;
    captureState.trackEvents.length = 0;
    await expect(
      capturePanel.run(args, { caller: "mcp", maxResultChars }),
    ).rejects.toMatchObject({
      errorCode: "panel_too_large",
      statusCode: 413,
      details: {
        bigQueryBudget: {
          thisCall: { jobsAdmitted: 1, stillReservedUsd: 0 },
          jobs: [{ state: "settled", billedUsd: expect.any(Number) }],
        },
      },
    });
    expect(submissions).toHaveLength(2);
    expect(captureState.trackEvents).toEqual([]);
  });

  it("keeps in-app capture unbudgeted", async () => {
    const result = await capturePanel.run(args, { caller: "frontend" });
    expect(result.rows).toEqual([[1]]);
    expect(captureState.trackEvents).toEqual(["dashboard_panel_captured"]);
    expect(result).not.toHaveProperty("bigQueryBudget");
    expect(budget.admit).not.toHaveBeenCalled();
    expect(budget.read).not.toHaveBeenCalled();
  });
});
