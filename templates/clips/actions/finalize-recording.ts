import { defineAction, fail } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  compareAndSetManyAppState,
  deleteAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { emit } from "@agent-native/core/event-bus";
import { uploadFile } from "@agent-native/core/file-upload";
import {
  captureError,
  captureRouteError,
  getAppConfig,
} from "@agent-native/core/server";
import { getRequestContext } from "@agent-native/core/server/request-context";
import { track } from "@agent-native/core/tracking";
import { isStoredButUnservableFinalizeError } from "@shared/finalize-recovery.js";
import { retryableUploadInterruptionReason } from "@shared/upload-interruption.js";
import { MAX_UPLOAD_BYTES as MAX_RECORDING_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { queueBuilderMediaCompression } from "../server/lib/builder-media-compression.js";
import { debugLog } from "../server/lib/debug.js";
import {
  applyFaststart,
  hasPlayableMp4Metadata,
} from "../server/lib/faststart.js";
import { allowsLegacyS3ObjectForPersistedMedia } from "../server/lib/media-storage-provenance.js";
import {
  mediaVerificationStateKey,
  mediaVerificationMarkerMatchesUpload,
  parseMediaVerificationMarker,
} from "../server/lib/media-verification-state.js";
import { dispatchPostFinalizeJob } from "../server/lib/post-finalize-dispatch.js";
import { reconcileMeetingOnRecordingReady } from "../server/lib/reconcile-meeting-on-finalize.js";
import {
  hostedStorageAuthFailure,
  recordingTrackingSource,
  trackRecordingFailure,
} from "../server/lib/recording-failures.js";
import {
  listRecordingChunkKeys,
  recordingUploadBrowserSessionId,
  validateRecordingChunkKeys,
} from "../server/lib/recording-upload-state.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";
import {
  deleteResumableSession,
  getResumableSession,
} from "../server/lib/resumable-session.js";
import { abortResumableUploadSession } from "../server/lib/resumable-upload-cleanup.js";
import { resolveResumableUploadProvider } from "../server/lib/resumable-upload-provider.js";
import {
  clipsHostedFileUploadProvider,
  deleteS3ObjectByUrl,
  fetchS3ObjectByUrl,
} from "../server/lib/s3-upload-provider.js";
import {
  clearSeekableRepairPending,
  markSeekableRepairPending,
} from "../server/lib/seekable-media-state.js";
import { isStreamingUploadDisabled } from "../server/lib/streaming-upload-mode.js";
import {
  markHostedCleanupConfirmed,
  uploadLeaseExpiry,
  waitingStorageLeaseExpiry,
} from "../server/lib/upload-lease.js";
import {
  probeHasAudioStream,
  remuxWebmToSeekable,
} from "../server/lib/video-remux.js";
import {
  consumeHostedClipRecording,
  HOSTED_STORAGE_UNAVAILABLE_REASON,
  releaseHostedClipRecording,
  requiresConfiguredVideoStorage,
  STORAGE_SETUP_REQUIRED_REASON,
} from "../server/lib/video-storage.js";
import {
  isRemoteProviderUrl,
  markRecordingSeekable,
} from "./lib/ensure-seekable-video.js";

function inlineRemuxMaxBytes(): number {
  const raw = Number(process.env.CLIPS_INLINE_REMUX_MAX_BYTES ?? "");
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 200 * 1024 * 1024;
}

function b64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(b64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

const RECORDING_TOO_LARGE_REASON =
  "Recording is too large to process after automatic compression. Please update the app and try again, or record a shorter clip.";

function recordingTooLargeReason(maxBytes: number): string {
  return `Recording exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB size limit. Please record a shorter clip.`;
}

const MEDIA_SERVE_VERIFICATION_TIMEOUT_MS = 8_000;
const MEDIA_SERVE_VERIFICATION_ATTEMPTS = 3;
const MEDIA_SERVE_VERIFICATION_BACKOFF_MS = 350;

function notTakenDown() {
  return or(
    isNull(schema.recordings.failureCode),
    ne(schema.recordings.failureCode, "taken_down"),
  );
}
const MEDIA_VERIFICATION_MAX_DURABLE_ATTEMPTS = 10;
const MEDIA_VERIFICATION_INITIAL_RETRY_DELAY_MS = 5_000;

function trackUploadBlockingFailure(params: {
  id: string;
  ownerEmail: string;
  uploadAttemptId: string | null | undefined;
  recordingPlatform: string | null | undefined;
  failureCode: string;
  failureType: string;
}): void {
  try {
    track(
      "clips_upload_blocking_failure",
      {
        app: "clips",
        template: "clips",
        surface: "server_upload",
        stage: "finalize_recording",
        outcome: "failed",
        failure_type: params.failureType,
        failure_code: params.failureCode,
        output_id: params.id,
        output_type: "clip",
        recording_id: params.id,
        recording_attempt_id: params.id,
        ...(params.uploadAttemptId
          ? { upload_attempt_id: params.uploadAttemptId }
          : {}),
        recording_platform: params.recordingPlatform ?? "unknown",
        upload_mode: "buffered",
      },
      recordingTrackingSource(params.ownerEmail),
    );
    // coercion-ok: analytics must not change the persisted upload outcome.
  } catch {
    // Best-effort analytics must never change upload behavior.
  }
}

function stateNumber(
  value: Record<string, unknown> | null | undefined,
  key: string,
): number | undefined {
  const raw = value?.[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return raw;
}

function stateBoolean(
  value: Record<string, unknown> | null | undefined,
  key: string,
): boolean | undefined {
  const raw = value?.[key];
  return typeof raw === "boolean" ? raw : undefined;
}

function stateString(
  value: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  const raw = value?.[key];
  return typeof raw === "string" && raw.trim() ? raw : undefined;
}

async function uploadWasAborted(id: string): Promise<boolean | undefined> {
  try {
    const state = await readAppState(`recording-upload-${id}`);
    return (
      !!state &&
      typeof state === "object" &&
      (state as Record<string, unknown>).aborted === true
    );
  } catch (error) {
    console.warn("[finalize] upload abort marker could not be read", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

const cliBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "1") return true;
  if (value === "0") return false;
  return value;
}, z.boolean());

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldVerifyServedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function responseHasReadableMediaBytes(
  response: Response,
): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) {
    const body = await response.arrayBuffer().catch(() => new ArrayBuffer(0));
    return body.byteLength > 0;
  }

  try {
    const { value } = await reader.read();
    return (value?.byteLength ?? 0) > 0;
  } catch {
    return false;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function servedMediaSizeBytes(response: Response): number | null {
  const contentRange = response.headers.get("content-range") ?? "";
  const total = Number(contentRange.match(/\/(\d+)$/)?.[1]);
  if (Number.isFinite(total) && total > 0) return total;
  if (response.status === 200) {
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > 0) return length;
  }
  return null;
}

async function verifyServedMediaUrl(
  recordingId: string,
  videoUrl: string,
  allowLegacyObjectKey = false,
  storageMode?: "own" | "hosted" | null,
): Promise<number | null> {
  if (!shouldVerifyServedMediaUrl(videoUrl)) return null;

  let lastFailure = "media URL did not serve readable bytes";
  for (
    let attempt = 1;
    attempt <= MEDIA_SERVE_VERIFICATION_ATTEMPTS;
    attempt++
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      MEDIA_SERVE_VERIFICATION_TIMEOUT_MS,
    );
    try {
      const signedS3Response = await fetchS3ObjectByUrl(videoUrl, {
        range: "bytes=0-1023",
        timeoutMs: MEDIA_SERVE_VERIFICATION_TIMEOUT_MS,
        recordingId,
        storageMode: storageMode === "hosted" ? "hosted" : "own",
        ...(allowLegacyObjectKey ? { allowLegacyObjectKey } : {}),
      });
      let response = signedS3Response;
      if (response?.status !== 200 && response?.status !== 206) {
        await response?.body?.cancel().catch(() => undefined);
        if (storageMode === "hosted") {
          lastFailure =
            "hosted media could not be read from its private bucket";
          continue;
        }
        response = await fetch(videoUrl, {
          method: "GET",
          headers: { Range: "bytes=0-1023" },
          signal: controller.signal,
        });
      }
      const statusOk = response.status === 200 || response.status === 206;
      if (statusOk) {
        const servedBytes = servedMediaSizeBytes(response);
        if (servedBytes === null) {
          lastFailure = "Stored media byte count could not be verified";
        } else if (await responseHasReadableMediaBytes(response)) {
          return servedBytes;
        } else {
          lastFailure = "media URL did not serve readable bytes";
        }
      } else {
        lastFailure = `media URL returned HTTP ${response.status}`;
        if (response.status < 500) break;
      }
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < MEDIA_SERVE_VERIFICATION_ATTEMPTS) {
      await sleep(MEDIA_SERVE_VERIFICATION_BACKOFF_MS * attempt);
    }
  }

  throw new Error(`Upload was stored-but-unservable: ${lastFailure}`);
}

function mediaVerificationRetryDelayMs(attempt: number): number {
  return Math.min(
    30_000,
    MEDIA_VERIFICATION_INITIAL_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1),
  );
}

function queueBackgroundBuilderCompression(args: {
  recordingId: string;
  ownerEmail: string;
  videoUrl: string | null | undefined;
  mimeType: string;
  providerId?: string | null;
  assetDbId?: string | null;
  sourceSizeBytes?: number | null;
  locallyTranscoded?: boolean;
}): void {
  void queueBuilderMediaCompression(args).catch((err) => {
    console.warn("[finalize] failed to queue media compression", {
      recordingId: args.recordingId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

async function failStoredButUnservableRecording(params: {
  id: string;
  ownerEmail: string;
  uploadAttemptId: string | null;
  uploadGenerationId: string | null;
  storageMode?: "own" | "hosted" | null;
  videoUrl?: string;
  expectedUploadState: Record<string, unknown> | null;
  expectedVerificationState: Record<string, unknown> | null;
  failureReason: string;
  browserSessionId?: string;
}): Promise<boolean> {
  const {
    id,
    ownerEmail,
    uploadAttemptId,
    uploadGenerationId,
    storageMode,
    videoUrl,
    expectedUploadState,
    expectedVerificationState,
    failureReason,
    browserSessionId,
  } = params;
  const now = new Date().toISOString();
  const db = getDb();
  const failed = await db
    .update(schema.recordings)
    .set({
      status: "failed",
      failureCode: "media_verification_failed",
      failureReason,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.recordings.id, id),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        eq(schema.recordings.status, "processing"),
        uploadAttemptId === null
          ? isNull(schema.recordings.uploadAttemptId)
          : eq(schema.recordings.uploadAttemptId, uploadAttemptId),
        uploadGenerationId === null
          ? isNull(schema.recordings.uploadGenerationId)
          : eq(schema.recordings.uploadGenerationId, uploadGenerationId),
      ),
    )
    .returning({
      id: schema.recordings.id,
      uploadAttemptId: schema.recordings.uploadAttemptId,
      recordingPlatform: schema.recordings.recordingPlatform,
    });
  if (failed.length !== 1) return false;
  const statePublished = await compareAndSetManyAppState([
    {
      key: `recording-upload-${id}`,
      expectedValue: expectedUploadState,
      nextValue: {
        ...(expectedUploadState ?? {}),
        recordingId: id,
        status: "failed",
        pendingMediaVerification: false,
        uploadAttemptId,
        uploadGenerationId,
        failureReason,
        updatedAt: now,
      },
    },
    {
      key: mediaVerificationStateKey(id),
      expectedValue: expectedVerificationState,
      nextValue: null,
    },
  ]);
  if (!statePublished) return false;
  try {
    track(
      "clips_upload_blocking_failure",
      {
        app: "clips",
        template: "clips",
        surface: "media_verification",
        stage: "media_verification",
        outcome: "failed",
        failure_type: "media_verification",
        failure_code: "media_verification_failed",
        recording_attempt_id: id,
        ...(failed[0]?.uploadAttemptId
          ? { upload_attempt_id: failed[0].uploadAttemptId }
          : {}),
        recording_platform: failed[0]?.recordingPlatform ?? "unknown",
      },
      recordingTrackingSource(ownerEmail, browserSessionId),
    );
  } catch {
    // coercion-ok: analytics is best-effort and must not change media recovery behavior.
  }
  trackRecordingFailure({
    recordingId: id,
    userId: ownerEmail,
    uploadAttemptId: failed[0]?.uploadAttemptId,
    platform: failed[0]?.recordingPlatform,
    failureCode: "media_verification_failed",
    browserSessionId,
  });
  if (storageMode === "hosted" && videoUrl) {
    let deleted = false;
    try {
      deleted = await deleteS3ObjectByUrl(videoUrl, {
        storageMode: "hosted",
        recordingId: id,
      });
    } catch (error) {
      console.error("[finalize] hosted failed media cleanup failed", {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (deleted) {
      await markHostedCleanupConfirmed(id, videoUrl);
      const [cleared] = await db
        .update(schema.recordings)
        .set({
          videoUrl: null,
          videoSizeBytes: 0,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.recordings.id, id),
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
            eq(schema.recordings.status, "failed"),
            eq(schema.recordings.videoUrl, videoUrl),
            notTakenDown(),
          ),
        )
        .returning({ id: schema.recordings.id });
      if (cleared) {
        await releaseHostedClipRecording({
          recordingId: id,
          ownerEmail,
        });
      }
    } else {
      console.error("[finalize] hosted failed media remains reserved", { id });
    }
  }
  await writeAppState("refresh-signal", { ts: Date.now() });
  return true;
}

type PendingMediaVerification = {
  videoUrl: string;
  videoSizeBytes: number;
  sourceSizeBytes: number;
  videoFormat: "webm" | "mp4";
  finalDurationMs: number;
  finalWidth: number;
  finalHeight: number;
  finalHasAudio: boolean;
  finalHasCamera: boolean;
  seekableApplied: boolean;
  mimeType: string;
  providerId?: string;
  assetDbId?: string;
  locallyTranscoded: boolean;
};

function pendingMediaVerificationFromState(
  state: Record<string, unknown> | null,
): PendingMediaVerification | null {
  if (state?.pendingMediaVerification !== true) return null;
  const videoUrl = stateString(state, "videoUrl");
  const videoSizeBytes = stateNumber(state, "videoSizeBytes");
  const sourceSizeBytes = stateNumber(state, "sourceSizeBytes");
  const videoFormat = stateString(state, "videoFormat");
  if (
    !videoUrl ||
    !videoSizeBytes ||
    !sourceSizeBytes ||
    (videoFormat !== "webm" && videoFormat !== "mp4")
  ) {
    return null;
  }
  return {
    videoUrl,
    videoSizeBytes,
    sourceSizeBytes,
    videoFormat,
    finalDurationMs: stateNumber(state, "durationMs") ?? 0,
    finalWidth: stateNumber(state, "width") ?? 0,
    finalHeight: stateNumber(state, "height") ?? 0,
    finalHasAudio: stateBoolean(state, "hasAudio") ?? true,
    finalHasCamera: stateBoolean(state, "hasCamera") ?? false,
    seekableApplied: stateBoolean(state, "seekableApplied") ?? false,
    mimeType: stateString(state, "mimeType") ?? `video/${videoFormat}`,
    providerId: stateString(state, "providerId"),
    assetDbId: stateString(state, "assetDbId"),
    locallyTranscoded: stateBoolean(state, "locallyTranscoded") ?? false,
  };
}

async function persistPendingMediaVerification(params: {
  id: string;
  ownerEmail: string;
  uploadAttemptId: string | null;
  uploadGenerationId: string | null;
  expectedUploadState: Record<string, unknown> | null;
  expectedVerificationState: Record<string, unknown> | null;
  media: PendingMediaVerification;
  failureReason: string;
  retryAttempt?: number;
}): Promise<boolean> {
  const {
    id,
    ownerEmail,
    uploadAttemptId,
    uploadGenerationId,
    expectedUploadState,
    expectedVerificationState,
    media,
    failureReason,
  } = params;
  const now = new Date().toISOString();
  const retryAttempt = Math.max(0, params.retryAttempt ?? 0);
  const nextRetryAttempt = Math.min(
    MEDIA_VERIFICATION_MAX_DURABLE_ATTEMPTS,
    retryAttempt + 1,
  );
  const nextAttemptAt = new Date(
    Date.now() + mediaVerificationRetryDelayMs(nextRetryAttempt),
  ).toISOString();
  const existingVerificationMarker = parseMediaVerificationMarker(
    expectedVerificationState,
  );
  const storedBrowserSessionId =
    existingVerificationMarker?.recordingId === id &&
    mediaVerificationMarkerMatchesUpload(
      existingVerificationMarker,
      uploadAttemptId,
      uploadGenerationId,
    )
      ? stateString(expectedVerificationState, "browserSessionId")
      : undefined;
  const browserSessionId =
    storedBrowserSessionId ??
    recordingUploadBrowserSessionId(expectedUploadState, {
      recordingId: id,
      uploadAttemptId,
      uploadGenerationId,
    }) ??
    getRequestContext()?.browserSessionId;
  const db = getDb();
  const persisted = await db
    .update(schema.recordings)
    .set({
      status: "processing",
      videoUrl: media.videoUrl,
      videoFormat: media.videoFormat,
      videoSizeBytes: media.videoSizeBytes,
      mediaUpdatedAt: now,
      durationMs: media.finalDurationMs,
      width: media.finalWidth,
      height: media.finalHeight,
      hasAudio: media.finalHasAudio,
      hasCamera: media.finalHasCamera,
      failureReason: null,
      failureCode: null,
      uploadProgress: 100,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.recordings.id, id),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        eq(schema.recordings.status, "processing"),
        isNull(schema.recordings.trashedAt),
        uploadAttemptId === null
          ? isNull(schema.recordings.uploadAttemptId)
          : eq(schema.recordings.uploadAttemptId, uploadAttemptId),
        uploadGenerationId === null
          ? isNull(schema.recordings.uploadGenerationId)
          : eq(schema.recordings.uploadGenerationId, uploadGenerationId),
      ),
    )
    .returning({ id: schema.recordings.id });
  if (persisted.length !== 1) return false;

  const statePublished = await compareAndSetManyAppState([
    {
      key: `recording-upload-${id}`,
      expectedValue: expectedUploadState,
      nextValue: {
        recordingId: id,
        status: "processing",
        progress: 100,
        pendingMediaVerification: true,
        mediaVerificationAttempt: retryAttempt,
        mediaVerificationNextAttemptAt: nextAttemptAt,
        mediaVerificationLastError: failureReason,
        uploadAttemptId,
        uploadGenerationId,
        ...(browserSessionId ? { browserSessionId } : {}),
        videoUrl: media.videoUrl,
        videoSizeBytes: media.videoSizeBytes,
        sourceSizeBytes: media.sourceSizeBytes,
        videoFormat: media.videoFormat,
        durationMs: media.finalDurationMs,
        width: media.finalWidth,
        height: media.finalHeight,
        hasAudio: media.finalHasAudio,
        hasCamera: media.finalHasCamera,
        seekableApplied: media.seekableApplied,
        mimeType: media.mimeType,
        providerId: media.providerId,
        assetDbId: media.assetDbId,
        locallyTranscoded: media.locallyTranscoded,
        updatedAt: now,
      },
    },
    {
      key: mediaVerificationStateKey(id),
      expectedValue: expectedVerificationState,
      nextValue: {
        recordingId: id,
        status: "pending",
        completedAttempts: retryAttempt,
        nextAttemptAt,
        leaseUntil: null,
        uploadAttemptId,
        uploadGenerationId,
        ...(browserSessionId ? { browserSessionId } : {}),
        updatedAt: now,
      },
    },
  ]);
  if (!statePublished) return false;
  await writeAppState("refresh-signal", { ts: Date.now() });
  return true;
}

async function claimPendingMediaVerification(params: {
  id: string;
  retryAttempt: number;
  uploadAttemptId: string | null;
  uploadGenerationId: string | null;
  expectedState: Record<string, unknown> | null;
}): Promise<Record<string, unknown> | null> {
  const {
    id,
    retryAttempt,
    uploadAttemptId,
    uploadGenerationId,
    expectedState,
  } = params;
  const key = mediaVerificationStateKey(id);
  const raw = expectedState;
  const marker = parseMediaVerificationMarker(raw);
  const rawMarker =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const now = Date.now();
  if (
    !marker ||
    marker.recordingId !== id ||
    retryAttempt !== marker.completedAttempts + 1 ||
    !mediaVerificationMarkerMatchesUpload(
      marker,
      uploadAttemptId,
      uploadGenerationId,
    ) ||
    now < Date.parse(marker.nextAttemptAt) ||
    (marker.status === "leased" &&
      marker.leaseUntil !== null &&
      now < Date.parse(marker.leaseUntil))
  ) {
    return null;
  }

  const updatedAt = new Date(now).toISOString();
  const claimedState = {
    ...(rawMarker ?? {}),
    status: "leased",
    leaseUntil: new Date(now + 60_000).toISOString(),
    uploadAttemptId,
    uploadGenerationId,
    updatedAt,
  };
  return (await compareAndSetAppState(
    key,
    raw as Record<string, unknown>,
    claimedState,
  ))
    ? claimedState
    : null;
}

async function dispatchMediaVerificationRetry(
  id: string,
  retryAttempt: number,
  uploadAttemptId: string | null,
  uploadGenerationId: string | null,
): Promise<void> {
  await dispatchPostFinalizeJob({
    recordingId: id,
    kind: "media-ready",
    delayMs: mediaVerificationRetryDelayMs(retryAttempt),
    retryAttempt,
    uploadAttemptId,
    uploadGenerationId,
    requireAccepted: true,
  }).catch((err: unknown) => {
    console.error("[finalize] media verification dispatch failed", {
      id,
      retryAttempt,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

async function leaveRecordingProcessingForMediaVerification(params: {
  id: string;
  ownerEmail: string;
  uploadAttemptId: string | null;
  uploadGenerationId: string | null;
  expectedUploadState: Record<string, unknown> | null;
  expectedVerificationState?: Record<string, unknown> | null;
  media: PendingMediaVerification;
  failureReason: string;
}) {
  const persisted = await persistPendingMediaVerification({
    ...params,
    expectedVerificationState: params.expectedVerificationState ?? null,
  });
  if (!persisted) {
    const aborted = await uploadWasAborted(params.id);
    return {
      id: params.id,
      status: "failed" as const,
      ...(aborted ? { aborted: true } : {}),
      videoUrl: params.media.videoUrl,
      videoSizeBytes: params.media.videoSizeBytes,
      sourceSizeBytes: params.media.sourceSizeBytes,
      durationMs: params.media.finalDurationMs,
    };
  }
  await dispatchMediaVerificationRetry(
    params.id,
    1,
    params.uploadAttemptId,
    params.uploadGenerationId,
  );
  return {
    id: params.id,
    status: "processing" as const,
    verificationPending: true,
    videoUrl: params.media.videoUrl,
    videoSizeBytes: params.media.videoSizeBytes,
    sourceSizeBytes: params.media.sourceSizeBytes,
    durationMs: params.media.finalDurationMs,
  };
}

async function queueReadyRecordingThumbnail(
  recordingId: string,
): Promise<void> {
  try {
    await getDb()
      .update(schema.recordings)
      .set({ thumbnailStatus: "pending" })
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          isNull(schema.recordings.thumbnailStatus),
        ),
      );
  } catch (err: unknown) {
    console.warn("[finalize] failed to mark thumbnail pending", {
      id: recordingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  await dispatchPostFinalizeJob({
    recordingId,
    kind: "thumbnail",
    requireAccepted: true,
  });
}

async function compareAndSetProcessingUploadState(params: {
  id: string;
  ownerEmail: string;
  uploadAttemptId: string | null;
  uploadGenerationId: string | null;
  expectedState: Record<string, unknown> | null;
  nextState: Record<string, unknown>;
}): Promise<boolean> {
  const [recording] = await getDb()
    .select({
      status: schema.recordings.status,
      uploadAttemptId: schema.recordings.uploadAttemptId,
      uploadGenerationId: schema.recordings.uploadGenerationId,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, params.id),
        ownerEmailMatches(schema.recordings.ownerEmail, params.ownerEmail),
      ),
    );
  if (
    recording?.status !== "processing" ||
    (recording.uploadAttemptId ?? null) !== params.uploadAttemptId ||
    (recording.uploadGenerationId ?? null) !== params.uploadGenerationId
  ) {
    return false;
  }
  return compareAndSetAppState(
    `recording-upload-${params.id}`,
    params.expectedState,
    params.nextState,
  );
}

async function markRecordingReady(params: {
  id: string;
  ownerEmail: string;
  videoUrl: string;
  videoSizeBytes: number;
  sourceSizeBytes: number;
  videoFormat: "webm" | "mp4";
  finalDurationMs: number;
  finalWidth: number;
  finalHeight: number;
  finalHasAudio: boolean;
  finalHasCamera: boolean;
  recordingAttemptId: string | null;
  recordingGenerationId: string | null;
  storageMode?: "own" | "hosted" | null;
  existingTitle: string;
  seekableApplied: boolean;
  browserSessionId?: string;
}) {
  const {
    id,
    ownerEmail,
    videoUrl,
    videoSizeBytes,
    sourceSizeBytes,
    videoFormat,
    finalDurationMs,
    finalWidth,
    finalHeight,
    finalHasAudio,
    finalHasCamera,
    recordingAttemptId,
    recordingGenerationId,
    storageMode,
    existingTitle,
    seekableApplied,
    browserSessionId,
  } = params;
  const db = getDb();
  const now = new Date().toISOString();

  const promoted = await db
    .update(schema.recordings)
    .set({
      status: "ready",
      videoUrl,
      videoFormat,
      videoSizeBytes,
      mediaUpdatedAt: now,
      durationMs: finalDurationMs,
      width: finalWidth,
      height: finalHeight,
      hasAudio: finalHasAudio,
      hasCamera: finalHasCamera,
      failureReason: null,
      failureCode: null,
      uploadProgress: 100,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.recordings.id, id),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        eq(schema.recordings.status, "processing"),
        recordingAttemptId === null
          ? isNull(schema.recordings.uploadAttemptId)
          : eq(schema.recordings.uploadAttemptId, recordingAttemptId),
        recordingGenerationId === null
          ? isNull(schema.recordings.uploadGenerationId)
          : eq(schema.recordings.uploadGenerationId, recordingGenerationId),
        isNull(schema.recordings.trashedAt),
      ),
    )
    .returning({ id: schema.recordings.id });

  if (promoted.length !== 1) {
    const [postUpdate] = await db
      .select({
        status: schema.recordings.status,
        uploadAttemptId: schema.recordings.uploadAttemptId,
        uploadGenerationId: schema.recordings.uploadGenerationId,
      })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, id),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        ),
      );
    debugLog("[finalize] markRecordingReady transition already resolved", {
      id,
      status: postUpdate?.status,
    });
    const sameUpload =
      postUpdate?.uploadAttemptId === recordingAttemptId &&
      postUpdate?.uploadGenerationId === recordingGenerationId;
    const isReady = sameUpload && postUpdate?.status === "ready";
    if (isReady) {
      if (
        !(await consumeHostedAllowanceIfNeeded({
          id,
          ownerEmail,
          storageMode,
          videoUrl,
          videoSizeBytes,
        }))
      ) {
        return {
          id,
          status: "failed" as const,
          transitionedToReady: false,
        };
      }
      await queueReadyRecordingThumbnail(id);
      await reconcileMeetingOnRecordingReady({
        recordingId: id,
        ownerEmail,
        endedAtIso: now,
      }).catch((err: unknown) => {
        console.error("[finalize] meeting reconcile failed", {
          id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    const aborted =
      sameUpload &&
      postUpdate?.status === "failed" &&
      (await uploadWasAborted(id));
    return {
      id,
      status: isReady ? ("ready" as const) : ("failed" as const),
      ...(aborted ? { aborted: true } : {}),
      transitionedToReady: false,
      ...(isReady
        ? {
            videoUrl,
            videoSizeBytes,
            sourceSizeBytes,
            durationMs: finalDurationMs,
          }
        : {}),
    };
  }

  if (
    !(await consumeHostedAllowanceIfNeeded({
      id,
      ownerEmail,
      storageMode,
      videoUrl,
      videoSizeBytes,
    }))
  ) {
    return {
      id,
      status: "failed" as const,
      transitionedToReady: false,
    };
  }

  // Published as soon as the row is ready, before any follow-up work can
  // fail: a client deletes its local copy only when these source bytes match.
  await writeAppState(`recording-upload-${id}`, {
    recordingId: id,
    status: "ready",
    progress: 100,
    uploadAttemptId: recordingAttemptId,
    uploadGenerationId: recordingGenerationId,
    ...(browserSessionId ? { browserSessionId } : {}),
    videoUrl,
    videoSizeBytes,
    sourceSizeBytes,
    durationMs: finalDurationMs,
    finishedAt: now,
  });

  track(
    "recording_ready",
    {
      app_name: "clips",
      template_name: "clips",
      output_id: id,
      output_type: "clip",
      recording_attempt_id: id,
      ...(recordingAttemptId ? { upload_attempt_id: recordingAttemptId } : {}),
      duration_s: Math.round(finalDurationMs / 1000),
      video_format: videoFormat,
      has_audio: finalHasAudio,
      has_camera: finalHasCamera,
      width: finalWidth,
      height: finalHeight,
    },
    recordingTrackingSource(ownerEmail, browserSessionId),
  );

  await queueReadyRecordingThumbnail(id);
  await reconcileMeetingOnRecordingReady({
    recordingId: id,
    ownerEmail,
    endedAtIso: now,
  }).catch((err: unknown) => {
    console.error("[finalize] meeting reconcile failed", {
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  const [existingTranscript] = await db
    .select({ recordingId: schema.recordingTranscripts.recordingId })
    .from(schema.recordingTranscripts)
    .where(eq(schema.recordingTranscripts.recordingId, id));
  if (!existingTranscript) {
    // A transcript import can create the row after the read above; keep it.
    await db
      .insert(schema.recordingTranscripts)
      .values({
        recordingId: id,
        ownerEmail,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: schema.recordingTranscripts.recordingId });
  }

  await deleteAppState(mediaVerificationStateKey(id)).catch((err) => {
    console.warn("[finalize] failed to clear media verification marker", {
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  await writeAppState("refresh-signal", { ts: Date.now() });

  if (seekableApplied) {
    await clearSeekableRepairPending(id).catch((err) => {
      console.warn("[finalize] failed to clear seekable repair marker", {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    await markRecordingSeekable(id, videoUrl).catch((err) => {
      console.warn("[finalize] failed to write seekable marker", {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  } else {
    if (isRemoteProviderUrl(videoUrl)) {
      await markSeekableRepairPending({
        recordingId: id,
        videoUrl,
      }).catch((err) => {
        console.warn("[finalize] failed to mark seekable repair pending", {
          id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    await dispatchPostFinalizeJob({
      recordingId: id,
      kind: "seekable",
    }).catch((err: unknown) => {
      console.warn("[finalize] seekable remux dispatch failed", {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  await dispatchPostFinalizeJob({
    recordingId: id,
    kind: "transcript",
  }).catch((err: unknown) => {
    console.error("[finalize] transcript dispatch failed", {
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  try {
    emit(
      "clip.created",
      {
        clipId: id,
        title: existingTitle,
        createdBy: ownerEmail,
        duration: finalDurationMs,
        url: videoUrl,
      },
      { owner: ownerEmail },
    );
  } catch (err) {
    console.warn("[finalize] clip.created emit failed:", err);
  }

  return {
    id,
    status: "ready" as const,
    transitionedToReady: true,
    videoUrl,
    videoSizeBytes,
    sourceSizeBytes,
    durationMs: finalDurationMs,
  };
}

async function consumeHostedAllowanceIfNeeded(params: {
  id: string;
  ownerEmail: string;
  storageMode?: "own" | "hosted" | null;
  videoUrl: string;
  videoSizeBytes: number;
}): Promise<boolean> {
  if (params.storageMode !== "hosted") return true;

  const result = await consumeHostedClipRecording({
    recordingId: params.id,
    ownerEmail: params.ownerEmail,
    actualBytes: params.videoSizeBytes,
  });
  if (result.ok) return true;

  const now = new Date().toISOString();
  const failureReason =
    "This clip could not be retained because hosted Clips storage reached its limit.";
  const [failed] = await getDb()
    .update(schema.recordings)
    .set({
      status: "failed",
      failureCode: result.reason,
      failureReason,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.recordings.id, params.id),
        ownerEmailMatches(schema.recordings.ownerEmail, params.ownerEmail),
        eq(schema.recordings.status, "ready"),
      ),
    )
    .returning({ id: schema.recordings.id });
  if (!failed) return false;

  await writeAppState(`recording-upload-${params.id}`, {
    recordingId: params.id,
    status: "failed",
    failureCode: result.reason,
    failureReason,
    updatedAt: now,
  });

  let deleted = false;
  try {
    deleted = await deleteS3ObjectByUrl(params.videoUrl, {
      storageMode: "hosted",
      recordingId: params.id,
    });
  } catch (error) {
    console.error(
      "[finalize] could not remove hosted clip after quota denial",
      {
        id: params.id,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
  if (deleted) {
    await markHostedCleanupConfirmed(params.id, params.videoUrl);
    const [cleared] = await getDb()
      .update(schema.recordings)
      .set({
        videoUrl: null,
        videoSizeBytes: 0,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.recordings.id, params.id),
          ownerEmailMatches(schema.recordings.ownerEmail, params.ownerEmail),
          eq(schema.recordings.status, "failed"),
          eq(schema.recordings.videoUrl, params.videoUrl),
          notTakenDown(),
        ),
      )
      .returning({ id: schema.recordings.id });
    if (cleared) {
      await releaseHostedClipRecording({
        recordingId: params.id,
        ownerEmail: params.ownerEmail,
      });
    }
  } else {
    console.error("[finalize] hosted quota denial left media for cleanup", {
      id: params.id,
    });
  }
  return false;
}

async function retryPendingMediaVerification(params: {
  id: string;
  ownerEmail: string;
  existingTitle: string;
  media: PendingMediaVerification;
  retryAttempt: number;
  uploadAttemptId: string | null;
  uploadGenerationId: string | null;
  storageMode?: "own" | "hosted" | null;
  expectedUploadState: Record<string, unknown> | null;
  expectedVerificationState: Record<string, unknown>;
  browserSessionId?: string;
}) {
  const {
    id,
    ownerEmail,
    existingTitle,
    media,
    retryAttempt,
    uploadAttemptId,
    uploadGenerationId,
    storageMode,
    expectedUploadState,
    expectedVerificationState,
    browserSessionId,
  } = params;
  const db = getDb();
  const [recording] = await db
    .select({
      uploadAttemptId: schema.recordings.uploadAttemptId,
      uploadGenerationId: schema.recordings.uploadGenerationId,
      status: schema.recordings.status,
      videoUrl: schema.recordings.videoUrl,
      editsJson: schema.recordings.editsJson,
      storageMode: schema.recordings.storageMode,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, id),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );
  if (
    !recording ||
    recording.status !== "processing" ||
    (recording.uploadAttemptId ?? null) !== uploadAttemptId ||
    (recording.uploadGenerationId ?? null) !== uploadGenerationId
  ) {
    const aborted =
      recording?.status === "failed" && (await uploadWasAborted(id));
    return {
      id,
      status:
        recording?.status === "ready"
          ? ("ready" as const)
          : ("failed" as const),
      ...(aborted ? { aborted: true } : {}),
      videoUrl: recording?.videoUrl ?? media.videoUrl,
      videoSizeBytes: media.videoSizeBytes,
      sourceSizeBytes: media.sourceSizeBytes,
      durationMs: media.finalDurationMs,
    };
  }

  const candidate: PendingMediaVerification = {
    ...media,
    videoUrl: recording.videoUrl || media.videoUrl,
  };
  try {
    const servedBytes = await verifyServedMediaUrl(
      id,
      candidate.videoUrl,
      allowsLegacyS3ObjectForPersistedMedia({
        requestedUrl: candidate.videoUrl,
        persistedUrl: recording.videoUrl,
        editsJson: recording.editsJson,
      }),
      recording.storageMode,
    );
    const result = await markRecordingReady({
      id,
      ownerEmail,
      existingTitle,
      videoUrl: candidate.videoUrl,
      videoSizeBytes: servedBytes ?? candidate.videoSizeBytes,
      sourceSizeBytes: candidate.sourceSizeBytes,
      videoFormat: candidate.videoFormat,
      finalDurationMs: candidate.finalDurationMs,
      finalWidth: candidate.finalWidth,
      finalHeight: candidate.finalHeight,
      finalHasAudio: candidate.finalHasAudio,
      finalHasCamera: candidate.finalHasCamera,
      recordingAttemptId: uploadAttemptId,
      recordingGenerationId: uploadGenerationId,
      storageMode,
      seekableApplied: candidate.seekableApplied,
      browserSessionId,
    });
    if (result.status === "ready" && result.transitionedToReady) {
      queueBackgroundBuilderCompression({
        recordingId: id,
        ownerEmail,
        videoUrl: candidate.videoUrl,
        mimeType: candidate.mimeType,
        providerId: candidate.providerId,
        assetDbId: candidate.assetDbId,
        sourceSizeBytes: candidate.videoSizeBytes,
        locallyTranscoded: candidate.locallyTranscoded,
      });
    }
    return result;
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : String(err);
    if (retryAttempt >= MEDIA_VERIFICATION_MAX_DURABLE_ATTEMPTS) {
      const terminalReason = `${failureReason} after ${retryAttempt} durable verification attempts`;
      const failed = await failStoredButUnservableRecording({
        id,
        ownerEmail,
        uploadAttemptId,
        uploadGenerationId,
        storageMode,
        videoUrl: candidate.videoUrl,
        expectedUploadState,
        expectedVerificationState,
        failureReason: terminalReason,
        browserSessionId,
      });
      if (!failed) {
        const [resolved] = await db
          .select({
            status: schema.recordings.status,
            videoUrl: schema.recordings.videoUrl,
          })
          .from(schema.recordings)
          .where(
            and(
              eq(schema.recordings.id, id),
              ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
            ),
          );
        const aborted =
          resolved?.status === "failed" && (await uploadWasAborted(id));
        return {
          id,
          status:
            resolved?.status === "ready"
              ? ("ready" as const)
              : ("failed" as const),
          ...(aborted ? { aborted: true } : {}),
          videoUrl: resolved?.videoUrl ?? candidate.videoUrl,
          videoSizeBytes: candidate.videoSizeBytes,
          sourceSizeBytes: candidate.sourceSizeBytes,
          durationMs: candidate.finalDurationMs,
        };
      }
      return {
        id,
        status: "failed" as const,
        videoUrl: candidate.videoUrl,
        videoSizeBytes: candidate.videoSizeBytes,
        sourceSizeBytes: candidate.sourceSizeBytes,
        durationMs: candidate.finalDurationMs,
        failureReason: terminalReason,
      };
    }

    const persisted = await persistPendingMediaVerification({
      id,
      ownerEmail,
      uploadAttemptId,
      uploadGenerationId,
      expectedUploadState,
      expectedVerificationState,
      media: candidate,
      failureReason,
      retryAttempt,
    });
    if (!persisted) {
      const [resolved] = await db
        .select({
          status: schema.recordings.status,
          videoUrl: schema.recordings.videoUrl,
        })
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.id, id),
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          ),
        );
      const aborted =
        resolved?.status === "failed" && (await uploadWasAborted(id));
      return {
        id,
        status:
          resolved?.status === "ready"
            ? ("ready" as const)
            : ("failed" as const),
        ...(aborted ? { aborted: true } : {}),
        videoUrl: resolved?.videoUrl ?? candidate.videoUrl,
        videoSizeBytes: candidate.videoSizeBytes,
        sourceSizeBytes: candidate.sourceSizeBytes,
        durationMs: candidate.finalDurationMs,
      };
    }
    await dispatchMediaVerificationRetry(
      id,
      retryAttempt + 1,
      uploadAttemptId,
      uploadGenerationId,
    );
    return {
      id,
      status: "processing" as const,
      verificationPending: true,
      videoUrl: candidate.videoUrl,
      videoSizeBytes: candidate.videoSizeBytes,
      sourceSizeBytes: candidate.sourceSizeBytes,
      durationMs: candidate.finalDurationMs,
    };
  }
}

export default defineAction({
  description:
    "Assemble recorded chunks into a final video blob, upload it to the configured storage provider, update the recording row (videoUrl, durationMs, width/height/hasAudio/hasCamera), flip status to 'ready', and trigger the agent to produce a title, summary, transcript, and chapters in the background.",
  schema: z.object({
    id: z.string().describe("Recording ID to finalize"),
    durationMs: z
      .number()
      .optional()
      .describe("Final recorded duration in milliseconds"),
    width: z.number().optional().describe("Video width in pixels"),
    height: z.number().optional().describe("Video height in pixels"),
    hasAudio: z
      .union([z.boolean(), cliBoolean])
      .optional()
      .describe("Whether the recording contains audio"),
    hasCamera: z
      .union([z.boolean(), cliBoolean])
      .optional()
      .describe("Whether the recording contains a camera feed"),
    mimeType: z
      .string()
      .optional()
      .describe("MIME type of the assembled blob (e.g. video/webm)"),
    locallyTranscoded: cliBoolean
      .optional()
      .describe(
        "Whether the uploaded video bytes were already locally transcoded/compressed before upload",
      ),
    mediaVerificationRetryAttempt: z.number().int().min(1).max(10).optional(),
    uploadAttemptId: z.string().min(1).max(128).nullable().optional(),
    uploadGenerationId: z
      .string()
      .min(1)
      .max(128)
      .nullable()
      .optional()
      .describe("Upload generation that owns the scratch data being finalized"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = args.id;
    debugLog("[finalize] starting", { id, ownerEmail });

    let chunkKeysToPurge: string[] = [];
    let storageMode: "own" | "hosted" | null = null;
    let uploadAttemptId: string | null = null;
    let uploadGenerationId: string | null = null;
    try {
      let [existing] = await db
        .select()
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.id, id),
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          ),
        );

      if (!existing) {
        console.warn("[finalize] recording not found", { id, ownerEmail });
        chunkKeysToPurge = await listRecordingChunkKeys(ownerEmail, id);
        throw new Error(`Recording not found: ${id}`);
      }
      storageMode = existing.storageMode ?? null;
      uploadAttemptId = existing.uploadAttemptId ?? null;
      uploadGenerationId = existing.uploadGenerationId ?? null;
      if (existing.failureCode === "taken_down") {
        fail("Recording is no longer available", {
          errorCode: "recording_taken_down",
          statusCode: 409,
        });
      }

      const generationId = args.uploadGenerationId ?? null;
      if ((existing.uploadGenerationId ?? null) !== generationId) {
        throw new Error("Upload generation changed before finalization");
      }
      if (
        args.uploadAttemptId !== undefined &&
        (existing.uploadAttemptId ?? null) !== args.uploadAttemptId
      ) {
        throw new Error("Upload attempt changed before finalization");
      }
      if (generationId !== null && existing.status === "uploading") {
        const claimed = await db
          .update(schema.recordings)
          .set({
            status: "processing",
            uploadLeaseExpiresAt: uploadLeaseExpiry(),
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(schema.recordings.id, id),
              ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
              eq(schema.recordings.status, "uploading"),
              existing.uploadAttemptId === null
                ? isNull(schema.recordings.uploadAttemptId)
                : eq(
                    schema.recordings.uploadAttemptId,
                    existing.uploadAttemptId,
                  ),
              eq(schema.recordings.uploadGenerationId, generationId),
            ),
          )
          .returning();
        if (claimed.length !== 1) {
          throw new Error("Upload changed before finalization could claim it");
        }
        existing = claimed[0]!;
      }

      if (existing.status === "ready" && existing.videoUrl) {
        debugLog("[finalize] already finalized, returning existing", { id });
        if (
          !(await consumeHostedAllowanceIfNeeded({
            id,
            ownerEmail,
            storageMode: existing.storageMode,
            videoUrl: existing.videoUrl,
            videoSizeBytes: existing.videoSizeBytes ?? 0,
          }))
        ) {
          return {
            id,
            status: "failed" as const,
            failureCode: "global_storage_cap",
          };
        }
        await queueReadyRecordingThumbnail(id);
        await deleteResumableSession(id, generationId).catch((err) =>
          console.warn("[finalize] failed to delete resumable session:", err),
        );
        await deleteAppState(mediaVerificationStateKey(id)).catch(() => {});
        const readyState = await readAppState(`recording-upload-${id}`);
        return {
          id,
          status: "ready" as const,
          videoUrl: existing.videoUrl,
          videoSizeBytes: existing.videoSizeBytes ?? 0,
          // The received bytes, never the served size: a client compares this
          // with its local copy, and 0 reads as "unverified", not a mismatch.
          sourceSizeBytes:
            stateNumber(
              readyState && typeof readyState === "object"
                ? (readyState as Record<string, unknown>)
                : null,
              "sourceSizeBytes",
            ) ?? 0,
          durationMs: existing.durationMs ?? 0,
        };
      }

      const uploadStateRaw = await readAppState(`recording-upload-${id}`);
      const uploadState =
        uploadStateRaw && typeof uploadStateRaw === "object"
          ? (uploadStateRaw as Record<string, unknown>)
          : null;
      const verificationStateRaw = await readAppState(
        mediaVerificationStateKey(id),
      );
      let verificationExpectedUploadState = uploadState;
      const mimeType =
        args.mimeType ||
        (typeof uploadState?.mimeType === "string"
          ? uploadState.mimeType
          : "") ||
        "video/webm";
      const videoFormat: "webm" | "mp4" =
        mimeType.includes("mp4") || mimeType.includes("quicktime")
          ? "mp4"
          : "webm";
      const finalDurationMs =
        args.durationMs ??
        stateNumber(uploadState, "durationMs") ??
        existing.durationMs ??
        0;
      const finalWidth =
        args.width ?? stateNumber(uploadState, "width") ?? existing.width ?? 0;
      const finalHeight =
        args.height ??
        stateNumber(uploadState, "height") ??
        existing.height ??
        0;
      const finalHasAudio =
        typeof args.hasAudio === "boolean"
          ? args.hasAudio
          : (stateBoolean(uploadState, "hasAudio") ?? existing.hasAudio);
      const finalHasCamera =
        typeof args.hasCamera === "boolean"
          ? args.hasCamera
          : (stateBoolean(uploadState, "hasCamera") ?? existing.hasCamera);

      const readyParams = {
        id,
        ownerEmail,
        videoFormat,
        finalDurationMs,
        finalWidth,
        finalHeight,
        finalHasAudio,
        finalHasCamera,
        recordingAttemptId:
          args.uploadAttemptId !== undefined
            ? args.uploadAttemptId
            : (existing.uploadAttemptId ?? null),
        recordingGenerationId: generationId,
        storageMode: existing.storageMode,
        existingTitle: existing.title,
        browserSessionId:
          recordingUploadBrowserSessionId(uploadState, {
            recordingId: id,
            uploadAttemptId:
              args.uploadAttemptId !== undefined
                ? args.uploadAttemptId
                : (existing.uploadAttemptId ?? null),
            uploadGenerationId: generationId,
          }) ?? getRequestContext()?.browserSessionId,
      };

      const pendingMedia = pendingMediaVerificationFromState(uploadState);
      if (existing.status === "processing" && pendingMedia) {
        const retryAttempt =
          args.mediaVerificationRetryAttempt ??
          stateNumber(uploadState, "mediaVerificationAttempt") ??
          1;
        const claimed = await claimPendingMediaVerification({
          id,
          retryAttempt,
          uploadAttemptId: existing.uploadAttemptId ?? null,
          uploadGenerationId: generationId,
          expectedState:
            verificationStateRaw && typeof verificationStateRaw === "object"
              ? (verificationStateRaw as Record<string, unknown>)
              : null,
        });
        if (!claimed) {
          return {
            id,
            status: "processing" as const,
            verificationPending: true,
            videoUrl: pendingMedia.videoUrl,
            videoSizeBytes: pendingMedia.videoSizeBytes,
            sourceSizeBytes: pendingMedia.sourceSizeBytes,
            durationMs: pendingMedia.finalDurationMs,
          };
        }
        return retryPendingMediaVerification({
          id,
          ownerEmail,
          existingTitle: existing.title,
          media: pendingMedia,
          retryAttempt,
          uploadAttemptId: existing.uploadAttemptId ?? null,
          uploadGenerationId: generationId,
          storageMode: existing.storageMode,
          expectedUploadState: uploadState,
          expectedVerificationState: claimed,
          browserSessionId:
            stateString(claimed, "browserSessionId") ??
            recordingUploadBrowserSessionId(uploadState, {
              recordingId: id,
              uploadAttemptId: existing.uploadAttemptId ?? null,
              uploadGenerationId: generationId,
            }) ??
            getRequestContext()?.browserSessionId,
        });
      }

      const resumableSession = await getResumableSession(id, generationId);
      if (resumableSession && isStreamingUploadDisabled()) {
        console.warn(
          `[finalize] streaming uploads are disabled, but completing existing resumable session for in-flight recording: ${id}`,
        );
      }
      if (resumableSession) {
        debugLog("[finalize] resumable session found, completing upload", {
          id,
          providerId: resumableSession.providerId,
        });
        if (
          existing.status === "failed" &&
          typeof existing.failureReason === "string" &&
          isStoredButUnservableFinalizeError(existing.failureReason)
        ) {
          const recoveryStartedAt = new Date().toISOString();
          const [recoveredRecording] = await db
            .update(schema.recordings)
            .set({
              status: "processing",
              failureReason: null,
              failureCode: null,
              updatedAt: recoveryStartedAt,
            })
            .where(
              and(
                eq(schema.recordings.id, id),
                ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
                eq(schema.recordings.status, "failed"),
                notTakenDown(),
                eq(schema.recordings.failureReason, existing.failureReason),
                existing.uploadAttemptId
                  ? eq(
                      schema.recordings.uploadAttemptId,
                      existing.uploadAttemptId,
                    )
                  : isNull(schema.recordings.uploadAttemptId),
                generationId
                  ? eq(schema.recordings.uploadGenerationId, generationId)
                  : isNull(schema.recordings.uploadGenerationId),
              ),
            )
            .returning({ id: schema.recordings.id });
          if (!recoveredRecording) {
            throw new Error("Recording changed before finalize recovery");
          }
          const recoveredUploadState = {
            ...(uploadState ?? {}),
            recordingId: id,
            status: "processing",
            uploadAttemptId: existing.uploadAttemptId ?? null,
            uploadGenerationId: generationId,
            failureReason: null,
            failureCode: null,
            updatedAt: recoveryStartedAt,
          };
          const recoveredStateWritten =
            await compareAndSetProcessingUploadState({
              id,
              ownerEmail,
              uploadAttemptId: existing.uploadAttemptId ?? null,
              uploadGenerationId: generationId,
              expectedState: uploadState,
              nextState: recoveredUploadState,
            });
          if (!recoveredStateWritten) {
            throw new Error(
              "Upload changed before finalize state was published",
            );
          }
          verificationExpectedUploadState = recoveredUploadState;
        }
        if (existing.status !== "processing" && existing.status !== "failed") {
          const processingStartedAt = new Date().toISOString();
          await db
            .update(schema.recordings)
            .set({
              status: "processing",
              failureReason: null,
              failureCode: null,
              uploadProgress: 100,
              updatedAt: processingStartedAt,
            })
            .where(
              and(
                eq(schema.recordings.id, id),
                ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
                eq(schema.recordings.status, existing.status),
                notTakenDown(),
              ),
            );
        }
        const uploadProvider = await resolveResumableUploadProvider(
          resumableSession.providerId,
        );
        if (!uploadProvider?.resumable) {
          throw new Error(
            "Upload completion failed: No resumable upload provider configured",
          );
        }
        if (resumableSession.bytesUploaded <= 0) {
          const cleaned = await abortResumableUploadSession(resumableSession, {
            provider: uploadProvider,
            label: `finalize-${id}`,
          });
          if (cleaned) {
            await deleteResumableSession(id, generationId).catch((deleteErr) =>
              console.warn(
                "[finalize] failed to retire empty resumable session:",
                deleteErr,
              ),
            );
            if (existing.storageMode === "hosted") {
              const now = new Date().toISOString();
              const failureReason = retryableUploadInterruptionReason(
                "Recording upload contained no video bytes",
              );
              const [failed] = await db
                .update(schema.recordings)
                .set({
                  status: "failed",
                  failureCode: "empty_upload",
                  failureReason,
                  uploadProgress: 0,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(schema.recordings.id, id),
                    ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
                    eq(schema.recordings.status, existing.status),
                    notTakenDown(),
                    existing.uploadAttemptId
                      ? eq(
                          schema.recordings.uploadAttemptId,
                          existing.uploadAttemptId,
                        )
                      : isNull(schema.recordings.uploadAttemptId),
                    generationId
                      ? eq(schema.recordings.uploadGenerationId, generationId)
                      : isNull(schema.recordings.uploadGenerationId),
                  ),
                )
                .returning({ id: schema.recordings.id });
              if (failed) {
                const failedUploadState = {
                  ...(uploadState ?? {}),
                  recordingId: id,
                  status: "failed",
                  failureCode: "empty_upload",
                  failureReason,
                  retryableInterruption: true,
                  updatedAt: now,
                };
                const statePublished = await compareAndSetAppState(
                  `recording-upload-${id}`,
                  uploadState,
                  failedUploadState,
                );
                if (statePublished) {
                  await markHostedCleanupConfirmed(id);
                  await releaseHostedClipRecording({
                    recordingId: id,
                    ownerEmail,
                  });
                }
              }
            }
          }
          throw new Error(
            "Upload completion failed: Recording upload contained no video bytes",
          );
        }

        let videoUrl: string;
        try {
          videoUrl = await uploadProvider.resumable.completeSession(
            {
              sessionId: resumableSession.sessionId,
              meta: resumableSession.meta,
            },
            typeof resumableSession.meta.filename === "string"
              ? resumableSession.meta.filename
              : "",
            { stableUrl: true, recordAsset: false },
          );
        } catch (err) {
          const cleaned = await abortResumableUploadSession(resumableSession, {
            provider: uploadProvider,
            label: `finalize-${id}`,
          });
          if (cleaned && existing.storageMode !== "hosted") {
            await deleteResumableSession(id, generationId).catch((deleteErr) =>
              console.warn(
                "[finalize] failed to retire aborted resumable session:",
                deleteErr,
              ),
            );
          } else if (existing.storageMode === "hosted") {
            console.error(
              "[finalize] hosted completion outcome is ambiguous; keeping its reservation and session state",
              { id, sessionCleanupConfirmed: cleaned },
            );
          }
          console.error("[finalize] resumable complete failed:", err);
          const wrapped = new Error(
            `Upload completion failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          Object.assign(wrapped, { cause: err });
          throw wrapped;
        }

        debugLog("[finalize] resumable upload completed", { id, videoUrl });
        let servedBytes: number | null;
        try {
          servedBytes = await verifyServedMediaUrl(
            id,
            videoUrl,
            true,
            existing.storageMode,
          );
        } catch (err) {
          const failureReason =
            err instanceof Error ? err.message : String(err);
          const pending = await leaveRecordingProcessingForMediaVerification({
            id,
            ownerEmail,
            uploadAttemptId: existing.uploadAttemptId ?? null,
            uploadGenerationId: generationId,
            expectedUploadState: verificationExpectedUploadState,
            expectedVerificationState:
              verificationStateRaw && typeof verificationStateRaw === "object"
                ? (verificationStateRaw as Record<string, unknown>)
                : null,
            failureReason,
            media: {
              videoUrl,
              videoSizeBytes: resumableSession.bytesUploaded,
              sourceSizeBytes: resumableSession.bytesUploaded,
              videoFormat,
              finalDurationMs,
              finalWidth,
              finalHeight,
              finalHasAudio,
              finalHasCamera,
              seekableApplied: false,
              mimeType,
              providerId: resumableSession.providerId,
              locallyTranscoded: args.locallyTranscoded === true,
            },
          });
          await deleteResumableSession(id, generationId).catch((deleteErr) =>
            console.warn(
              "[finalize] failed to retire pending resumable session:",
              deleteErr,
            ),
          );
          return pending;
        }
        const result = await markRecordingReady({
          ...readyParams,
          videoUrl,
          videoSizeBytes: servedBytes ?? resumableSession.bytesUploaded,
          sourceSizeBytes: resumableSession.bytesUploaded,
          seekableApplied: false,
        });
        if (result.status === "ready" && result.transitionedToReady) {
          queueBackgroundBuilderCompression({
            recordingId: id,
            ownerEmail,
            videoUrl,
            mimeType,
            providerId: resumableSession.providerId,
            sourceSizeBytes: resumableSession.bytesUploaded,
            locallyTranscoded: args.locallyTranscoded === true,
          });
        }
        deleteResumableSession(id, generationId).catch((err) =>
          console.warn("[finalize] failed to delete resumable session:", err),
        );
        return result;
      }

      const compressionRaw = await readAppState(`recording-compression-${id}`);
      const compressionMeta: {
        originalBytes?: number;
        compressedBytes?: number;
        ratio?: number;
        elapsedMs?: number;
        outputMimeType?: string;
      } | null =
        compressionRaw && typeof compressionRaw === "object"
          ? (compressionRaw as {
              originalBytes?: number;
              compressedBytes?: number;
              ratio?: number;
              elapsedMs?: number;
              outputMimeType?: string;
            })
          : null;

      const [processingRecording] = await db
        .update(schema.recordings)
        .set({
          status: "processing",
          uploadProgress: 100,
          mediaUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.recordings.id, id),
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
            eq(schema.recordings.status, existing.status),
            notTakenDown(),
            existing.uploadAttemptId
              ? eq(schema.recordings.uploadAttemptId, existing.uploadAttemptId)
              : isNull(schema.recordings.uploadAttemptId),
            generationId
              ? eq(schema.recordings.uploadGenerationId, generationId)
              : isNull(schema.recordings.uploadGenerationId),
          ),
        )
        .returning({ id: schema.recordings.id });
      if (!processingRecording) {
        throw new Error(
          "Upload changed before buffered chunks could be assembled",
        );
      }

      const uploadBrowserSessionId = recordingUploadBrowserSessionId(
        uploadState,
        {
          recordingId: id,
          uploadAttemptId: existing.uploadAttemptId ?? null,
          uploadGenerationId: generationId,
        },
      );
      const processingUploadState = {
        recordingId: id,
        status: "processing",
        progress: 100,
        uploadAttemptId: existing.uploadAttemptId ?? null,
        uploadGenerationId: generationId,
        ...(uploadBrowserSessionId
          ? { browserSessionId: uploadBrowserSessionId }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      const processingStateWritten = await compareAndSetProcessingUploadState({
        id,
        ownerEmail,
        uploadAttemptId: existing.uploadAttemptId ?? null,
        uploadGenerationId: generationId,
        expectedState: uploadState,
        nextState: processingUploadState,
      });
      if (!processingStateWritten) {
        throw new Error("Upload changed before buffered state was published");
      }
      verificationExpectedUploadState = processingUploadState;

      const failChunkAssembly = async (
        failureReason: string,
        failureCode:
          | "chunk_assembly_failed"
          | "recording_too_large" = "chunk_assembly_failed",
      ): Promise<never> => {
        const now = new Date().toISOString();
        const [failedRecording] = await db
          .update(schema.recordings)
          .set({
            status: "failed",
            failureCode,
            failureReason,
            mediaUpdatedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.recordings.id, id),
              ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
              eq(schema.recordings.status, "processing"),
              existing.uploadAttemptId
                ? eq(
                    schema.recordings.uploadAttemptId,
                    existing.uploadAttemptId,
                  )
                : isNull(schema.recordings.uploadAttemptId),
              generationId
                ? eq(schema.recordings.uploadGenerationId, generationId)
                : isNull(schema.recordings.uploadGenerationId),
            ),
          )
          .returning({
            uploadAttemptId: schema.recordings.uploadAttemptId,
            recordingPlatform: schema.recordings.recordingPlatform,
          });
        if (failedRecording)
          trackUploadBlockingFailure({
            id,
            ownerEmail,
            uploadAttemptId: failedRecording.uploadAttemptId,
            recordingPlatform: failedRecording.recordingPlatform,
            failureCode,
            failureType:
              failureCode === "recording_too_large"
                ? "size_limit"
                : "finalize_error",
          });
        if (failedRecording)
          trackRecordingFailure({
            recordingId: id,
            userId: ownerEmail,
            uploadAttemptId: failedRecording?.uploadAttemptId,
            platform: failedRecording?.recordingPlatform,
            failureCode,
          });
        if (failedRecording && existing.storageMode === "hosted") {
          await markHostedCleanupConfirmed(id);
          await releaseHostedClipRecording({
            recordingId: id,
            ownerEmail,
          });
        }
        if (failedRecording)
          await compareAndSetAppState(
            `recording-upload-${id}`,
            processingUploadState,
            {
              ...processingUploadState,
              status: "failed",
              failureReason,
              updatedAt: now,
            },
          );
        throw new Error(failureReason);
      };

      const chunkKeys = await listRecordingChunkKeys(
        ownerEmail,
        id,
        generationId,
      );
      const expectedDataChunks = stateNumber(uploadState, "expectedDataChunks");
      debugLog("[finalize] chunks found", {
        id,
        count: chunkKeys.length,
        expectedDataChunks,
      });
      chunkKeysToPurge = chunkKeys;

      if (chunkKeys.length === 0) {
        await failChunkAssembly(`No chunks found for recording ${id}`);
      }

      let chunkSequence: ReturnType<typeof validateRecordingChunkKeys>;
      try {
        chunkSequence = validateRecordingChunkKeys(
          chunkKeys,
          expectedDataChunks,
        );
      } catch (err) {
        await failChunkAssembly(
          err instanceof Error
            ? err.message
            : "Recording upload is incomplete. Please retry the recording.",
        );
        throw new Error("Unreachable chunk validation failure");
      }

      const parts: Uint8Array[] = [];
      for (const { key, index } of chunkSequence) {
        const entry = await readAppState(key);
        const b64 = typeof entry?.data === "string" ? entry.data : null;
        if (!b64) {
          await failChunkAssembly(
            `Recording chunk ${index} is missing upload data. Please retry the recording.`,
          );
        }

        const entryIndex = stateNumber(entry, "index");
        if (entryIndex !== undefined && entryIndex !== index) {
          await failChunkAssembly(
            `Recording chunk metadata mismatch for chunk ${index}. Please retry the recording.`,
          );
        }

        const bytes = b64ToBytes(b64!);
        const expectedBytes = stateNumber(entry, "bytes");
        if (
          typeof expectedBytes === "number" &&
          bytes.byteLength !== expectedBytes
        ) {
          await failChunkAssembly(
            `Recording chunk ${index} is incomplete (${bytes.byteLength} of ${expectedBytes} bytes). Please retry the recording.`,
          );
        }
        parts.push(bytes);
      }
      const assembled = concatBytes(parts);
      const maxUploadBytes =
        existing.storageMode === "hosted"
          ? getAppConfig().clips.hostedStorage.maxClipBytes
          : MAX_RECORDING_UPLOAD_BYTES;
      if (assembled.byteLength > maxUploadBytes) {
        await failChunkAssembly(
          existing.storageMode === "hosted"
            ? recordingTooLargeReason(maxUploadBytes)
            : RECORDING_TOO_LARGE_REASON,
          "recording_too_large",
        );
      }
      parts.length = 0;

      let uploadData = assembled;
      let seekableApplied = false;
      if (videoFormat === "mp4") {
        try {
          uploadData = applyFaststart(assembled);
          if (uploadData !== assembled) {
            debugLog("[finalize] faststart applied", { id });
          }
        } catch (err) {
          console.warn("[finalize] faststart failed, uploading as-is", {
            id,
            err: err instanceof Error ? err.message : String(err),
          });
          uploadData = assembled;
        }

        if (!hasPlayableMp4Metadata(uploadData)) {
          const err = new Error(
            "Recorded MP4 is corrupted or incomplete and cannot be recovered. Please record again.",
          );
          try {
            captureRouteError(err, {
              route: "finalize-recording",
              tags: {
                uploadStep: "mp4-validation",
                videoFormat,
              },
              extra: {
                recordingId: id,
                dataBytes: uploadData.byteLength,
                mimeType,
                ownerEmail,
              },
            });
          } catch {
            // Sentry must never mask the real validation error.
          }
          throw err;
        }
        seekableApplied = true;
      } else if (videoFormat === "webm") {
        if (assembled.byteLength <= inlineRemuxMaxBytes()) {
          try {
            const seekable = await remuxWebmToSeekable(uploadData);
            if (seekable.changed) {
              uploadData = seekable.bytes;
              seekableApplied = true;
              debugLog("[finalize] webm remux applied", {
                id,
                bytes: uploadData.byteLength,
              });
            }
          } catch (err) {
            console.warn("[finalize] webm remux failed, uploading as-is", {
              id,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      let correctedHasAudio = finalHasAudio;
      if (finalHasAudio) {
        const assembledHasAudio = await probeHasAudioStream(
          assembled,
          videoFormat,
        ).catch(() => null);

        if (assembledHasAudio === false) {
          console.warn(
            "[finalize] recording claimed audio but assembled bytes have none; correcting hasAudio",
            { id, videoFormat },
          );
          try {
            captureRouteError(
              new Error(
                "Recording was reported to have audio, but the assembled upload has no audio track.",
              ),
              {
                route: "finalize-recording",
                tags: {
                  uploadStep: "audio-claimed-but-missing",
                  videoFormat,
                },
                extra: {
                  recordingId: id,
                  dataBytes: assembled.byteLength,
                  mimeType,
                  ownerEmail,
                },
              },
            );
          } catch {
            // Sentry must never mask the real capture-side issue.
          }
          correctedHasAudio = false;
        } else if (assembledHasAudio === true && uploadData !== assembled) {
          const uploadHasAudio = await probeHasAudioStream(
            uploadData,
            videoFormat,
          ).catch(() => null);
          if (uploadHasAudio === false) {
            const err = new Error(
              "Recording had an audio track before the seekable rewrite, but the rewritten video has no audio track. Please record again.",
            );
            try {
              captureRouteError(err, {
                route: "finalize-recording",
                tags: {
                  uploadStep: "audio-dropped-by-remux",
                  videoFormat,
                },
                extra: {
                  recordingId: id,
                  dataBytes: uploadData.byteLength,
                  mimeType,
                  ownerEmail,
                },
              });
            } catch {
              // Sentry must never mask the real validation error.
            }
            await failChunkAssembly(err.message);
          }
        }
      }

      let upload: Awaited<ReturnType<typeof uploadFile>>;
      try {
        const uploadInput = {
          data: uploadData,
          filename: `${id}.${videoFormat}`,
          mimeType,
          ownerEmail,
          stableUrl: true,
          recordAsset: false,
        };
        upload =
          existing.storageMode === "hosted"
            ? await clipsHostedFileUploadProvider.upload(uploadInput)
            : await uploadFile(uploadInput);
      } catch (err) {
        if (
          !(existing.storageMode === "hosted" && hostedStorageAuthFailure(err))
        ) {
          try {
            captureRouteError(err, {
              route: "finalize-recording",
              tags: {
                uploadStep: "finalize-upload",
                videoFormat,
              },
              extra: {
                recordingId: id,
                dataBytes: uploadData.byteLength,
                mimeType,
                videoFormat,
                ownerEmail,
                originalBytes:
                  compressionMeta?.originalBytes ?? assembled.byteLength,
                compressedBytes: compressionMeta?.compressedBytes,
                compressionRatio: compressionMeta?.ratio,
                compressionElapsedMs: compressionMeta?.elapsedMs,
                compressionOutputMimeType: compressionMeta?.outputMimeType,
                compressionRan: !!compressionMeta,
              },
            });
          } catch {
            // Sentry must never mask the real upload error.
          }
        }
        throw err;
      }

      if (upload === null) {
        const now = new Date().toISOString();
        if (requiresConfiguredVideoStorage()) {
          const [failedRecording] = await db
            .update(schema.recordings)
            .set({
              status: "failed",
              failureCode: "storage_setup_required",
              failureReason: STORAGE_SETUP_REQUIRED_REASON,
              durationMs: finalDurationMs,
              width: finalWidth,
              height: finalHeight,
              hasAudio: finalHasAudio,
              hasCamera: finalHasCamera,
              uploadProgress: 0,
              mediaUpdatedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.recordings.id, id),
                ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
                eq(schema.recordings.status, "processing"),
                existing.uploadAttemptId
                  ? eq(
                      schema.recordings.uploadAttemptId,
                      existing.uploadAttemptId,
                    )
                  : isNull(schema.recordings.uploadAttemptId),
                generationId
                  ? eq(schema.recordings.uploadGenerationId, generationId)
                  : isNull(schema.recordings.uploadGenerationId),
              ),
            )
            .returning({
              uploadAttemptId: schema.recordings.uploadAttemptId,
              recordingPlatform: schema.recordings.recordingPlatform,
            });
          if (!failedRecording) {
            const [current] = await db
              .select({ failureCode: schema.recordings.failureCode })
              .from(schema.recordings)
              .where(
                and(
                  eq(schema.recordings.id, id),
                  ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
                ),
              );
            if (current?.failureCode === "user_cancelled") {
              return {
                id,
                status: "failed" as const,
                aborted: true,
                storageSetupRequired: false,
                failureReason: "Recording cancelled by user",
                durationMs: finalDurationMs,
              };
            }
            throw new Error(
              "Recording changed before storage failure was saved",
            );
          }
          trackUploadBlockingFailure({
            id,
            ownerEmail,
            uploadAttemptId: failedRecording.uploadAttemptId,
            recordingPlatform: failedRecording.recordingPlatform,
            failureCode: "storage_setup_required",
            failureType: "storage_error",
          });
          trackRecordingFailure({
            recordingId: id,
            userId: ownerEmail,
            uploadAttemptId: failedRecording?.uploadAttemptId,
            platform: failedRecording?.recordingPlatform,
            failureCode: "storage_setup_required",
          });

          await writeAppState(`recording-upload-${id}`, {
            recordingId: id,
            status: "failed",
            failureReason: STORAGE_SETUP_REQUIRED_REASON,
            storageSetupRequired: true,
            progress: 0,
            updatedAt: now,
          });
          await writeAppState("refresh-signal", { ts: Date.now() });

          return {
            id,
            status: "failed" as const,
            storageSetupRequired: true,
            failureReason: STORAGE_SETUP_REQUIRED_REASON,
            durationMs: finalDurationMs,
          };
        }

        const [waitingStorageRecording] = await db
          .update(schema.recordings)
          .set({
            status: "uploading",
            failureReason: STORAGE_SETUP_REQUIRED_REASON,
            uploadLeaseExpiresAt: waitingStorageLeaseExpiry(),
            durationMs: finalDurationMs,
            width: finalWidth,
            height: finalHeight,
            hasAudio: finalHasAudio,
            hasCamera: finalHasCamera,
            uploadProgress: 100,
            mediaUpdatedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.recordings.id, id),
              ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
              eq(schema.recordings.status, "processing"),
              existing.uploadAttemptId === null
                ? isNull(schema.recordings.uploadAttemptId)
                : eq(
                    schema.recordings.uploadAttemptId,
                    existing.uploadAttemptId,
                  ),
              generationId === null
                ? isNull(schema.recordings.uploadGenerationId)
                : eq(schema.recordings.uploadGenerationId, generationId),
            ),
          )
          .returning({ id: schema.recordings.id });
        if (!waitingStorageRecording) {
          throw new Error("Recording changed before waiting storage was saved");
        }

        const waitingStorageState = {
          ...processingUploadState,
          status: "waiting_storage",
          failureReason: STORAGE_SETUP_REQUIRED_REASON,
          storageSetupRequired: true,
          pendingMediaVerification: false,
          progress: 100,
          chunksReceived: chunkKeys.length,
          totalChunks: chunkKeys.length,
          mimeType,
          durationMs: finalDurationMs,
          width: finalWidth,
          height: finalHeight,
          hasAudio: finalHasAudio,
          hasCamera: finalHasCamera,
          updatedAt: now,
        };
        const waitingStoragePublished = await compareAndSetManyAppState([
          {
            key: `recording-upload-${id}`,
            expectedValue: processingUploadState,
            nextValue: waitingStorageState,
          },
          ...(verificationStateRaw && typeof verificationStateRaw === "object"
            ? [
                {
                  key: mediaVerificationStateKey(id),
                  expectedValue: verificationStateRaw as Record<
                    string,
                    unknown
                  >,
                  nextValue: null,
                },
              ]
            : []),
        ]);
        if (!waitingStoragePublished) {
          throw new Error(
            "Upload changed before waiting storage state was published",
          );
        }
        await writeAppState("refresh-signal", { ts: Date.now() });

        chunkKeysToPurge = [];

        return {
          id,
          status: "waiting_storage" as const,
          storageSetupRequired: true,
          failureReason: STORAGE_SETUP_REQUIRED_REASON,
          durationMs: finalDurationMs,
        };
      }

      if (!upload?.url) {
        const err = new Error(
          "File upload returned no URL. Check your storage provider configuration.",
        );
        try {
          captureRouteError(err, {
            route: "finalize-recording",
            tags: {
              uploadStep: "finalize-upload",
              videoFormat,
              uploadResult: "no-url",
            },
            extra: {
              recordingId: id,
              dataBytes: uploadData.byteLength,
              mimeType,
              videoFormat,
              ownerEmail,
              uploadShape: "object-without-url",
            },
          });
        } catch {
          // Sentry must never mask the real error.
        }
        throw err;
      }

      debugLog("[finalize] done", {
        id,
        videoUrl: upload.url,
        bytes: uploadData.byteLength,
      });
      let servedBytes: number | null;
      try {
        servedBytes = await verifyServedMediaUrl(
          id,
          upload.url,
          true,
          existing.storageMode,
        );
      } catch (err) {
        const failureReason = err instanceof Error ? err.message : String(err);
        return await leaveRecordingProcessingForMediaVerification({
          id,
          ownerEmail,
          uploadAttemptId: readyParams.recordingAttemptId,
          uploadGenerationId: readyParams.recordingGenerationId,
          expectedUploadState: verificationExpectedUploadState,
          expectedVerificationState:
            verificationStateRaw && typeof verificationStateRaw === "object"
              ? (verificationStateRaw as Record<string, unknown>)
              : null,
          failureReason,
          media: {
            videoUrl: upload.url,
            videoSizeBytes: uploadData.byteLength,
            sourceSizeBytes: assembled.byteLength,
            videoFormat,
            finalDurationMs,
            finalWidth,
            finalHeight,
            finalHasAudio: correctedHasAudio,
            finalHasCamera,
            seekableApplied,
            mimeType,
            providerId: upload.provider,
            assetDbId: upload.id,
            locallyTranscoded:
              args.locallyTranscoded === true || Boolean(compressionMeta),
          },
        });
      }
      const result = await markRecordingReady({
        ...readyParams,
        finalHasAudio: correctedHasAudio,
        videoUrl: upload.url,
        videoSizeBytes: servedBytes ?? uploadData.byteLength,
        sourceSizeBytes: assembled.byteLength,
        seekableApplied,
      });
      if (result.status === "ready" && result.transitionedToReady) {
        queueBackgroundBuilderCompression({
          recordingId: id,
          ownerEmail,
          videoUrl: upload.url,
          mimeType,
          providerId: upload.provider,
          assetDbId: upload.id,
          sourceSizeBytes: uploadData.byteLength,
          locallyTranscoded:
            args.locallyTranscoded === true || Boolean(compressionMeta),
        });
      }
      return result;
    } catch (error) {
      const authFailure =
        storageMode === "hosted" ? hostedStorageAuthFailure(error) : null;
      if (!authFailure) throw error;

      const failedAt = new Date().toISOString();
      try {
        captureError(error, {
          route: "/_agent-native/actions/finalize-recording",
          errorMessagePolicy: "omit",
          tags: {
            area: "clips-storage",
            source: "clips-hosted-storage",
            storageMode: "hosted",
            errorCode: "hosted_storage_unavailable",
            reportExpected: "true",
            ...(authFailure.status
              ? { providerStatus: String(authFailure.status) }
              : {}),
          },
          extra: { recordingId: id },
        });
      } catch {
        // Error reporting must never change the upload result.
      }
      try {
        await db
          .update(schema.recordings)
          .set({
            failureCode: "hosted_storage_unavailable",
            failureReason: HOSTED_STORAGE_UNAVAILABLE_REASON,
            updatedAt: failedAt,
          })
          .where(
            and(
              eq(schema.recordings.id, id),
              ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
              inArray(schema.recordings.status, ["uploading", "processing"]),
              uploadAttemptId === null
                ? isNull(schema.recordings.uploadAttemptId)
                : eq(schema.recordings.uploadAttemptId, uploadAttemptId),
              uploadGenerationId === null
                ? isNull(schema.recordings.uploadGenerationId)
                : eq(schema.recordings.uploadGenerationId, uploadGenerationId),
            ),
          );
      } catch (persistError) {
        console.error("[finalize] hosted storage failure could not be saved", {
          id,
          error:
            persistError instanceof Error
              ? persistError.message
              : String(persistError),
        });
      }

      throw Object.assign(new Error(HOSTED_STORAGE_UNAVAILABLE_REASON), {
        cause: error,
        errorCode: "hosted_storage_unavailable",
        statusCode: 503,
      });
    } finally {
      if (chunkKeysToPurge.length > 0) {
        let purged = 0;
        for (const key of chunkKeysToPurge) {
          try {
            await deleteAppState(key);
            purged += 1;
          } catch (err) {
            console.warn("[finalize] chunk delete failed", {
              key,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
        debugLog("[finalize] chunks purged", {
          id,
          purged,
          attempted: chunkKeysToPurge.length,
        });
      }
      try {
        await deleteAppState(`recording-compression-${id}`);
      } catch (err) {
        console.warn("[finalize] compression key delete failed", {
          id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
});
