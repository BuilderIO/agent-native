import { defineAction } from "@agent-native/core/action";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The real actions and the real BigQuery runner (`runQuery`) against a mocked
// BigQuery REST API. The budget ledger is mocked here; its SQL has its own spec.
const budget = vi.hoisted(() => ({
  admit: vi.fn(),
  mark: vi.fn(async () => undefined),
  settle: vi.fn(async () => true),
  read: vi.fn(),
}));
const journey = vi.hoisted(() => ({
  args: [] as Array<Record<string, unknown>>,
}));

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
// Cache coordination fails, so every query reaches BigQuery.
vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getDbExec: () => ({
    execute: async () => {
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
  getRequestUserEmail: () => "alice@example.com",
  getRequestOrgId: () => "org-1",
  getRequestRunContext: () => undefined,
  platformWaitUntil: () => undefined,
}));
vi.mock("../server/lib/credentials", () => ({
  resolveCredential: async (key: string) =>
    key === "BIGQUERY_PROJECT_ID" ? "builder-3b0a2" : null,
}));
vi.mock("../server/lib/gcloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/gcloud")>()),
  getBigQueryAccessToken: async () => "test-token",
}));
vi.mock("@agent-native/core/tracking", () => ({ track: () => undefined }));
// The deep reads are replaced by stand-ins that run one job each through the
// real runner with the cap the real read passes.
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
        return actual.unavailableFirstPartyAnalyticsHealth(
          "health_read_failed",
        );
      },
    };
  },
);

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

const submissions: any[] = [];

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

beforeEach(() => {
  submissions.length = 0;
  journey.args.length = 0;
  budget.admit.mockReset();
  budget.admit.mockImplementation(async (_identity, request) => ({
    status: "admitted",
    requestId: `request-${request.jobId}`,
    reservedBytes: request.reservedBytes,
    created: true,
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
        submissions.push(body);
        return json({ jobReference: { ...body.jobReference, location: "US" } });
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const journeyArgs = { dateFrom: "2026-11-01", dateTo: "2026-11-02" };

describe("outside-agent (MCP) jobs go through admission", () => {
  it("get-onboarding-journey admits each job before submitting it, under its reservation", async () => {
    const result = (await getOnboardingJourney.run(journeyArgs, {
      caller: "mcp",
    })) as Record<string, any>;

    expect(budget.admit).toHaveBeenCalledTimes(1);
    const [identity, request] = budget.admit.mock.calls[0]!;
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
    expect(submissions[0].jobReference.jobId).toBe(request.jobId);
    expect(submissions[0].configuration.query.maximumBytesBilled).toBe(
      "25000000000",
    );
    expect(budget.settle).toHaveBeenCalledWith(
      "builder-3b0a2",
      request.jobId,
      { kind: "billed", billedBytes: 10_485_760, cacheHit: false },
      expect.any(Date),
    );
    // A default MCP call is five 25 GB pages, so it fits under $1 with its follow-ups.
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
    // $0.40 left: one follow-up (25 GB) and one 25 GB page.
    expect(journey.args[0]).toMatchObject({
      maxTotalBytesBilled: 25_000_000_000,
    });
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

  it("get-first-party-analytics-health admits its job with the small health cap", async () => {
    const result = (await getHealth.run({}, { caller: "mcp" })) as Record<
      string,
      any
    >;
    expect(budget.admit).toHaveBeenCalledTimes(1);
    expect(budget.admit.mock.calls[0]![1]).toMatchObject({
      source: "get-first-party-analytics-health",
      reservedBytes: 100_000_000,
    });
    expect(submissions[0].configuration.query.maximumBytesBilled).toBe(
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
    const result = (await getHealth.run({}, { caller: "mcp" })) as Record<
      string,
      any
    >;
    expect(result.metrics.coverage).toEqual({
      kind: "unavailable",
      reason: "outside_agent_budget",
    });
    expect(result.bigQueryBudget.refusal).toMatchObject({
      code: "budget_exhausted",
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

describe("in-app paths keep today's caps", () => {
  it("the in-app bigquery action submits with the 750 GB default and no admission", async () => {
    await bigquery.run({ sql: "SELECT 1" }, { caller: "tool" });
    expect(submissions).toHaveLength(1);
    expect(submissions[0].configuration.query.maximumBytesBilled).toBe(
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
    expect(submissions[0].configuration.query.maximumBytesBilled).toBe(
      "25000000000",
    );
    expect(budget.admit).not.toHaveBeenCalled();
    expect(budget.read).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("bigQueryBudget");
  });

  it("in-app health keeps its 100 MB cap with no admission", async () => {
    await getHealth.run({}, { caller: "frontend" });
    expect(submissions[0].configuration.query.maximumBytesBilled).toBe(
      "100000000",
    );
    expect(budget.admit).not.toHaveBeenCalled();
  });
});
