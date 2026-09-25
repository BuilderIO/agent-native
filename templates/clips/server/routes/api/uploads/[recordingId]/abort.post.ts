/**
 * Abort an in-flight recording upload. Clears any stashed chunks and marks
 * the recording row as failed so the UI can reflect the state.
 *
 * Route: POST /api/uploads/:recordingId/abort
 */

import {
  compareAndSetManyAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { runWithRequestContext } from "@agent-native/core/server";
import { isStoredButUnservableFinalizeError } from "@shared/finalize-recovery.js";
import { and, eq, isNull } from "drizzle-orm";
import {
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getDb, schema } from "../../../../db/index.js";
import { mediaVerificationStateKey } from "../../../../lib/media-verification-state.js";
import {
  normalizeRecordingFailureCode,
  trackRecordingFailure,
} from "../../../../lib/recording-failures.js";
import { deleteRecordingChunks } from "../../../../lib/recording-upload-state.js";
import {
  getEventOwnerContext,
  ownerEmailMatches,
} from "../../../../lib/recordings.js";
import {
  deleteResumableSession,
  getResumableSession,
} from "../../../../lib/resumable-session.js";
import { resolveResumableUploadProvider } from "../../../../lib/resumable-upload-provider.js";

function uploadStateMatchesRecording(
  state: Record<string, unknown>,
  uploadAttemptId: string | null,
  uploadGenerationId: string | null,
): boolean {
  return (
    (state.uploadAttemptId == null ||
      state.uploadAttemptId === uploadAttemptId) &&
    (state.uploadGenerationId == null ||
      state.uploadGenerationId === uploadGenerationId)
  );
}

function canReconcilePreviousGenerationState(
  state: Record<string, unknown>,
  status: string,
  uploadAttemptId: string | null,
  uploadGenerationId: string | null,
  requestedAttemptId: string | null,
  requestedGenerationId: string | null,
  allowSameAttemptCancellation: boolean,
): boolean {
  return (
    status === "uploading" &&
    typeof uploadGenerationId === "string" &&
    (state.uploadAttemptId == null
      ? uploadAttemptId === null
      : state.uploadAttemptId === uploadAttemptId) &&
    typeof state.uploadGenerationId === "string" &&
    state.uploadGenerationId !== uploadGenerationId &&
    requestedAttemptId === uploadAttemptId &&
    (allowSameAttemptCancellation ||
      requestedGenerationId === uploadGenerationId)
  );
}

export async function handleAbortRecordingUpload(
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
    ? { ownerEmail: override.ownerEmail, orgId: override.orgId }
    : await getEventOwnerContext(event).then((context) => ({
        ownerEmail: context.userEmail,
        orgId: context.orgId,
        authUserId: context.authUserId,
      }));
  const body = (await readBody(event).catch(() => null)) as {
    reason?: unknown;
    failureCode?: unknown;
    failureStage?: unknown;
    httpStatus?: unknown;
    attemptId?: unknown;
    uploadGenerationId?: unknown;
  } | null;
  const reasonText =
    typeof body?.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
  const isResetChunksHtmlFailure =
    /reset-chunks\b/i.test(reasonText) &&
    /(?:<!doctype html|<html\b)/i.test(reasonText);
  const isHtmlFailure =
    /returned an HTML error response/i.test(reasonText) ||
    /(?:<!doctype\s+html\b|<html\b)/i.test(reasonText) ||
    isResetChunksHtmlFailure;
  const requestedFailureCode = normalizeRecordingFailureCode(body?.failureCode);
  const legacyCancellationReasons = new Set([
    "Recording cancelled by user",
    "Recording cancelled during countdown",
    "Upload cancelled",
  ]);
  const normalizedFailureCode = !reasonText
    ? "unknown"
    : requestedFailureCode === "unknown" &&
        legacyCancellationReasons.has(reasonText)
      ? "user_cancelled"
      : requestedFailureCode;
  const failureCode =
    (normalizedFailureCode === "upload_failed" ||
      normalizedFailureCode === "unknown") &&
    isHtmlFailure
      ? "chunk_html_error"
      : normalizedFailureCode;
  const failureStage =
    body?.failureStage === "multipart_start" ||
    body?.failureStage === "chunk_upload" ||
    body?.failureStage === "reset_chunks"
      ? body.failureStage
      : isResetChunksHtmlFailure
        ? "reset_chunks"
        : isHtmlFailure
          ? "chunk_upload"
          : undefined;
  const explicitHttpStatus =
    Number.isInteger(body?.httpStatus) &&
    Number(body?.httpStatus) >= 100 &&
    Number(body?.httpStatus) <= 599
      ? Number(body?.httpStatus)
      : undefined;
  const htmlStatus = isHtmlFailure
    ? reasonText.match(/\b([45]\d{2})\b/)?.[1]
    : undefined;
  const httpStatus =
    explicitHttpStatus ?? (htmlStatus ? Number(htmlStatus) : undefined);
  const failureReason = isHtmlFailure
    ? `Upload returned an HTML error response${httpStatus ? ` (${httpStatus})` : ""}.`
    : reasonText || "unknown";
  const requestedAttemptId =
    typeof body?.attemptId === "string" &&
    body.attemptId.length > 0 &&
    body.attemptId.length <= 128
      ? body.attemptId
      : null;
  const requestedGenerationId =
    typeof body?.uploadGenerationId === "string" &&
    body.uploadGenerationId.length > 0 &&
    body.uploadGenerationId.length <= 128
      ? body.uploadGenerationId
      : null;

  const requestContext = { userEmail: ownerEmail, orgId, authUserId };
  return runWithRequestContext(requestContext, async () => {
    const db = getDb();

    const [existing] = await db
      .select({
        id: schema.recordings.id,
        status: schema.recordings.status,
        videoUrl: schema.recordings.videoUrl,
        failureReason: schema.recordings.failureReason,
        failureCode: schema.recordings.failureCode,
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

    const preserveFailure =
      existing.status === "failed" && existing.failureCode != null;
    const persistedFailureCode =
      existing.status === "failed" && existing.failureCode
        ? normalizeRecordingFailureCode(existing.failureCode)
        : failureCode;
    const persistedFailureReason = preserveFailure
      ? existing.failureReason || failureReason
      : failureReason;

    const existingAttemptId = existing.uploadAttemptId ?? null;
    const existingGenerationId = existing.uploadGenerationId ?? null;
    const allowSameAttemptCancellation =
      failureCode === "user_cancelled" &&
      requestedAttemptId !== null &&
      requestedAttemptId === existingAttemptId;
    if (
      requestedAttemptId !== existingAttemptId ||
      (!allowSameAttemptCancellation &&
        requestedGenerationId !== existingGenerationId)
    ) {
      setResponseStatus(event, 409);
      return {
        error: "A newer upload retry is already active.",
        staleAttempt: true,
      };
    }

    if (existing.status === "ready" && existing.videoUrl) {
      return { ok: true, recordingId, alreadyReady: true, chunksCleared: 0 };
    }

    const uploadStateKey = `recording-upload-${recordingId}`;
    const verificationStateKey = mediaVerificationStateKey(recordingId);
    const [existingUploadStateRaw, existingVerificationStateRaw] =
      await Promise.all([
        readAppState(uploadStateKey),
        readAppState(verificationStateKey),
      ]);
    const existingUploadState =
      existingUploadStateRaw && typeof existingUploadStateRaw === "object"
        ? (existingUploadStateRaw as Record<string, unknown>)
        : {};
    const existingUploadStateSnapshot =
      existingUploadStateRaw && typeof existingUploadStateRaw === "object"
        ? (existingUploadStateRaw as Record<string, unknown>)
        : null;
    const existingVerificationStateSnapshot =
      existingVerificationStateRaw &&
      typeof existingVerificationStateRaw === "object"
        ? (existingVerificationStateRaw as Record<string, unknown>)
        : null;
    if (
      !uploadStateMatchesRecording(
        existingUploadState,
        existingAttemptId,
        existingGenerationId,
      ) &&
      !canReconcilePreviousGenerationState(
        existingUploadState,
        existing.status,
        existingAttemptId,
        existingGenerationId,
        requestedAttemptId,
        requestedGenerationId,
        allowSameAttemptCancellation,
      )
    ) {
      setResponseStatus(event, 409);
      return {
        error: "A newer upload retry is already active.",
        staleAttempt: true,
      };
    }
    if (
      existing.status === "processing" &&
      existingUploadState.pendingMediaVerification === true
    ) {
      return {
        ok: true,
        recordingId,
        verificationPending: true,
        chunksCleared: 0,
      };
    }

    let preserveRecoveryState =
      isStoredButUnservableFinalizeError(failureReason) ||
      isStoredButUnservableFinalizeError(existing.failureReason);
    let resumableSession = preserveRecoveryState
      ? null
      : await getResumableSession(recordingId, existingGenerationId);

    const now = new Date().toISOString();
    const createAbortedUploadState = (
      uploadState: Record<string, unknown>,
      uploadAttemptId: string | null,
      uploadGenerationId: string | null,
      reason: string,
    ) => ({
      ...uploadState,
      recordingId,
      status: "failed",
      aborted: true,
      uploadAttemptId,
      uploadGenerationId,
      failureReason: reason,
      updatedAt: now,
    });
    let transitionExisting = existing;
    let transitionAttemptId = existingAttemptId;
    let transitionGenerationId = existingGenerationId;
    let transitionFailureCode = persistedFailureCode;
    let transitionFailureReason = persistedFailureReason;
    let transitionUploadStateSnapshot = existingUploadStateSnapshot;
    let transitionVerificationStateSnapshot = existingVerificationStateSnapshot;
    let abortedUploadState = createAbortedUploadState(
      existingUploadState,
      transitionAttemptId,
      transitionGenerationId,
      transitionFailureReason,
    );
    let uploadStateClaimed = await compareAndSetManyAppState([
      {
        key: uploadStateKey,
        expectedValue: transitionUploadStateSnapshot,
        nextValue: abortedUploadState,
      },
    ]);
    if (!uploadStateClaimed) {
      const [latest] = await db
        .select({
          id: schema.recordings.id,
          status: schema.recordings.status,
          videoUrl: schema.recordings.videoUrl,
          failureReason: schema.recordings.failureReason,
          failureCode: schema.recordings.failureCode,
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
        !latest ||
        (latest.status !== "uploading" && latest.status !== "processing")
      ) {
        setResponseStatus(event, 409);
        return {
          error: "A newer upload retry is already active.",
          staleAttempt: true,
        };
      }

      transitionAttemptId = latest.uploadAttemptId ?? null;
      transitionGenerationId = latest.uploadGenerationId ?? null;
      if (
        requestedAttemptId !== transitionAttemptId ||
        (!allowSameAttemptCancellation &&
          requestedGenerationId !== transitionGenerationId)
      ) {
        setResponseStatus(event, 409);
        return {
          error: "A newer upload retry is already active.",
          staleAttempt: true,
        };
      }

      const [latestUploadStateRaw, latestVerificationStateRaw] =
        await Promise.all([
          readAppState(uploadStateKey),
          readAppState(verificationStateKey),
        ]);
      const latestUploadState =
        latestUploadStateRaw && typeof latestUploadStateRaw === "object"
          ? (latestUploadStateRaw as Record<string, unknown>)
          : {};
      if (
        !uploadStateMatchesRecording(
          latestUploadState,
          transitionAttemptId,
          transitionGenerationId,
        ) &&
        !canReconcilePreviousGenerationState(
          latestUploadState,
          latest.status,
          transitionAttemptId,
          transitionGenerationId,
          requestedAttemptId,
          requestedGenerationId,
          allowSameAttemptCancellation,
        )
      ) {
        setResponseStatus(event, 409);
        return {
          error: "A newer upload retry is already active.",
          staleAttempt: true,
        };
      }
      if (
        latest.status === "processing" &&
        latestUploadState.pendingMediaVerification === true
      ) {
        return {
          ok: true,
          recordingId,
          verificationPending: true,
          chunksCleared: 0,
        };
      }

      transitionExisting = latest;
      transitionUploadStateSnapshot =
        latestUploadStateRaw && typeof latestUploadStateRaw === "object"
          ? (latestUploadStateRaw as Record<string, unknown>)
          : null;
      transitionVerificationStateSnapshot =
        latestVerificationStateRaw &&
        typeof latestVerificationStateRaw === "object"
          ? (latestVerificationStateRaw as Record<string, unknown>)
          : null;
      transitionFailureCode = failureCode;
      transitionFailureReason = failureReason;
      preserveRecoveryState =
        isStoredButUnservableFinalizeError(failureReason) ||
        isStoredButUnservableFinalizeError(latest.failureReason);
      resumableSession = preserveRecoveryState
        ? null
        : await getResumableSession(recordingId, transitionGenerationId);
      abortedUploadState = createAbortedUploadState(
        latestUploadState,
        transitionAttemptId,
        transitionGenerationId,
        transitionFailureReason,
      );
      uploadStateClaimed = await compareAndSetManyAppState([
        {
          key: uploadStateKey,
          expectedValue: transitionUploadStateSnapshot,
          nextValue: abortedUploadState,
        },
      ]);
      if (!uploadStateClaimed) {
        setResponseStatus(event, 409);
        return {
          error: "A newer upload retry is already active.",
          staleAttempt: true,
        };
      }
    }

    const aborted = await db
      .update(schema.recordings)
      .set({
        status: "failed",
        failureCode: transitionFailureCode,
        failureReason: transitionFailureReason,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          eq(schema.recordings.status, transitionExisting.status),
          transitionExisting.failureCode === null ||
            transitionExisting.failureCode === undefined
            ? isNull(schema.recordings.failureCode)
            : eq(schema.recordings.failureCode, transitionExisting.failureCode),
          transitionAttemptId === null
            ? isNull(schema.recordings.uploadAttemptId)
            : eq(schema.recordings.uploadAttemptId, transitionAttemptId),
          allowSameAttemptCancellation
            ? undefined
            : transitionGenerationId === null
              ? isNull(schema.recordings.uploadGenerationId)
              : eq(
                  schema.recordings.uploadGenerationId,
                  transitionGenerationId,
                ),
        ),
      )
      .returning({
        id: schema.recordings.id,
        uploadGenerationId: schema.recordings.uploadGenerationId,
        uploadAttemptId: schema.recordings.uploadAttemptId,
        recordingPlatform: schema.recordings.recordingPlatform,
      });

    if (aborted.length !== 1) {
      const uploadStateRestored = await compareAndSetManyAppState([
        {
          key: uploadStateKey,
          expectedValue: abortedUploadState,
          nextValue: transitionUploadStateSnapshot,
        },
      ]);
      if (!uploadStateRestored) {
        console.info(
          `[abort] upload state changed while rolling back stale abort for ${recordingId}`,
        );
      }
      setResponseStatus(event, 409);
      return {
        error: "A newer upload retry is already active.",
        staleAttempt: true,
      };
    }

    if (
      transitionExisting.status !== "failed" ||
      transitionExisting.failureCode !== transitionFailureCode
    ) {
      trackRecordingFailure({
        recordingId,
        userId: ownerEmail,
        uploadAttemptId: aborted[0]?.uploadAttemptId,
        platform: aborted[0]?.recordingPlatform,
        failureCode: transitionFailureCode,
        failureStage,
        httpStatus,
      });
    }
    const abortedGenerationId =
      typeof aborted[0]?.uploadGenerationId === "string"
        ? aborted[0].uploadGenerationId
        : transitionGenerationId;

    if (
      transitionVerificationStateSnapshot &&
      !(await compareAndSetManyAppState([
        {
          key: verificationStateKey,
          expectedValue: transitionVerificationStateSnapshot,
          nextValue: null,
        },
      ]))
    ) {
      console.info(
        `[abort] verification state changed after abort claim; preserving replacement state for ${recordingId}`,
      );
    }

    // Reset may have created a new provider session between our preflight
    // read and the attempt-fenced abort claim. Re-read the claimed generation
    // so cancellation cleans up that replacement session instead of leaving it
    // active after the client has gone idle.
    if (!preserveRecoveryState) {
      resumableSession = await getResumableSession(
        recordingId,
        abortedGenerationId,
      );
    }

    const cleared = preserveRecoveryState
      ? 0
      : await deleteRecordingChunks(
          ownerEmail,
          recordingId,
          abortedGenerationId,
        );
    if (!preserveRecoveryState) {
      if (resumableSession) {
        const provider = await resolveResumableUploadProvider(
          resumableSession.providerId,
        ).catch(() => null);
        let providerCleanupSucceeded = false;
        try {
          if (!provider?.resumable?.abortSession) {
            throw new Error(
              `Resumable upload provider ${resumableSession.providerId} cannot abort this session`,
            );
          }
          await provider.resumable.abortSession({
            sessionId: resumableSession.sessionId,
            meta: resumableSession.meta,
          });
          providerCleanupSucceeded = true;
        } catch (err) {
          console.warn(
            "[abort] resumable upload provider cleanup failed:",
            err instanceof Error ? err.message : String(err),
          );
        }
        // Keep the provider handle when cleanup fails so a later abort/cleanup
        // retry can still address the multipart upload. Deleting it here would
        // permanently orphan the provider-side session.
        if (providerCleanupSucceeded) {
          await deleteResumableSession(recordingId, abortedGenerationId).catch(
            () => {},
          );
        }
      } else {
        await deleteResumableSession(recordingId, abortedGenerationId).catch(
          () => {},
        );
      }
    }
    await writeAppState("refresh-signal", { ts: Date.now() });

    return { ok: true, recordingId, chunksCleared: cleared };
  });
}

export default defineEventHandler((event) => handleAbortRecordingUpload(event));
