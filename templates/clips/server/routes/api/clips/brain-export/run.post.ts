import { timingSafeEqual } from "node:crypto";

import { createError, defineEventHandler, getHeader } from "h3";

import { runBrainExportSweepOnce } from "../../../../jobs/brain-export.js";

declare global {
  var __AGENT_NATIVE_CLIPS_BRAIN_EXPORT_SCHEDULED_RUNTIME__:
    | boolean
    | undefined;
}

function productionLike() {
  return (
    process.env.NODE_ENV === "production" || process.env.NETLIFY === "true"
  );
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
  const scheduled =
    globalThis.__AGENT_NATIVE_CLIPS_BRAIN_EXPORT_SCHEDULED_RUNTIME__ === true;
  const secret = process.env.CLIPS_BRAIN_EXPORT_JOBS_SECRET?.trim(); // guard:allow-env-credential — deployment scheduler route secret
  if (!secret && productionLike() && !scheduled)
    throw createError({
      statusCode: 503,
      statusMessage: "CLIPS_BRAIN_EXPORT_JOBS_SECRET is required",
    });
  if (
    secret &&
    !scheduled &&
    !headerMatchesSecret(getHeader(event, "authorization"), secret)
  )
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  await runBrainExportSweepOnce();
  return { ok: true };
});
