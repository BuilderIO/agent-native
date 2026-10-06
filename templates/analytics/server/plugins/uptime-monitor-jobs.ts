import { runDueMonitorsOnce } from "../jobs/uptime-monitors";
import { isProductionServerlessRuntime } from "../lib/production-serverless-runtime";

const DEFAULT_INTERVAL_MS = 30_000;
let skippingLogged = false;

declare global {
  var __AGENT_NATIVE_UPTIME_MONITOR_SCHEDULED_RUNTIME__: boolean | undefined;
}

function platformSchedulerOwnsMonitors(): boolean {
  return (
    isProductionServerlessRuntime() ||
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
          ? "[uptime-monitors] Skipping in-process cron because production serverless runtimes rely on scheduled/background monitor sweeps."
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
