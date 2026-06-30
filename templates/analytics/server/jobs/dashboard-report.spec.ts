import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimDueDashboardReportSubscriptions: vi.fn(),
  markDashboardReportResult: vi.fn(),
  runWithRequestContext: vi.fn(),
  sendDashboardReportSubscription: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  runWithRequestContext: mocks.runWithRequestContext,
}));

vi.mock("../lib/dashboard-report", () => ({
  sendDashboardReportSubscription: mocks.sendDashboardReportSubscription,
}));

vi.mock("../lib/dashboard-report-subscriptions", () => ({
  claimDueDashboardReportSubscriptions:
    mocks.claimDueDashboardReportSubscriptions,
  markDashboardReportResult: mocks.markDashboardReportResult,
}));

import type { DashboardReportSubscription } from "../lib/dashboard-report-subscriptions";
import { runDashboardReportsOnce } from "./dashboard-report";

function subscription(): DashboardReportSubscription {
  return {
    id: "sub_1",
    dashboardId: "agent-native",
    name: "Agent Native daily email",
    recipients: ["steve@builder.io"],
    filters: {},
    frequency: "daily",
    timeOfDay: "04:00",
    timezone: "America/Los_Angeles",
    enabled: true,
    nextRunAt: "2026-06-30T11:00:00.000Z",
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:00.000Z",
    ownerEmail: "steve@builder.io",
    orgId: "org_1",
  };
}

describe("dashboard report sweep", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.claimDueDashboardReportSubscriptions.mockReset();
    mocks.markDashboardReportResult.mockReset();
    mocks.runWithRequestContext.mockImplementation(
      async (_ctx, run: () => Promise<unknown>) => run(),
    );
    mocks.sendDashboardReportSubscription.mockReset();
  });

  it("marks an unexpected no-screenshot result as degraded", async () => {
    const sub = subscription();
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([sub]);
    mocks.sendDashboardReportSubscription.mockResolvedValue({
      dashboardUrl: "https://analytics.example.test/dashboards/agent-native",
      recipientCount: 1,
      screenshotAttached: false,
      screenshotMode: "none",
      screenshotError: "dashboard render timed out",
    });

    const result = await runDashboardReportsOnce();

    expect(result).toEqual({ processed: 1, failed: 1, remaining: 0 });
    expect(mocks.sendDashboardReportSubscription).toHaveBeenCalledWith(sub, {
      requireScreenshot: true,
    });
    expect(mocks.markDashboardReportResult).toHaveBeenCalledWith(
      sub,
      "error",
      "Dashboard screenshot unavailable: dashboard render timed out",
    );
  });

  it("requires a screenshot for scheduled report delivery", async () => {
    const sub = subscription();
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([sub]);
    mocks.sendDashboardReportSubscription.mockRejectedValue(
      new Error("Dashboard screenshot unavailable: chromium died"),
    );

    const result = await runDashboardReportsOnce();

    expect(result).toEqual({ processed: 1, failed: 1, remaining: 0 });
    expect(mocks.sendDashboardReportSubscription).toHaveBeenCalledWith(sub, {
      requireScreenshot: true,
    });
    expect(mocks.markDashboardReportResult).toHaveBeenCalledWith(
      sub,
      "error",
      "Dashboard screenshot unavailable: chromium died",
    );
  });
});
