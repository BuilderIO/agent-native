// guard:allow-api-route — Upload transport interruption preserves resumable state for desktop recovery.

/**
 * Mark a live upload as interrupted without discarding its provider session or
 * buffered chunks. Explicit cancellation continues to use /abort.
 *
 * Route: POST /api/uploads/:recordingId/interrupt
 */

import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, isNull } from "drizzle-orm";
import {
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getDb, schema } from "../../../../db/index.js";
import {
  getEventOwnerContext,
  ownerEmailMatches,
} from "../../../../lib/recordings.js";
import {
  isRetryableUploadInterruption,
  RETRYABLE_UPLOAD_INTERRUPTION_REASON,
} from "../../../../lib/upload-interruption.js";

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  const { userEmail: ownerEmail, orgId } = await getEventOwnerContext(event);
  const body = (await readBody(event).catch(() => null)) as {
    detail?: unknown;
    attemptId?: unknown;
  } | null;
  const attemptId =
    typeof body?.attemptId === "string" &&
    body.attemptId.length > 0 &&
    body.attemptId.length <= 128
      ? body.attemptId
      : null;
  const interruptionDetail =
    typeof body?.detail === "string" && body.detail.trim()
      ? body.detail.trim().slice(0, 1000)
      : null;

  return runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
    const db = getDb();
    const [existing] = await db
      .select({
        id: schema.recordings.id,
        status: schema.recordings.status,
        failureReason: schema.recordings.failureReason,
        videoUrl: schema.recordings.videoUrl,
        uploadAttemptId: schema.recordings.uploadAttemptId,
      })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        ),
      );

    if (!existing) {
      setResponseStatus(event, 404);
      return { error: "Recording not found" };
    }
    if (existing.status === "ready" || existing.status === "processing") {
      return {
        ok: true,
        recordingId,
        status: existing.status,
        alreadyAccepted: true,
      };
    }
    if ((existing.uploadAttemptId ?? null) !== attemptId) {
      setResponseStatus(event, 409);
      return {
        error: "A newer upload retry is already active.",
        staleAttempt: true,
      };
    }
    if (
      existing.status === "failed" &&
      isRetryableUploadInterruption(existing.failureReason)
    ) {
      return {
        ok: true,
        recordingId,
        status: "failed",
        alreadyInterrupted: true,
      };
    }
    if (existing.status !== "uploading") {
      setResponseStatus(event, 409);
      return { error: "Recording upload is no longer active" };
    }

    const interruptedAt = new Date().toISOString();
    const interrupted = await db
      .update(schema.recordings)
      .set({
        status: "failed",
        failureReason: RETRYABLE_UPLOAD_INTERRUPTION_REASON,
        updatedAt: interruptedAt,
      })
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          eq(schema.recordings.status, "uploading"),
          attemptId === null
            ? isNull(schema.recordings.uploadAttemptId)
            : eq(schema.recordings.uploadAttemptId, attemptId),
        ),
      )
      .returning({ id: schema.recordings.id });

    if (interrupted.length !== 1) {
      setResponseStatus(event, 409);
      return { error: "Recording upload changed while it was interrupted" };
    }

    const uploadStateRaw = await readAppState(
      `recording-upload-${recordingId}`,
    ).catch(() => null);
    const uploadState =
      uploadStateRaw && typeof uploadStateRaw === "object"
        ? (uploadStateRaw as Record<string, unknown>)
        : {};
    await writeAppState(`recording-upload-${recordingId}`, {
      ...uploadState,
      recordingId,
      status: "failed",
      failureReason: RETRYABLE_UPLOAD_INTERRUPTION_REASON,
      retryableInterruption: true,
      ...(interruptionDetail ? { interruptionDetail } : {}),
      updatedAt: interruptedAt,
    });
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.info("[upload-interrupt] resumable state preserved", {
      recordingId,
      hasInterruptionDetail: interruptionDetail !== null,
    });
    return { ok: true, recordingId, status: "failed", resumable: true };
  });
});
