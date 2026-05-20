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
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import {
  readAppState,
  writeAppState,
  deleteAppState,
  listAppState,
} from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";
import { emit } from "@agent-native/core/event-bus";
import { captureRouteError } from "@agent-native/core/server";
import {
  applyFaststart,
  hasPlayableMp4Metadata,
} from "../server/lib/faststart.js";
import { debugLog } from "../server/lib/debug.js";
import requestTranscript from "./request-transcript.js";

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

const STORAGE_SETUP_REQUIRED_REASON =
  "Video storage is not connected yet. Connect Builder.io or configure S3-compatible storage to upload and finish saving this clip.";

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
            eq(schema.recordings.ownerEmail, ownerEmail),
          ),
        );

      if (!existing) {
        console.warn("[finalize] recording not found", { id, ownerEmail });
        // Still purge chunks for this id — it's orphaned.
        chunkKeysToPurge = (await listAppState(`recording-chunks-${id}-`)).map(
          (e) => e.key,
        );
        throw new Error(`Recording not found: ${id}`);
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

      // Pull all chunk entries for this recording in index order.
      const chunkEntries = await listAppState(`recording-chunks-${id}-`);
      chunkEntries.sort((a, b) => {
        const ai = Number(a.key.split("-").pop() || 0);
        const bi = Number(b.key.split("-").pop() || 0);
        return ai - bi;
      });
      debugLog("[finalize] chunks found", {
        id,
        count: chunkEntries.length,
      });
      // Commit to deleting these keys in the finally below. We collect
      // the keys NOW (not after success) because a throw in uploadFile
      // or the drizzle update would otherwise bypass the delete and
      // orphan the chunks.
      chunkKeysToPurge = chunkEntries.map((e) => e.key);

      if (chunkEntries.length === 0) {
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

      const parts: Uint8Array[] = [];
      for (const entry of chunkEntries) {
        const b64 =
          typeof entry.value?.data === "string" ? entry.value.data : null;
        if (b64) parts.push(b64ToBytes(b64));
      }
      const assembled = concatBytes(parts);
      // `parts` is no longer needed — dropping the array reference lets V8
      // GC the Uint8Array slices while uploadFile is in flight. Each entry
      // can be megabytes and we can be holding a gigabyte total for long
      // recordings.
      parts.length = 0;

      // Apply faststart to MP4 files — moves the moov atom before mdat so
      // browsers can begin playback immediately via HTTP range requests.
      let uploadData = assembled;
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
            "Recorded MP4 is missing playback metadata. Please retry the recording.",
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
      }

      let upload: Awaited<ReturnType<typeof uploadFile>>;
      try {
        upload = await uploadFile({
          data: uploadData,
          filename: `${id}.${videoFormat}`,
          mimeType,
          ownerEmail,
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
          chunksReceived: chunkEntries.length,
          totalChunks: chunkEntries.length,
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
      const videoUrl = upload.url;

      // Update the recording row with final metadata and flip to 'ready'.
      await db
        .update(schema.recordings)
        .set({
          status: "ready",
          videoUrl,
          videoFormat,
          videoSizeBytes: assembled.byteLength,
          durationMs: finalDurationMs,
          width: finalWidth,
          height: finalHeight,
          hasAudio: finalHasAudio,
          hasCamera: finalHasCamera,
          failureReason: null,
          uploadProgress: 100,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.recordings.id, id));

      // Seed a pending transcript row so the agent background task has a place
      // to write results.
      const [existingTranscript] = await db
        .select({ recordingId: schema.recordingTranscripts.recordingId })
        .from(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, id));
      if (!existingTranscript) {
        await db.insert(schema.recordingTranscripts).values({
          recordingId: id,
          ownerEmail,
          status: "pending",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      await writeAppState(`recording-upload-${id}`, {
        recordingId: id,
        status: "ready",
        progress: 100,
        videoUrl,
        finishedAt: new Date().toISOString(),
      });

      await writeAppState("refresh-signal", { ts: Date.now() });

      // Kick off transcription in the background. Native web/macOS speech rows
      // are preserved first; cloud transcription only fills gaps/refines when
      // needed. The chunk endpoint already awaits this finalize call, so we
      // fire-and-forget — the request context (user email via AsyncLocalStorage)
      // carries through to async continuations started before this run()
      // returns. Without this the transcript row stays in `pending` forever and
      // the UI shows an infinite "Transcribing…" spinner.
      void requestTranscript
        .run({ recordingId: id, force: true })
        .catch((err) => {
          console.error("[finalize] background transcript failed", {
            id,
            error: err instanceof Error ? err.message : String(err),
          });
        });

      // Emit clip.created event — best-effort, never block the main flow.
      try {
        emit(
          "clip.created",
          {
            clipId: id,
            title: existing.title,
            createdBy: ownerEmail,
            duration: finalDurationMs,
            url: videoUrl,
          },
          { owner: ownerEmail },
        );
      } catch (err) {
        console.warn("[finalize] clip.created emit failed:", err);
      }

      debugLog("[finalize] done", {
        id,
        videoUrl,
        bytes: assembled.byteLength,
      });

      return {
        id,
        status: "ready" as const,
        videoUrl,
        videoSizeBytes: assembled.byteLength,
        durationMs: finalDurationMs,
      };
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
