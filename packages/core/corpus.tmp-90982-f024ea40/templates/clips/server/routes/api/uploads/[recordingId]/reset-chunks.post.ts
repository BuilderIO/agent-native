/**
 * Reset chunk scratch space for a recording without aborting the recording
 * itself. Used by the recorder when it needs to discard the chunks it
 * already streamed up (because they're going to be replaced with a
 * compressed blob) — without flipping the row to `failed`, which is what
 * `abort.post.ts` does.
 *
 * Optionally accepts compression metadata in the body — surfaced into
 * `recording-compression-{id}` (a separate sub-key from
 * `recording-upload-{id}`) so:
 *   1. `finalize-recording` can include it in `captureRouteError` extras
 *      (so Sentry tells us originalBytes / compressedBytes / ratio if the
 *      Builder.io upload still fails after compression).
 *   2. The library card can show "Compressed from XXX MB" if we want to
 *      surface that in the UI later.
 *
 * The dedicated sub-key is important: the recorder's own `onChunk`
 * callback overwrites `recording-upload-{id}` whole-cloth on every chunk
 * upload (it's the simplest way to drive the progress poller), so storing
 * compression metadata there would have it clobbered the moment the
 * post-compression re-upload starts. The separate key is read-only from
 * the compression path's perspective.
 *
 * Route: POST /api/uploads/:recordingId/reset-chunks
 */

import {
  writeAppState,
  deleteAppStateByPrefix,
} from "@agent-native/core/application-state";
import { getActiveFileUploadProviderForRequest } from "@agent-native/core/file-upload";
import { runWithRequestContext } from "@agent-native/core/server";
import type { UploadMode } from "@shared/recording-core.js";
import { MAX_UPLOAD_BYTES as MAX_RECORDING_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { and, eq } from "drizzle-orm";
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
  deleteResumableSession,
  setResumableSession,
} from "../../../../lib/resumable-session.js";
import { shouldEnableStreamingUpload } from "../../../../lib/streaming-upload-mode.js";
import { allowsSqlRecordingChunkScratch } from "../../../../lib/video-storage.js";

interface CompressionMeta {
  originalBytes?: number;
  compressedBytes?: number;
  ratio?: number;
  elapsedMs?: number;
  outputMimeType?: string;
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

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  const { userEmail: ownerEmail, orgId } = await getEventOwnerContext(event);
  const body = (await readBody(event).catch(() => null)) as {
    compression?: CompressionMeta | null;
    requestStreaming?: boolean;
    mimeType?: string;
  } | null;

  // Sanitize compression metadata. The recorder is the only client we trust
  // here, but the values land in Sentry extras — so we still bound them to
  // numbers / strings to avoid surprise.
  const compression: CompressionMeta | null = body?.compression
    ? {
        originalBytes: pickNumber(body.compression.originalBytes),
        compressedBytes: pickNumber(body.compression.compressedBytes),
        ratio: pickNumber(body.compression.ratio),
        elapsedMs: pickNumber(body.compression.elapsedMs),
        outputMimeType: pickString(body.compression.outputMimeType, 120),
      }
    : null;

  return runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
    const db = getDb();

    const [existing] = await db
      .select({ id: schema.recordings.id })
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

    const cleared = await deleteAppStateByPrefix(
      `recording-chunks-${recordingId}-`,
    );
    // Clear any stale resumable session so a buffered retry does not
    // accidentally route through handleResumableChunk with stale offsets.
    await deleteResumableSession(recordingId).catch(() => {});

    let uploadMode: UploadMode = "buffered";
    if (body?.requestStreaming === true) {
      const mimeType = normalizeVideoMimeType(body.mimeType);
      if (!mimeType) {
        setResponseStatus(event, 400);
        return { error: "A supported video mimeType is required for retry" };
      }

      const bufferedFallbackAvailable = allowsSqlRecordingChunkScratch();
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
          await setResumableSession(recordingId, {
            providerId: uploadProvider.id,
            sessionId: session.sessionId,
            meta: {
              ...session.meta,
              stableUrl: true,
              recordAsset: false,
            },
            bytesUploaded: 0,
            lastCommittedIndex: -1,
          });
          uploadMode = "streaming";
        } catch (err) {
          if (!bufferedFallbackAvailable) {
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

    // Reset the per-recording upload progress so the UI poller sees the
    // re-upload restart from 0 and doesn't briefly show "100% then
    // re-running" on the post-compression chunked upload pass.
    const now = new Date().toISOString();
    await writeAppState(`recording-upload-${recordingId}`, {
      recordingId,
      status: "uploading",
      progress: 0,
      chunksReceived: 0,
      bytesReceived: 0,
      maxBytes: MAX_RECORDING_UPLOAD_BYTES,
      updatedAt: now,
    });

    // Stash compression metadata under its own key. We don't merge it into
    // `recording-upload-{id}` because the recorder client overwrites that
    // key on every chunk upload — any compression context written there
    // would be clobbered before `finalize-recording` could read it.
    if (compression) {
      await writeAppState(`recording-compression-${recordingId}`, {
        recordingId,
        ...compression,
        recordedAt: now,
      });
    }

    await db
      .update(schema.recordings)
      .set({
        status: "uploading",
        failureReason: null,
        uploadProgress: 0,
        updatedAt: now,
      })
      .where(eq(schema.recordings.id, recordingId));

    return {
      ok: true,
      recordingId,
      chunksCleared: cleared,
      compressionRecorded: !!compression,
      uploadMode,
    };
  });
});
