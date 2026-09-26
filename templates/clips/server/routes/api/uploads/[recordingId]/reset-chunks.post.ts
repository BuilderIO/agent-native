import { randomUUID } from "node:crypto";

import {
  compareAndSetAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import { getActiveFileUploadProviderForRequest } from "@agent-native/core/file-upload";
import { runWithRequestContext } from "@agent-native/core/server";
import type { UploadMode } from "@shared/recording-core.js";
import { MAX_UPLOAD_BYTES as MAX_RECORDING_UPLOAD_BYTES } from "@shared/upload-limits.js";
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
import { isMediaVerificationPending } from "../../../../lib/media-verification-state.js";
import { trackRecordingFailure } from "../../../../lib/recording-failures.js";
import { deleteRecordingChunks } from "../../../../lib/recording-upload-state.js";
import {
  getEventOwnerContext,
  ownerEmailMatches,
} from "../../../../lib/recordings.js";
import {
  deleteResumableSession,
  getResumableSession,
  setResumableSession,
  type StoredResumableSession,
} from "../../../../lib/resumable-session.js";
import { abortResumableUploadSession } from "../../../../lib/resumable-upload-cleanup.js";
import { S3MultipartStartError } from "../../../../lib/s3-upload-provider.js";
import { shouldEnableStreamingUpload } from "../../../../lib/streaming-upload-mode.js";
import {
  renewUploadLease,
  uploadLeaseExpiry,
} from "../../../../lib/upload-lease.js";
import { allowsSqlRecordingChunkScratch } from "../../../../lib/video-storage.js";

interface CompressionMeta {
  originalBytes?: number;
  compressedBytes?: number;
  ratio?: number;
  elapsedMs?: number;
  outputMimeType?: string;
}

interface PendingResumableCleanup {
  recordingId: string;
  generationId: string | null;
  ownerGenerationId: string | null;
  claimId: string | null;
  session: StoredResumableSession;
}

function parsePendingResumableCleanup(
  raw: Record<string, unknown> | null,
  recordingId: string,
): PendingResumableCleanup | null {
  if (!raw) return null;
  const session = raw.session;
  const generationId = raw.generationId;
  const ownerGenerationId = raw.ownerGenerationId;
  const claimId = raw.claimId;
  if (
    raw.recordingId !== recordingId ||
    !session ||
    typeof session !== "object" ||
    Array.isArray(session) ||
    !(generationId === null || typeof generationId === "string") ||
    (ownerGenerationId !== undefined &&
      ownerGenerationId !== null &&
      typeof ownerGenerationId !== "string") ||
    (claimId !== undefined && claimId !== null && typeof claimId !== "string")
  ) {
    throw new Error(
      `Invalid resumable cleanup state for recording ${recordingId}`,
    );
  }

  const candidate = session as Record<string, unknown>;
  if (
    typeof candidate.providerId !== "string" ||
    typeof candidate.sessionId !== "string" ||
    !candidate.meta ||
    typeof candidate.meta !== "object" ||
    Array.isArray(candidate.meta) ||
    typeof candidate.bytesUploaded !== "number" ||
    !Number.isFinite(candidate.bytesUploaded) ||
    (candidate.lastCommittedIndex !== undefined &&
      typeof candidate.lastCommittedIndex !== "number")
  ) {
    throw new Error(
      `Invalid resumable session in cleanup state for recording ${recordingId}`,
    );
  }

  return {
    recordingId,
    generationId,
    ownerGenerationId:
      ownerGenerationId === undefined ? null : ownerGenerationId,
    claimId: claimId === undefined ? null : claimId,
    session: candidate as unknown as StoredResumableSession,
  };
}

function normalizeVideoMimeType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const mimeType = value.split(";")[0]?.trim().toLowerCase();
  return mimeType === "video/mp4" ||
    mimeType === "video/quicktime" ||
    mimeType === "video/webm"
    ? mimeType
    : null;
}

function pickNumber(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function pickString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

export async function handleResetRecordingChunks(
  event: H3Event,
  override?: {
    recordingId?: string;
    ownerEmail?: string;
    orgId?: string;
  },
) {
  const recordingId =
    override?.recordingId ?? getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  const { ownerEmail, orgId, authUserId } = override?.ownerEmail
    ? {
        ownerEmail: override.ownerEmail,
        orgId: override.orgId,
        authUserId: undefined,
      }
    : await getEventOwnerContext(event).then(
        ({ userEmail, orgId, authUserId }) => ({
          ownerEmail: userEmail,
          orgId,
          authUserId,
        }),
      );
  const body = (await readBody(event).catch(() => null)) as {
    compression?: CompressionMeta | null;
    requestStreaming?: boolean;
    mimeType?: string;
    attemptId?: string;
    uploadGenerationId?: string;
    useGenerationFence?: boolean;
  } | null;
  const requestedStreamingMimeType =
    body?.requestStreaming === true
      ? normalizeVideoMimeType(body.mimeType)
      : null;
  if (body?.requestStreaming === true && !requestedStreamingMimeType) {
    setResponseStatus(event, 400);
    return { error: "A supported video mimeType is required for retry" };
  }
  const recoveryEnabled = await isFeatureFlagEnabled(UPLOAD_RETRY_RESUME_FLAG, {
    userEmail: ownerEmail,
    userKey: ownerEmail,
    orgId,
  });

  const compression: CompressionMeta | null = body?.compression
    ? {
        originalBytes: pickNumber(body.compression.originalBytes),
        compressedBytes: pickNumber(body.compression.compressedBytes),
        ratio: pickNumber(body.compression.ratio),
        elapsedMs: pickNumber(body.compression.elapsedMs),
        outputMimeType: pickString(body.compression.outputMimeType, 120),
      }
    : null;

  const requestContext = { userEmail: ownerEmail, orgId, authUserId };
  return runWithRequestContext(requestContext, async () => {
    const db = getDb();

    const [existing] = await db
      .select({
        id: schema.recordings.id,
        status: schema.recordings.status,
        videoUrl: schema.recordings.videoUrl,
        uploadAttemptId: schema.recordings.uploadAttemptId,
        uploadGenerationId: schema.recordings.uploadGenerationId,
        recordingPlatform: schema.recordings.recordingPlatform,
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

    if (existing.status === "ready" && existing.videoUrl) {
      setResponseStatus(event, 409);
      return { error: "Recording is already ready" };
    }

    const requestedAttemptId =
      typeof body?.attemptId === "string" &&
      body.attemptId.length > 0 &&
      body.attemptId.length <= 128
        ? body.attemptId
        : null;
    const existingAttemptId = existing.uploadAttemptId ?? null;
    const existingGenerationId = existing.uploadGenerationId ?? null;
    if (
      existingAttemptId !== null &&
      existingAttemptId !== requestedAttemptId
    ) {
      setResponseStatus(event, 409);
      return {
        error: "A newer upload retry is already active.",
        staleAttempt: true,
      };
    }
    const requestedGenerationId =
      typeof body?.uploadGenerationId === "string" &&
      body.uploadGenerationId.length > 0 &&
      body.uploadGenerationId.length <= 128
        ? body.uploadGenerationId
        : null;
    if (
      existingGenerationId !== null &&
      existingGenerationId !== requestedGenerationId
    ) {
      setResponseStatus(event, 409);
      return {
        error: "A newer upload generation is already active.",
        staleAttempt: true,
      };
    }

    if (
      await isMediaVerificationPending({
        ownerEmail,
        recordingId,
        recordingStatus: existing.status,
      })
    ) {
      setResponseStatus(event, 409);
      return { error: "Recording is still being verified" };
    }
    if (existing.status !== "uploading" && existing.status !== "failed") {
      setResponseStatus(event, 409);
      return { error: "Recording upload is no longer resettable" };
    }

    // Fence this reset before deleting any provider or buffered state. A
    // retry that lost the token race must not tear down the winner's session.
    const now = new Date().toISOString();
    const useGenerationFence =
      existingAttemptId !== null ||
      existingGenerationId !== null ||
      (recoveryEnabled &&
        (requestedAttemptId !== null ||
          requestedGenerationId !== null ||
          body?.useGenerationFence === true));
    const nextGenerationId = useGenerationFence ? randomUUID() : null;
    const uploadStateKey = `recording-upload-${recordingId}`;
    const uploadStateSnapshot = await readAppState(uploadStateKey);
    const cleanupStateKey = `recording-resumable-cleanup-${recordingId}`;
    const cleanupStateSnapshot = await readAppState(cleanupStateKey);
    const parsedCleanup = parsePendingResumableCleanup(
      cleanupStateSnapshot,
      recordingId,
    );
    const pendingCleanup =
      parsedCleanup &&
      (parsedCleanup.ownerGenerationId === null
        ? !useGenerationFence
        : parsedCleanup.ownerGenerationId === existingGenerationId)
        ? parsedCleanup
        : null;
    const discardedGenerationId = pendingCleanup
      ? pendingCleanup.generationId
      : existingGenerationId;
    const discardedResumableSession =
      pendingCleanup?.session ??
      (await getResumableSession(recordingId, existingGenerationId));
    const reset = await db
      .update(schema.recordings)
      .set({
        status: "uploading",
        failureReason: null,
        failureCode: null,
        uploadProgress: 0,
        uploadGenerationId: nextGenerationId,
        ...(!recoveryEnabled && existingAttemptId === null
          ? { uploadAttemptId: null }
          : {}),
        uploadLeaseExpiresAt: uploadLeaseExpiry(),
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          eq(schema.recordings.status, existing.status),
          existingAttemptId === null
            ? isNull(schema.recordings.uploadAttemptId)
            : eq(schema.recordings.uploadAttemptId, existingAttemptId),
          existingGenerationId === null
            ? isNull(schema.recordings.uploadGenerationId)
            : eq(schema.recordings.uploadGenerationId, existingGenerationId),
        ),
      )
      .returning({ id: schema.recordings.id });

    if (reset.length !== 1) {
      setResponseStatus(event, 409);
      return {
        error: "A newer upload retry is already active.",
        staleAttempt: true,
      };
    }

    let cleanupClaim: PendingResumableCleanup | null = null;
    if (discardedResumableSession) {
      const candidate: PendingResumableCleanup = {
        recordingId,
        generationId: discardedGenerationId,
        ownerGenerationId: nextGenerationId,
        claimId: randomUUID(),
        session: discardedResumableSession,
      };
      const claimed = await compareAndSetAppState(
        cleanupStateKey,
        cleanupStateSnapshot,
        candidate as unknown as Record<string, unknown>,
      );
      if (claimed) cleanupClaim = candidate;
    }

    let resumableCleanupFailed = false;
    if (discardedResumableSession) {
      if (cleanupClaim) {
        const cleaned = await abortResumableUploadSession(
          discardedResumableSession,
          { label: `reset-${recordingId}` },
        );
        if (!cleaned) {
          if (!allowsSqlRecordingChunkScratch()) {
            setResponseStatus(event, 502);
            return {
              error:
                "The previous recording upload could not be cleaned up. Retry the upload restart.",
            };
          }
          console.warn(
            `[reset-chunks-${recordingId}] provider cleanup failed; using buffered retry and retaining cleanup claim`,
          );
          resumableCleanupFailed = true;
        }
        if (!resumableCleanupFailed) {
          const released = await compareAndSetAppState(
            cleanupStateKey,
            cleanupClaim as unknown as Record<string, unknown>,
            null,
          );
          if (!released) {
            console.warn(
              `[reset-chunks-${recordingId}] cleanup claim changed while releasing it`,
            );
          }
        }
      }
    }
    const cleared = await deleteRecordingChunks(
      ownerEmail,
      recordingId,
      discardedGenerationId,
    );
    if (!discardedResumableSession || cleanupClaim || resumableCleanupFailed) {
      try {
        await deleteResumableSession(recordingId, discardedGenerationId);
      } catch (error) {
        console.warn(
          `[reset-chunks-${recordingId}] local resumable session cleanup failed`,
          error,
        );
        setResponseStatus(event, 502);
        return {
          error:
            "The previous recording upload could not be reset locally. Retry the upload restart.",
        };
      }
    }

    let uploadMode: UploadMode = "buffered";
    let compensateStartedSession: (() => Promise<void>) | null = null;
    const bufferedFallbackAvailable = allowsSqlRecordingChunkScratch();
    const shouldRetryStreaming =
      body?.requestStreaming === true && !resumableCleanupFailed;
    if (shouldRetryStreaming) {
      const mimeType = requestedStreamingMimeType;
      if (!mimeType) {
        setResponseStatus(event, 400);
        return { error: "A supported video mimeType is required for retry" };
      }

      const uploadProvider = await getActiveFileUploadProviderForRequest();
      if (
        shouldEnableStreamingUpload({
          client: "desktop",
          mimeType,
          bufferedFallbackAvailable,
        }) &&
        uploadProvider?.resumable
      ) {
        try {
          const extension = /mp4|quicktime/.test(mimeType) ? "mp4" : "webm";
          const filename = `${recordingId}.${extension}`;
          const session = await uploadProvider.resumable.startSession(
            filename,
            mimeType,
            MAX_RECORDING_UPLOAD_BYTES,
          );
          await setResumableSession(
            recordingId,
            {
              providerId: uploadProvider.id,
              sessionId: session.sessionId,
              meta: {
                ...session.meta,
                stableUrl: true,
                recordAsset: false,
              },
              bytesUploaded: 0,
              lastCommittedIndex: -1,
            },
            nextGenerationId,
          );
          compensateStartedSession = async () => {
            if (!uploadProvider.resumable?.abortSession) {
              throw new Error(
                `Resumable upload provider ${uploadProvider.id} cannot abort the discarded retry session`,
              );
            }
            await uploadProvider.resumable.abortSession({
              sessionId: session.sessionId,
              meta: session.meta,
            });
            await deleteResumableSession(recordingId, nextGenerationId);
          };
          uploadMode = "streaming";
        } catch (err) {
          if (!bufferedFallbackAvailable) {
            if (err instanceof S3MultipartStartError) {
              const failureReason = `Multipart upload could not start (${err.status}).`;
              const failed = await db
                .update(schema.recordings)
                .set({
                  status: "failed",
                  failureCode: "multipart_start_failed",
                  failureReason,
                  updatedAt: new Date().toISOString(),
                })
                .where(
                  and(
                    eq(schema.recordings.id, recordingId),
                    ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
                    eq(schema.recordings.status, "uploading"),
                    nextGenerationId === null
                      ? isNull(schema.recordings.uploadGenerationId)
                      : eq(
                          schema.recordings.uploadGenerationId,
                          nextGenerationId,
                        ),
                    existingAttemptId === null
                      ? isNull(schema.recordings.uploadAttemptId)
                      : eq(
                          schema.recordings.uploadAttemptId,
                          existingAttemptId,
                        ),
                  ),
                )
                .returning({ id: schema.recordings.id });
              if (failed.length === 1) {
                trackRecordingFailure({
                  recordingId,
                  userId: ownerEmail,
                  uploadAttemptId: existingAttemptId,
                  platform: existing.recordingPlatform,
                  failureCode: "multipart_start_failed",
                  failureStage: "multipart_start",
                  httpStatus: err.status,
                });
              } else {
                setResponseStatus(event, 409);
                return {
                  error: "A newer upload retry is already active.",
                  staleAttempt: true,
                };
              }
              setResponseStatus(event, 502);
              return {
                error: failureReason,
                failureCode: "multipart_start_failed",
                failureStage: "multipart_start",
                httpStatus: err.status,
              };
            }
            setResponseStatus(event, 502);
            return {
              error: `Could not restart recording upload: ${
                err instanceof Error ? err.message : String(err)
              }`,
            };
          }
          console.warn(
            `[reset-chunks-${recordingId}] resumable restart failed; using buffered retry:`,
            err,
          );
        }
      } else if (!bufferedFallbackAvailable) {
        setResponseStatus(event, 409);
        return {
          error:
            "Recording upload storage could not start a resumable retry session.",
        };
      }
    }

    const preservedAttemptId = existingAttemptId;
    const resetLease = await renewUploadLease(recordingId, {
      attemptId: preservedAttemptId,
      generationId: nextGenerationId,
    });
    if (!resetLease.held) {
      await compensateStartedSession?.();
      setResponseStatus(event, 409);
      return {
        error: "Recording upload changed while its retry was starting.",
        staleAttempt: true,
      };
    }

    const uploadStateUpdated = await compareAndSetAppState(
      uploadStateKey,
      uploadStateSnapshot,
      {
        recordingId,
        status: "uploading",
        progress: 0,
        chunksReceived: 0,
        bytesReceived: 0,
        uploadAttemptId: preservedAttemptId,
        uploadGenerationId: nextGenerationId,
        maxBytes: MAX_RECORDING_UPLOAD_BYTES,
        updatedAt: now,
      },
    );
    if (!uploadStateUpdated) {
      const [current] = await db
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
        (current.uploadAttemptId ?? null) !== preservedAttemptId ||
        (current.uploadGenerationId ?? null) !== nextGenerationId
      ) {
        setResponseStatus(event, 409);
        return {
          error: "Recording upload changed while its retry was starting.",
          staleAttempt: true,
        };
      }
    }

    if (compression) {
      await writeAppState(`recording-compression-${recordingId}`, {
        recordingId,
        ...compression,
        recordedAt: now,
      });
    }

    return {
      ok: true,
      recordingId,
      chunksCleared: cleared,
      compressionRecorded: !!compression,
      uploadMode,
      uploadGenerationId: nextGenerationId,
    };
  });
}

export default defineEventHandler((event: H3Event) =>
  handleResetRecordingChunks(event),
);
