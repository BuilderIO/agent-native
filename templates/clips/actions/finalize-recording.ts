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
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { debugLog } from "../server/lib/debug.js";
import {
  applyFaststart,
  hasPlayableMp4Metadata,
} from "../server/lib/faststart.js";
import {
  listRecordingChunkKeys,
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
import { isStreamingUploadDisabled } from "../server/lib/streaming-upload-mode.js";
import {
  probeHasAudioStream,
  remuxWebmToSeekable,
} from "../server/lib/video-remux.js";
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

const RECORDING_TOO_LARGE_REASON =
  "Recording is too large to process after automatic compression. Please update the app and try again, or record a shorter clip.";

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
        // Guard against a slow/racing finalize resurrecting a recording the
        // user already aborted (abort.post.ts flips status to 'failed'). If
        // the row was aborted after this call started, the WHERE clause
        // excludes it and the UPDATE becomes a no-op instead of silently
        // flipping 'failed' back to 'ready'.
        ne(schema.recordings.status, "failed"),
        // Guard against the other direction of the cancel/finalize race:
        // trash-recording's skipIfReady only blocks trashing a row that is
        // ALREADY 'ready'. If cancel lands while this finalize is still
        // 'processing'/'streaming', trashedAt gets set before this UPDATE
        // runs. Excluding trashed rows here stops us from flipping status to
        // 'ready' underneath a recording the user just trashed.
        isNull(schema.recordings.trashedAt),
      ),
    );

  // Re-select to see whether the guarded UPDATE above actually landed. If the
  // row is not 'ready' now, the status guard blocked the write (the recording
  // was aborted concurrently) — stop here without seeding a transcript,
  // writing 'ready' app-state, emitting clip.created, or kicking off
  // background transcription for a recording the user already saw fail.
  const [postUpdate] = await db
    .select({
      status: schema.recordings.status,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, id),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );
  if (!postUpdate || postUpdate.status !== "ready") {
    debugLog(
      "[finalize] markRecordingReady blocked — recording was aborted concurrently",
      { id, status: postUpdate?.status },
    );
    return {
      id,
      status: "failed" as const,
      videoUrl,
      videoSizeBytes,
      durationMs: finalDurationMs,
    };
  }

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

    // Keys of chunks we normally delete after finalize exits.
    // Collected as soon as we list chunks and purged in a finally-block so
    // a throw mid-finalize can't leave multi-gigabyte base64 payloads
    // lingering in application_state. This was the primary cause of the
    // server-side half of the 70 GB memory leak — each failed finalize
    // orphaned one recording's worth of chunks, and with base64 overhead
    // a 30-minute recording is ~1.5 GB per corpse. Missing storage is the
    // exception: those chunks stay recoverable until the user connects a
    // provider and this action runs again.
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

      const failChunkAssembly = async (
        failureReason: string,
      ): Promise<never> => {
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

      // Pull chunk keys first, then fetch values one at a time. A single
      // SELECT key,value over many base64 chunks can exceed Neon's 8s op
      // timeout before we even start assembling the recording.
      const chunkKeys = await listRecordingChunkKeys(ownerEmail, id);
      const expectedDataChunks = stateNumber(uploadState, "expectedDataChunks");
      debugLog("[finalize] chunks found", {
        id,
        count: chunkKeys.length,
        expectedDataChunks,
      });
      // Commit to deleting these keys in the finally below. We collect
      // the keys NOW (not after success) because a throw in uploadFile
      // or the drizzle update would otherwise bypass the delete and
      // orphan the chunks.
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

      // Audio sanity checks. `finalHasAudio` is a CLAIM from the client about
      // capture intent, not proof the bytes we're about to upload actually
      // contain an audio track — e.g. the desktop native recorder can report
      // `hasAudio: true` for a screen recording whose ScreenCaptureKit output
      // has no audio stream at all (mic audio isn't muxed into that file by
      // design; see native_screen.rs). Two distinct failure modes, handled
      // differently:
      //
      //   1. PIPELINE DROP — the assembled bytes had audio before our own
      //      faststart/remux rewrite and don't after. That would be a bug in
      //      this file, should be unreachable, and is cheap insurance against
      //      a future regression — fail loud exactly like the existing mp4
      //      validation failure so the recording is retryable instead of
      //      silently publishing a video that lost audio in our own pipeline.
      //   2. CAPTURE-LEVEL MISMATCH — the client claimed audio but the
      //      ASSEMBLED bytes (before any rewrite of ours) never had an audio
      //      stream to begin with. This is a capture-side gap upstream of
      //      finalize, not something a retry here can fix, so hard-failing
      //      would just turn every affected recording into a lost upload
      //      instead of a silent-but-watchable one. Log it loudly and correct
      //      the stored `hasAudio` metadata so it matches reality, but let
      //      finalize proceed.
      //
      // Best-effort throughout: only acts when the probe can actually answer
      // (skips silently if ffmpeg is unavailable), never blocks a legitimate
      // upload on missing tooling.
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
          // A rewrite ran (faststart/webm remux) AND we positively confirmed
          // the pre-rewrite source had audio — re-probe the REWRITTEN bytes.
          // Gated strictly on `=== true` (not just "not false"): when the
          // source probe was inconclusive (`null`, e.g. ffmpeg unavailable),
          // we have no proof audio ever existed, so we must not hard-fail a
          // recording that may simply be a Tier-2 capture-level mismatch.
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
      return markRecordingReady({
        ...readyParams,
        // Use the audio-probe-corrected value, not the raw client claim in
        // `readyParams` — see the audio sanity check above.
        finalHasAudio: correctedHasAudio,
        videoUrl: upload.url,
        videoSizeBytes: uploadData.byteLength,
        seekableApplied,
      });
    } finally {
      // Unconditional chunk scratch-space cleanup. Runs on success AND on
      // error — a throw during uploadFile / drizzle update / anything else
      // used to leave gigabytes of base64 chunks in application_state
      // forever. Best-effort: individual delete failures are logged but
      // never re-thrown, because re-throwing from a finally would mask the
      // original error that landed us here.
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
