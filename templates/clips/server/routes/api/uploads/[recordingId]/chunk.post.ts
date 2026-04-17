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
  defineEventHandler,
  getRouterParam,
  getQuery,
  readRawBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db/index.js";
import { getEventOwnerEmail } from "../../../../lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";
import finalizeRecording from "../../../../../actions/finalize-recording.js";

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

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  const query = getQuery(event);
  const index = Number(query.index ?? 0);
  const total = Number(query.total ?? 0);
  const isFinal = query.isFinal === "1" || query.isFinal === "true";
  const mimeType =
    typeof query.mimeType === "string" ? query.mimeType : "video/webm";

  if (!Number.isFinite(index) || index < 0) {
    setResponseStatus(event, 400);
    return { error: "Invalid chunk index" };
  }

  const ownerEmail = await getEventOwnerEmail(event);
  const db = getDb();

  // Verify the recording belongs to the current user.
  const [existing] = await db
    .select({
      id: schema.recordings.id,
      status: schema.recordings.status,
      ownerEmail: schema.recordings.ownerEmail,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        eq(schema.recordings.ownerEmail, ownerEmail),
      ),
    );

  if (!existing) {
    setResponseStatus(event, 404);
    return { error: "Recording not found" };
  }

  const raw = await readRawBody(event, false);
  if (!raw || raw.byteLength === 0) {
    setResponseStatus(event, 400);
    return { error: "Empty chunk body" };
  }

  // readRawBody(event, false) returns Uint8Array. Buffer is a Uint8Array
  // subclass on Node, so this is safe whether we're on Node or workerd.
  const bytes: Uint8Array = raw;

  // Pad index to 6 digits so string-sort order matches numeric order if the
  // finalize path ever sorts lexically. (finalize also parses back to a number.)
  const paddedIndex = String(index).padStart(6, "0");
  const chunkKey = `recording-chunks-${recordingId}-${paddedIndex}`;

  await writeAppState(chunkKey, {
    recordingId,
    index,
    bytes: bytes.byteLength,
    mimeType,
    data: toBase64(bytes),
    createdAt: new Date().toISOString(),
  });

  // Update upload progress (best-effort). If total is unknown we treat it as
  // indeterminate and keep progress at its last known value.
  if (total > 0) {
    const progress = Math.min(100, Math.round(((index + 1) / total) * 100));
    await writeAppState(`recording-upload-${recordingId}`, {
      recordingId,
      status: isFinal ? "processing" : "uploading",
      progress,
      chunksReceived: index + 1,
      totalChunks: total,
      mimeType,
      updatedAt: new Date().toISOString(),
    });

    await db
      .update(schema.recordings)
      .set({
        uploadProgress: progress,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.recordings.id, recordingId));
  }

  // Final chunk — kick off finalize. We await so the client gets a single
  // "done" response with the final URL (instead of needing to poll).
  if (isFinal) {
    try {
      const result = await finalizeRecording.run({
        id: recordingId,
        durationMs: query.durationMs ? Number(query.durationMs) : undefined,
        width: query.width ? Number(query.width) : undefined,
        height: query.height ? Number(query.height) : undefined,
        hasAudio:
          query.hasAudio === undefined
            ? undefined
            : query.hasAudio === "1" || query.hasAudio === "true",
        hasCamera:
          query.hasCamera === undefined
            ? undefined
            : query.hasCamera === "1" || query.hasCamera === "true",
        mimeType,
      });
      return {
        ok: true,
        finalized: true,
        ...result,
      };
    } catch (err) {
      console.error("[clips] finalize-recording failed:", err);
      await db
        .update(schema.recordings)
        .set({
          status: "failed",
          failureReason: err instanceof Error ? err.message : "Finalize failed",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.recordings.id, recordingId));
      await writeAppState(`recording-upload-${recordingId}`, {
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

  return {
    ok: true,
    finalized: false,
    index,
    bytes: bytes.byteLength,
  };
});
