import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { and, eq, sql, type SQL } from "drizzle-orm";

import { getDb, schema } from "../../server/db/index.js";
import { queueBuilderMediaCompression } from "../../server/lib/builder-media-compression.js";
import {
  deleteRecordingMediaObjects,
  deleteSupersededHostedMedia,
} from "../../server/lib/recording-media-cleanup.js";
import {
  fillMediaFacts,
  isMissingMediaFacts,
} from "../../server/lib/recording-media-facts.js";
import { ownerEmailMatches } from "../../server/lib/recordings.js";
import { fetchS3ObjectByUrl } from "../../server/lib/s3-upload-provider.js";
import { clearSeekableRepairPending } from "../../server/lib/seekable-media-state.js";
import { uploadRecordingMedia } from "../../server/lib/upload-recording-media.js";
import {
  makeSeekable,
  normalizeTimelineToMp4,
  probeMediaInfo,
  type VideoFormat,
} from "../../server/lib/video-remux.js";
import { isLoomRecordingSource } from "../../shared/loom.js";
import { isYouTubeEmbedBackedRecording } from "../../shared/youtube.js";

const PROVIDER_FETCH_TIMEOUT_MS = 60_000;

export type EnsureSeekableStatus =
  | "optimized"
  | "already-optimized"
  | "skipped-not-ready"
  | "skipped-no-media"
  | "skipped-local-media"
  | "skipped-too-large"
  | "skipped-fetch-failed"
  | "skipped-normalize-failed"
  | "skipped-upload-failed"
  | "not-found";

export interface EnsureSeekableResult {
  recordingId: string;
  status: EnsureSeekableStatus;
  changed: boolean;
  videoUrl?: string | null;
  detail?: string;
}

export function seekableMarkerKey(recordingId: string): string {
  return `recording-seekable-${recordingId}`;
}

export async function markRecordingSeekable(
  recordingId: string,
  videoUrl: string | null | undefined,
): Promise<void> {
  await writeAppState(seekableMarkerKey(recordingId), {
    recordingId,
    videoUrl: videoUrl ?? null,
    at: new Date().toISOString(),
  });
}

async function isAlreadyMarked(
  recordingId: string,
  videoUrl: string | null,
): Promise<boolean> {
  const marker = await readAppState(seekableMarkerKey(recordingId)).catch(
    () => null,
  );
  return Boolean(
    marker &&
    typeof marker === "object" &&
    (marker as { videoUrl?: unknown }).videoUrl === videoUrl,
  );
}

export function isRemoteProviderUrl(
  videoUrl: string | null | undefined,
): boolean {
  return typeof videoUrl === "string" && /^https:\/\//i.test(videoUrl.trim());
}

export async function fetchProviderBytes(
  videoUrl: string,
  options: {
    recordingId?: string;
    storageMode?: "own" | "hosted" | null;
    /** Refuse anything larger than this; defaults to the upload limit. */
    maxBytes?: number;
  } = {},
): Promise<
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "skipped-fetch-failed" | "skipped-too-large" }
> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PROVIDER_FETCH_TIMEOUT_MS,
  );
  try {
    const res =
      options.storageMode === "hosted"
        ? options.recordingId
          ? await fetchS3ObjectByUrl(videoUrl, {
              recordingId: options.recordingId,
              storageMode: "hosted",
              timeoutMs: PROVIDER_FETCH_TIMEOUT_MS,
            })
          : null
        : await fetch(videoUrl, { signal: controller.signal });
    if (!res) return { ok: false, reason: "skipped-fetch-failed" };
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: "skipped-fetch-failed" };
    }

    const declaredLength = Number(res.headers.get("content-length") ?? "0");
    const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES;
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: "skipped-too-large" };
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0)
      return { ok: false, reason: "skipped-fetch-failed" };
    if (buf.byteLength > maxBytes) {
      return { ok: false, reason: "skipped-too-large" };
    }
    return { ok: true, bytes: buf };
  } catch {
    return { ok: false, reason: "skipped-fetch-failed" };
  } finally {
    clearTimeout(timeout);
  }
}

type MeasuredMediaColumns = {
  durationMs?: SQL;
  width?: SQL;
  height?: SQL;
  hasAudio?: false;
};

/**
 * A streamed upload goes straight to storage, past finalize's look at the
 * file, so this job is the first to hold its bytes. Returns what the file
 * adds to the row, as values the database checks against the row when it
 * writes, so a job that read the row earlier can't undo another's: a length
 * or size only fills a column still at 0, and the audio flag only turns
 * false, when the file has no audio stream. Null when the file adds nothing.
 */
async function measureMedia(
  rec: { durationMs: number; width: number; height: number; hasAudio: boolean },
  mediaBytes: Uint8Array,
  videoFormat: VideoFormat,
): Promise<MeasuredMediaColumns | null> {
  const given = {
    durationMs: rec.durationMs,
    width: rec.width,
    height: rec.height,
  };
  if (!rec.hasAudio && !isMissingMediaFacts(given)) return null;

  const probed = await probeMediaInfo(mediaBytes, videoFormat);
  const measured = fillMediaFacts(given, probed);
  const columns: MeasuredMediaColumns = {};
  for (const key of ["durationMs", "width", "height"] as const) {
    if (measured[key] !== given[key]) {
      columns[key] =
        sql`coalesce(nullif(${schema.recordings[key]}, 0), ${measured[key]})`;
    }
  }
  if (rec.hasAudio && probed.hasAudio === false) columns.hasAudio = false;
  return Object.keys(columns).length > 0 ? columns : null;
}

/**
 * Saves what the file adds when this job leaves the media as it is. Leaves
 * `mediaUpdatedAt` alone: the media hasn't changed, and transcripts are tied
 * to it.
 */
async function saveMeasuredMedia(
  rec: { id: string; videoUrl: string; mediaUpdatedAt: string },
  ownerEmail: string,
  columns: MeasuredMediaColumns,
): Promise<void> {
  await getDb()
    .update(schema.recordings)
    .set({ ...columns, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.recordings.id, rec.id),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        eq(schema.recordings.videoUrl, rec.videoUrl),
        // Any media replacement moves this, even one that keeps the URL.
        eq(schema.recordings.mediaUpdatedAt, rec.mediaUpdatedAt),
      ),
    );
  await writeAppState("refresh-signal", { ts: Date.now() });
}

async function ensureRecordingSeekableInternal(params: {
  recordingId: string;
  ownerEmail: string;
  force?: boolean;
  normalizeTimeline?: boolean;
}): Promise<EnsureSeekableResult> {
  const {
    recordingId,
    ownerEmail,
    force = false,
    normalizeTimeline = false,
  } = params;
  const db = getDb();

  const [rec] = await db
    .select({
      id: schema.recordings.id,
      status: schema.recordings.status,
      videoUrl: schema.recordings.videoUrl,
      videoFormat: schema.recordings.videoFormat,
      storageMode: schema.recordings.storageMode,
      sourceAppName: schema.recordings.sourceAppName,
      durationMs: schema.recordings.durationMs,
      width: schema.recordings.width,
      height: schema.recordings.height,
      hasAudio: schema.recordings.hasAudio,
      mediaUpdatedAt: schema.recordings.mediaUpdatedAt,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );

  if (!rec) {
    return { recordingId, status: "not-found", changed: false };
  }
  if (rec.status !== "ready") {
    return { recordingId, status: "skipped-not-ready", changed: false };
  }
  if (isLoomRecordingSource(rec) || isYouTubeEmbedBackedRecording(rec)) {
    return { recordingId, status: "skipped-local-media", changed: false };
  }
  if (!rec.videoUrl) {
    return { recordingId, status: "skipped-no-media", changed: false };
  }
  if (!isRemoteProviderUrl(rec.videoUrl)) {
    return {
      recordingId,
      status: "skipped-local-media",
      changed: false,
      videoUrl: rec.videoUrl,
    };
  }

  if (
    !normalizeTimeline &&
    !force &&
    (await isAlreadyMarked(recordingId, rec.videoUrl))
  ) {
    return {
      recordingId,
      status: "already-optimized",
      changed: false,
      videoUrl: rec.videoUrl,
    };
  }

  const fetched = await fetchProviderBytes(rec.videoUrl, {
    recordingId,
    storageMode: rec.storageMode,
  });
  if (!fetched.ok) {
    return { recordingId, status: fetched.reason, changed: false };
  }

  const videoFormat: VideoFormat = rec.videoFormat === "mp4" ? "mp4" : "webm";
  const seekable = normalizeTimeline
    ? await normalizeTimelineToMp4({
        mediaBytes: fetched.bytes,
        videoFormat,
      })
    : await makeSeekable({
        mediaBytes: fetched.bytes,
        videoFormat,
      });
  const outputFormat: VideoFormat = normalizeTimeline ? "mp4" : videoFormat;

  // Measured from the bytes that stay the recording's media: when they are
  // new, the numbers are written with the swap below, never before it.
  const measuredColumns = await measureMedia(
    rec,
    seekable.bytes,
    seekable.changed ? outputFormat : videoFormat,
  ).catch((err) => {
    console.warn("[ensure-seekable-video] measuring media failed", {
      recordingId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });

  if (!seekable.changed) {
    if (measuredColumns) {
      await saveMeasuredMedia(
        {
          id: recordingId,
          videoUrl: rec.videoUrl,
          mediaUpdatedAt: rec.mediaUpdatedAt,
        },
        ownerEmail,
        measuredColumns,
      ).catch((err) => {
        console.warn("[ensure-seekable-video] saving measured media failed", {
          recordingId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    if (normalizeTimeline) {
      return {
        recordingId,
        status: "skipped-normalize-failed",
        changed: false,
        videoUrl: rec.videoUrl,
        detail:
          "Timeline normalization could not produce a verified MP4; the original recording was left unchanged.",
      };
    }
    await markRecordingSeekable(recordingId, rec.videoUrl);
    return {
      recordingId,
      status: "already-optimized",
      changed: false,
      videoUrl: rec.videoUrl,
    };
  }

  const mimeType = outputFormat === "mp4" ? "video/mp4" : "video/webm";
  const upload = await uploadRecordingMedia({
    recordingId,
    data: seekable.bytes,
    filename: `${recordingId}.${outputFormat}`,
    mimeType,
    ownerEmail,
    stableUrl: true,
    recordAsset: false,
  }).catch((err) => {
    console.warn("[ensure-seekable-video] repaired media upload failed", {
      recordingId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });

  if (!upload?.url) {
    return {
      recordingId,
      status: "skipped-upload-failed",
      changed: false,
      videoUrl: rec.videoUrl,
    };
  }

  const updated = await db
    .update(schema.recordings)
    .set({
      ...measuredColumns,
      videoUrl: upload.url,
      videoFormat: outputFormat,
      videoSizeBytes: seekable.bytes.byteLength,
      mediaUpdatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        eq(schema.recordings.videoUrl, rec.videoUrl),
      ),
    )
    .returning({
      id: schema.recordings.id,
      videoUrl: schema.recordings.videoUrl,
      videoFormat: schema.recordings.videoFormat,
    });

  if (
    updated.length !== 1 ||
    updated[0]?.videoUrl !== upload.url ||
    updated[0]?.videoFormat !== outputFormat
  ) {
    await deleteRecordingMediaObjects(
      {
        id: recordingId,
        storageMode: rec.storageMode,
        videoUrl: upload.url,
      },
      { protectedUrls: [rec.videoUrl] },
    );
    return {
      recordingId,
      status: "skipped-upload-failed",
      changed: false,
      videoUrl: rec.videoUrl,
      detail: "Recording changed while repaired media was uploading.",
    };
  }

  if (rec.storageMode === "hosted") {
    await deleteSupersededHostedMedia(rec.videoUrl, {
      recordingId,
      replacementUrl: upload.url,
    });
  }
  await markRecordingSeekable(recordingId, upload.url);
  await writeAppState("refresh-signal", { ts: Date.now() });

  void queueBuilderMediaCompression({
    recordingId,
    ownerEmail,
    videoUrl: upload.url,
    mimeType,
    providerId: upload.provider,
    assetDbId: upload.id,
    sourceSizeBytes: seekable.bytes.byteLength,
    locallyTranscoded: normalizeTimeline,
  }).catch((err) => {
    console.warn("[ensure-seekable-video] media compression queue failed", {
      recordingId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return {
    recordingId,
    status: "optimized",
    changed: true,
    videoUrl: upload.url,
  };
}

export async function ensureRecordingSeekable(params: {
  recordingId: string;
  ownerEmail: string;
  force?: boolean;
  normalizeTimeline?: boolean;
}): Promise<EnsureSeekableResult> {
  const result = await ensureRecordingSeekableInternal(params);
  if (result.changed || result.status === "already-optimized") {
    await clearSeekableRepairPending(params.recordingId).catch((err) => {
      console.warn("[ensure-seekable-video] failed to clear pending marker", {
        recordingId: params.recordingId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
  return result;
}
