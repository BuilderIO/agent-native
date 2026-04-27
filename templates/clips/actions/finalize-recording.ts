/**
 * Finalize a recording — assemble chunks, upload the final blob,
 * update the recording row, flip status to 'processing' → 'ready',
 * and trigger a background agent chat to produce title/summary/chapters.
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
import {
  uploadFile,
  getActiveFileUploadProvider,
} from "@agent-native/core/file-upload";
import { emit } from "@agent-native/core/event-bus";
import { applyFaststart } from "../server/lib/faststart.js";
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
      .boolean()
      .optional()
      .describe("Whether the recording contains audio"),
    hasCamera: z
      .boolean()
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

    // Keys of chunks we need to delete regardless of how finalize exits.
    // Collected as soon as we list chunks and purged in a finally-block so
    // a throw mid-finalize can't leave multi-gigabyte base64 payloads
    // lingering in application_state. This was the primary cause of the
    // server-side half of the 70 GB memory leak — each failed finalize
    // orphaned one recording's worth of chunks, and with base64 overhead
    // a 30-minute recording is ~1.5 GB per corpse.
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

      const uploadState = await readAppState(`recording-upload-${id}`);
      const mimeType =
        args.mimeType ||
        (typeof uploadState?.mimeType === "string"
          ? uploadState.mimeType
          : "") ||
        "video/webm";
      const videoFormat: "webm" | "mp4" = mimeType.includes("mp4")
        ? "mp4"
        : "webm";

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

      // Require a real upload provider — storing video blobs in the database
      // is not viable for production. The onboarding step ensures this is
      // configured before the user can record.
      const activeProvider = getActiveFileUploadProvider();
      if (!activeProvider) {
        throw new Error(
          "No file upload provider configured. Connect Builder.io or S3-compatible storage in Settings.",
        );
      }

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
      }

      const upload = await uploadFile({
        data: uploadData,
        filename: `${id}.${videoFormat}`,
        mimeType,
        ownerEmail,
      });

      if (!upload?.url) {
        throw new Error(
          "File upload returned no URL. Check your storage provider configuration.",
        );
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
          durationMs: args.durationMs ?? existing.durationMs ?? 0,
          width: args.width ?? existing.width ?? 0,
          height: args.height ?? existing.height ?? 0,
          hasAudio:
            typeof args.hasAudio === "boolean"
              ? args.hasAudio
              : existing.hasAudio,
          hasCamera:
            typeof args.hasCamera === "boolean"
              ? args.hasCamera
              : existing.hasCamera,
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

      // Kick off Whisper transcription in the background. The chunk endpoint
      // already awaits this finalize call, so we fire-and-forget — the request
      // context (user email via AsyncLocalStorage) carries through to any
      // async continuations started before this run() returns. Without this
      // the transcript row stays in `pending` forever and the UI shows an
      // infinite "Transcribing…" spinner.
      void requestTranscript.run({ recordingId: id }).catch((err) => {
        console.error("[finalize] background transcript failed", {
          id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // Queue a background agent run by writing a structured message to
      // application_state. The frontend's agent-chat-bridge picks up
      // `agent-task-*` keys and dispatches sendToAgentChat({ background: true }).
      await writeAppState(`agent-task-recording-${id}`, {
        kind: "post-recording-processing",
        recordingId: id,
        background: true,
        openSidebar: false,
        message: [
          `A new recording (${id}) just finished uploading.`,
          "Please do the following in the background:",
          "1. Generate a concise, descriptive title and update it via update-recording.",
          "2. Generate a 1-2 sentence summary and store it in the description.",
          "3. Produce a transcript (segmented, with startMs/endMs/text) and save it to the recording_transcripts table for this recording id, setting status='ready'.",
          "4. Produce a short chapters list (chaptersJson: [{startMs, title}]) and save it on the recording row.",
          "Do NOT prompt the user — this is a silent background task.",
        ].join("\n"),
        context: {
          recordingId: id,
          videoUrl,
          durationMs: args.durationMs ?? 0,
        },
        createdAt: new Date().toISOString(),
      });

      // Emit clip.created event — best-effort, never block the main flow.
      try {
        emit(
          "clip.created",
          {
            clipId: id,
            title: existing.title,
            createdBy: ownerEmail,
            duration: args.durationMs ?? existing.durationMs ?? 0,
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
        durationMs: args.durationMs ?? existing.durationMs ?? 0,
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
    }
  },
});
