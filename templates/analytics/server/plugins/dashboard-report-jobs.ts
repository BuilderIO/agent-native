import { runDashboardReportsOnce } from "../jobs/dashboard-report";

const INTERVAL_MS = 60_000;
let skippingLogged = false;

declare global {
  var __AGENT_NATIVE_DASHBOARD_REPORT_SCHEDULED_RUNTIME__: boolean | undefined;
}

function platformSchedulerOwnsReports(): boolean {
  return (
    process.env.NETLIFY === "true" ||
    globalThis.__AGENT_NATIVE_DASHBOARD_REPORT_SCHEDULED_RUNTIME__ === true
  );
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

  setInterval(() => {
    runDashboardReportsOnce().catch((err) =>
      console.error("[dashboard-report] interval failed:", err),
    );
  }, INTERVAL_MS);

  console.log(
    `[dashboard-report] Recurring dashboard report sweep every ${INTERVAL_MS / 1000}s.`,
  );
}
