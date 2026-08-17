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

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  const { userEmail: ownerEmail, orgId } = await getEventOwnerContext(event);
  const body = (await readBody(event).catch(() => null)) as {
    reason?: unknown;
    attemptId?: unknown;
    uploadGenerationId?: unknown;
  } | null;
  // A teardown abort (page unmount, navigating away from /record) carries no
  // reason. Keep "caller said why" distinct from "nobody said why" so the
  // generic default can never overwrite an already-recorded diagnosis below.
  const requestedReason =
    typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 1000)
      : null;
  const failureReason = requestedReason ?? "Upload aborted by user";
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

    const existingAttemptId = existing.uploadAttemptId ?? null;
    const existingGenerationId = existing.uploadGenerationId ?? null;
    if (
      requestedAttemptId !== existingAttemptId ||
      requestedGenerationId !== existingGenerationId
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

    // The recorder reports its real failure through this route and then fires
    // a second, reasonless abort while the page tears down. Without this the
    // second write replaces "413 payload too large" with the generic default,
    // and the only record of why the upload broke is gone by the time the
    // owner opens the recording.
    const storedReason =
      requestedReason ??
      (existing.status === "failed" && existing.failureReason
        ? existing.failureReason
        : failureReason);

    const now = new Date().toISOString();
    const aborted = await db
      .update(schema.recordings)
      .set({
        status: "failed",
        failureReason: storedReason,
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

    if (aborted.length !== 1) {
      setResponseStatus(event, 409);
      return {
        error: "A newer upload retry is already active.",
        staleAttempt: true,
      };
    }

    const auxiliaryStateUpdated = await compareAndSetManyAppState([
      {
        key: uploadStateKey,
        expectedValue: existingUploadStateSnapshot,
        nextValue: {
          ...existingUploadState,
          recordingId,
          status: "failed",
          failureReason: storedReason,
          updatedAt: now,
        },
      },
      ...(existingVerificationStateSnapshot
        ? [
            {
              key: verificationStateKey,
              expectedValue: existingVerificationStateSnapshot,
              nextValue: null,
            },
          ]
        : []),
    ]);
    if (!auxiliaryStateUpdated) {
      console.info(
        `[abort] upload state changed after abort claim; preserving replacement state for ${recordingId}`,
      );
    }

    // Reset may have started this exact generation's provider session after
    // our preflight read but before the abort claim. Re-read after the row CAS
    // so either abort observes the late handle or reset observes the lost row
    // claim and compensates it.
    if (!preserveRecoveryState) {
      resumableSession = await getResumableSession(
        recordingId,
        existingGenerationId,
      );
    }

    const cleared = preserveRecoveryState
      ? 0
      : await deleteRecordingChunks(
          ownerEmail,
          recordingId,
          existingGenerationId,
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
          await deleteResumableSession(recordingId, existingGenerationId).catch(
            () => {},
          );
        }
      } else {
        await deleteResumableSession(recordingId, existingGenerationId).catch(
          () => {},
        );
      }
    }
    await writeAppState("refresh-signal", { ts: Date.now() });

    return { ok: true, recordingId, chunksCleared: cleared };
  });
});
