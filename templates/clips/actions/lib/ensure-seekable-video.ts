import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../../server/db/index.js";
import { queueBuilderMediaCompression } from "../../server/lib/builder-media-compression.js";
import { allowsLegacyS3ObjectForPersistedMedia } from "../../server/lib/media-storage-provenance.js";
import {
  deleteRecordingMediaObjects,
  deleteSupersededHostedMedia,
} from "../../server/lib/recording-media-cleanup.js";
import { ownerEmailMatches } from "../../server/lib/recordings.js";
import { fetchS3ObjectByUrl } from "../../server/lib/s3-upload-provider.js";
import { clearSeekableRepairPending } from "../../server/lib/seekable-media-state.js";
import { uploadRecordingMedia } from "../../server/lib/upload-recording-media.js";
import {
  makeSeekable,
  normalizeTimelineToMp4,
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

// The signed reader's timeout covers the headers only, so a body that stalls
// mid-stream would otherwise hang the job. Reading chunk by chunk lets the
// reader be cancelled, which tears the request down; a whole-body read
// locks the stream and cannot be.
async function readBodyWithIdleTimeout(
  res: Response,
  idleMs: number,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`Media body stalled for ${idleMs}ms`);
        reader.cancel(err).catch(() => {});
        reject(err);
      }, idleMs);
    });
    let step: ReadableStreamReadResult<Uint8Array>;
    try {
      step = await Promise.race([reader.read(), stalled]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (step.done) break;
    chunks.push(step.value);
    total += step.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function fetchProviderBytes(
  videoUrl: string,
  options: {
    recordingId?: string;
    storageMode?: "own" | "hosted" | null;
    allowLegacyObjectKey?: boolean;
  } = {},
): Promise<
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "skipped-fetch-failed" | "skipped-too-large" }
> {
  // A private own bucket answers an unsigned read of the stored URL with
  // 401, so own storage is read signed first; hosted must never fall back
  // to an unsigned read.
  const hosted = options.storageMode === "hosted";
  let res: Response | null = null;
  if (options.recordingId) {
    try {
      res = await fetchS3ObjectByUrl(videoUrl, {
        recordingId: options.recordingId,
        storageMode: hosted ? "hosted" : "own",
        timeoutMs: PROVIDER_FETCH_TIMEOUT_MS,
        ...(options.allowLegacyObjectKey && !hosted
          ? { allowLegacyObjectKey: true }
          : {}),
      });
    } catch (err) {
      console.warn("[ensure-seekable-video] signed storage read failed", {
        recordingId: options.recordingId,
        storageMode: hosted ? "hosted" : "own",
        error: err instanceof Error ? err.message : String(err),
      });
      if (hosted) return { ok: false, reason: "skipped-fetch-failed" };
    }
    if (res && !res.ok) {
      console.warn("[ensure-seekable-video] signed storage read refused", {
        recordingId: options.recordingId,
        storageMode: hosted ? "hosted" : "own",
        status: res.status,
      });
      await res.body?.cancel().catch(() => {});
      if (hosted) return { ok: false, reason: "skipped-fetch-failed" };
      res = null;
    }
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!res) {
      if (hosted) return { ok: false, reason: "skipped-fetch-failed" };
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), PROVIDER_FETCH_TIMEOUT_MS);
      res = await fetch(videoUrl, { signal: controller.signal });
      clearTimeout(timeout);
      timeout = undefined;
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, reason: "skipped-fetch-failed" };
      }
    }

    const declaredLength = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: "skipped-too-large" };
    }

    const buf = await readBodyWithIdleTimeout(
      res,
      PROVIDER_FETCH_TIMEOUT_MS,
      MAX_UPLOAD_BYTES,
    );
    if (buf.byteLength === 0)
      return { ok: false, reason: "skipped-fetch-failed" };
    if (buf.byteLength > MAX_UPLOAD_BYTES) {
      return { ok: false, reason: "skipped-too-large" };
    }
    return { ok: true, bytes: buf };
  } catch {
    return { ok: false, reason: "skipped-fetch-failed" };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
      editsJson: schema.recordings.editsJson,
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
    allowLegacyObjectKey: allowsLegacyS3ObjectForPersistedMedia({
      requestedUrl: rec.videoUrl,
      persistedUrl: rec.videoUrl,
      editsJson: rec.editsJson,
    }),
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

  if (!seekable.changed) {
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

  const outputFormat: VideoFormat = normalizeTimeline ? "mp4" : videoFormat;
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
