import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimDueDashboardReportSubscriptions: vi.fn(),
  dashboardReportRetryAt: vi.fn(),
  markDashboardReportResult: vi.fn(),
  recordDashboardReportCaptureOutcome: vi.fn(),
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
  recordDashboardReportCaptureOutcome:
    mocks.recordDashboardReportCaptureOutcome,
}));

import type { DashboardReportResult } from "../lib/dashboard-report";
import type { DashboardReportSubscription } from "../lib/dashboard-report-subscriptions";
import { runDashboardReportsOnce } from "./dashboard-report";

function subscription(
  overrides: Partial<DashboardReportSubscription> = {},
): DashboardReportSubscription {
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
    lastCaptureAt: null,
    lastCaptureMode: null,
    lastCaptureError: null,
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:00.000Z",
    ownerEmail: "steve@builder.io",
    orgId: "org_1",
    ...overrides,
  };
}

function completeResult(
  overrides: Partial<DashboardReportResult> = {},
): DashboardReportResult {
  return {
    dashboardUrl: "https://analytics.example.test/dashboards/agent-native",
    recipientCount: 1,
    reportMode: "complete",
    degradedPanelIds: [],
    emailsSent: true,
    ...overrides,
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
    mocks.recordDashboardReportCaptureOutcome.mockReset();
    mocks.recordDashboardReportCaptureOutcome.mockResolvedValue(true);
    mocks.runWithRequestContext.mockImplementation(
      async (_ctx, run: () => Promise<unknown>) => run(),
    );
    mocks.sendDashboardReportSubscription.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("persists a complete report as success with zero failures", async () => {
    const sub = subscription();
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([sub]);
    mocks.sendDashboardReportSubscription.mockResolvedValue(completeResult());

    const result = await runDashboardReportsOnce();

    expect(result).toEqual({ processed: 1, failed: 0, remaining: 0 });
    expect(mocks.markDashboardReportResult).toHaveBeenCalledWith(
      sub,
      "success",
    );
  });

  it("counts a degraded-but-emailed report as failed and names the degraded panels", async () => {
    const sub = subscription();
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([sub]);
    mocks.sendDashboardReportSubscription.mockResolvedValue(
      completeResult({
        reportMode: "degraded",
        degradedPanelIds: ["panel_revenue", "panel_signups"],
        emailsSent: true,
      }),
    );

    const result = await runDashboardReportsOnce();

    expect(result).toEqual({ processed: 1, failed: 1, remaining: 0 });
    expect(mocks.sendDashboardReportSubscription).toHaveBeenCalledWith(
      sub,
      expect.objectContaining({ skipEmailWhenDegraded: false }),
    );
    expect(console.error).toHaveBeenCalledWith(
      "[dashboard-report] Subscription sub_1 sent a degraded report:",
      "panels unavailable: panel_revenue, panel_signups",
    );
    expect(mocks.markDashboardReportResult).toHaveBeenCalledWith(
      sub,
      "error",
      "panels unavailable: panel_revenue, panel_signups",
    );
  });

  it("holds back a degraded report inside the retry window without counting it as failed", async () => {
    const sub = subscription();
    const retryAt = "2026-07-13T11:16:00.000Z";
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([sub]);
    mocks.dashboardReportRetryAt.mockReturnValue(retryAt);
    mocks.sendDashboardReportSubscription.mockResolvedValue(
      completeResult({
        reportMode: "degraded",
        degradedPanelIds: ["panel_revenue"],
        reportError: "dashboard render timed out",
        emailsSent: false,
      }),
    );

    const result = await runDashboardReportsOnce();

    expect(result).toEqual({ processed: 1, failed: 0, remaining: 0 });
    expect(mocks.sendDashboardReportSubscription).toHaveBeenCalledWith(
      sub,
      expect.objectContaining({ skipEmailWhenDegraded: true }),
    );
    expect(console.error).toHaveBeenCalledWith(
      "[dashboard-report] Subscription sub_1 held back a degraded report, will retry:",
      "dashboard render timed out",
    );
    expect(mocks.markDashboardReportResult).toHaveBeenCalledWith(
      sub,
      "error",
      "dashboard render timed out (retry scheduled)",
      { nextRunAt: retryAt },
    );
  });

  it("persists the held-back error without a nextRunAt once the retry window has closed", async () => {
    const sub = subscription();
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([sub]);
    mocks.dashboardReportRetryAt.mockReturnValue(null);
    mocks.sendDashboardReportSubscription.mockResolvedValue(
      completeResult({
        reportMode: "degraded",
        degradedPanelIds: ["panel_revenue"],
        emailsSent: false,
      }),
    );

    const result = await runDashboardReportsOnce();

    expect(result).toEqual({ processed: 1, failed: 0, remaining: 0 });
    expect(mocks.sendDashboardReportSubscription).toHaveBeenCalledWith(
      sub,
      expect.objectContaining({ skipEmailWhenDegraded: false }),
    );
    expect(mocks.markDashboardReportResult).toHaveBeenCalledWith(
      sub,
      "error",
      "panels unavailable: panel_revenue (retry scheduled)",
    );
  });

  it("marks the subscription failed when send throws and persists the thrown message", async () => {
    const sub = subscription();
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([sub]);
    mocks.sendDashboardReportSubscription.mockRejectedValue(
      new Error("Email provider rejected the message"),
    );

    const result = await runDashboardReportsOnce();

    expect(result).toEqual({ processed: 1, failed: 1, remaining: 0 });
    expect(console.error).toHaveBeenCalledWith(
      "[dashboard-report] Subscription sub_1 failed:",
      "Email provider rejected the message",
    );
    expect(mocks.markDashboardReportResult).toHaveBeenCalledWith(
      sub,
      "error",
      "Email provider rejected the message",
    );
  });

  it("swallows a persist failure, counts it as failed, and still processes the rest of the batch", async () => {
    const subA = subscription({ id: "sub_a" });
    const subB = subscription({ id: "sub_b" });
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([subA, subB]);
    mocks.sendDashboardReportSubscription.mockResolvedValue(completeResult());
    mocks.markDashboardReportResult.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    const result = await runDashboardReportsOnce();

    expect(result).toEqual({ processed: 2, failed: 1, remaining: 0 });
    expect(mocks.markDashboardReportResult).toHaveBeenCalledTimes(2);
    expect(mocks.markDashboardReportResult).toHaveBeenNthCalledWith(
      1,
      subA,
      "success",
    );
    expect(mocks.markDashboardReportResult).toHaveBeenNthCalledWith(
      2,
      subB,
      "success",
    );
    expect(console.error).toHaveBeenCalledWith(
      "[dashboard-report] Failed to persist subscription sub_a result:",
      "database unavailable",
    );
  });

  it("continues processing later subscriptions after an earlier one throws", async () => {
    const subA = subscription({ id: "sub_a" });
    const subB = subscription({ id: "sub_b" });
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([subA, subB]);
    mocks.sendDashboardReportSubscription
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(completeResult());

    const result = await runDashboardReportsOnce();

    expect(result).toEqual({ processed: 2, failed: 1, remaining: 0 });
    expect(mocks.markDashboardReportResult).toHaveBeenCalledWith(
      subA,
      "error",
      "boom",
    );
    expect(mocks.markDashboardReportResult).toHaveBeenCalledWith(
      subB,
      "success",
    );
  });

  it("wires onCaptureOutcome to persist the capture checkpoint for the subscription", async () => {
    const sub = subscription();
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([sub]);
    mocks.sendDashboardReportSubscription.mockImplementation(
      async (
        _sub: unknown,
        options: {
          onCaptureOutcome?: (outcome: {
            mode: "full" | "partial" | "none";
            error?: string;
          }) => Promise<void>;
        },
      ) => {
        await options.onCaptureOutcome?.({
          mode: "partial",
          error: "part 2 timed out",
        });
        return completeResult({
          reportMode: "degraded",
          degradedPanelIds: ["panel_2"],
          reportError: "part 2 timed out",
        });
      },
    );

    await runDashboardReportsOnce();

    expect(mocks.recordDashboardReportCaptureOutcome).toHaveBeenCalledWith(
      sub,
      { mode: "partial", error: "part 2 timed out" },
    );
  });

  it("captures the serverless delivery deadline before claiming work", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NETLIFY", "true");
    const startedAt = new Date("2026-07-23T12:00:00.000Z");
    vi.setSystemTime(startedAt);
    const sub = subscription();
    mocks.claimDueDashboardReportSubscriptions.mockImplementation(async () => {
      vi.setSystemTime(new Date(startedAt.getTime() + 80_000));
      return [sub];
    });
    mocks.sendDashboardReportSubscription.mockResolvedValue(completeResult());

    await runDashboardReportsOnce();

    expect(mocks.sendDashboardReportSubscription).toHaveBeenCalledWith(
      sub,
      expect.objectContaining({
        deadlineAt: startedAt.getTime() + 220_000,
        onCaptureOutcome: expect.any(Function),
      }),
    );
  });

  it("omits the delivery deadline off Netlify", async () => {
    const sub = subscription();
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([sub]);
    mocks.sendDashboardReportSubscription.mockResolvedValue(completeResult());

    await runDashboardReportsOnce();

    const options = mocks.sendDashboardReportSubscription.mock.calls[0][1];
    expect(options).not.toHaveProperty("deadlineAt");
  });

  it("claims up to 5 reports per sweep on Netlify regardless of the override", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("DASHBOARD_REPORT_SWEEP_LIMIT", "1");
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([]);

    await runDashboardReportsOnce();

    expect(mocks.claimDueDashboardReportSubscriptions).toHaveBeenCalledWith(5);
  });

  it("honors DASHBOARD_REPORT_SWEEP_LIMIT off Netlify", async () => {
    vi.stubEnv("DASHBOARD_REPORT_SWEEP_LIMIT", "3");
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([]);

    await runDashboardReportsOnce();

    expect(mocks.claimDueDashboardReportSubscriptions).toHaveBeenCalledWith(3);
  });

  it("defaults to a sweep limit of 5 off Netlify with no override", async () => {
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue([]);

    await runDashboardReportsOnce();

    expect(mocks.claimDueDashboardReportSubscriptions).toHaveBeenCalledWith(5);
  });

  it("reports remaining work when the batch fills the sweep limit", async () => {
    vi.stubEnv("NETLIFY", "true");
    const subs = Array.from({ length: 5 }, (_, i) =>
      subscription({ id: `sub_${i}` }),
    );
    mocks.claimDueDashboardReportSubscriptions.mockResolvedValue(subs);
    mocks.sendDashboardReportSubscription.mockResolvedValue(completeResult());

    const result = await runDashboardReportsOnce();

    expect(result).toEqual({ processed: 5, failed: 0, remaining: 1 });
  });

  it("returns zeros for a concurrent call while a sweep is already running", async () => {
    const sub = subscription();
    let releaseClaim!: (subs: DashboardReportSubscription[]) => void;
    mocks.claimDueDashboardReportSubscriptions.mockImplementation(
      () =>
        new Promise<DashboardReportSubscription[]>((resolve) => {
          releaseClaim = resolve;
        }),
    );
    mocks.sendDashboardReportSubscription.mockResolvedValue(completeResult());

    const firstRun = runDashboardReportsOnce();
    const concurrentResult = await runDashboardReportsOnce();

    expect(concurrentResult).toEqual({ processed: 0, failed: 0, remaining: 0 });

    releaseClaim([sub]);
    const firstResult = await firstRun;
    expect(firstResult).toEqual({ processed: 1, failed: 0, remaining: 0 });
  });
});
