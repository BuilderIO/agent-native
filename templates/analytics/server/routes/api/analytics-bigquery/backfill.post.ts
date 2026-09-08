import { timingSafeEqual } from "node:crypto";

import { createError, defineEventHandler, getHeader } from "h3";

// guard:allow-action-twin — the generated scheduled worker authenticates before invoking this job route.
import { runFirstPartyAnalyticsBigQueryBackfillOnce } from "../../../jobs/analytics-bigquery-backfill.js";

declare global {
  var __AGENT_NATIVE_ANALYTICS_BIGQUERY_BACKFILL_SCHEDULED_RUNTIME__:
    | boolean
    | undefined;
}

function scheduledFunctionRuntime(): boolean {
  return (
    globalThis.__AGENT_NATIVE_ANALYTICS_BIGQUERY_BACKFILL_SCHEDULED_RUNTIME__ ===
    true
  );
}

function cronSecret(): string | null {
  const secret = process.env.ANALYTICS_BIGQUERY_BACKFILL_CRON_SECRET?.trim();
  return secret ? secret : null;
}

function headerMatchesSecret(
  header: string | undefined,
  secret: string,
): boolean {
  const expected = `Bearer ${secret}`;
  const value = header?.trim() ?? "";
  if (value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

export default defineEventHandler(async (event) => {
  const secret = cronSecret();
  const scheduledRuntime = scheduledFunctionRuntime();
  const authenticated =
    secret !== null &&
    headerMatchesSecret(getHeader(event, "authorization"), secret);
  if (!scheduledRuntime && !authenticated) {
    throw createError({
      statusCode: secret ? 401 : 503,
      statusMessage: secret
        ? "Unauthorized"
        : "ANALYTICS_BIGQUERY_BACKFILL_CRON_SECRET is required",
    });
  }

  return {
    ok: true,
    ...(await runFirstPartyAnalyticsBigQueryBackfillOnce()),
  };
});
