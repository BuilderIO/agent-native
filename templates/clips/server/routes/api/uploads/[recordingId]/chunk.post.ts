/**
 * Accept one recording chunk. The recorder-engine streams chunks here as the
 * browser's MediaRecorder emits `ondataavailable`. Each chunk is a binary POST
 * body; query params tell us where it sits in the sequence.
 *
 * Query params:
 *   index    — 0-based chunk index
 *   total    — expected total chunks (may be updated on the final chunk)
 *   isFinal  — "1" when this is the last chunk; triggers finalize-recording
 *   mimeType — optional override for the assembled blob MIME type
 *   durationMs / width / height / hasAudio / hasCamera — forwarded to finalize
 *
 * Route: POST /api/uploads/:recordingId/chunk?index=N&total=T&isFinal=0|1
 */

import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import { runWithRequestContext } from "@agent-native/core/server";
import { track } from "@agent-native/core/tracking";
import { normalizeChunkUploadNumber } from "@shared/recording-core.js";
import { MAX_UPLOAD_BYTES as MAX_RECORDING_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { and, eq } from "drizzle-orm";
import {
  createError,
  defineEventHandler,
  getHeader,
  getRouterParam,
  getQuery,
  readRawBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import finalizeRecording from "../../../../../actions/finalize-recording.js";
import { UPLOAD_RETRY_RESUME_FLAG } from "../../../../../shared/feature-flags.js";
import { getDb, schema } from "../../../../db/index.js";
import { debugLog } from "../../../../lib/debug.js";
import {
  deleteRecordingChunks,
  sumRecordingChunkBytes,
} from "../../../../lib/recording-upload-state.js";
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
import { resolveResumableUploadProvider } from "../../../../lib/resumable-upload-provider.js";
import { isStreamingUploadDisabled } from "../../../../lib/streaming-upload-mode.js";
import { renewUploadLease } from "../../../../lib/upload-lease.js";
import {
  allowsSqlRecordingChunkScratch,
  shouldRejectVideoUploadWithoutStorage,
  STORAGE_SETUP_REQUIRED_REASON,
} from "../../../../lib/video-storage.js";

const RECORDING_TOO_LARGE_REASON = `Recording exceeds the ${Math.round(MAX_RECORDING_UPLOAD_BYTES / (1024 * 1024))} MB size limit. Please record a shorter clip.`;

// Netlify functions have a 6 MB buffered request cap, but binary requests
// are base64 encoded by the gateway and effectively cap out around 4.5 MB.
// Keep our own cap lower so dev/local failures match production.
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

const ALLOWED_RECORDING_MIME_TYPES = new Set([
  "video/webm",
  "video/mp4",
  "video/quicktime",
]);

function normalizeRecordingMimeType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const mimeType = value.trim();
  if (!mimeType || mimeType.length > 120 || /[\r\n]/.test(mimeType)) {
    return null;
  }
  const baseType = mimeType.split(";")[0]?.trim().toLowerCase();
  if (!baseType || !ALLOWED_RECORDING_MIME_TYPES.has(baseType)) return null;
  return mimeType;
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function stateNumber(
  value: Record<string, unknown> | null | undefined,
  key: string,
): number | undefined {
  const raw = value?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function pendingMediaVerificationState(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Record<string, unknown>;
  return state.status === "processing" &&
    state.pendingMediaVerification === true
    ? state
    : null;
}

function acceptedProcessingResponse(
  event: H3Event,
  recordingId: string,
  state: Record<string, unknown>,
) {
  setResponseStatus(event, 202);
  return {
    ok: true,
    finalized: false,
    verificationPending: true,
    status: "processing" as const,
    retryAfterMs: 3_000,
    id: recordingId,
    videoUrl: typeof state.videoUrl === "string" ? state.videoUrl : undefined,
    videoSizeBytes: stateNumber(state, "videoSizeBytes"),
    sourceSizeBytes: stateNumber(state, "sourceSizeBytes"),
    durationMs: stateNumber(state, "durationMs"),
  };
}

function expectedDataChunksForFinalPost(
  index: number,
  bodySize: number,
): number {
  return index + (bodySize > 0 ? 1 : 0);
}

function trackUploadBlockingFailure(
  ownerEmail: string,
  properties: Record<string, unknown>,
): void {
  try {
    track(
      "clips_upload_blocking_failure",
      {
        app: "clips",
        template: "clips",
        surface: "server_upload",
        ...properties,
      },
      { userId: ownerEmail },
    );
  } catch {
    // Best-effort analytics must never change upload behavior.
  }
}

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    throw createError({ statusCode: 400, message: "Missing recordingId" });
  }

  const query = getQuery(event);
  const attemptIdValue = Array.isArray(query.attemptId)
    ? query.attemptId[0]
    : query.attemptId;
  const attemptId =
    typeof attemptIdValue === "string" &&
    attemptIdValue.length > 0 &&
    attemptIdValue.length <= 128 &&
    !/[\r\n]/.test(attemptIdValue)
      ? attemptIdValue
      : null;
  const uploadGenerationIdValue = Array.isArray(query.uploadGenerationId)
    ? query.uploadGenerationId[0]
    : query.uploadGenerationId;
  const uploadGenerationId =
    typeof uploadGenerationIdValue === "string" &&
    uploadGenerationIdValue.length > 0 &&
    uploadGenerationIdValue.length <= 128 &&
    !/[\r\n]/.test(uploadGenerationIdValue)
      ? uploadGenerationIdValue
      : null;
  const index = Number(query.index ?? 0);
  const total = Number(query.total ?? 0);
  const isFinal = query.isFinal === "1" || query.isFinal === "true";
  // The client (recorder-engine) knows the exact mimeType it picked for the
  // whole recording and sends it on every chunk. Never guess — a wrong
  // default writes the wrong Content-Type to storage.
  const mimeType = normalizeRecordingMimeType(query.mimeType);
  if (!mimeType) {
    throw createError({
      statusCode: 400,
      message: "Unsupported or missing mimeType query param",
    });
  }

  debugLog("[chunk] received", {
    recordingId,
    index,
    total,
    isFinal,
    mimeType,
  });

  if (
    !Number.isFinite(index) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > 999_999
  ) {
    throw createError({ statusCode: 400, message: "Invalid chunk index" });
  }

  const contentLength = Number(getHeader(event, "content-length") || 0);
  if (contentLength > MAX_CHUNK_BYTES) {
    setResponseStatus(event, 413);
    return { error: "Chunk too large" };
  }

  let ownerEmail: string;
  let orgId: string | undefined;
  try {
    const context = await getEventOwnerContext(event);
    ownerEmail = context.userEmail;
    orgId = context.orgId;
  } catch (err) {
    console.error("[chunk] getEventOwnerContext threw:", err);
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }
  debugLog("[chunk] resolved owner:", ownerEmail);

  if (
    attemptId !== null &&
    !(await isFeatureFlagEnabled(UPLOAD_RETRY_RESUME_FLAG, {
      userEmail: ownerEmail,
      userKey: ownerEmail,
      orgId,
    }))
  ) {
    setResponseStatus(event, 409);
    return {
      ok: false,
      error: "Resumable upload retry is disabled.",
      restartRequired: true,
      recoveryEnabled: false,
    };
  }

  return runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
    const db = getDb();

    // Verify the recording belongs to the current user. Everything else about
    // its state comes back from the lease renewal below.
    const [existing] = await db
      .select({
        id: schema.recordings.id,
        status: schema.recordings.status,
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
      console.warn("[chunk] recording not found for owner", {
        recordingId,
        ownerEmail,
      });
      throw createError({ statusCode: 404, message: "Recording not found" });
    }

    const failedUploadResponse = (reason: string, bytes?: number) => {
      setResponseStatus(
        event,
        reason === RECORDING_TOO_LARGE_REASON ? 413 : 409,
      );
      return {
        ok: false,
        error: reason,
        bytesReceived: bytes,
        maxBytes: MAX_RECORDING_UPLOAD_BYTES,
      };
    };

    // The first renewal admits the request. Later renewals immediately before
    // every durable write/finalization boundary close the body-read/provider
    // gap where /abort can otherwise commit while this request is in flight.
    if ((existing.uploadGenerationId ?? null) !== uploadGenerationId) {
      setResponseStatus(event, 409);
      return {
        ok: false,
        error: "A newer upload generation is already active.",
        staleAttempt: true,
      };
    }
    const lease = await renewUploadLease(recordingId, {
      attemptId,
      generationId: uploadGenerationId,
      uploadProgress:
        total > 0
          ? Math.min(100, Math.round(((index + 1) / total) * 100))
          : undefined,
    });
    if (!lease.held) {
      if (lease.staleAttempt) {
        setResponseStatus(event, 409);
        return {
          ok: false,
          error: "A newer upload retry is already active.",
          staleAttempt: true,
        };
      }
      if (lease.status === "ready") {
        const readyState = await readAppState(
          `recording-upload-${recordingId}`,
        ).catch(() => null);
        return {
          ok: true,
          finalized: true,
          status: "ready" as const,
          videoUrl: lease.videoUrl,
          videoSizeBytes: lease.videoSizeBytes,
          durationMs: lease.durationMs,
          sourceSizeBytes: stateNumber(readyState, "sourceSizeBytes"),
        };
      }
      await deleteRecordingChunks(
        ownerEmail,
        recordingId,
        uploadGenerationId,
      ).catch((err) => {
        console.warn("[chunk] failed upload chunk cleanup failed:", {
          recordingId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
      return failedUploadResponse(
        lease.failureReason ?? "Recording upload has already failed.",
      );
    }

    const rejectIfLeaseLost = async () => {
      const current = await renewUploadLease(recordingId, {
        attemptId,
        generationId: uploadGenerationId,
      });
      if (current.held) return null;
      await deleteRecordingChunks(
        ownerEmail,
        recordingId,
        uploadGenerationId,
      ).catch((err) => {
        console.warn("[chunk] failed upload chunk cleanup failed:", {
          recordingId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
      return failedUploadResponse(
        current.failureReason ?? "Recording upload has already failed.",
      );
    };

    if (isFinal && existing.status === "processing") {
      const pendingState = pendingMediaVerificationState(
        await readAppState(`recording-upload-${recordingId}`).catch(() => null),
      );
      if (pendingState) {
        return acceptedProcessingResponse(event, recordingId, pendingState);
      }
    }

    // Resumable streaming path — forward chunks directly to the provider.
    const resumableSession = await getResumableSession(
      recordingId,
      uploadGenerationId,
    );
    if (resumableSession && isStreamingUploadDisabled()) {
      console.warn(
        `[chunk] streaming uploads are disabled, but preserving existing resumable session for in-flight recording: ${recordingId}`,
      );
    }
    if (resumableSession) {
      return handleResumableChunk(
        event,
        resumableSession,
        recordingId,
        index,
        isFinal,
        mimeType,
        query,
        ownerEmail,
        attemptId,
        uploadGenerationId,
      );
    }

    // Store chunks in application_state, assemble on finalize.
    if (await shouldRejectVideoUploadWithoutStorage()) {
      const leaseFailure = await rejectIfLeaseLost();
      if (leaseFailure) return leaseFailure;
      const now = new Date().toISOString();
      await db
        .update(schema.recordings)
        .set({
          status: "failed",
          failureReason: STORAGE_SETUP_REQUIRED_REASON,
          updatedAt: now,
        })
        .where(eq(schema.recordings.id, recordingId));
      await writeAppState(`recording-upload-${recordingId}`, {
        recordingId,
        status: "failed",
        failureReason: STORAGE_SETUP_REQUIRED_REASON,
        storageSetupRequired: true,
        updatedAt: now,
      });
      setResponseStatus(event, 409);
      return {
        ok: false,
        error: STORAGE_SETUP_REQUIRED_REASON,
        storageSetupRequired: true,
      };
    }
    if (!allowsSqlRecordingChunkScratch()) {
      setResponseStatus(event, 409);
      return {
        ok: false,
        error:
          "Recording upload storage is configured, but this upload did not start a resumable storage session. Refresh and start the recording again.",
        storageSetupRequired: false,
      };
    }

    const raw = await readRawBody(event, false);
    const bodySize = raw ? raw.byteLength : 0;
    debugLog("[chunk] body size:", bodySize, "isFinal:", isFinal);
    if (bodySize > MAX_CHUNK_BYTES) {
      setResponseStatus(event, 413);
      return { error: "Chunk too large" };
    }

    // An empty body is only a problem for non-final chunks. The final sentinel
    // POST the client sends after MediaRecorder.stop() is intentionally empty
    // (all the real bytes arrived in earlier chunks); rejecting it with 400
    // here meant finalize never ran and the recording got stuck in 'uploading'
    // forever. For isFinal we just skip the chunk write and fall through to
    // the finalize branch below.
    if (!isFinal && bodySize === 0) {
      throw createError({ statusCode: 400, message: "Empty chunk body" });
    }

    // readRawBody(event, false) returns Uint8Array. Buffer is a Uint8Array
    // subclass on Node, so this is safe whether we're on Node or workerd.
    const bytes: Uint8Array = raw ?? new Uint8Array(0);
    const expectedDataChunks = isFinal
      ? expectedDataChunksForFinalPost(index, bytes.byteLength)
      : undefined;

    const uploadStateRaw = await readAppState(
      `recording-upload-${recordingId}`,
    );
    const uploadState =
      uploadStateRaw && typeof uploadStateRaw === "object"
        ? uploadStateRaw
        : null;
    let bytesReceived = stateNumber(uploadState, "bytesReceived") ?? 0;

    const failRecordingTooLarge = async (nextBytes: number) => {
      const leaseFailure = await rejectIfLeaseLost();
      if (leaseFailure) return leaseFailure;
      const now = new Date().toISOString();
      await db
        .update(schema.recordings)
        .set({
          status: "failed",
          failureReason: RECORDING_TOO_LARGE_REASON,
          updatedAt: now,
        })
        .where(eq(schema.recordings.id, recordingId));
      await writeAppState(`recording-upload-${recordingId}`, {
        recordingId,
        status: "failed",
        failureReason: RECORDING_TOO_LARGE_REASON,
        bytesReceived: nextBytes,
        maxBytes: MAX_RECORDING_UPLOAD_BYTES,
        updatedAt: now,
      });
      await deleteRecordingChunks(
        ownerEmail,
        recordingId,
        uploadGenerationId,
      ).catch((err) => {
        console.warn("[chunk] oversized upload chunk cleanup failed:", {
          recordingId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
      setResponseStatus(event, 413);
      return {
        ok: false,
        error: RECORDING_TOO_LARGE_REASON,
        bytesReceived: nextBytes,
        maxBytes: MAX_RECORDING_UPLOAD_BYTES,
      };
    };

    // Only persist non-empty chunks. The final sentinel can legitimately be
    // empty — writing a zero-byte chunk would just clutter application_state.
    if (bytes.byteLength > 0) {
      // Pad index to 6 digits so string-sort order matches numeric order if the
      // finalize path ever sorts lexically. (finalize also parses back to a number.)
      const paddedIndex = String(index).padStart(6, "0");
      const chunkKey = `recording-chunks-${recordingId}${uploadGenerationId ? `-${uploadGenerationId}` : ""}-${paddedIndex}`;
      const previousChunk = await readAppState(chunkKey);
      const previousBytes = stateNumber(previousChunk, "bytes") ?? 0;
      const persistedBytesBefore = await sumRecordingChunkBytes(
        ownerEmail,
        recordingId,
        uploadGenerationId,
      );
      const nextBytes =
        Math.max(0, persistedBytesBefore - previousBytes) + bytes.byteLength;

      if (nextBytes > MAX_RECORDING_UPLOAD_BYTES) {
        return failRecordingTooLarge(nextBytes);
      }

      const leaseFailure = await rejectIfLeaseLost();
      if (leaseFailure) return leaseFailure;
      await writeAppState(chunkKey, {
        recordingId,
        index,
        bytes: bytes.byteLength,
        mimeType,
        data: toBase64(bytes),
        createdAt: new Date().toISOString(),
      });
      bytesReceived = await sumRecordingChunkBytes(
        ownerEmail,
        recordingId,
        uploadGenerationId,
      );
      if (bytesReceived > MAX_RECORDING_UPLOAD_BYTES) {
        return failRecordingTooLarge(bytesReceived);
      }
    }

    // Update upload progress (best-effort). If total is unknown we treat it as
    // indeterminate and keep progress at its last known value.
    // Chunks may arrive out of order when uploaded in parallel, so take the
    // max of the current persisted value and the incoming index to keep
    // progress monotonically non-decreasing.
    if (total > 0) {
      const chunksReceived = Math.max(
        stateNumber(uploadState, "chunksReceived") ?? 0,
        index + 1,
      );
      const progress = Math.max(
        stateNumber(uploadState, "progress") ?? 0,
        Math.min(100, Math.round((chunksReceived / total) * 100)),
      );
      const leaseFailure = await rejectIfLeaseLost();
      if (leaseFailure) return leaseFailure;
      await writeAppState(`recording-upload-${recordingId}`, {
        recordingId,
        uploadGenerationId,
        status: isFinal ? "processing" : "uploading",
        progress,
        chunksReceived,
        totalChunks: total,
        ...(expectedDataChunks !== undefined
          ? {
              expectedDataChunks,
              finalChunkIndex: index,
              finalChunkBytes: bytes.byteLength,
            }
          : {}),
        bytesReceived,
        maxBytes: MAX_RECORDING_UPLOAD_BYTES,
        mimeType,
        updatedAt: new Date().toISOString(),
      });
    } else if (bytes.byteLength > 0 || isFinal) {
      const leaseFailure = await rejectIfLeaseLost();
      if (leaseFailure) return leaseFailure;
      await writeAppState(`recording-upload-${recordingId}`, {
        recordingId,
        uploadGenerationId,
        status: isFinal ? "processing" : "uploading",
        chunksReceived: Math.max(
          stateNumber(uploadState, "chunksReceived") ?? 0,
          index + 1,
        ),
        ...(expectedDataChunks !== undefined
          ? {
              expectedDataChunks,
              finalChunkIndex: index,
              finalChunkBytes: bytes.byteLength,
            }
          : {}),
        bytesReceived,
        maxBytes: MAX_RECORDING_UPLOAD_BYTES,
        mimeType,
        updatedAt: new Date().toISOString(),
      });
    }

    // Final chunk — kick off finalize. We await so the client gets a single
    // "done" response with the final URL (instead of needing to poll).
    if (isFinal) {
      const leaseFailure = await rejectIfLeaseLost();
      if (leaseFailure) return leaseFailure;
      bytesReceived = await sumRecordingChunkBytes(
        ownerEmail,
        recordingId,
        uploadGenerationId,
      );
      if (bytesReceived > MAX_RECORDING_UPLOAD_BYTES) {
        return failRecordingTooLarge(bytesReceived);
      }
      const finalLease = await rejectIfLeaseLost();
      if (finalLease) return finalLease;
      debugLog("[chunk] isFinal — invoking finalize", { recordingId });
      try {
        const result = await finalizeRecording.run(
          buildFinalizeArgs(recordingId, mimeType, query, uploadGenerationId),
        );
        debugLog("[chunk] finalize ok", {
          recordingId,
          videoUrl: (result as any)?.videoUrl,
        });
        if ((result as any)?.status === "failed") {
          setResponseStatus(event, 409);
          return {
            ok: false,
            finalized: false,
            aborted: true,
            status: "failed",
            error: "Recording was cancelled before it finished saving.",
          };
        }
        const waitingForStorage =
          (result as any)?.status === "waiting_storage" ||
          (result as any)?.storageSetupRequired === true;
        const verificationPending =
          (result as any)?.status === "processing" &&
          (result as any)?.verificationPending === true;
        if (waitingForStorage || verificationPending) {
          setResponseStatus(event, 202);
        }
        return {
          ok: true,
          finalized: !waitingForStorage && !verificationPending,
          waitingForStorage,
          ...(verificationPending ? { retryAfterMs: 3_000 } : {}),
          ...result,
        };
      } catch (err) {
        console.error("[clips] finalize-recording failed:", err);
        const [committed] = await db
          .select({
            id: schema.recordings.id,
            status: schema.recordings.status,
            videoUrl: schema.recordings.videoUrl,
            videoSizeBytes: schema.recordings.videoSizeBytes,
            durationMs: schema.recordings.durationMs,
            width: schema.recordings.width,
            height: schema.recordings.height,
            hasAudio: schema.recordings.hasAudio,
            hasCamera: schema.recordings.hasCamera,
          })
          .from(schema.recordings)
          .where(
            and(
              eq(schema.recordings.id, recordingId),
              ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
            ),
          );
        if (committed?.status === "ready" && committed.videoUrl) {
          console.warn(
            "[clips] finalize reported an error after committing a ready recording; returning committed success.",
            {
              recordingId,
              error: err instanceof Error ? err.message : String(err),
            },
          );
          const priorReadyStateRaw = await readAppState(
            `recording-upload-${recordingId}`,
          ).catch(() => null);
          const priorReadyState =
            priorReadyStateRaw && typeof priorReadyStateRaw === "object"
              ? (priorReadyStateRaw as Record<string, unknown>)
              : {};
          const sourceSizeBytes =
            stateNumber(priorReadyState, "sourceSizeBytes") ??
            stateNumber(priorReadyState, "bytesReceived");
          try {
            await writeAppState(`recording-upload-${recordingId}`, {
              ...priorReadyState,
              recordingId,
              status: "ready",
              progress: 100,
              videoUrl: committed.videoUrl,
              videoSizeBytes: committed.videoSizeBytes,
              sourceSizeBytes,
              durationMs: committed.durationMs,
              finishedAt: new Date().toISOString(),
            });
          } catch (stateErr) {
            console.warn("[clips] committed-ready state repair failed:", {
              recordingId,
              err:
                stateErr instanceof Error ? stateErr.message : String(stateErr),
            });
          }
          return {
            ok: true,
            finalized: true,
            recoveredAfterFinalizeError: true,
            id: committed.id,
            status: "ready",
            videoUrl: committed.videoUrl,
            videoSizeBytes: committed.videoSizeBytes,
            sourceSizeBytes,
            durationMs: committed.durationMs,
            width: committed.width,
            height: committed.height,
            hasAudio: committed.hasAudio,
            hasCamera: committed.hasCamera,
          };
        }
        if (committed?.status === "processing" && committed.videoUrl) {
          const pendingState = pendingMediaVerificationState(
            await readAppState(`recording-upload-${recordingId}`).catch(
              () => null,
            ),
          );
          if (pendingState) {
            return acceptedProcessingResponse(event, recordingId, pendingState);
          }
        }
        trackUploadBlockingFailure(ownerEmail, {
          stage: "finalize_recording",
          failureKind: "finalize_error",
          recordingId,
          uploadMode: "buffered",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        const failed = await db
          .update(schema.recordings)
          .set({
            status: "failed",
            failureReason:
              err instanceof Error ? err.message : "Finalize failed",
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(schema.recordings.id, recordingId),
              ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
              eq(schema.recordings.status, "processing"),
            ),
          )
          .returning({ id: schema.recordings.id });
        if (failed.length !== 1) {
          throw err;
        }
        const failedUploadStateRaw = await readAppState(
          `recording-upload-${recordingId}`,
        ).catch(() => null);
        const failedUploadState =
          failedUploadStateRaw && typeof failedUploadStateRaw === "object"
            ? (failedUploadStateRaw as Record<string, unknown>)
            : {};
        await writeAppState(`recording-upload-${recordingId}`, {
          ...failedUploadState,
          recordingId,
          status: "failed",
          failureReason: err instanceof Error ? err.message : "Finalize failed",
          updatedAt: new Date().toISOString(),
        });
        setResponseStatus(event, 500);
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Finalize failed",
        };
      }
    }

    return { ok: true, finalized: false, index, bytes: bytes.byteLength };
  });
});

function buildFinalizeArgs(
  recordingId: string,
  mimeType: string,
  query: Record<string, unknown>,
  uploadGenerationId: string | null,
) {
  const queryBoolean = (value: unknown): boolean | undefined => {
    if (value === undefined) return undefined;
    if (Array.isArray(value)) return queryBoolean(value[0]);
    return value === "1" || value === "true" || value === true;
  };

  return {
    id: recordingId,
    durationMs: normalizeChunkUploadNumber(query.durationMs),
    width: normalizeChunkUploadNumber(query.width),
    height: normalizeChunkUploadNumber(query.height),
    hasAudio: queryBoolean(query.hasAudio),
    hasCamera: queryBoolean(query.hasCamera),
    locallyTranscoded: queryBoolean(query.locallyTranscoded),
    mimeType,
    ...(uploadGenerationId ? { uploadGenerationId } : {}),
  };
}

// Resumable streaming path: each chunk is forwarded directly to the upload
// provider. Always returns a response — never falls through to the buffered path.
async function handleResumableChunk(
  event: H3Event,
  session: StoredResumableSession,
  recordingId: string,
  index: number,
  isFinal: boolean,
  mimeType: string,
  query: Record<string, unknown>,
  ownerEmail: string,
  attemptId: string | null,
  uploadGenerationId: string | null,
) {
  const uploadProvider = await resolveResumableUploadProvider(
    session.providerId,
  );
  if (!uploadProvider?.resumable) {
    setResponseStatus(event, 502);
    return { ok: false, error: "Upload storage is not configured" };
  }
  console.log(
    `[resumable-chunk-${recordingId}] resumable session exists - bytesUploaded=${session.bytesUploaded} index=${index} isFinal=${isFinal}`,
  );

  const cleanupFailedFinalSession = async () => {
    const cleaned = await abortResumableUploadSession(session, {
      provider: uploadProvider,
      label: `resumable-final-${recordingId}`,
    });
    if (cleaned) {
      await deleteResumableSession(recordingId, uploadGenerationId).catch(
        (error) =>
          console.warn(
            `[resumable-chunk-${recordingId}] failed to retire aborted session:`,
            error,
          ),
      );
    }
    return !cleaned;
  };

  const raw = await readRawBody(event, false);
  const bytes: Uint8Array = raw ?? new Uint8Array(0);
  let finalizedSourceSizeBytes = session.bytesUploaded;

  if (!isFinal && bytes.byteLength === 0) {
    throw createError({ statusCode: 400, message: "Empty chunk body" });
  }

  if (isFinal && bytes.byteLength === 0) {
    if (session.bytesUploaded <= 0) {
      setResponseStatus(event, 400);
      return {
        ok: false,
        error: "Cannot finalize an empty resumable upload",
      };
    }
    const lease = await renewUploadLease(recordingId, {
      attemptId,
      generationId: uploadGenerationId,
    });
    if (!lease.held) {
      setResponseStatus(event, 409);
      return {
        ok: false,
        error: lease.failureReason ?? "Recording upload has already failed.",
      };
    }
    // 0-byte sentinel from the recorder after stop(). All data chunks have
    // already been PUT to the provider; send Content-Range: bytes */<total>
    // to close the session before handing off to finalize-recording.
    let closeRes;
    try {
      closeRes = await uploadProvider.resumable.relayChunk(
        { sessionId: session.sessionId, meta: session.meta },
        `bytes */${session.bytesUploaded}`,
        new Uint8Array(0),
      );
    } catch (error) {
      const cleanupFailed = await cleanupFailedFinalSession();
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        `[resumable-chunk-${recordingId}] session close threw:`,
        error,
      );
      setResponseStatus(event, 502);
      return {
        ok: false,
        error: `Resumable session close failed: ${detail}`,
        ...(cleanupFailed ? { cleanupFailed: true } : {}),
      };
    }
    if (!closeRes.ok || closeRes.status === 308) {
      console.error(
        `[resumable-chunk-${recordingId}] session close failed (${closeRes.status})`,
      );
      const cleanupFailed = await cleanupFailedFinalSession();
      setResponseStatus(event, 502);
      return {
        ok: false,
        error: `Resumable session close failed (${closeRes.status})`,
        ...(cleanupFailed ? { cleanupFailed: true } : {}),
      };
    }
    if (closeRes.updatedMeta) {
      const postCloseLease = await renewUploadLease(recordingId, {
        attemptId,
        generationId: uploadGenerationId,
      });
      if (!postCloseLease.held) {
        setResponseStatus(event, 409);
        return {
          ok: false,
          error:
            postCloseLease.failureReason ??
            "Recording upload has already failed.",
        };
      }
      await setResumableSession(
        recordingId,
        {
          ...session,
          meta: { ...session.meta, ...closeRes.updatedMeta },
        },
        uploadGenerationId,
      );
    }
  } else {
    // Idempotent replay guard: a client retry (after a lost response) can
    // re-send a chunk we already committed. Re-PUTing it at the new offset
    // would corrupt the file — detect the duplicate by index and skip the PUT.
    // Chunks are strictly sequential, so any index <= last committed is a replay.
    // A replayed non-final is acked here; a replayed final falls through to
    // finalize, which is idempotent.
    const isReplay = index <= (session.lastCommittedIndex ?? -1);
    if (isReplay) {
      console.warn(
        `[resumable-chunk-${recordingId}] duplicate chunk ${index}, acking without re-upload`,
      );
      if (!isFinal) {
        return {
          ok: true,
          finalized: false,
          index,
          bytes: bytes.byteLength,
          duplicate: true,
        };
      }
    } else {
      const lease = await renewUploadLease(recordingId, {
        attemptId,
        generationId: uploadGenerationId,
      });
      if (!lease.held) {
        setResponseStatus(event, 409);
        return {
          ok: false,
          error: lease.failureReason ?? "Recording upload has already failed.",
        };
      }
      // Forward the data chunk to the provider and advance offsets only after
      // the provider confirms receipt (308 Resume Incomplete for non-final, 2xx for final).
      const start = session.bytesUploaded;
      const end = start + bytes.byteLength - 1;
      const contentRange = isFinal
        ? `bytes ${start}-${end}/${start + bytes.byteLength}`
        : `bytes ${start}-${end}/*`;

      const putT0 = Date.now();
      let putResult;
      try {
        putResult = await uploadProvider.resumable.relayChunk(
          { sessionId: session.sessionId, meta: session.meta },
          contentRange,
          bytes,
          { mimeType: mimeType.split(";")[0].trim() },
        );
      } catch (error) {
        if (isFinal) {
          const cleanupFailed = await cleanupFailedFinalSession();
          const detail = error instanceof Error ? error.message : String(error);
          console.error(
            `[resumable-chunk-${recordingId}] final chunk upload threw:`,
            error,
          );
          setResponseStatus(event, 502);
          return {
            ok: false,
            error: `Final chunk upload failed: ${detail}`,
            ...(cleanupFailed ? { cleanupFailed: true } : {}),
          };
        }
        throw error;
      }
      console.log(
        `[resumable-chunk-${recordingId}] PUT ${Date.now() - putT0}ms status=${putResult.status} range="${contentRange}"`,
      );

      const resultOk = isFinal
        ? putResult.ok && putResult.status !== 308
        : putResult.ok;
      if (!resultOk) {
        const restartRequired =
          putResult.status === 404 || putResult.status === 410;
        const cleanupFailed = isFinal
          ? await cleanupFailedFinalSession()
          : false;
        if (restartRequired && !cleanupFailed) {
          await deleteResumableSession(recordingId, uploadGenerationId).catch(
            () => {},
          );
        }
        setResponseStatus(event, restartRequired ? 409 : 502);
        return {
          ok: false,
          error: `Chunk upload failed (${putResult.status})`,
          ...(restartRequired ? { restartRequired: true } : {}),
          ...(cleanupFailed ? { cleanupFailed: true } : {}),
        };
      }

      const postUploadLease = await renewUploadLease(recordingId, {
        attemptId,
        generationId: uploadGenerationId,
      });
      if (!postUploadLease.held) {
        setResponseStatus(event, 409);
        return {
          ok: false,
          error:
            postUploadLease.failureReason ??
            "Recording upload has already failed.",
        };
      }
      await setResumableSession(
        recordingId,
        {
          ...session,
          ...(putResult.updatedMeta
            ? { meta: { ...session.meta, ...putResult.updatedMeta } }
            : {}),
          bytesUploaded: start + bytes.byteLength,
          lastCommittedIndex: index,
        },
        uploadGenerationId,
      );
      finalizedSourceSizeBytes = start + bytes.byteLength;

      if (!isFinal) {
        return { ok: true, finalized: false, index, bytes: bytes.byteLength };
      }
    }
  }

  // isFinal — delegate to finalize-recording, which reads the resumable
  // session and calls provider.resumable.completeSession.
  const finalLease = await renewUploadLease(recordingId, {
    attemptId,
    generationId: uploadGenerationId,
  });
  if (!finalLease.held) {
    setResponseStatus(event, 409);
    return {
      ok: false,
      error: finalLease.failureReason ?? "Recording upload has already failed.",
    };
  }
  try {
    const result = await finalizeRecording.run(
      buildFinalizeArgs(recordingId, mimeType, query, uploadGenerationId),
    );
    if ((result as any)?.status === "failed") {
      setResponseStatus(event, 409);
      return {
        ok: false,
        finalized: false,
        aborted: true,
        status: "failed",
        error: "Recording was cancelled before it finished saving.",
      };
    }
    const verificationPending =
      (result as any)?.status === "processing" &&
      (result as any)?.verificationPending === true;
    if (verificationPending) setResponseStatus(event, 202);
    return {
      ok: true,
      finalized: !verificationPending,
      ...(verificationPending ? { retryAfterMs: 3_000 } : {}),
      ...result,
    };
  } catch (err) {
    console.error(`[resumable-chunk-${recordingId}] finalize failed:`, err);
    const db = getDb();
    const [committed] = await db
      .select({
        id: schema.recordings.id,
        status: schema.recordings.status,
        videoUrl: schema.recordings.videoUrl,
        videoSizeBytes: schema.recordings.videoSizeBytes,
        durationMs: schema.recordings.durationMs,
        width: schema.recordings.width,
        height: schema.recordings.height,
        hasAudio: schema.recordings.hasAudio,
        hasCamera: schema.recordings.hasCamera,
      })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        ),
      );
    if (committed?.status === "ready" && committed.videoUrl) {
      console.warn(
        `[resumable-chunk-${recordingId}] finalize reported an error after committing a ready recording; returning committed success.`,
        { error: err instanceof Error ? err.message : String(err) },
      );
      const priorReadyStateRaw = await readAppState(
        `recording-upload-${recordingId}`,
      ).catch(() => null);
      const priorReadyState =
        priorReadyStateRaw && typeof priorReadyStateRaw === "object"
          ? (priorReadyStateRaw as Record<string, unknown>)
          : {};
      const sourceSizeBytes =
        stateNumber(priorReadyState, "sourceSizeBytes") ??
        finalizedSourceSizeBytes;
      await writeAppState(`recording-upload-${recordingId}`, {
        ...priorReadyState,
        recordingId,
        status: "ready",
        progress: 100,
        videoUrl: committed.videoUrl,
        videoSizeBytes: committed.videoSizeBytes,
        sourceSizeBytes,
        durationMs: committed.durationMs,
        finishedAt: new Date().toISOString(),
      }).catch((stateErr) =>
        console.warn(
          `[resumable-chunk-${recordingId}] committed-ready state repair failed:`,
          stateErr,
        ),
      );
      return {
        ok: true,
        finalized: true,
        recoveredAfterFinalizeError: true,
        id: committed.id,
        status: "ready",
        videoUrl: committed.videoUrl,
        videoSizeBytes: committed.videoSizeBytes,
        sourceSizeBytes,
        durationMs: committed.durationMs,
        width: committed.width,
        height: committed.height,
        hasAudio: committed.hasAudio,
        hasCamera: committed.hasCamera,
      };
    }
    if (committed?.status === "processing" && committed.videoUrl) {
      const pendingState = pendingMediaVerificationState(
        await readAppState(`recording-upload-${recordingId}`).catch(() => null),
      );
      if (pendingState) {
        return acceptedProcessingResponse(event, recordingId, pendingState);
      }
    }

    trackUploadBlockingFailure(ownerEmail, {
      stage: "finalize_recording",
      failureKind: "finalize_error",
      recordingId,
      uploadMode: "resumable",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    const failureReason =
      err instanceof Error ? err.message : "Finalize failed";
    const failedAt = new Date().toISOString();
    const failed = await db
      .update(schema.recordings)
      .set({
        status: "failed",
        failureReason,
        updatedAt: failedAt,
      })
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          eq(schema.recordings.status, "processing"),
        ),
      )
      .returning({ id: schema.recordings.id });
    if (failed.length !== 1) throw err;
    const failedUploadStateRaw = await readAppState(
      `recording-upload-${recordingId}`,
    ).catch(() => null);
    const failedUploadState =
      failedUploadStateRaw && typeof failedUploadStateRaw === "object"
        ? (failedUploadStateRaw as Record<string, unknown>)
        : {};
    await writeAppState(`recording-upload-${recordingId}`, {
      ...failedUploadState,
      recordingId,
      status: "failed",
      failureReason,
      updatedAt: failedAt,
    });
    setResponseStatus(event, 500);
    return {
      ok: false,
      error: failureReason,
    };
  }
}
