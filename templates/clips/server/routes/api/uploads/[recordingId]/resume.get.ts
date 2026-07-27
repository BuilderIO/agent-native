// guard:allow-api-route — Upload transport resume endpoint returns lease and offset state for the chunk protocol.

/**
 * Report the authoritative received-offset for an in-flight upload, so a
 * client whose stream dropped can continue instead of stranding.
 *
 * The chunk-POST protocol is unchanged: a client resumes by POSTing the next
 * chunk at `nextChunkIndex`. Asking also renews the lease, because a client
 * asking where to resume is a live writer.
 *
 * Route: GET /api/uploads/:recordingId/resume
 */

import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, isNull } from "drizzle-orm";
import {
  createError,
  defineEventHandler,
  getRouterParam,
  getQuery,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getDb, schema } from "../../../../db/index.js";
import {
  listRecordingChunkKeys,
  recordingChunkIndexFromKey,
  sumRecordingChunkBytes,
} from "../../../../lib/recording-upload-state.js";
import {
  getEventOwnerContext,
  ownerEmailMatches,
} from "../../../../lib/recordings.js";
import { getResumableSession } from "../../../../lib/resumable-session.js";
import {
  isRetryableUploadInterruption,
  RETRYABLE_UPLOAD_INTERRUPTION_REASON,
} from "../../../../lib/upload-interruption.js";
import { uploadLeaseExpiry } from "../../../../lib/upload-lease.js";

export default defineEventHandler(async (event: H3Event) => {
  setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    throw createError({ statusCode: 400, message: "Missing recordingId" });
  }
  const requestedAttemptIdValue = getQuery(event).attemptId;
  const requestedAttemptId = Array.isArray(requestedAttemptIdValue)
    ? requestedAttemptIdValue[0]
    : requestedAttemptIdValue;
  if (
    typeof requestedAttemptId !== "string" ||
    requestedAttemptId.length < 16 ||
    requestedAttemptId.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(requestedAttemptId)
  ) {
    throw createError({
      statusCode: 400,
      message: "A valid upload retry attemptId is required",
    });
  }

  let ownerEmail: string;
  let orgId: string | undefined;
  try {
    const context = await getEventOwnerContext(event);
    ownerEmail = context.userEmail;
    orgId = context.orgId;
  } catch {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }

  return runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
    const [recording] = await getDb()
      .select({
        id: schema.recordings.id,
        status: schema.recordings.status,
        failureReason: schema.recordings.failureReason,
        videoUrl: schema.recordings.videoUrl,
        uploadProgress: schema.recordings.uploadProgress,
        uploadAttemptId: schema.recordings.uploadAttemptId,
      })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        ),
      );

    if (!recording) {
      setResponseStatus(event, 404);
      return { error: "Recording not found" };
    }

    const session = await getResumableSession(recordingId);
    const retryableFailure =
      recording.status === "failed" &&
      isRetryableUploadInterruption(recording.failureReason);
    const existingAttemptId = recording.uploadAttemptId ?? null;
    if (
      recording.status === "uploading" &&
      existingAttemptId !== null &&
      existingAttemptId !== requestedAttemptId
    ) {
      setResponseStatus(event, 409);
      return {
        resumable: false,
        recordingId,
        status: "uploading",
        reason: "retry_already_active",
      };
    }
    if (recording.status !== "uploading" && !retryableFailure) {
      return {
        resumable: false,
        recordingId,
        status: recording.status,
        failureReason: recording.failureReason,
        videoUrl: recording.videoUrl,
      };
    }

    const attemptId = requestedAttemptId;
    const now = new Date().toISOString();
    const claimed = await getDb()
      .update(schema.recordings)
      .set({
        status: "uploading",
        failureReason: null,
        uploadAttemptId: attemptId,
        uploadLeaseExpiresAt: uploadLeaseExpiry(),
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          retryableFailure
            ? eq(schema.recordings.status, "failed")
            : eq(schema.recordings.status, "uploading"),
          retryableFailure
            ? eq(
                schema.recordings.failureReason,
                RETRYABLE_UPLOAD_INTERRUPTION_REASON,
              )
            : undefined,
          existingAttemptId === null
            ? isNull(schema.recordings.uploadAttemptId)
            : eq(schema.recordings.uploadAttemptId, existingAttemptId),
        ),
      )
      .returning({ id: schema.recordings.id });

    if (claimed.length !== 1) {
      setResponseStatus(event, 409);
      return {
        resumable: false,
        recordingId,
        status: "uploading",
        reason: "retry_already_active",
      };
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
      status: "uploading",
      failureReason: null,
      retryableInterruption: false,
      progress: recording.uploadProgress,
      ...(session ? { bytesReceived: session.bytesUploaded } : {}),
      updatedAt: now,
    });
    await writeAppState("refresh-signal", { ts: Date.now() });

    if (session) {
      return {
        resumable: true,
        recordingId,
        status: "uploading",
        uploadMode: "streaming" as const,
        attemptId,
        bytesReceived: session.bytesUploaded,
        nextChunkIndex: (session.lastCommittedIndex ?? -1) + 1,
      };
    }

    const stored = new Set(
      (await listRecordingChunkKeys(ownerEmail, recordingId))
        .map(recordingChunkIndexFromKey)
        .filter((index): index is number => index !== null),
    );
    // Finalize requires chunks contiguous from 0, so resume at the first gap
    // rather than after the highest index we happen to hold.
    let nextChunkIndex = 0;
    while (stored.has(nextChunkIndex)) nextChunkIndex += 1;

    return {
      resumable: true,
      recordingId,
      status: "uploading",
      uploadMode: "buffered" as const,
      attemptId,
      bytesReceived: await sumRecordingChunkBytes(ownerEmail, recordingId),
      nextChunkIndex,
    };
  });
});
