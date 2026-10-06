import {
  extractInternalBearerToken,
  readBodyWithSizeLimit,
  runWithRequestContext,
  verifyInternalToken,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { defineEventHandler, getHeader, setResponseStatus } from "h3";
import { z } from "zod";

import { getDb, schema } from "../../../db/index.js";
import { processMailAiFilterBackfills } from "../../../lib/ai-filter-backfill.js";

const MAX_REQUEST_BODY_BYTES = 1024;

const bodySchema = z.object({
  taskId: z.string().min(1).max(64),
  runId: z.string().min(1).max(64),
});

export default defineEventHandler(async (event) => {
  let body: unknown;
  try {
    body = await readBodyWithSizeLimit(event, MAX_REQUEST_BODY_BYTES);
  } catch (error) {
    setResponseStatus(
      event,
      (error as { statusCode?: unknown })?.statusCode === 413 ? 413 : 400,
    );
    return { ok: false, error: "Unable to read Mail AI backfill job" };
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success || parsed.data.taskId !== parsed.data.runId) {
    setResponseStatus(event, 400);
    return { ok: false, error: "Invalid Mail AI backfill job" };
  }
  const { runId } = parsed.data;
  const token = extractInternalBearerToken(getHeader(event, "authorization"));
  if (!token || !verifyInternalToken(runId, token)) {
    setResponseStatus(event, 401);
    return { ok: false, error: "Invalid or expired Mail AI backfill token" };
  }

  const [run] = await getDb()
    .select({ ownerEmail: schema.aiFilterBackfills.ownerEmail })
    .from(schema.aiFilterBackfills)
    .where(eq(schema.aiFilterBackfills.id, runId))
    .limit(1);
  if (!run) {
    setResponseStatus(event, 404);
    return { ok: false, error: "Mail AI backfill run not found" };
  }

  await runWithRequestContext({ userEmail: run.ownerEmail }, () =>
    processMailAiFilterBackfills(run.ownerEmail, runId),
  );
  return { ok: true, runId };
});
