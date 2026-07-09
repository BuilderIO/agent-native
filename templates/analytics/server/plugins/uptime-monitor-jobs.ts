/**
 * Background uptime-monitor sweep registration. Mirrors
 * server/plugins/analytics-alert-jobs.ts for gating (env flags, platform
 * scheduler ownership, prod default on) and interval scheduling.
 *
 * The monitor tables are created by the app migration list (server/plugins/
 * db.ts, versions 92+), which runs at boot regardless of this cron gate — so
 * the actions/UI have their schema even when in-process sweeps are disabled.
 */
import { runDueMonitorsOnce } from "../jobs/uptime-monitors";

const DEFAULT_INTERVAL_MS = 30_000;
let skippingLogged = false;

declare global {
  var __AGENT_NATIVE_UPTIME_MONITOR_SCHEDULED_RUNTIME__: boolean | undefined;
}

function platformSchedulerOwnsMonitors(): boolean {
  return (
    process.env.NETLIFY === "true" ||
    globalThis.__AGENT_NATIVE_UPTIME_MONITOR_SCHEDULED_RUNTIME__ === true
  );
}

function intervalMs(): number {
  const raw = process.env.UPTIME_MONITOR_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_INTERVAL_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 10_000
    ? parsed
    : DEFAULT_INTERVAL_MS;
}

export default function registerUptimeMonitorJobs(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag =
    process.env.UPTIME_MONITOR_JOBS ?? process.env.RUN_BACKGROUND_JOBS;
  const enabled =
    !platformSchedulerOwnsMonitors() &&
    (flag === "1" || (isProd && flag !== "0"));

  if (!enabled) {
    if (!skippingLogged) {
      console.log(
        platformSchedulerOwnsMonitors()
          ? "[uptime-monitors] Skipping in-process cron because the platform scheduler owns monitor sweeps."
          : "[uptime-monitors] Skipping background cron (set UPTIME_MONITOR_JOBS=1 or RUN_BACKGROUND_JOBS=1 to enable in dev; on by default in production)",
      );
      skippingLogged = true;
    }
    return;
  }

  const ms = intervalMs();
  setInterval(() => {
    runDueMonitorsOnce({ source: "in-process" }).catch((err) =>
      console.error("[uptime-monitors] interval failed:", err),
    );
  }, ms);

  console.log(`[uptime-monitors] Recurring monitor sweep every ${ms / 1000}s.`);
}
