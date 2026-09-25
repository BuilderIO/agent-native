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

  const { ownerEmail, orgId } = override?.ownerEmail
    ? { ownerEmail: override.ownerEmail, orgId: override.orgId }
    : await getEventOwnerContext(event).then((context) => ({
        ownerEmail: context.userEmail,
        orgId: context.orgId,
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
    /^\s*(?:<!doctype html|<html\b)/i.test(reasonText) ||
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
  const failureReason = reasonText || "unknown";
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

  return runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
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

    const preserveRecoveryState =
      isStoredButUnservableFinalizeError(failureReason) ||
      isStoredButUnservableFinalizeError(existing.failureReason);
    let resumableSession = preserveRecoveryState
      ? null
      : await getResumableSession(recordingId, existingGenerationId);

    const now = new Date().toISOString();
    const abortedUploadState = {
      ...existingUploadState,
      recordingId,
      status: "failed",
      aborted: true,
      failureReason: persistedFailureReason,
      updatedAt: now,
    };
    const uploadStateClaimed = await compareAndSetManyAppState([
      {
        key: uploadStateKey,
        expectedValue: existingUploadStateSnapshot,
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

    const aborted = await db
      .update(schema.recordings)
      .set({
        status: "failed",
        failureCode: persistedFailureCode,
        failureReason: persistedFailureReason,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          eq(schema.recordings.status, existing.status),
          existing.failureCode === null || existing.failureCode === undefined
            ? isNull(schema.recordings.failureCode)
            : eq(schema.recordings.failureCode, existing.failureCode),
          existingAttemptId === null
            ? isNull(schema.recordings.uploadAttemptId)
            : eq(schema.recordings.uploadAttemptId, existingAttemptId),
          allowSameAttemptCancellation
            ? undefined
            : existingGenerationId === null
              ? isNull(schema.recordings.uploadGenerationId)
              : eq(schema.recordings.uploadGenerationId, existingGenerationId),
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
          nextValue: existingUploadStateSnapshot,
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
      existing.status !== "failed" ||
      existing.failureCode !== persistedFailureCode
    ) {
      trackRecordingFailure({
        recordingId,
        userId: ownerEmail,
        uploadAttemptId: aborted[0]?.uploadAttemptId,
        platform: aborted[0]?.recordingPlatform,
        failureCode: persistedFailureCode,
        failureStage,
        httpStatus,
      });
    }
    const abortedGenerationId =
      typeof aborted[0]?.uploadGenerationId === "string"
        ? aborted[0].uploadGenerationId
        : existingGenerationId;

    if (
      existingVerificationStateSnapshot &&
      !(await compareAndSetManyAppState([
        {
          key: verificationStateKey,
          expectedValue: existingVerificationStateSnapshot,
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
