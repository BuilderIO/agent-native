import { runDashboardReportsOnce } from "../jobs/dashboard-report";
import { isProductionServerlessRuntime } from "../lib/production-serverless-runtime";

const DEFAULT_INTERVAL_MS = 60_000;
let skippingLogged = false;

declare global {
  var __AGENT_NATIVE_DASHBOARD_REPORT_SCHEDULED_RUNTIME__: boolean | undefined;
}

function platformSchedulerOwnsReports(): boolean {
  return (
    isProductionServerlessRuntime() ||
    globalThis.__AGENT_NATIVE_DASHBOARD_REPORT_SCHEDULED_RUNTIME__ === true
  );
}

function intervalMs(): number {
  const raw = process.env.DASHBOARD_REPORT_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_INTERVAL_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 10_000
    ? parsed
    : DEFAULT_INTERVAL_MS;
}

export default function registerDashboardReportJobs(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag =
    process.env.ANALYTICS_DASHBOARD_REPORT_JOBS ??
    process.env.RUN_BACKGROUND_JOBS;
  const enabled =
    !platformSchedulerOwnsReports() &&
    (flag === "1" || (isProd && flag !== "0"));

  if (!enabled) {
    if (!skippingLogged) {
      console.log(
        platformSchedulerOwnsReports()
          ? "[dashboard-report] Skipping in-process cron because the platform scheduler owns dashboard reports."
          : "[dashboard-report] Skipping background cron (set ANALYTICS_DASHBOARD_REPORT_JOBS=1 or RUN_BACKGROUND_JOBS=1 to enable in dev; on by default in production)",
      );
      skippingLogged = true;
    }
    return;
  }

  const ms = intervalMs();
  setInterval(() => {
    runDashboardReportsOnce().catch((err) =>
      console.error("[dashboard-report] interval failed:", err),
    );
  }, ms);

  console.log(
    `[dashboard-report] Recurring dashboard report sweep every ${ms / 1000}s.`,
  );
}
