/**
 * Run the upload reaper once. Invoked by the per-minute Clips scheduled
 * function (see `jobs/emit-netlify-brain-export-cron.ts`), never by
 * `setInterval` — an in-process timer only fires while traffic keeps a lambda
 * warm, which is why the old startup sweeps effectively never ran in prod.
 *
 * `dryRun=1` reports what would be reaped without writing.
 *
 * Route: POST /api/uploads/reap
 */

import { timingSafeEqual } from "node:crypto";

import {
  createError,
  defineEventHandler,
  getHeader,
  getQuery,
  type H3Event,
} from "h3";

import { reapExpiredUploads } from "../../../lib/upload-lease.js";

declare global {
  var __AGENT_NATIVE_CLIPS_BRAIN_EXPORT_SCHEDULED_RUNTIME__:
    | boolean
    | undefined;
}

function headerMatchesSecret(header: string | undefined, secret: string) {
  const expected = `Bearer ${secret}`;
  const value = header?.trim() ?? "";
  return (
    value.length === expected.length &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}

export default defineEventHandler(async (event: H3Event) => {
  const scheduled =
    globalThis.__AGENT_NATIVE_CLIPS_BRAIN_EXPORT_SCHEDULED_RUNTIME__ === true;
  const secret = process.env.CLIPS_BRAIN_EXPORT_JOBS_SECRET?.trim(); // guard:allow-env-credential — deployment scheduler route secret
  if (!scheduled) {
    if (!secret) {
      throw createError({
        statusCode: 503,
        statusMessage: "CLIPS_BRAIN_EXPORT_JOBS_SECRET is required",
      });
    }
    if (
      secret &&
      !headerMatchesSecret(getHeader(event, "authorization"), secret)
    ) {
      throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
    }
  }

  const query = getQuery(event);
  const result = await reapExpiredUploads({
    dryRun: query.dryRun === "1" || query.dryRun === "true",
  });
  if (
    result.failed > 0 ||
    result.scratchKeysDeleted > 0 ||
    result.resumableSessionsAborted > 0 ||
    result.resumableCleanupFailed > 0
  ) {
    console.log("[uploads] reaped expired uploads", {
      failed: result.failed,
      scratchKeysDeleted: result.scratchKeysDeleted,
      resumableSessionsAborted: result.resumableSessionsAborted,
      resumableCleanupFailed: result.resumableCleanupFailed,
    });
  }
  return { ok: true, ...result };
});
