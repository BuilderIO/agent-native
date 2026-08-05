import { timingSafeEqual } from "node:crypto";

import { createError, defineEventHandler, getHeader } from "h3";

// guard:allow-action-twin — external cron endpoint authenticates scheduled callers before invoking the rollup job.
import { runAnalyticsRollupBackfillOnce } from "../../../jobs/analytics-rollup-backfill";

declare global {
  var __AGENT_NATIVE_ANALYTICS_ROLLUP_BACKFILL_SCHEDULED_RUNTIME__:
    | boolean
    | undefined;
}

function scheduledFunctionRuntime(): boolean {
  return (
    globalThis.__AGENT_NATIVE_ANALYTICS_ROLLUP_BACKFILL_SCHEDULED_RUNTIME__ ===
    true
  );
}

function cronSecret(): string | null {
  const secret = process.env.ANALYTICS_ROLLUP_BACKFILL_CRON_SECRET?.trim();
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
  const authenticatedHeader =
    secret !== null &&
    headerMatchesSecret(getHeader(event, "authorization"), secret);
  if (!scheduledRuntime && !authenticatedHeader) {
    throw createError({
      statusCode: secret ? 401 : 503,
      statusMessage: secret
        ? "Unauthorized"
        : "ANALYTICS_ROLLUP_BACKFILL_CRON_SECRET is required",
    });
  }

  const result = await runAnalyticsRollupBackfillOnce();
  return { ok: true, ...result };
});
