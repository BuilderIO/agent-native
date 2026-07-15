import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimDueDashboardReportSubscriptions: vi.fn(),
  dashboardReportRetryAt: vi.fn(),
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
  dashboardReportRetryAt: mocks.dashboardReportRetryAt,
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.claimDueDashboardReportSubscriptions.mockReset();
    mocks.dashboardReportRetryAt.mockReset();
    mocks.dashboardReportRetryAt.mockReturnValue(null);
    mocks.markDashboardReportResult.mockReset();
    mocks.runWithRequestContext.mockImplementation(
      async (_ctx, run: () => Promise<unknown>) => run(),
    );
    mocks.sendDashboardReportSubscription.mockReset();
  });

  it("marks a screenshotless delivery failed while preserving its diagnostic", async () => {
    const sub = subscription();
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([sub]);
    mocks.sendDashboardReportSubscription.mockResolvedValue({
      dashboardUrl: "https://analytics.example.test/dashboards/agent-native",
      recipientCount: 1,
      screenshotAttached: false,
      screenshotMode: "none",
      screenshotError: "dashboard render timed out",
      emailsSent: true,
    });

    const result = await runDashboardReportsOnce();

    expect(result).toEqual({ processed: 1, failed: 1, remaining: 0 });
    expect(mocks.sendDashboardReportSubscription).toHaveBeenCalledWith(sub, {
      skipEmailWithoutScreenshot: false,
      allowLimitedFallback: true,
    });
    expect(console.error).toHaveBeenCalledWith(
      "[dashboard-report] Subscription sub_1 sent without a screenshot:",
      "Dashboard screenshot unavailable: dashboard render timed out",
    );
    expect(mocks.markDashboardReportResult).toHaveBeenCalledWith(
      sub,
      "error",
      "Dashboard screenshot unavailable: dashboard render timed out",
    );
  });

  it("marks delivery as failed when the email send throws", async () => {
    const sub = subscription();
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([sub]);
    mocks.sendDashboardReportSubscription.mockRejectedValue(
      new Error("Email provider rejected the message"),
    );

    const result = await runDashboardReportsOnce();

    expect(result).toEqual({ processed: 1, failed: 1, remaining: 0 });
    expect(mocks.sendDashboardReportSubscription).toHaveBeenCalledWith(sub, {
      skipEmailWithoutScreenshot: false,
      allowLimitedFallback: true,
    });
    expect(mocks.markDashboardReportResult).toHaveBeenCalledWith(
      sub,
      "error",
      "Email provider rejected the message",
    );
  });

  it("skips the fallback email and reschedules a retry within the retry window", async () => {
    const sub = subscription();
    const retryAt = "2026-07-13T11:16:00.000Z";
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([sub]);
    mocks.dashboardReportRetryAt.mockReturnValue(retryAt);
    mocks.sendDashboardReportSubscription.mockResolvedValue({
      dashboardUrl: "https://analytics.example.test/dashboards/agent-native",
      recipientCount: 1,
      screenshotAttached: false,
      screenshotMode: "none",
      screenshotError: "dashboard render timed out",
      emailsSent: false,
    });

    const result = await runDashboardReportsOnce();

    expect(result).toEqual({ processed: 1, failed: 0, remaining: 0 });
    expect(mocks.sendDashboardReportSubscription).toHaveBeenCalledWith(sub, {
      skipEmailWithoutScreenshot: true,
      allowLimitedFallback: false,
    });
    expect(console.error).toHaveBeenCalledWith(
      "[dashboard-report] Subscription sub_1 skipped sending without a screenshot, will retry:",
      "Dashboard screenshot unavailable: dashboard render timed out",
    );
    expect(mocks.markDashboardReportResult).toHaveBeenCalledWith(
      sub,
      "error",
      "Dashboard screenshot unavailable: dashboard render timed out (retry scheduled)",
      { nextRunAt: retryAt },
    );
  });

  it("falls back to the no-screenshot email once the retry window has elapsed", async () => {
    const sub = subscription();
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([sub]);
    mocks.dashboardReportRetryAt.mockReturnValue(null);
    mocks.sendDashboardReportSubscription.mockResolvedValue({
      dashboardUrl: "https://analytics.example.test/dashboards/agent-native",
      recipientCount: 1,
      screenshotAttached: false,
      screenshotMode: "none",
      screenshotError: "dashboard render timed out",
      emailsSent: true,
    });

    const result = await runDashboardReportsOnce();

    expect(result).toEqual({ processed: 1, failed: 1, remaining: 0 });
    expect(mocks.sendDashboardReportSubscription).toHaveBeenCalledWith(sub, {
      skipEmailWithoutScreenshot: false,
      allowLimitedFallback: true,
    });
    expect(console.error).toHaveBeenCalledWith(
      "[dashboard-report] Subscription sub_1 sent without a screenshot:",
      "Dashboard screenshot unavailable: dashboard render timed out",
    );
    expect(mocks.markDashboardReportResult).toHaveBeenCalledWith(
      sub,
      "error",
      "Dashboard screenshot unavailable: dashboard render timed out",
    );
  });

  it("requests the limited fallback attempt only once the retry window has elapsed", async () => {
    const sub = subscription();
    const retryAt = "2026-06-30T11:10:00.000Z";
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([sub]);
    mocks.dashboardReportRetryAt.mockReturnValue(retryAt);
    mocks.sendDashboardReportSubscription.mockResolvedValue({
      dashboardUrl: "https://analytics.example.test/dashboards/agent-native",
      recipientCount: 1,
      screenshotAttached: false,
      screenshotMode: "none",
      screenshotError: "dashboard render timed out",
      emailsSent: false,
    });

    await runDashboardReportsOnce();

    expect(mocks.sendDashboardReportSubscription).toHaveBeenCalledWith(sub, {
      skipEmailWithoutScreenshot: true,
      allowLimitedFallback: false,
    });
  });

  it("persists why the full screenshot failed when a later attempt succeeds", async () => {
    const sub = subscription();
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([sub]);
    mocks.dashboardReportRetryAt.mockReturnValue(null);
    mocks.sendDashboardReportSubscription.mockResolvedValue({
      dashboardUrl: "https://analytics.example.test/dashboards/agent-native",
      recipientCount: 1,
      screenshotAttached: true,
      screenshotMode: "full-lightweight",
      screenshotError: "full: launching the screenshot browser: chromium died",
      emailsSent: true,
    });

    const result = await runDashboardReportsOnce();

    expect(result).toEqual({ processed: 1, failed: 0, remaining: 0 });
    expect(mocks.markDashboardReportResult).toHaveBeenCalledWith(
      sub,
      "success",
      expect.stringContaining("earlier attempts failed"),
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("[dashboard-report] Subscription sub_1"),
    );
  });
});
