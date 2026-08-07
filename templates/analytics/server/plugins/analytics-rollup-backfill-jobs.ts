import { runAnalyticsRollupBackfillOnce } from "../jobs/analytics-rollup-backfill";
import { isProductionServerlessRuntime } from "../lib/production-serverless-runtime";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
let skippingLogged = false;

declare global {
  var __AGENT_NATIVE_ANALYTICS_ROLLUP_BACKFILL_SCHEDULED_RUNTIME__:
    | boolean
    | undefined;
}

function platformSchedulerOwnsBackfill(): boolean {
  return (
    isProductionServerlessRuntime() ||
    process.env.NITRO_PRESET === "netlify" ||
    globalThis.__AGENT_NATIVE_ANALYTICS_ROLLUP_BACKFILL_SCHEDULED_RUNTIME__ ===
      true
  );
}

function intervalMs(): number {
  const raw = process.env.ANALYTICS_ROLLUP_BACKFILL_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_INTERVAL_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 10_000
    ? parsed
    : DEFAULT_INTERVAL_MS;
}

export default function registerAnalyticsRollupBackfillJobs(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag =
    process.env.ANALYTICS_ROLLUP_BACKFILL_JOBS ??
    process.env.RUN_BACKGROUND_JOBS;
  const enabled =
    !platformSchedulerOwnsBackfill() &&
    (flag === "1" || (isProd && flag !== "0"));

  if (!enabled) {
    if (!skippingLogged) {
      console.log(
        platformSchedulerOwnsBackfill()
          ? "[analytics-rollups] Skipping in-process cron because the platform scheduler owns historical rollup backfills."
          : "[analytics-rollups] Skipping historical rollup backfill (set ANALYTICS_ROLLUP_BACKFILL_JOBS=1 or RUN_BACKGROUND_JOBS=1 to enable in dev; on by default in production)",
      );
      skippingLogged = true;
    }
    return;
  }

  const ms = intervalMs();
  setInterval(() => {
    runAnalyticsRollupBackfillOnce().catch((err) =>
      console.error("[analytics-rollups] historical backfill failed:", err),
    );
  }, ms);

  console.log(
    `[analytics-rollups] Historical rollup backfill scheduled every ${ms / 1000}s.`,
  );
}
