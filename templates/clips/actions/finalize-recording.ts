/**
 * Finalize a recording — assemble chunks, upload the final blob,
 * update the recording row, flip status to 'processing' → 'ready',
 * and request transcription. Title generation is queued by the transcript
 * path once usable transcript text exists.
 *
 * Usage:
 *   pnpm action finalize-recording --id=<recordingId>
 */

import { defineAction } from "@agent-native/core";
import {
  readAppState,
  writeAppState,
  deleteAppState,
} from "@agent-native/core/application-state";
import { emit } from "@agent-native/core/event-bus";
import {
  getActiveFileUploadProvider,
  uploadFile,
} from "@agent-native/core/file-upload";
import { captureRouteError } from "@agent-native/core/server";
import { MAX_UPLOAD_BYTES as MAX_RECORDING_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { debugLog } from "../server/lib/debug.js";
import {
  applyFaststart,
  hasPlayableMp4Metadata,
} from "../server/lib/faststart.js";
import { listRecordingChunkKeys } from "../server/lib/recording-upload-state.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";
import {
  deleteResumableSession,
  getResumableSession,
} from "../server/lib/resumable-session.js";
import { isStreamingUploadDisabled } from "../server/lib/streaming-upload-mode.js";
import { remuxWebmToSeekable } from "../server/lib/video-remux.js";
import {
  requiresConfiguredVideoStorage,
  STORAGE_SETUP_REQUIRED_REASON,
} from "../server/lib/video-storage.js";
import {
  ensureRecordingSeekable,
  markRecordingSeekable,
} from "./lib/ensure-seekable-video.js";
import requestTranscript from "./request-transcript.js";

// Recordings up to this size get their seekable rewrite applied inline during
// finalize (we already hold the assembled bytes). Larger recordings are handed
// off to the background/reprocess path so we don't stretch the finalize
// request or exhaust serverless /tmp. Override with CLIPS_INLINE_REMUX_MAX_BYTES.
function inlineRemuxMaxBytes(): number {
  const raw = Number(process.env.CLIPS_INLINE_REMUX_MAX_BYTES ?? "");
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 200 * 1024 * 1024;
}

/**
 * Decode a base64 string back into a Uint8Array.
 * We store chunks as base64 in application_state because the SQL JSON
 * column holds text, not raw bytes.
 */
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

function chunkIndexFromKey(key: string): number {
  return Number(key.split("-").pop() || 0);
}

const RECORDING_TOO_LARGE_REASON =
  "Recording is too large to process after automatic compression. Please update the app and try again, or record a shorter clip.";
const MEDIA_SERVE_VERIFICATION_TIMEOUT_MS = 8_000;
const MEDIA_SERVE_VERIFICATION_ATTEMPTS = 3;
const MEDIA_SERVE_VERIFICATION_BACKOFF_MS = 350;

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

const cliBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
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

async function verifyServedMediaUrl(videoUrl: string): Promise<void> {
  if (!shouldVerifyServedMediaUrl(videoUrl)) return;

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
      const response = await fetch(videoUrl, {
        method: "GET",
        headers: { Range: "bytes=0-1023" },
        signal: controller.signal,
      });
      const statusOk = response.status === 200 || response.status === 206;
      if (statusOk && (await responseHasReadableMediaBytes(response))) {
        return;
      }
      lastFailure = `media URL returned HTTP ${response.status}`;
      if (response.status < 500) break;
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

async function failStoredButUnservableRecording(params: {
  id: string;
  ownerEmail: string;
  failureReason: string;
}): Promise<void> {
  const { id, ownerEmail, failureReason } = params;
  const now = new Date().toISOString();
  const db = getDb();
  await db
    .update(schema.recordings)
    .set({
      status: "failed",
      failureReason,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.recordings.id, id),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );
  const uploadStateRaw = await readAppState(`recording-upload-${id}`).catch(
    () => null,
  );
  const uploadState =
    uploadStateRaw && typeof uploadStateRaw === "object"
      ? (uploadStateRaw as Record<string, unknown>)
      : {};
  await writeAppState(`recording-upload-${id}`, {
    ...uploadState,
    recordingId: id,
    status: "failed",
    failureReason,
    updatedAt: now,
  });
  await writeAppState("refresh-signal", { ts: Date.now() });
}

// Flip recording to 'ready', seed transcript row, fire background transcript,
// emit clip.created. Used by both the resumable and buffered upload paths.
async function markRecordingReady(params: {
  id: string;
  ownerEmail: string;
  videoUrl: string;
  videoSizeBytes: number;
  videoFormat: "webm" | "mp4";
  finalDurationMs: number;
  finalWidth: number;
  finalHeight: number;
  finalHasAudio: boolean;
  finalHasCamera: boolean;
  existingTitle: string;
  // Whether a seekable rewrite (MP4 faststart / WebM Cues remux) was already
  // applied to the uploaded bytes. When false, a best-effort background repair
  // is triggered so streamed/raw uploads still become seekable.
  seekableApplied: boolean;
}) {
  const {
    id,
    ownerEmail,
    videoUrl,
    videoSizeBytes,
    videoFormat,
    finalDurationMs,
    finalWidth,
    finalHeight,
    finalHasAudio,
    finalHasCamera,
    existingTitle,
    seekableApplied,
  } = params;
  const db = getDb();
  const now = new Date().toISOString();

  await db
    .update(schema.recordings)
    .set({
      status: "ready",
      videoUrl,
      videoFormat,
      videoSizeBytes,
      durationMs: finalDurationMs,
      width: finalWidth,
      height: finalHeight,
      hasAudio: finalHasAudio,
      hasCamera: finalHasCamera,
      failureReason: null,
      uploadProgress: 100,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.recordings.id, id),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );

  const [existingTranscript] = await db
    .select({ recordingId: schema.recordingTranscripts.recordingId })
    .from(schema.recordingTranscripts)
    .where(eq(schema.recordingTranscripts.recordingId, id));
  if (!existingTranscript) {
    await db.insert(schema.recordingTranscripts).values({
      recordingId: id,
      ownerEmail,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  }

  await writeAppState(`recording-upload-${id}`, {
    recordingId: id,
    status: "ready",
    progress: 100,
    videoUrl,
    finishedAt: now,
  });
  await writeAppState("refresh-signal", { ts: Date.now() });

  if (seekableApplied) {
    // Uploaded bytes are already start-playable and seekable — remember it so
    // later reprocess sweeps skip this clip.
    await markRecordingSeekable(id, videoUrl).catch((err) => {
      console.warn("[finalize] failed to write seekable marker", {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  } else {
    // Streaming/resumable (or oversized) uploads shipped raw MediaRecorder
    // bytes with no seekable rewrite: an MP4 with a trailing moov or a WebM
    // without a Cues index buffers on load and re-buffers on every seek. Fix
    // it in the background so playback is smooth without blocking finalize.
    void Promise.resolve(
      ensureRecordingSeekable({ recordingId: id, ownerEmail }),
    ).catch((err: unknown) => {
      console.warn("[finalize] background seekable remux failed", {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // Kick off transcription in the background — fire-and-forget so the chunk
  // endpoint gets a quick response. The request context (user email via
  // AsyncLocalStorage) carries through to async continuations.
  void Promise.resolve(
    requestTranscript.run({ recordingId: id, force: true }),
  ).catch((err: unknown) => {
    console.error("[finalize] background transcript failed", {
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
    videoUrl,
    videoSizeBytes,
    durationMs: finalDurationMs,
  };
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
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = args.id;
    debugLog("[finalize] starting", { id, ownerEmail });

    // Keys of chunks to delete in the finally block. Ordinary failures still
    // purge scratch space; stored-but-unservable provider URLs clear this list
    // before throwing because these chunks are the buffered path's recovery
    // copy.
    let chunkKeysToPurge: string[] = [];
    try {
      const [existing] = await db
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
        // Still purge chunks for this id — it's orphaned.
        chunkKeysToPurge = await listRecordingChunkKeys(ownerEmail, id);
        throw new Error(`Recording not found: ${id}`);
      }

      // Idempotency guard: finalize can be re-invoked when a client retries the
      // final chunk after a lost response. If already 'ready' return the existing
      // result instead of re-running the complete/assembly path (session and
      // chunks are gone by then).
      if (existing.status === "ready" && existing.videoUrl) {
        debugLog("[finalize] already finalized, returning existing", { id });
        return {
          id,
          status: "ready" as const,
          videoUrl: existing.videoUrl,
          videoSizeBytes: existing.videoSizeBytes ?? 0,
          durationMs: existing.durationMs ?? 0,
        };
      }

      const uploadStateRaw = await readAppState(`recording-upload-${id}`);
      const uploadState =
        uploadStateRaw && typeof uploadStateRaw === "object"
          ? (uploadStateRaw as Record<string, unknown>)
          : null;
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
        existingTitle: existing.title,
      };

      // Resumable path: create-recording initialized a session and chunk.post.ts
      // forwarded all chunks to the provider. Complete the session to get the CDN URL.
      const resumableSession = await getResumableSession(id);
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
        try {
          const uploadProvider = getActiveFileUploadProvider();
          if (!uploadProvider?.resumable) {
            throw new Error("No resumable upload provider configured");
          }
          if (resumableSession.bytesUploaded <= 0) {
            throw new Error("Recording upload contained no video bytes");
          }
          const videoUrl = await uploadProvider.resumable.completeSession(
            {
              sessionId: resumableSession.sessionId,
              meta: resumableSession.meta,
            },
            typeof resumableSession.meta.filename === "string"
              ? resumableSession.meta.filename
              : "",
            { skipCompressionWait: true },
          );
          debugLog("[finalize] resumable upload completed", { id, videoUrl });
          try {
            await verifyServedMediaUrl(videoUrl);
          } catch (err) {
            const failureReason =
              err instanceof Error ? err.message : String(err);
            await failStoredButUnservableRecording({
              id,
              ownerEmail,
              failureReason,
            });
            throw err;
          }
          const result = await markRecordingReady({
            ...readyParams,
            videoUrl,
            videoSizeBytes: resumableSession.bytesUploaded,
            // Streaming path forwards raw MediaRecorder bytes straight to the
            // provider — no faststart/Cues rewrite happened. Repair in the
            // background.
            seekableApplied: false,
          });
          // Delete only after durable state is written — so a retry before
          // this point can still find the session and re-enter this path.
          deleteResumableSession(id).catch((err) =>
            console.warn("[finalize] failed to delete resumable session:", err),
          );
          return result;
        } catch (err) {
          console.error("[finalize] resumable complete failed:", err);
          throw new Error(
            `Upload completion failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Buffered path — assemble chunks from application_state, then upload.

      // The recorder stashes compression metadata at
      // `recording-compression-{id}` when its browser-side ffmpeg.wasm
      // pass ran to bring the assembled blob under Builder.io's 100 MB
      // upload cap. Stored under its own sub-key (rather than nested
      // inside `recording-upload-{id}`) because the recorder client
      // overwrites the upload key on every chunk POST — co-locating the
      // compression context would mean it gets clobbered before this
      // action runs. Surface it into the Sentry payload on any upload
      // failure so we can tell at a glance whether the user hit the limit
      // on the original blob or on the compressed one.
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

      // Flip to 'processing' while we assemble.
      await db
        .update(schema.recordings)
        .set({
          status: "processing",
          uploadProgress: 100,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.recordings.id, id));

      await writeAppState(`recording-upload-${id}`, {
        recordingId: id,
        status: "processing",
        progress: 100,
        updatedAt: new Date().toISOString(),
      });

      // Pull chunk keys first, then fetch values one at a time. A single
      // SELECT key,value over many base64 chunks can exceed Neon's 8s op
      // timeout before we even start assembling the recording.
      const chunkKeys = await listRecordingChunkKeys(ownerEmail, id);
      chunkKeys.sort((a, b) => chunkIndexFromKey(a) - chunkIndexFromKey(b));
      debugLog("[finalize] chunks found", {
        id,
        count: chunkKeys.length,
      });
      // Purge on ordinary assembly/upload failures to avoid orphaning large
      // base64 chunks. Stored-but-unservable verification failures clear this
      // list before throwing so finalize can be retried from the recovery copy.
      chunkKeysToPurge = chunkKeys;

      if (chunkKeys.length === 0) {
        await db
          .update(schema.recordings)
          .set({
            status: "failed",
            failureReason: "No chunks found for recording",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.recordings.id, id));
        await writeAppState(`recording-upload-${id}`, {
          recordingId: id,
          status: "failed",
          failureReason: "No chunks found for recording",
        });
        throw new Error(`No chunks found for recording ${id}`);
      }

      const failChunkAssembly = async (failureReason: string) => {
        const now = new Date().toISOString();
        await db
          .update(schema.recordings)
          .set({
            status: "failed",
            failureReason,
            updatedAt: now,
          })
          .where(eq(schema.recordings.id, id));
        await writeAppState(`recording-upload-${id}`, {
          recordingId: id,
          status: "failed",
          failureReason,
          updatedAt: now,
        });
        throw new Error(failureReason);
      };

      const parts: Uint8Array[] = [];
      for (const key of chunkKeys) {
        const entry = await readAppState(key);
        const b64 = typeof entry?.data === "string" ? entry.data : null;
        const index = chunkIndexFromKey(key);
        if (!b64) {
          await failChunkAssembly(
            `Recording chunk ${index} is missing upload data. Please retry the recording.`,
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
      if (assembled.byteLength > MAX_RECORDING_UPLOAD_BYTES) {
        await failChunkAssembly(RECORDING_TOO_LARGE_REASON);
      }
      // `parts` is no longer needed — dropping the array reference lets V8
      // GC the Uint8Array slices while uploadFile is in flight. Each entry
      // can be megabytes and we can be holding a gigabyte total for long
      // recordings.
      parts.length = 0;

      // Make the assembled recording seekable before upload — we already hold
      // the full bytes, so a viewer never has to wait through a non-seekable
      // first play. MP4: relocate moov ahead of mdat (pure TS). WebM: remux to
      // add a Cues index + real duration (ffmpeg -c copy). When neither runs
      // (unknown format, oversized, or ffmpeg unavailable) `seekableApplied`
      // stays false and markRecordingReady schedules a background repair.
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
        // moov is present and validated — the MP4 is start-playable/seekable.
        seekableApplied = true;
      } else if (videoFormat === "webm") {
        // MediaRecorder WebM has no Cues index and an unknown duration, so
        // Chrome buffers on load and re-buffers on every seek. A lossless
        // `ffmpeg -c copy` remux rewrites it with a SeekHead + Cues + real
        // duration. Bounded by size so finalize stays fast; larger clips get a
        // background pass. Best-effort: on any failure we upload the original.
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

      let upload: Awaited<ReturnType<typeof uploadFile>>;
      try {
        upload = await uploadFile({
          data: uploadData,
          filename: `${id}.${videoFormat}`,
          mimeType,
          ownerEmail,
          skipCompressionWait: true,
        });
      } catch (err) {
        // Capture structured context so a "Builder.io upload failed (500)" can
        // be diagnosed without round-tripping with the user. Especially
        // important alongside the new browser-side compression — we want to
        // know whether the user hit Builder.io's 100 MB cap on the original
        // recording or on the compressed result.
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
        throw err;
      }

      if (upload === null) {
        const now = new Date().toISOString();
        if (requiresConfiguredVideoStorage()) {
          await db
            .update(schema.recordings)
            .set({
              status: "failed",
              failureReason: STORAGE_SETUP_REQUIRED_REASON,
              durationMs: finalDurationMs,
              width: finalWidth,
              height: finalHeight,
              hasAudio: finalHasAudio,
              hasCamera: finalHasCamera,
              uploadProgress: 0,
              updatedAt: now,
            })
            .where(eq(schema.recordings.id, id));

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

        await db
          .update(schema.recordings)
          .set({
            status: "uploading",
            failureReason: STORAGE_SETUP_REQUIRED_REASON,
            durationMs: finalDurationMs,
            width: finalWidth,
            height: finalHeight,
            hasAudio: finalHasAudio,
            hasCamera: finalHasCamera,
            uploadProgress: 100,
            updatedAt: now,
          })
          .where(eq(schema.recordings.id, id));

        await writeAppState(`recording-upload-${id}`, {
          recordingId: id,
          status: "waiting_storage",
          failureReason: STORAGE_SETUP_REQUIRED_REASON,
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
        });
        await writeAppState("refresh-signal", { ts: Date.now() });

        // Keep the chunk scratch-space recoverable. Once the user connects
        // Builder.io/S3, the player calls this action again and the same chunks
        // are uploaded to the newly configured provider.
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
        // Provider returned success but no URL — likely a misconfigured S3
        // bucket or a Builder.io edge case worth investigating.
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
      try {
        await verifyServedMediaUrl(upload.url);
      } catch (err) {
        chunkKeysToPurge = [];
        const failureReason = err instanceof Error ? err.message : String(err);
        await failStoredButUnservableRecording({
          id,
          ownerEmail,
          failureReason,
        });
        throw err;
      }
      const result = await markRecordingReady({
        ...readyParams,
        videoUrl: upload.url,
        videoSizeBytes: uploadData.byteLength,
        seekableApplied,
      });
      return result;
    } finally {
      // Best-effort chunk scratch-space cleanup. Stored-but-unservable provider
      // failures clear this list before throwing so a retry can re-upload from
      // the buffered recovery copy.
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
      // Drop the compression sub-key written by reset-chunks. Best effort;
      // it's small (<200 bytes) so a leaked one is harmless, but tidying
      // up keeps `application_state` clean across many recordings.
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
