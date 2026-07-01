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
import { getActiveFileUploadProvider } from "@agent-native/core/file-upload";
import { runWithRequestContext } from "@agent-native/core/server";
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
import { getDb, schema } from "../../../../db/index.js";
import { debugLog } from "../../../../lib/debug.js";
import { sumRecordingChunkBytes } from "../../../../lib/recording-upload-state.js";
import {
  getEventOwnerContext,
  ownerEmailMatches,
} from "../../../../lib/recordings.js";
import {
  getResumableSession,
  setResumableSession,
  type StoredResumableSession,
} from "../../../../lib/resumable-session.js";
import { isStreamingUploadDisabled } from "../../../../lib/streaming-upload-mode.js";
import {
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

    // Resumable streaming path — forward chunks directly to the provider.
    const resumableSession = await getResumableSession(recordingId);
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
      );
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

    // Already finalized — retried final chunk after session was deleted. Skip
    // buffered path writes so recording-upload-* state stays correct.
    if (existing.status === "ready") {
      return { ok: true, finalized: true };
    }

    // Store chunks in application_state, assemble on finalize.
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
          bytesReceived: await sumRecordingChunkBytes(ownerEmail, recordingId),
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
      const persistedBytesBefore = await sumRecordingChunkBytes(
        ownerEmail,
        recordingId,
      );
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
      bytesReceived = await sumRecordingChunkBytes(ownerEmail, recordingId);
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
        .set({ uploadProgress: progress, updatedAt: new Date().toISOString() })
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
      bytesReceived = await sumRecordingChunkBytes(ownerEmail, recordingId);
      if (bytesReceived > MAX_RECORDING_UPLOAD_BYTES) {
        return failRecordingTooLarge(bytesReceived);
      }
      const failedResponse = await stopIfUploadFailed();
      if (failedResponse) return failedResponse;
      debugLog("[chunk] isFinal — invoking finalize", { recordingId });
      try {
        const result = await finalizeRecording.run(
          buildFinalizeArgs(recordingId, mimeType, query),
        );
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
        const [committed] = await db
          .select({
            id: schema.recordings.id,
            status: schema.recordings.status,
            videoUrl: schema.recordings.videoUrl,
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
          try {
            await writeAppState(`recording-upload-${recordingId}`, {
              recordingId,
              status: "ready",
              progress: 100,
              videoUrl: committed.videoUrl,
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
            durationMs: committed.durationMs,
            width: committed.width,
            height: committed.height,
            hasAudio: committed.hasAudio,
            hasCamera: committed.hasCamera,
          };
        }
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

    return { ok: true, finalized: false, index, bytes: bytes.byteLength };
  });
});

function buildFinalizeArgs(
  recordingId: string,
  mimeType: string,
  query: Record<string, unknown>,
) {
  return {
    id: recordingId,
    durationMs: normalizeChunkUploadNumber(query.durationMs),
    width: normalizeChunkUploadNumber(query.width),
    height: normalizeChunkUploadNumber(query.height),
    hasAudio:
      query.hasAudio === undefined
        ? undefined
        : query.hasAudio === "1" || query.hasAudio === "true",
    hasCamera:
      query.hasCamera === undefined
        ? undefined
        : query.hasCamera === "1" || query.hasCamera === "true",
    mimeType,
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
) {
  const uploadProvider = getActiveFileUploadProvider();
  console.log(
    `[resumable-chunk-${recordingId}] resumable session exists - bytesUploaded=${session.bytesUploaded} index=${index} isFinal=${isFinal}`,
  );

  const raw = await readRawBody(event, false);
  const bytes: Uint8Array = raw ?? new Uint8Array(0);

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
    // 0-byte sentinel from the recorder after stop(). All data chunks have
    // already been PUT to the provider; send Content-Range: bytes */<total>
    // to close the session before handing off to finalize-recording.
    const closeRes = await uploadProvider!.resumable!.relayChunk(
      { sessionId: session.sessionId, meta: session.meta },
      `bytes */${session.bytesUploaded}`,
      new Uint8Array(0),
    );
    if (!closeRes.ok || closeRes.status === 308) {
      console.error(
        `[resumable-chunk-${recordingId}] session close failed (${closeRes.status})`,
      );
      setResponseStatus(event, 502);
      return {
        ok: false,
        error: `Resumable session close failed (${closeRes.status})`,
      };
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
      // Forward the data chunk to the provider and advance offsets only after
      // the provider confirms receipt (308 Resume Incomplete for non-final, 2xx for final).
      const start = session.bytesUploaded;
      const end = start + bytes.byteLength - 1;
      const contentRange = isFinal
        ? `bytes ${start}-${end}/${start + bytes.byteLength}`
        : `bytes ${start}-${end}/*`;

      const putT0 = Date.now();
      const putResult = await uploadProvider!.resumable!.relayChunk(
        { sessionId: session.sessionId, meta: session.meta },
        contentRange,
        bytes,
        { mimeType: mimeType.split(";")[0].trim() },
      );
      console.log(
        `[resumable-chunk-${recordingId}] PUT ${Date.now() - putT0}ms status=${putResult.status} range="${contentRange}"`,
      );

      const resultOk = isFinal
        ? putResult.ok && putResult.status !== 308
        : putResult.ok;
      if (!resultOk) {
        setResponseStatus(event, 502);
        return {
          ok: false,
          error: `Chunk upload failed (${putResult.status})`,
        };
      }

      await setResumableSession(recordingId, {
        ...session,
        ...(putResult.updatedMeta
          ? { meta: { ...session.meta, ...putResult.updatedMeta } }
          : {}),
        bytesUploaded: start + bytes.byteLength,
        lastCommittedIndex: index,
      });

      if (!isFinal) {
        return { ok: true, finalized: false, index, bytes: bytes.byteLength };
      }
    }
  }

  // isFinal — delegate to finalize-recording, which reads the resumable
  // session and calls provider.resumable.completeSession.
  try {
    const result = await finalizeRecording.run(
      buildFinalizeArgs(recordingId, mimeType, query),
    );
    return { ok: true, finalized: true, ...result };
  } catch (err) {
    console.error(`[resumable-chunk-${recordingId}] finalize failed:`, err);
    setResponseStatus(event, 500);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Finalize failed",
    };
  }
}
