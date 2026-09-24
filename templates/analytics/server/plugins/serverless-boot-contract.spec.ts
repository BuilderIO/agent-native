import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobs = vi.hoisted(() => ({
  alerts: vi.fn(),
  rollups: vi.fn(),
  reports: vi.fn(),
  retention: vi.fn(),
  monitors: vi.fn(),
}));

vi.mock("../jobs/analytics-alerts", () => ({
  runAnalyticsAlertsOnce: jobs.alerts,
}));
vi.mock("../jobs/analytics-rollup-backfill", () => ({
  runAnalyticsRollupBackfillOnce: jobs.rollups,
}));
vi.mock("../jobs/dashboard-report", () => ({
  runDashboardReportsOnce: jobs.reports,
}));
vi.mock("../jobs/session-replay-retention", () => ({
  runSessionReplayRetentionOnce: jobs.retention,
}));
vi.mock("../jobs/uptime-monitors", () => ({
  runDueMonitorsOnce: jobs.monitors,
}));

import registerAnalyticsAlertJobs from "./analytics-alert-jobs";
import registerAnalyticsRollupBackfillJobs from "./analytics-rollup-backfill-jobs";
import registerDashboardReportJobs from "./dashboard-report-jobs";
import registerSessionReplayRetentionJobs from "./session-replay-retention-jobs";
import registerUptimeMonitorJobs from "./uptime-monitor-jobs";

const registerers = [
  registerAnalyticsAlertJobs,
  registerAnalyticsRollupBackfillJobs,
  registerDashboardReportJobs,
  registerSessionReplayRetentionJobs,
  registerUptimeMonitorJobs,
];

const originalEnv = { ...process.env };

describe("Analytics serverless boot contract", () => {
  let intervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: "production", NETLIFY: "true" };
    intervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(() => 1 as unknown as NodeJS.Timeout);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("does not create an in-process recurring timer from any job plugin", () => {
    for (const register of registerers) register();

    expect(intervalSpy).not.toHaveBeenCalled();
  });
});
