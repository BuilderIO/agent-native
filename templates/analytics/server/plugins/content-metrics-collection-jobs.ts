import { getAppConfig } from "@agent-native/core/server";

import { runContentMetricsCollectionOnce } from "../jobs/content-metrics-collection";
import { isProductionServerlessRuntime } from "../lib/production-serverless-runtime";

// Hourly ticks; each step runs at most once per UTC day (see collect.ts), so
// a long-lived server collects shortly after midnight UTC and after restarts.
const TICK_MS = 60 * 60 * 1000;
let skippingLogged = false;

export default function registerContentMetricsCollectionJobs(): void {
  const isServerless = isProductionServerlessRuntime();
  const enabled =
    !isServerless &&
    (getAppConfig().runtime.backgroundJobsEnabled ??
      process.env.NODE_ENV === "production");

  if (!enabled) {
    if (!skippingLogged) {
      console.log(
        isServerless
          ? "[content-metrics] Skipping in-process collection because production serverless runtimes rely on the scheduled sweep."
          : "[content-metrics] Skipping daily collection (set RUN_BACKGROUND_JOBS=1 to enable in dev; on by default in production)",
      );
      skippingLogged = true;
    }
    return;
  }

  setInterval(() => {
    runContentMetricsCollectionOnce()
      .then((result) => {
        if (result.ran && result.steps.some((s) => s.status !== "skipped")) {
          console.log("[content-metrics] Collection pass completed", result);
        }
      })
      .catch((err) =>
        console.error("[content-metrics] collection interval failed:", err),
      );
  }, TICK_MS);

  console.log("[content-metrics] Daily content collection scheduled.");
}
