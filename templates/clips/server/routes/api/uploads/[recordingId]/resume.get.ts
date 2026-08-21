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
  compareAndSetAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, isNull, lte } from "drizzle-orm";
import {
  createError,
  defineEventHandler,
  getRouterParam,
  getQuery,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { UPLOAD_RETRY_RESUME_FLAG } from "../../../../../shared/feature-flags.js";
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
import {
  deleteResumableSession,
  getResumableSession,
} from "../../../../lib/resumable-session.js";
import { abortResumableUploadSession } from "../../../../lib/resumable-upload-cleanup.js";
import { isRetryableUploadInterruption } from "../../../../lib/upload-interruption.js";
import {
  UPLOAD_LEASE_MS,
  uploadLeaseExpiry,
} from "../../../../lib/upload-lease.js";

const RETRY_CLAIM_LIVENESS_MS = 30 * 1000;
const RETRY_CLAIM_RETRY_AFTER_MIN_MS = 250;

function retryClaimRetryAfterMs(
  lastHeartbeatMs: number,
  nowMs: number,
): number {
  return Math.max(
    RETRY_CLAIM_RETRY_AFTER_MIN_MS,
    Math.min(
      RETRY_CLAIM_LIVENESS_MS,
      lastHeartbeatMs + RETRY_CLAIM_LIVENESS_MS - nowMs,
    ),
  );
}

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

  const recoveryEnabled = await isFeatureFlagEnabled(UPLOAD_RETRY_RESUME_FLAG, {
    userEmail: ownerEmail,
    userKey: ownerEmail,
    orgId,
  });
  if (!recoveryEnabled) {
    return runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      const [recording] = await getDb()
        .select({
          status: schema.recordings.status,
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
      if (!recording) {
        setResponseStatus(event, 404);
        return { error: "Recording not found" };
      }
      if (
        recording.uploadAttemptId &&
        recording.uploadAttemptId !== requestedAttemptId
      ) {
        setResponseStatus(event, 409);
        return {
          recoveryEnabled: false,
          resumable: false,
          recordingId,
          status: recording.status,
          reason: "retry_already_active",
        };
      }
      return {
        recoveryEnabled: false,
        resumable: false,
        recordingId,
        status: recording.status ?? null,
        reason: "feature_disabled",
        ...(recording.uploadAttemptId
          ? { attemptId: recording.uploadAttemptId }
          : {}),
        ...(recording.uploadGenerationId
          ? { uploadGenerationId: recording.uploadGenerationId }
          : {}),
      };
    });
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
        uploadGenerationId: schema.recordings.uploadGenerationId,
        uploadLeaseExpiresAt: schema.recordings.uploadLeaseExpiresAt,
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

    // Legacy rows keep their null generation and unscoped scratch. A reset
    // upgrades them by installing a fresh generation before it deletes data.
    const existingGenerationId = recording.uploadGenerationId ?? null;
    const generationId = existingGenerationId;
    let session = generationId
      ? await getResumableSession(recordingId, generationId)
      : await getResumableSession(recordingId);
    const retryableFailure =
      recording.status === "failed" &&
      isRetryableUploadInterruption(recording.failureReason);
    const existingAttemptId = recording.uploadAttemptId ?? null;
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const staleLeaseThreshold = new Date(
      nowMs + UPLOAD_LEASE_MS - RETRY_CLAIM_LIVENESS_MS,
    ).toISOString();
    const claimLeaseExpiryMs = Date.parse(recording.uploadLeaseExpiresAt ?? "");
    const claimHeartbeatMs = claimLeaseExpiryMs - UPLOAD_LEASE_MS;
    const differentRetryClaim =
      recording.status === "uploading" &&
      existingAttemptId !== null &&
      existingAttemptId !== requestedAttemptId;
    if (differentRetryClaim && !Number.isFinite(claimHeartbeatMs)) {
      setResponseStatus(event, 409);
      return {
        resumable: false,
        recoveryEnabled: true,
        recordingId,
        status: "uploading",
        reason: "retry_claim_liveness_unavailable",
      };
    }
    const differentLiveRetryClaim =
      differentRetryClaim && claimHeartbeatMs > nowMs - RETRY_CLAIM_LIVENESS_MS;
    if (differentLiveRetryClaim) {
      setResponseStatus(event, 409);
      return {
        resumable: false,
        recoveryEnabled: true,
        recordingId,
        status: "uploading",
        reason: "retry_already_active",
        retryAfterMs: retryClaimRetryAfterMs(claimHeartbeatMs, nowMs),
      };
    }
    if (recording.status !== "uploading" && !retryableFailure) {
      return {
        resumable: false,
        recoveryEnabled: true,
        recordingId,
        status: recording.status,
        failureReason: recording.failureReason,
        videoUrl: recording.videoUrl,
      };
    }

    const uploadStateKey = `recording-upload-${recordingId}`;
    const uploadStateRaw = await readAppState(uploadStateKey);
    const uploadState = uploadStateRaw ?? {};
    const attemptId = requestedAttemptId;
    const takingOverStaleRetryClaim = differentRetryClaim;
    const claimedLeaseExpiry = uploadLeaseExpiry(nowMs);
    const claimed = await getDb()
      .update(schema.recordings)
      .set({
        status: "uploading",
        failureReason: null,
        uploadAttemptId: attemptId,
        ...(generationId ? { uploadGenerationId: generationId } : {}),
        uploadLeaseExpiresAt: claimedLeaseExpiry,
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
            ? eq(schema.recordings.failureReason, recording.failureReason!)
            : undefined,
          existingAttemptId === null
            ? isNull(schema.recordings.uploadAttemptId)
            : eq(schema.recordings.uploadAttemptId, existingAttemptId),
          existingGenerationId === null
            ? isNull(schema.recordings.uploadGenerationId)
            : eq(schema.recordings.uploadGenerationId, existingGenerationId),
          takingOverStaleRetryClaim
            ? lte(schema.recordings.uploadLeaseExpiresAt, staleLeaseThreshold)
            : undefined,
        ),
      )
      .returning({ id: schema.recordings.id });

    if (claimed.length !== 1) {
      setResponseStatus(event, 409);
      return {
        resumable: false,
        recoveryEnabled: true,
        recordingId,
        status: "uploading",
        reason: "retry_already_active",
        retryAfterMs: 250,
      };
    }

    if (takingOverStaleRetryClaim && session) {
      const invalidated = await abortResumableUploadSession(session, {
        label: `upload-resume-takeover-${recordingId}`,
      });
      if (!invalidated) {
        await getDb()
          .update(schema.recordings)
          .set({
            uploadAttemptId: existingAttemptId,
            uploadLeaseExpiresAt: recording.uploadLeaseExpiresAt,
            updatedAt: new Date(claimHeartbeatMs).toISOString(),
          })
          .where(
            and(
              eq(schema.recordings.id, recordingId),
              ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
              eq(schema.recordings.status, "uploading"),
              eq(schema.recordings.uploadAttemptId, attemptId),
              generationId === null
                ? isNull(schema.recordings.uploadGenerationId)
                : eq(schema.recordings.uploadGenerationId, generationId),
              eq(schema.recordings.uploadLeaseExpiresAt, claimedLeaseExpiry),
            ),
          );
        setResponseStatus(event, 409);
        return {
          resumable: false,
          recoveryEnabled: true,
          recordingId,
          status: "uploading",
          reason: "stale_provider_session_invalidation_failed",
        };
      }
      await deleteResumableSession(recordingId, generationId);
      session = null;
    }

    const uploadStateUpdated = await compareAndSetAppState(
      uploadStateKey,
      uploadStateRaw,
      {
        ...uploadState,
        recordingId,
        status: "uploading",
        failureReason: null,
        retryableInterruption: false,
        progress: recording.uploadProgress,
        uploadAttemptId: attemptId,
        uploadGenerationId: generationId,
        ...(session ? { bytesReceived: session.bytesUploaded } : {}),
        updatedAt: now,
      },
    );
    if (!uploadStateUpdated) {
      const [current] = await getDb()
        .select({
          status: schema.recordings.status,
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
      if (
        current?.status !== "uploading" ||
        (current.uploadAttemptId ?? null) !== attemptId ||
        (current.uploadGenerationId ?? null) !== generationId
      ) {
        setResponseStatus(event, 409);
        return {
          resumable: false,
          recoveryEnabled: true,
          recordingId,
          status: current?.status ?? null,
          reason: "upload_state_changed",
        };
      }
      console.info(
        `[upload-resume] upload state advanced under the same claim; preserving newer progress for ${recordingId}`,
      );
    }
    await writeAppState("refresh-signal", { ts: Date.now() });

    if (session) {
      return {
        resumable: true,
        recoveryEnabled: true,
        recordingId,
        status: "uploading",
        uploadMode: "streaming" as const,
        attemptId,
        ...(generationId ? { uploadGenerationId: generationId } : {}),
        bytesReceived: session.bytesUploaded,
        nextChunkIndex: (session.lastCommittedIndex ?? -1) + 1,
      };
    }

    const stored = new Set(
      (generationId
        ? await listRecordingChunkKeys(ownerEmail, recordingId, generationId)
        : await listRecordingChunkKeys(ownerEmail, recordingId)
      )
        .map(recordingChunkIndexFromKey)
        .filter((index): index is number => index !== null),
    );
    // Finalize requires chunks contiguous from 0, so resume at the first gap
    // rather than after the highest index we happen to hold.
    let nextChunkIndex = 0;
    while (stored.has(nextChunkIndex)) nextChunkIndex += 1;

    return {
      resumable: true,
      recoveryEnabled: true,
      recordingId,
      status: "uploading",
      uploadMode: "buffered" as const,
      attemptId,
      ...(generationId ? { uploadGenerationId: generationId } : {}),
      bytesReceived: generationId
        ? await sumRecordingChunkBytes(ownerEmail, recordingId, generationId)
        : await sumRecordingChunkBytes(ownerEmail, recordingId),
      nextChunkIndex,
    };
  });
});
