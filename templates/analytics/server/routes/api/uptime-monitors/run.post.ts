import { timingSafeEqual } from "node:crypto";

import { createError, defineEventHandler, getHeader } from "h3";

import { runDueMonitorsOnce } from "../../../jobs/uptime-monitors";

declare global {
  var __AGENT_NATIVE_UPTIME_MONITOR_SCHEDULED_RUNTIME__: boolean | undefined;
}

function productionLike(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.NETLIFY === "true" ||
    process.env.VERCEL === "1"
  );
}

function scheduledFunctionRuntime(): boolean {
  return globalThis.__AGENT_NATIVE_UPTIME_MONITOR_SCHEDULED_RUNTIME__ === true;
}

function cronSecret(): string | null {
  const secret = process.env.UPTIME_MONITORS_CRON_SECRET?.trim();
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
  if (!secret && productionLike() && !scheduledRuntime) {
    throw createError({
      statusCode: 503,
      statusMessage: "UPTIME_MONITORS_CRON_SECRET is required",
    });
  }

  if (
    secret &&
    !scheduledRuntime &&
    !headerMatchesSecret(getHeader(event, "authorization"), secret)
  ) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  return runDueMonitorsOnce();
});
