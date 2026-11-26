import { defineAction } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

function must<T>(value: T | null | undefined, message = "Expected a value"): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  admit: vi.fn(),
  estimate: vi.fn(),
  readBudget: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getCredentialContext: () => ({
    userEmail: "alice@example.com",
    orgId: "org-1",
  }),
}));
vi.mock("./dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolve,
}));
vi.mock("./bigquery", () => ({
  dryRunQuerySchema: async () => ({ error: null }),
  BigQueryDryRunPreparationError: class extends Error {},
}));
vi.mock("./dashboard-report-subscriptions", () => ({
  countEnabledDashboardReportSubscriptions: async () => 0,
}));
vi.mock("./bigquery-agent-budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bigquery-agent-budget")>()),
  admitBigQueryAgentJob: mocks.admit,
  readBigQueryAgentBudget: mocks.readBudget,
}));

const { bigQueryJobGate } = await import("./bigquery-agent-context");
const {
  OUTSIDE_AGENT_JOB_CAP_BYTES,
  OUTSIDE_AGENT_ORG_LIMIT_BYTES,
  OUTSIDE_AGENT_PERSON_BASE_BYTES,
  OUTSIDE_AGENT_PERSON_CEILING_BYTES,
} = await import("./bigquery-agent-budget");
const { verifyDashboardPanels } =
  await import("./dashboard-panel-verification");

function panel(id: string, sql: string) {
  // raw-sql-ok: fixed fixture SQL written in this file, no runtime values.
  return {
    id,
    title: id,
    source: "bigquery",
    chartType: "table",
    width: 2,
    sql,
  };
}

const config = {
  name: "T",
  panels: [
    panel("refused", "SELECT 'refused' AS label, 1 AS n"),
    panel("allowed", "SELECT 'allowed' AS label, 1 AS n"),
  ],
};

const today = {
  utcDay: "2026-11-17",
  resetsAt: "2026-11-18T00:00:00.000Z",
  jobCapBytes: OUTSIDE_AGENT_JOB_CAP_BYTES,
  person: {
    limitBytes: OUTSIDE_AGENT_PERSON_BASE_BYTES,
    settledBytes: 0,
    reservedBytes: 0,
    remainingBytes: OUTSIDE_AGENT_PERSON_BASE_BYTES,
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

beforeEach(() => {
  mocks.estimate.mockReset();
  mocks.estimate.mockResolvedValue({ status: "ok", bytes: 20 * 1024 ** 2 });
  mocks.readBudget.mockReset();
  mocks.readBudget.mockResolvedValue(today);
  mocks.admit.mockReset();
  mocks.admit.mockImplementation(async (_identity, request) =>
    request.jobId === "job-refused"
      ? {
          status: "refused",
          code: "budget_exhausted",
          scope: "person",
          reservedBytes: request.reservedBytes,
          budget: null,
        }
      : {
          status: "admitted",
          requestId: `request-${request.jobId}`,
          reservedBytes: request.reservedBytes,
          created: true,
          leaseExpiresAt: new Date(Date.now() + request.leaseMs).toISOString(),
          budget: null,
        },
  );
  mocks.resolve.mockReset();
  mocks.resolve.mockImplementation(async (request: { query: string }) => {
    const id = request.query.includes("'refused'") ? "refused" : "allowed";
    const gate = bigQueryJobGate();
    if (gate) {
      await gate.admit({
        projectId: "builder-3b0a2",
        jobId: `job-${id}`,
        credentialScope: "default",
        credentialFingerprint: null,
        exclusive: true,
        capBytes: gate.jobCapFor(750_000_000_000),
        estimate: mocks.estimate,
      });
    }
    return {
      rows: [{ label: id, n: 1 }],
      schema: [
        { name: "label", type: "STRING" },
        { name: "n", type: "INT64" },
      ],
    };
  });
});

const verifyAs = (caller: "mcp" | "tool") =>
  defineAction({
    description: "Verify panels as a dashboard write would.",
    schema: z.object({}),
    run: async () => verifyDashboardPanels(config, ["refused", "allowed"]),
  }).run({}, { caller });

describe("verifying an outside agent's dashboard edit", () => {
  it("admits each panel's job against the budget from its dry run, and marks a refused one unverified", async () => {
    const result = await verifyAs("mcp");
    expect(mocks.admit).toHaveBeenCalledTimes(2);
    for (const [identity, request] of mocks.admit.mock.calls) {
      expect(identity).toEqual({
        ownerEmail: "alice@example.com",
        orgId: "org-1",
      });
      expect(request).toMatchObject({
        source: "panel-verification",
        estimatedBytes: 20 * 1024 ** 2,
        reservedBytes: 22 * 1024 ** 2,
      });
    }
    const byId = Object.fromEntries(result.panels.map((p) => [p.panelId, p]));
    expect(byId.refused).toMatchObject({
      status: "unverified",
      note: "outside_agent_budget",
    });
    expect(must(byId.refused).error).toMatch(/daily BigQuery limit/);
    expect(must(byId.allowed).status).toBe("ok");
    expect(result.blocking).toBe(false);
  });

  it("reads a panel whose query would cross the no-ask allowance as unverified, never asking mid-write", async () => {
    mocks.admit.mockImplementation(async (_identity, request) => ({
      status: "refused",
      code: "approval_required",
      scope: "person",
      reservedBytes: request.reservedBytes,
      budget: today,
    }));
    const result = await verifyAs("mcp");
    for (const panel of result.panels) {
      expect(panel).toMatchObject({
        status: "unverified",
        note: "outside_agent_approval_required",
      });
      expect(panel.error).toContain(
        "Allowing up to $5.00 today needs your approval on Analytics' review page, which this call can't ask for.",
      );
    }
    expect(result.blocking).toBe(false);
    expect(result.bigQueryBudget).toMatchObject({
      refusal: { code: "approval_required" },
    });
  });

  it("returns what its jobs cost and today's budgets", async () => {
    const result = await verifyAs("mcp");
    expect(result.bigQueryBudget).toMatchObject({
      thisCall: { jobsAdmitted: 1, stillReservedUsd: expect.any(Number) },
      jobs: [
        {
          jobId: "job-allowed",
          estimatedUsd: expect.any(Number),
          reservedUsd: expect.any(Number),
          billedUsd: null,
          state: "reserved",
        },
      ],
      today: {
        person: { remainingUsd: 1, noAskAllowanceUsd: 1 },
        org: { remainingUsd: 50 },
      },
      refusal: { code: "budget_exhausted" },
    });
  });

  it("runs the in-app agent's verification with no budget", async () => {
    const result = await verifyAs("tool");
    expect(mocks.admit).not.toHaveBeenCalled();
    expect(result.panels.map((p) => p.status)).toEqual(["ok", "ok"]);
    expect(result).not.toHaveProperty("bigQueryBudget");
  });

  it.each([
    ["a failed dry run", "dry_run_failed", /the dry run failed/],
    ["missing byte statistics", "missing_statistics", /reported no bytes/],
    [
      "malformed byte statistics",
      "malformed_statistics",
      /byte count was unreadable/,
    ],
  ] as const)(
    "submits nothing and marks the panel unverified after %s",
    async (_label, reason, message) => {
      mocks.estimate.mockResolvedValue({ status: "unavailable", reason });
      const result = await verifyAs("mcp");
      expect(mocks.admit).not.toHaveBeenCalled();
      for (const panel of result.panels) {
        expect(panel).toMatchObject({
          status: "unverified",
          note: "outside_agent_estimate_unavailable",
        });
        expect(panel.error).toMatch(message);
      }
      expect(result.blocking).toBe(false);
      expect(result.bigQueryBudget).toMatchObject({
        thisCall: { jobsAdmitted: 0 },
        jobs: [],
        refusal: { code: "estimate_unavailable" },
      });
    },
  );

  it("reserves the whole per-job cap when a dry run reading tables reports zero bytes", async () => {
    mocks.estimate.mockResolvedValue({ status: "zero_with_tables" });
    await verifyAs("mcp");
    expect(must(mocks.admit.mock.calls[1])[1]).toMatchObject({
      estimatedBytes: null,
      reservedBytes: 50_000_000_000,
    });
  });
});
