/**
 * Retry a web-originated recording upload that failed or stalled, using the
 * chunks this browser mirrored to IndexedDB while recording (see
 * `recording-backup.ts`). This talks to the same `reset-chunks` / `chunk`
 * upload routes the live recorder uses (`recorder-engine.ts`) and the
 * desktop app's own local-backup retry uses — there is no separate retry
 * action, this is the one retry path apps replay the saved chunks through.
 *
 * Retry only works in the browser that made the recording: the raw video
 * bytes never reach the server until the upload finishes, so a browser that
 * never captured them has nothing to replay. Callers must check
 * `hasRecordingBackup()` first and tell the user plainly when it's false
 * rather than showing a retry button that can't succeed.
 */
import { appBasePath } from "@agent-native/core/client/api-path";
import { chunkUploadUrl } from "@shared/recording-core";

import {
  deleteRecordingBackup,
  getRecordingBackupChunks,
  getRecordingBackupMeta,
} from "./recording-backup";

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

  const resetUrl = `${appBasePath()}/api/uploads/${recordingId}/reset-chunks`;
  const resetRes = await fetch(resetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mimeType: meta.mimeType }),
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
  // coercion-ok: a malformed 2xx body just means no generation id to carry
  // forward — the chunk route accepts chunks with no uploadGenerationId too.
  const reset = (await resetRes.json().catch(() => null)) as {
    uploadGenerationId?: unknown;
  } | null;
  const uploadGenerationId =
    typeof reset?.uploadGenerationId === "string" && reset.uploadGenerationId
      ? reset.uploadGenerationId
      : undefined;

  const chunkBaseUrl = `${appBasePath()}/api/uploads/${recordingId}/chunk`;
  const total = chunks.length;
  let result: Record<string, unknown> | undefined;

  for (let index = 0; index < total; index++) {
    const isFinal = index === total - 1;
    const url = chunkUploadUrl(chunkBaseUrl, {
      index,
      total,
      isFinal,
      mimeType: meta.mimeType,
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
    const body = await chunks[index].arrayBuffer();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": meta.mimeType || "application/octet-stream",
      },
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

  // Only drop the local copy once the clip is fully verified and ready.
  // "processing" means finalize hasn't confirmed the media yet, so keep the
  // backup around the same way the desktop retry keeps its local file until
  // verification lands — otherwise a failed verification has nothing left
  // to retry from.
  if (status === "ready") {
    await deleteRecordingBackup(recordingId).catch(() => {});
  }

  return { status, videoUrl };
}
