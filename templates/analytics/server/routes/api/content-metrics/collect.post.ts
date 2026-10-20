import { createError, defineEventHandler } from "h3";

// guard:allow-action-twin — the platform scheduler's background worker calls this after checking its build-time token; people and agents use run-content-collection.
import { runContentMetricsCollectionOnce } from "../../../jobs/content-metrics-collection";

declare global {
  var __AGENT_NATIVE_CONTENT_METRICS_SCHEDULED_RUNTIME__: boolean | undefined;
}

export default defineEventHandler(async () => {
  // Only the emitted background worker sets this flag, after it has checked
  // the per-build cron token. Every other caller is refused, so no request
  // from a browser can start provider or BigQuery work.
  if (globalThis.__AGENT_NATIVE_CONTENT_METRICS_SCHEDULED_RUNTIME__ !== true) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }
  const result = await runContentMetricsCollectionOnce();
  return { ok: true, ...result };
});
