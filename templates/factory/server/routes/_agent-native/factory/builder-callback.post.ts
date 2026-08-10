import { createHmac, timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";
import {
  getRequestHeader,
  getQuery,
  readRawBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { defineEventHandler } from "h3";

import { resolveConnectorSecret } from "../../../connectors/credentials.js";
import { getDb } from "../../../db/index.js";
import { triageItems, triageRuns } from "../../../db/schema.js";

export default defineEventHandler(async (event: H3Event) => {
  const runId = String(getQuery(event).runId ?? "").trim();
  if (!runId) {
    setResponseStatus(event, 400);
    return { ok: false, error: "runId is required" };
  }
  const rawBody = (await readRawBody(event)) ?? "";
  let payload: {
    status?: string;
    taskId?: string;
    id?: string;
    error?: string;
  };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    setResponseStatus(event, 400);
    return { ok: false, error: "Invalid JSON body" };
  }

  const db = getDb();
  const run = (
    await db
      .select({
        id: triageRuns.id,
        ownerEmail: triageRuns.ownerEmail,
        orgId: triageRuns.orgId,
        itemId: triageRuns.itemId,
      })
      .from(triageRuns)
      .where(eq(triageRuns.id, runId))
      .limit(1)
  )[0];
  if (!run || !run.orgId) {
    setResponseStatus(event, 404);
    return { ok: false, error: "Factory run not found" };
  }

  const secret = await resolveConnectorSecret(
    "FACTORY_BUILDER_WEBHOOK_SECRET",
    run.ownerEmail,
    {
      orgId: run.orgId,
    },
  );
  const signature = getRequestHeader(event, "x-builder-signature") ?? "";
  if (!secret || !verifySignature(rawBody, signature, secret)) {
    setResponseStatus(event, secret ? 401 : 503);
    return {
      ok: false,
      error: secret
        ? "Invalid Builder callback signature"
        : "Callback secret is not configured",
    };
  }

  const now = new Date().toISOString();
  const terminal = payload.status === "success" ? "completed" : "failed";
  const reason =
    payload.status === "success"
      ? "Builder reported a successful terminal callback."
      : payload.error?.trim() || "Builder reported an error terminal callback.";
  const progress = [{ at: now, state: terminal, reason }];
  await db
    .update(triageRuns)
    .set({
      status: terminal,
      providerTaskId: payload.taskId ?? payload.id ?? undefined,
      progressLogJson: JSON.stringify(progress),
      heartbeatAt: now,
      completedAt: now,
      error: terminal === "failed" ? reason : null,
    })
    .where(and(eq(triageRuns.id, runId), eq(triageRuns.orgId, run.orgId)));
  await db
    .update(triageItems)
    .set({
      status: terminal === "completed" ? "evidence_ready" : "failed",
      updatedAt: now,
    })
    .where(
      and(eq(triageItems.id, run.itemId), eq(triageItems.orgId, run.orgId)),
    );

  return { ok: true, runId, status: terminal };
});

function verifySignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}
