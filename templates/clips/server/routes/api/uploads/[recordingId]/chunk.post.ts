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
  listAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { runWithRequestContext } from "@agent-native/core/server";
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
import { getDb, schema } from "../../../../db/index.js";
import { debugLog } from "../../../../lib/debug.js";
import {
  getEventOwnerContext,
  ownerEmailMatches,
} from "../../../../lib/recordings.js";
import {
  shouldRejectVideoUploadWithoutStorage,
  STORAGE_SETUP_REQUIRED_REASON,
} from "../../../../lib/video-storage.js";
const RECORDING_TOO_LARGE_REASON = `Recording exceeds the ${Math.round(MAX_RECORDING_UPLOAD_BYTES / (1024 * 1024))} MB size limit. Please record a shorter clip.`;

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

async function sumPersistedChunkBytes(recordingId: string): Promise<number> {
  const chunks = await listAppState(`recording-chunks-${recordingId}-`);
  return chunks.reduce(
    (total, entry) => total + (stateNumber(entry.value, "bytes") ?? 0),
    0,
  );
}

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    throw createError({ statusCode: 400, message: "Missing recordingId" });
  }

  const query = getQuery(event);
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

  if (!Number.isFinite(index) || index < 0) {
    throw createError({ statusCode: 400, message: "Invalid chunk index" });
  }

  // Netlify functions have a 6 MB buffered request cap, but binary requests
  // are base64 encoded by the gateway and effectively cap out around 4.5 MB.
  // Keep our own cap lower so dev/local failures match production.
  const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
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

  return runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
    const db = getDb();

    // Verify the recording belongs to the current user.
    const [existing] = await db
      .select({
        id: schema.recordings.id,
        status: schema.recordings.status,
        failureReason: schema.recordings.failureReason,
        ownerEmail: schema.recordings.ownerEmail,
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

    if (existing.status === "failed") {
      return failedUploadResponse(
        existing.failureReason ?? "Recording upload has already failed.",
      );
    }

    if (await shouldRejectVideoUploadWithoutStorage()) {
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

    const uploadStateRaw = await readAppState(
      `recording-upload-${recordingId}`,
    );
    const uploadState =
      uploadStateRaw && typeof uploadStateRaw === "object"
        ? uploadStateRaw
        : null;
    const failedReason =
      typeof uploadState?.failureReason === "string"
        ? uploadState.failureReason
        : RECORDING_TOO_LARGE_REASON;
    if (uploadState?.status === "failed") {
      return failedUploadResponse(failedReason);
    }
    let bytesReceived = stateNumber(uploadState, "bytesReceived") ?? 0;

    const stopIfUploadFailed = async () => {
      const latestState = await readAppState(`recording-upload-${recordingId}`);
      const latestReason =
        latestState && typeof latestState.failureReason === "string"
          ? latestState.failureReason
          : "Recording upload has already failed.";
      if (latestState?.status === "failed") {
        return failedUploadResponse(latestReason);
      }

      const [current] = await db
        .select({
          status: schema.recordings.status,
          failureReason: schema.recordings.failureReason,
        })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, recordingId));
      if (current?.status === "failed") {
        const reason =
          current.failureReason ?? "Recording upload has already failed.";
        await writeAppState(`recording-upload-${recordingId}`, {
          recordingId,
          status: "failed",
          failureReason: reason,
          bytesReceived: await sumPersistedChunkBytes(recordingId),
          maxBytes: MAX_RECORDING_UPLOAD_BYTES,
          updatedAt: new Date().toISOString(),
        });
        return failedUploadResponse(reason);
      }
      return null;
    };

    const failRecordingTooLarge = async (nextBytes: number) => {
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
      const chunkKey = `recording-chunks-${recordingId}-${paddedIndex}`;
      const previousChunk = await readAppState(chunkKey);
      const previousBytes = stateNumber(previousChunk, "bytes") ?? 0;
      const persistedBytesBefore = await sumPersistedChunkBytes(recordingId);
      const nextBytes =
        Math.max(0, persistedBytesBefore - previousBytes) + bytes.byteLength;

      if (nextBytes > MAX_RECORDING_UPLOAD_BYTES) {
        return failRecordingTooLarge(nextBytes);
      }

      await writeAppState(chunkKey, {
        recordingId,
        index,
        bytes: bytes.byteLength,
        mimeType,
        data: toBase64(bytes),
        createdAt: new Date().toISOString(),
      });
      bytesReceived = await sumPersistedChunkBytes(recordingId);
      if (bytesReceived > MAX_RECORDING_UPLOAD_BYTES) {
        return failRecordingTooLarge(bytesReceived);
      }
    }

    // Update upload progress (best-effort). If total is unknown we treat it as
    // indeterminate and keep progress at its last known value.
    if (total > 0) {
      const failedResponse = await stopIfUploadFailed();
      if (failedResponse) return failedResponse;
      const progress = Math.min(100, Math.round(((index + 1) / total) * 100));
      await writeAppState(`recording-upload-${recordingId}`, {
        recordingId,
        status: isFinal ? "processing" : "uploading",
        progress,
        chunksReceived: index + 1,
        totalChunks: total,
        bytesReceived,
        maxBytes: MAX_RECORDING_UPLOAD_BYTES,
        mimeType,
        updatedAt: new Date().toISOString(),
      });
      const failedAfterStateWrite = await stopIfUploadFailed();
      if (failedAfterStateWrite) return failedAfterStateWrite;

      await db
        .update(schema.recordings)
        .set({
          uploadProgress: progress,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.recordings.id, recordingId),
            eq(schema.recordings.status, existing.status),
          ),
        );
    } else if (bytes.byteLength > 0) {
      const failedResponse = await stopIfUploadFailed();
      if (failedResponse) return failedResponse;
      await writeAppState(`recording-upload-${recordingId}`, {
        recordingId,
        status: "uploading",
        chunksReceived: index + 1,
        bytesReceived,
        maxBytes: MAX_RECORDING_UPLOAD_BYTES,
        mimeType,
        updatedAt: new Date().toISOString(),
      });
      const failedAfterStateWrite = await stopIfUploadFailed();
      if (failedAfterStateWrite) return failedAfterStateWrite;
    }

    // Final chunk — kick off finalize. We await so the client gets a single
    // "done" response with the final URL (instead of needing to poll).
    if (isFinal) {
      bytesReceived = await sumPersistedChunkBytes(recordingId);
      if (bytesReceived > MAX_RECORDING_UPLOAD_BYTES) {
        return failRecordingTooLarge(bytesReceived);
      }
      const failedResponse = await stopIfUploadFailed();
      if (failedResponse) return failedResponse;
      debugLog("[chunk] isFinal — invoking finalize", { recordingId });
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
        debugLog("[chunk] finalize ok", {
          recordingId,
          videoUrl: (result as any)?.videoUrl,
        });
        const waitingForStorage =
          (result as any)?.status === "waiting_storage" ||
          (result as any)?.storageSetupRequired === true;
        if (waitingForStorage) {
          setResponseStatus(event, 202);
        }
        return {
          ok: true,
          finalized: !waitingForStorage,
          waitingForStorage,
          ...result,
        };
      } catch (err) {
        console.error("[clips] finalize-recording failed:", err);
        await db
          .update(schema.recordings)
          .set({
            status: "failed",
            failureReason:
              err instanceof Error ? err.message : "Finalize failed",
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
});
