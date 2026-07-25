import { writeAppState } from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../../server/db/index.js";
import { queueBuilderMediaCompression } from "../../server/lib/builder-media-compression.js";
import {
  extractLoomVideoId,
  normalizeLoomShareUrl,
} from "../../shared/loom.js";
import {
  fetchLoomTranscript,
  loomTranscriptUnavailableMessage,
} from "./loom-transcript.js";
import { downloadLoomVideo } from "./loom-video.js";

export type LoomImportJobResult = {
  status: "ready" | "failed";
  failureReason?: string;
};

async function failLoomImport(
  recordingId: string,
  failureReason: string,
): Promise<LoomImportJobResult> {
  const now = new Date().toISOString();
  await getDb()
    .update(schema.recordings)
    .set({ status: "failed", failureReason, updatedAt: now })
    .where(eq(schema.recordings.id, recordingId));
  await writeAppState(`recording-upload-${recordingId}`, {
    recordingId,
    status: "failed",
    failureReason,
    updatedAt: now,
  });
  await writeAppState("refresh-signal", { ts: Date.now() });
  return { status: "failed", failureReason };
}

/**
 * Downloads a Loom video and re-uploads it to Clips storage, off the request
 * that created the "processing" row. Loom's CDN plus a reupload can outlast a
 * synchronous serverless function's execution ceiling; running it here keeps
 * import-loom-recording's own request fast regardless of Loom video length.
 */
export async function runLoomImportJob({
  recordingId,
  ownerEmail,
}: {
  recordingId: string;
  ownerEmail: string;
}): Promise<LoomImportJobResult> {
  const db = getDb();
  const [recording] = await db
    .select({
      id: schema.recordings.id,
      durationMs: schema.recordings.durationMs,
      sourceWindowTitle: schema.recordings.sourceWindowTitle,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId));

  const shareUrl = normalizeLoomShareUrl(recording?.sourceWindowTitle ?? "");
  const loomId = shareUrl ? extractLoomVideoId(shareUrl) : null;
  if (!recording || !shareUrl || !loomId) {
    return failLoomImport(
      recordingId,
      "This Loom recording is missing its source URL.",
    );
  }

  let media: Awaited<ReturnType<typeof downloadLoomVideo>>;
  try {
    media = await downloadLoomVideo({ loomId, shareUrl });
  } catch (err) {
    return failLoomImport(
      recordingId,
      err instanceof Error ? err.message : String(err),
    );
  }

  const upload = await uploadFile({
    data: media.bytes,
    filename: `${recordingId}.mp4`,
    mimeType: media.mimeType,
    ownerEmail,
    stableUrl: true,
    recordAsset: false,
  });
  if (!upload?.url) {
    return failLoomImport(
      recordingId,
      "File upload returned no URL. Check your storage provider configuration.",
    );
  }

  const now = new Date().toISOString();
  await db
    .update(schema.recordings)
    .set({
      videoUrl: upload.url,
      videoSizeBytes: media.sizeBytes,
      status: "ready",
      failureReason: null,
      updatedAt: now,
    })
    .where(eq(schema.recordings.id, recordingId));

  void queueBuilderMediaCompression({
    recordingId,
    ownerEmail,
    videoUrl: upload.url,
    mimeType: media.mimeType,
    providerId: upload.provider,
    assetDbId: upload.id,
    sourceSizeBytes: media.sizeBytes,
  }).catch((err) => {
    console.warn("[clips] Loom media compression queue failed", {
      recordingId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  let transcript: Awaited<ReturnType<typeof fetchLoomTranscript>> = null;
  try {
    transcript = await fetchLoomTranscript({
      shareUrl,
      durationMs: recording.durationMs,
    });
  } catch (err) {
    console.warn(
      `[clips] Loom transcript import skipped for ${loomId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  const transcriptValues = {
    ownerEmail,
    language: transcript?.language ?? "en",
    segmentsJson: transcript ? JSON.stringify(transcript.segments) : "[]",
    fullText: transcript?.fullText ?? "",
    status: transcript ? ("ready" as const) : ("failed" as const),
    failureReason: transcript ? null : loomTranscriptUnavailableMessage(),
    updatedAt: now,
  };
  const [existingTranscript] = await db
    .select({ recordingId: schema.recordingTranscripts.recordingId })
    .from(schema.recordingTranscripts)
    .where(eq(schema.recordingTranscripts.recordingId, recordingId));
  if (existingTranscript) {
    await db
      .update(schema.recordingTranscripts)
      .set(transcriptValues)
      .where(eq(schema.recordingTranscripts.recordingId, recordingId));
  } else {
    await db.insert(schema.recordingTranscripts).values({
      recordingId,
      ...transcriptValues,
      createdAt: now,
    });
  }

  await writeAppState(`recording-upload-${recordingId}`, {
    recordingId,
    status: "ready",
    progress: 100,
    videoUrl: upload.url,
    updatedAt: now,
  });
  await writeAppState("refresh-signal", { ts: Date.now() });

  return { status: "ready" };
}
