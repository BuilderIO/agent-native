import { defineAction } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Verifying an outside agent's dashboard edit runs BigQuery jobs it caused.
// The panel source is mocked to start its job through the budget gate, the
// way the real runner does; the ledger's admission decision is mocked.
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  admit: vi.fn(),
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
}));

const { bigQueryJobGate } = await import("./bigquery-agent-context");
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

beforeEach(() => {
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
        capBytes: gate.jobCapFor(750_000_000_000),
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
  it("admits each panel's job against the budget, capped at 50 GB, and marks a refused one unverified", async () => {
    const result = await verifyAs("mcp");
    expect(mocks.admit).toHaveBeenCalledTimes(2);
    for (const [identity, request] of mocks.admit.mock.calls) {
      expect(identity).toEqual({
        ownerEmail: "alice@example.com",
        orgId: "org-1",
      });
      expect(request).toMatchObject({
        source: "panel-verification",
        reservedBytes: 50_000_000_000,
      });
    }
    const byId = Object.fromEntries(result.panels.map((p) => [p.panelId, p]));
    expect(byId.refused).toMatchObject({
      status: "unverified",
      note: "outside_agent_budget",
    });
    expect(byId.refused!.error).toMatch(/daily BigQuery limit/);
    expect(byId.allowed!.status).toBe("ok");
    expect(result.blocking).toBe(false);
  });

  it("runs the in-app agent's verification with no budget", async () => {
    const result = await verifyAs("tool");
    expect(mocks.admit).not.toHaveBeenCalled();
    expect(result.panels.map((p) => p.status)).toEqual(["ok", "ok"]);
  });
});
