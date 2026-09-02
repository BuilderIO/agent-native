import { writeAppState } from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";
import { and, eq, isNull } from "drizzle-orm";

import { parseEdits } from "../../app/lib/timestamp-mapping.js";
import { isLoomEmbedBackedRecording } from "../../shared/loom.js";
import { getDb, schema } from "../db/index.js";
import {
  loadRecordingMediaBytes,
  type PublicAgentRecording,
} from "./public-agent-context.js";
import { deleteRecordingMediaObjects } from "./recording-media-cleanup.js";
import { ownerEmailMatches } from "./recordings.js";
import { extractJpegFrame, VideoFrameExtractionError } from "./video-frame.js";

export const RECORDING_THUMBNAIL_AT_MS = 350;

export type EnsureRecordingThumbnailStatus =
  | "generated"
  | "already-set"
  | "not-found"
  | "skipped-not-ready"
  | "skipped-no-media"
  | "skipped-loom-embed"
  | "skipped-media-fetch"
  | "skipped-frame-extraction"
  | "skipped-upload-failed"
  | "skipped-race";

export interface EnsureRecordingThumbnailResult {
  recordingId: string;
  status: EnsureRecordingThumbnailStatus;
  changed: boolean;
  thumbnailUrl?: string | null;
  detail?: string;
}

function fallbackMimeType(videoFormat: string | null | undefined): string {
  return videoFormat === "mp4" ? "video/mp4" : "video/webm";
}

function normalizeMimeType(
  mimeType: string | null | undefined,
  videoFormat: string | null | undefined,
): string {
  const normalized = mimeType?.split(";")[0]?.trim().toLowerCase();
  return normalized?.startsWith("video/")
    ? (mimeType ?? fallbackMimeType(videoFormat))
    : fallbackMimeType(videoFormat);
}

async function extractThumbnailFrame(
  mediaBytes: Uint8Array,
  mimeType: string,
): Promise<Uint8Array> {
  try {
    return await extractJpegFrame({
      mediaBytes,
      mimeType,
      atMs: RECORDING_THUMBNAIL_AT_MS,
    });
  } catch (error) {
    if (
      !(error instanceof VideoFrameExtractionError) ||
      error.code !== "NO_VIDEO"
    ) {
      throw error;
    }

    return extractJpegFrame({
      mediaBytes,
      mimeType,
      atMs: 0,
    });
  }
}

async function loadRecording(
  recordingId: string,
  ownerEmail: string,
): Promise<PublicAgentRecording | null> {
  const [recording] = await getDb()
    .select()
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );
  return recording ?? null;
}

/**
 * Persist one still thumbnail for a ready recording when the upload path did
 * not already provide one. The thumbnail update is compare-and-set so a user
 * or another upload cannot be overwritten while frame extraction runs.
 */
export async function ensureRecordingThumbnail(params: {
  recordingId: string;
  ownerEmail: string;
  mediaBytes?: Uint8Array;
  thumbnailBytes?: Uint8Array;
  mimeType?: string;
  replaceNonEditorThumbnail?: boolean;
}): Promise<EnsureRecordingThumbnailResult> {
  const {
    recordingId,
    ownerEmail,
    mediaBytes: suppliedBytes,
    thumbnailBytes: suppliedThumbnail,
  } = params;
  const recording = await loadRecording(recordingId, ownerEmail);

  if (!recording) return { recordingId, status: "not-found", changed: false };

  const existingThumbnailUrl = recording.thumbnailUrl?.trim() || null;
  const suppliedThumbnailBytes = suppliedThumbnail?.byteLength
    ? suppliedThumbnail
    : undefined;
  const hasEditorThumbnail = Boolean(parseEdits(recording.editsJson).thumbnail);
  const replaceExisting = Boolean(
    params.replaceNonEditorThumbnail &&
    existingThumbnailUrl &&
    !hasEditorThumbnail,
  );

  if (existingThumbnailUrl && !replaceExisting) {
    return {
      recordingId,
      status: "already-set",
      changed: false,
      thumbnailUrl: existingThumbnailUrl,
    };
  }
  if (recording.status !== "ready") {
    return { recordingId, status: "skipped-not-ready", changed: false };
  }
  if (!recording.videoUrl && !suppliedBytes && !suppliedThumbnailBytes) {
    return { recordingId, status: "skipped-no-media", changed: false };
  }

  let bytes = suppliedBytes;
  let mimeType = normalizeMimeType(params.mimeType, recording.videoFormat);
  if (!bytes && !suppliedThumbnailBytes) {
    if (!recording.videoUrl) {
      return { recordingId, status: "skipped-no-media", changed: false };
    }
    try {
      if (isLoomEmbedBackedRecording(recording)) {
        return { recordingId, status: "skipped-loom-embed", changed: false };
      }
      const media = await loadRecordingMediaBytes(recording);
      bytes = media.bytes;
      mimeType = media.mimeType;
    } catch (error) {
      console.warn("[clips] recording thumbnail media fetch skipped", {
        recordingId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        recordingId,
        status: "skipped-media-fetch",
        changed: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (!bytes?.byteLength && !suppliedThumbnailBytes) {
    return { recordingId, status: "skipped-no-media", changed: false };
  }

  let frame = suppliedThumbnailBytes;
  if (!frame) {
    try {
      frame = await extractThumbnailFrame(bytes!, mimeType);
    } catch (error) {
      console.warn("[clips] recording thumbnail frame extraction skipped", {
        recordingId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        recordingId,
        status: "skipped-frame-extraction",
        changed: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const uploaded = await uploadFile({
    data: frame,
    filename: `thumb-${recordingId}.jpg`,
    mimeType: "image/jpeg",
    ownerEmail,
    recordAsset: false,
  }).catch((error) => {
    console.warn("[clips] recording thumbnail upload skipped", {
      recordingId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (!uploaded?.url) {
    return { recordingId, status: "skipped-upload-failed", changed: false };
  }

  const updated = await getDb()
    .update(schema.recordings)
    .set({
      thumbnailUrl: uploaded.url,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        recording.videoUrl
          ? eq(schema.recordings.videoUrl, recording.videoUrl)
          : isNull(schema.recordings.videoUrl),
        recording.thumbnailUrl !== null && replaceExisting
          ? eq(schema.recordings.thumbnailUrl, recording.thumbnailUrl)
          : recording.thumbnailUrl == null
            ? isNull(schema.recordings.thumbnailUrl)
            : eq(schema.recordings.thumbnailUrl, recording.thumbnailUrl),
        recording.editsJson == null
          ? isNull(schema.recordings.editsJson)
          : eq(schema.recordings.editsJson, recording.editsJson),
      ),
    )
    .returning({
      id: schema.recordings.id,
      thumbnailUrl: schema.recordings.thumbnailUrl,
    });

  if (updated.length !== 1 || updated[0]?.thumbnailUrl !== uploaded.url) {
    await deleteRecordingMediaObjects({
      id: recordingId,
      thumbnailUrl: uploaded.url,
    }).catch(() => {});
    const current = await loadRecording(recordingId, ownerEmail).catch(
      () => null,
    );
    if (current?.thumbnailUrl) {
      return {
        recordingId,
        status: "already-set",
        changed: false,
        thumbnailUrl: current.thumbnailUrl,
      };
    }
    return {
      recordingId,
      status: "skipped-race",
      changed: false,
      detail: "Recording changed while its thumbnail was uploading.",
    };
  }

  await writeAppState("refresh-signal", { ts: Date.now() }).catch(() => {});

  return {
    recordingId,
    status: "generated",
    changed: true,
    thumbnailUrl: uploaded.url,
  };
}
