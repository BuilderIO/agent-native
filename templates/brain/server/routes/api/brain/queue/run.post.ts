import { timingSafeEqual } from "node:crypto";

import { createError, defineEventHandler, getHeader } from "h3";

import { processBrainIngestQueueOnce } from "../../../../../jobs/process-ingest-queue.js";
import { syncDueBrainSourcesOnce } from "../../../../jobs/sync-sources.js";
import { expireSensitivityQuarantines } from "../../../../lib/brain.js";

declare global {
  var __AGENT_NATIVE_BRAIN_SCHEDULED_RUNTIME__: boolean | undefined;
}

function productionLike() {
  return (
    process.env.NODE_ENV === "production" || process.env.NETLIFY === "true"
  );
}

function scheduledFunctionRuntime() {
  return globalThis.__AGENT_NATIVE_BRAIN_SCHEDULED_RUNTIME__ === true;
}

function headerMatchesSecret(header: string | undefined, secret: string) {
  const expected = `Bearer ${secret}`;
  const value = header?.trim() ?? "";
  return (
    value.length === expected.length &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}

export default defineEventHandler(async (event) => {
  const secret = process.env.BRAIN_JOBS_SECRET?.trim(); // guard:allow-env-credential — deployment-level scheduler route secret
  const scheduled = scheduledFunctionRuntime();
  if (!secret && productionLike() && !scheduled) {
    throw createError({
      statusCode: 503,
      statusMessage: "BRAIN_JOBS_SECRET is required",
    });
  }
  if (
    secret &&
    !scheduled &&
    !headerMatchesSecret(getHeader(event, "authorization"), secret)
  ) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const [sync, queue, expiredSensitivityQuarantines] = await Promise.all([
    syncDueBrainSourcesOnce({ system: true, limit: 5 }),
    processBrainIngestQueueOnce({ limit: 1, runDistillation: true }),
    expireSensitivityQuarantines(),
  ]);
  return { ok: true, sync, queue, expiredSensitivityQuarantines };
});
