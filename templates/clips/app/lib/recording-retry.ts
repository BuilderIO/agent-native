import { appBasePath } from "@agent-native/core/client/api-path";
import { chunkUploadUrl, UPLOAD_SLICE_BYTES } from "@shared/recording-core";

import {
  claimRecordingBackupLock,
  deleteRecordingBackup,
  getRecordingBackupChunks,
  getRecordingBackupMeta,
  isCompleteRecordingBackup,
  verifyServerCopy,
} from "./recording-backup";
import { uploadChunkRequest } from "./upload-request";

export { hasRecordingBackup } from "./recording-backup";

export interface RetryRecordingUploadResult {
  status?: string;
  videoUrl?: string | null;
}

/** Another tab is recording or uploading this copy right now. */
export class LocalCopyInUseError extends Error {
  constructor() {
    super("This recording is open in another tab.");
    this.name = "LocalCopyInUseError";
  }
}

/**
 * Re-upload a failed clip from this browser's local copy. The copy's Web Lock
 * is held throughout, so a copy another tab is using is never replayed or
 * deleted, and the copy is deleted only once the server proves it received
 * every byte. Without Web Locks the upload still runs but the copy is kept.
 */
export async function retryRecordingUploadFromBackup(
  recordingId: string,
): Promise<RetryRecordingUploadResult> {
  const claim = await claimRecordingBackupLock(recordingId);
  if (claim.status === "busy") throw new LocalCopyInUseError();
  try {
    return await replayLocalCopy(recordingId, claim.status === "held");
  } finally {
    if (claim.status === "held") claim.release();
  }
}

async function replayLocalCopy(
  recordingId: string,
  mayDelete: boolean,
): Promise<RetryRecordingUploadResult> {
  const [meta, chunks] = await Promise.all([
    getRecordingBackupMeta(recordingId),
    getRecordingBackupChunks(recordingId),
  ]);
  if (!meta || chunks.length === 0) {
    throw new Error(
      "This clip's recorded data isn't saved in this browser, so it can only be retried from the device it was recorded on.",
    );
  }
  // A copy whose end never arrived is finished from the recovery prompt,
  // which uploads it with a partial warning and keeps the copy.
  if (meta.incomplete || !isCompleteRecordingBackup(meta, chunks)) {
    throw new Error(
      "This browser's local recording backup is incomplete and can't be safely retried.",
    );
  }

  const attemptId = crypto.randomUUID();
  const resumeUrl = `${appBasePath()}/api/uploads/${recordingId}/resume?attemptId=${encodeURIComponent(attemptId)}`;
  const resumeRes = await fetch(resumeUrl, { method: "GET" });
  if (!resumeRes.ok) {
    // coercion-ok: response text only enriches an already-failing claim error.
    const text = await resumeRes.text().catch(() => "");
    throw new Error(
      `Couldn't claim the upload retry (resume ${resumeRes.status}). ${
        text || resumeRes.statusText
      }`,
    );
  }
  let resume: {
    resumable?: unknown;
    attemptId?: unknown;
    uploadGenerationId?: unknown;
  };
  try {
    resume = (await resumeRes.json()) as typeof resume;
  } catch {
    throw new Error("The upload retry claim returned an unreadable response.");
  }
  if (resume.resumable !== true || resume.attemptId !== attemptId) {
    throw new Error("The upload retry could not claim this recording.");
  }
  const claimedGenerationId =
    typeof resume.uploadGenerationId === "string" && resume.uploadGenerationId
      ? resume.uploadGenerationId
      : undefined;

  const resetUrl = `${appBasePath()}/api/uploads/${recordingId}/reset-chunks`;
  const resetRes = await fetch(resetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestStreaming: true,
      mimeType: meta.mimeType,
      attemptId,
      useGenerationFence: true,
      ...(claimedGenerationId
        ? { uploadGenerationId: claimedGenerationId }
        : {}),
    }),
  });
  if (!resetRes.ok) {
    // coercion-ok: the request already failed; this only fills in the
    // human-readable detail on the error we're about to throw.
    const text = await resetRes.text().catch(() => "");
    throw new Error(
      `Couldn't restart the upload (reset-chunks ${resetRes.status}). ${
        text || resetRes.statusText
      }`,
    );
  }
  let reset: { uploadGenerationId?: unknown };
  try {
    reset = (await resetRes.json()) as typeof reset;
  } catch {
    throw new Error("Upload retry setup returned an unreadable response.");
  }
  if (
    typeof reset.uploadGenerationId !== "string" ||
    !reset.uploadGenerationId
  ) {
    throw new Error("Upload retry setup returned no upload generation.");
  }
  const uploadGenerationId = reset.uploadGenerationId;

  const chunkBaseUrl = `${appBasePath()}/api/uploads/${recordingId}/chunk`;
  const recordingBlob = new Blob(
    chunks.map((chunk) => chunk.blob),
    { type: meta.mimeType },
  );
  const total = Math.ceil(recordingBlob.size / UPLOAD_SLICE_BYTES);
  let result: Record<string, unknown> | undefined;

  for (let index = 0; index < total; index++) {
    const isFinal = index === total - 1;
    const url = chunkUploadUrl(chunkBaseUrl, {
      index,
      total,
      isFinal,
      mimeType: meta.mimeType,
      attemptId,
      uploadGenerationId,
      ...(isFinal
        ? {
            durationMs: meta.durationMs,
            width: meta.width,
            height: meta.height,
            hasAudio: meta.hasAudio,
            hasCamera: meta.hasCamera,
          }
        : {}),
    });
    const start = index * UPLOAD_SLICE_BYTES;
    const end = Math.min(start + UPLOAD_SLICE_BYTES, recordingBlob.size);
    const body = await recordingBlob
      .slice(start, end, meta.mimeType)
      .arrayBuffer();
    const res = await uploadChunkRequest({
      url,
      contentType: meta.mimeType || "application/octet-stream",
      body,
    });
    if (!res.ok) {
      // coercion-ok: the request already failed; this only fills in the
      // human-readable detail on the error we're about to throw.
      const text = await res.text().catch(() => "");
      throw new Error(
        `Upload failed on chunk ${index + 1} of ${total} (${res.status}). ${
          text || res.statusText
        }`,
      );
    }
    // coercion-ok: an unparsable 2xx body leaves `status`/`videoUrl` unknown
    // below, which the caller already treats as "not confirmed ready" and
    // keeps the local backup — it never gets coerced into a false success.
    result = (await res.json().catch(() => undefined)) as
      | Record<string, unknown>
      | undefined;
  }

  const status = typeof result?.status === "string" ? result.status : undefined;
  const videoUrl =
    typeof result?.videoUrl === "string" ? result.videoUrl : null;

  const proof = verifyServerCopy(
    {
      sourceSizeBytes:
        typeof result?.sourceSizeBytes === "number"
          ? result.sourceSizeBytes
          : null,
      durationMs:
        typeof result?.durationMs === "number" ? result.durationMs : null,
    },
    { bytes: meta.bytes, durationMs: meta.durationMs },
  );
  if (status === "ready" && mayDelete && proof === "verified") {
    await deleteRecordingBackup(recordingId).catch((err: unknown) => {
      // coercion-ok: the clip is saved; a leftover copy is reconciled by the next scan.
      console.warn("[clips] deleting the retried local copy failed:", err);
    });
  }

  return { status, videoUrl };
}
