import { createError, defineEventHandler } from "h3";

// guard:allow-action-twin -- only the build-token-authenticated background worker may prune global usage.
import { pruneBigQueryUsage } from "../../../lib/bigquery-usage-retention";

declare global {
  var __AGENT_NATIVE_BIGQUERY_USAGE_RETENTION_SCHEDULED_RUNTIME__:
    | boolean
    | undefined;
}

export default defineEventHandler(async () => {
  if (
    globalThis.__AGENT_NATIVE_BIGQUERY_USAGE_RETENTION_SCHEDULED_RUNTIME__ !==
    true
  )
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  return { ok: true, ...(await pruneBigQueryUsage()) };
});
