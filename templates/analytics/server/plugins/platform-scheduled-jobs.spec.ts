import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runDashboardReportsOnce = vi.hoisted(() => vi.fn());
const runAnalyticsAlertsOnce = vi.hoisted(() => vi.fn());

vi.mock("../jobs/dashboard-report", () => ({
  runDashboardReportsOnce,
}));
vi.mock("../jobs/analytics-alerts", () => ({
  runAnalyticsAlertsOnce,
}));

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  delete process.env.NETLIFY;
  delete process.env.NETLIFY_FUNCTION_NAME;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  delete process.env.LAMBDA_TASK_ROOT;
  delete process.env.AWS_EXECUTION_ENV;
  delete process.env.VERCEL;
  delete process.env.ANALYTICS_DASHBOARD_REPORT_JOBS;
  delete process.env.ANALYTICS_ALERT_JOBS;
  delete process.env.RUN_BACKGROUND_JOBS;
  globalThis.__AGENT_NATIVE_DASHBOARD_REPORT_SCHEDULED_RUNTIME__ = undefined;
  globalThis.__AGENT_NATIVE_ANALYTICS_ALERT_SCHEDULED_RUNTIME__ = undefined;
}

describe("platform-scheduled job registration", () => {
  let intervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetEnv();
    vi.resetModules();
    intervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(() => 1 as unknown as NodeJS.Timeout);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  it("does not start dashboard report intervals in production Lambda functions", async () => {
    process.env.NODE_ENV = "production";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "analytics-alert-sweep-background";
    process.env.ANALYTICS_DASHBOARD_REPORT_JOBS = "1";

    const register = (await import("./dashboard-report-jobs")).default;
    register();

    expect(intervalSpy).not.toHaveBeenCalled();
  });

  it("does not start alert intervals in production Lambda functions", async () => {
    process.env.NODE_ENV = "production";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "dashboard-report-sweep-background";
    process.env.ANALYTICS_ALERT_JOBS = "1";

    const register = (await import("./analytics-alert-jobs")).default;
    register();

    expect(intervalSpy).not.toHaveBeenCalled();
  });

  it("keeps intervals enabled for long-lived production servers", async () => {
    process.env.NODE_ENV = "production";

    const registerReports = (await import("./dashboard-report-jobs")).default;
    const registerAlerts = (await import("./analytics-alert-jobs")).default;
    registerReports();
    registerAlerts();

    expect(intervalSpy).toHaveBeenCalledTimes(2);
  });
});
