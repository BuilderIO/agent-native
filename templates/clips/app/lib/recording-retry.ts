import { appBasePath } from "@agent-native/core/client/api-path";
import { chunkUploadUrl, UPLOAD_SLICE_BYTES } from "@shared/recording-core";

import {
  deleteRecordingBackup,
  getRecordingBackupChunks,
  getRecordingBackupMeta,
  isCompleteRecordingBackup,
} from "./recording-backup";
import { uploadChunkRequest } from "./upload-request";

export { hasRecordingBackup } from "./recording-backup";

export interface RetryRecordingUploadResult {
  status?: string;
  videoUrl?: string | null;
}

export async function retryRecordingUploadFromBackup(
  recordingId: string,
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
  if (!isCompleteRecordingBackup(meta, chunks)) {
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
      const text = await res.text().catch(() => "");
      throw new Error(
        `Upload failed on chunk ${index + 1} of ${total} (${res.status}). ${
          text || res.statusText
        }`,
      );
    }
    // coercion-ok: an unparsable 2xx body leaves `status`/`videoUrl` unknown
    result = (await res.json().catch(() => undefined)) as
      | Record<string, unknown>
      | undefined;
  }

  const status = typeof result?.status === "string" ? result.status : undefined;
  const videoUrl =
    typeof result?.videoUrl === "string" ? result.videoUrl : null;

  if (status === "ready") {
    await deleteRecordingBackup(recordingId).catch(() => {});
  }

  return { status, videoUrl };
}
