import { runAnalyticsAlertsOnce } from "../jobs/analytics-alerts";

const DEFAULT_INTERVAL_MS = 60_000;
let skippingLogged = false;

declare global {
  var __AGENT_NATIVE_ANALYTICS_ALERT_SCHEDULED_RUNTIME__: boolean | undefined;
}

function platformSchedulerOwnsAlerts(): boolean {
  return (
    process.env.NETLIFY === "true" ||
    globalThis.__AGENT_NATIVE_ANALYTICS_ALERT_SCHEDULED_RUNTIME__ === true
  );
}

function intervalMs(): number {
  const raw = process.env.ANALYTICS_ALERT_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_INTERVAL_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 10_000
    ? parsed
    : DEFAULT_INTERVAL_MS;
}

export default function registerAnalyticsAlertJobs(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag =
    process.env.ANALYTICS_ALERT_JOBS ?? process.env.RUN_BACKGROUND_JOBS;
  const enabled =
    !platformSchedulerOwnsAlerts() &&
    (flag === "1" || (isProd && flag !== "0"));

  if (!enabled) {
    if (!skippingLogged) {
      console.log(
        platformSchedulerOwnsAlerts()
          ? "[analytics-alerts] Skipping in-process cron because the platform scheduler owns alert sweeps."
          : "[analytics-alerts] Skipping background cron (set ANALYTICS_ALERT_JOBS=1 or RUN_BACKGROUND_JOBS=1 to enable in dev; on by default in production)",
      );
      skippingLogged = true;
    }
    return;
  }

  const ms = intervalMs();
  setInterval(() => {
    runAnalyticsAlertsOnce().catch((err) =>
      console.error("[analytics-alerts] interval failed:", err),
    );
  }, ms);

  console.log(`[analytics-alerts] Recurring alert sweep every ${ms / 1000}s.`);
}
