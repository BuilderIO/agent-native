// guard:allow-api-route — Upload transport interruption preserves resumable state for desktop recovery.

/**
 * Mark a live upload as interrupted without discarding its provider session or
 * buffered chunks. Explicit cancellation continues to use /abort.
 *
 * Route: POST /api/uploads/:recordingId/interrupt
 */

import {
  compareAndSetAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, isNull } from "drizzle-orm";
import {
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import { UPLOAD_RETRY_RESUME_FLAG } from "../../../../../shared/feature-flags.js";
import { getDb, schema } from "../../../../db/index.js";
import {
  getEventOwnerContext,
  ownerEmailMatches,
} from "../../../../lib/recordings.js";
import {
  isRetryableUploadInterruption,
  retryableUploadInterruptionReason,
} from "../../../../lib/upload-interruption.js";
import abortUpload from "./abort.post.js";

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  const { userEmail: ownerEmail, orgId } = await getEventOwnerContext(event);
  if (
    !(await isFeatureFlagEnabled(UPLOAD_RETRY_RESUME_FLAG, {
      userEmail: ownerEmail,
      userKey: ownerEmail,
      orgId,
    }))
  ) {
    return abortUpload(event);
  }
  const body = (await readBody(event).catch(() => null)) as {
    detail?: unknown;
    attemptId?: unknown;
    uploadGenerationId?: unknown;
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
  const uploadGenerationId =
    typeof body?.uploadGenerationId === "string" &&
    body.uploadGenerationId.length > 0 &&
    body.uploadGenerationId.length <= 128
      ? body.uploadGenerationId
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
        uploadGenerationId: schema.recordings.uploadGenerationId,
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
    if ((existing.uploadGenerationId ?? null) !== uploadGenerationId) {
      setResponseStatus(event, 409);
      return {
        error: "A newer upload generation is already active.",
        staleAttempt: true,
      };
    }
    const alreadyInterrupted =
      existing.status === "failed" &&
      isRetryableUploadInterruption(existing.failureReason);
    if (existing.status !== "uploading" && !alreadyInterrupted) {
      setResponseStatus(event, 409);
      return { error: "Recording upload is no longer active" };
    }

    const uploadStateKey = `recording-upload-${recordingId}`;
    const uploadStateRaw = await readAppState(uploadStateKey);
    const uploadState = uploadStateRaw ?? {};
    const interruptedAt = new Date().toISOString();
    const failureReason = retryableUploadInterruptionReason(interruptionDetail);
    if (!alreadyInterrupted) {
      const interrupted = await db
        .update(schema.recordings)
        .set({
          status: "failed",
          failureReason,
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
            uploadGenerationId === null
              ? isNull(schema.recordings.uploadGenerationId)
              : eq(schema.recordings.uploadGenerationId, uploadGenerationId),
          ),
        )
        .returning({ id: schema.recordings.id });

      if (interrupted.length !== 1) {
        setResponseStatus(event, 409);
        return { error: "Recording upload changed while it was interrupted" };
      }
    }

    const uploadStateUpdated = await compareAndSetAppState(
      uploadStateKey,
      uploadStateRaw,
      {
        ...uploadState,
        recordingId,
        status: "failed",
        failureReason,
        retryableInterruption: true,
        uploadAttemptId: attemptId,
        uploadGenerationId,
        ...(interruptionDetail ? { interruptionDetail } : {}),
        updatedAt: interruptedAt,
      },
    );
    if (!uploadStateUpdated) {
      console.info(
        `[upload-interrupt] upload state changed after interruption claim; preserving replacement state for ${recordingId}`,
      );
    }
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.info("[upload-interrupt] resumable state preserved", {
      recordingId,
      hasInterruptionDetail: interruptionDetail !== null,
    });
    return {
      ok: true,
      recordingId,
      status: "failed",
      resumable: true,
      ...(alreadyInterrupted ? { alreadyInterrupted: true } : {}),
    };
  });
});
