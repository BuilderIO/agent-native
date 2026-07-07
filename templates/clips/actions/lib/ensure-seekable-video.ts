/**
 * Repair an already-stored recording so it plays back and seeks instantly.
 *
 * This is the fetch-based counterpart to the inline seekable pass in
 * `finalize-recording`. It re-fetches a recording's stored provider media,
 * runs the format-appropriate seekable rewrite (MP4 faststart / WebM Cues
 * remux), and, when that changed the bytes, re-uploads the fixed file and
 * repoints the recording at it.
 *
 * Used by:
 *   - `reprocess-recording` — owner/agent triggered backfill of clips that were
 *     uploaded before the seekable pass existed (or via the streaming path,
 *     which never applied it).
 *   - `finalize-recording` — a best-effort background pass for the resumable
 *     streaming path, whose bytes live at the provider and were never buffered
 *     server-side for an inline rewrite.
 *
 * Everything is best-effort and non-destructive: if we can't fetch, can't
 * improve, or can't re-upload, the existing recording is left exactly as-is.
 */

import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";
import { MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../../server/db/index.js";
import { queueBuilderMediaCompression } from "../../server/lib/builder-media-compression.js";
import { ownerEmailMatches } from "../../server/lib/recordings.js";
import {
  makeSeekable,
  type VideoFormat,
} from "../../server/lib/video-remux.js";
import { isLoomRecordingSource } from "../../shared/loom.js";

const PROVIDER_FETCH_TIMEOUT_MS = 60_000;

export type EnsureSeekableStatus =
  | "optimized"
  | "already-optimized"
  | "skipped-not-ready"
  | "skipped-no-media"
  | "skipped-local-media"
  | "skipped-too-large"
  | "skipped-fetch-failed"
  | "skipped-upload-failed"
  | "not-found";

export interface EnsureSeekableResult {
  recordingId: string;
  status: EnsureSeekableStatus;
  changed: boolean;
  videoUrl?: string | null;
  detail?: string;
}

/** application_state key marking a recording's media as already made seekable. */
export function seekableMarkerKey(recordingId: string): string {
  return `recording-seekable-${recordingId}`;
}

/**
 * Record that `videoUrl` for `recordingId` has been made seekable, so later
 * sweeps skip it. Scoped by URL so a re-upload that changes the URL is not
 * mistaken for already-processed.
 */
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

function isRemoteProviderUrl(videoUrl: string | null | undefined): boolean {
  return typeof videoUrl === "string" && /^https:\/\//i.test(videoUrl.trim());
}

async function fetchProviderBytes(
  videoUrl: string,
): Promise<
  { ok: true; bytes: Uint8Array } | { ok: false; reason: EnsureSeekableStatus }
> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PROVIDER_FETCH_TIMEOUT_MS,
  );
  try {
    const res = await fetch(videoUrl, { signal: controller.signal });
    if (!res.ok) return { ok: false, reason: "skipped-fetch-failed" };

    const declaredLength = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
      return { ok: false, reason: "skipped-too-large" };
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0)
      return { ok: false, reason: "skipped-fetch-failed" };
    if (buf.byteLength > MAX_UPLOAD_BYTES) {
      return { ok: false, reason: "skipped-too-large" };
    }
    return { ok: true, bytes: buf };
  } catch {
    return { ok: false, reason: "skipped-fetch-failed" };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Ensure a single recording's stored media is seekable. Owner-scoped: pass the
 * resolved owner email so the DB lookup can only touch that owner's rows.
 */
export async function ensureRecordingSeekable(params: {
  recordingId: string;
  ownerEmail: string;
  force?: boolean;
}): Promise<EnsureSeekableResult> {
  const { recordingId, ownerEmail, force = false } = params;
  const db = getDb();

  const [rec] = await db
    .select({
      id: schema.recordings.id,
      status: schema.recordings.status,
      videoUrl: schema.recordings.videoUrl,
      videoFormat: schema.recordings.videoFormat,
      sourceAppName: schema.recordings.sourceAppName,
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
  if (isLoomRecordingSource(rec)) {
    return { recordingId, status: "skipped-local-media", changed: false };
  }
  if (!rec.videoUrl) {
    return { recordingId, status: "skipped-no-media", changed: false };
  }
  // Only provider-hosted media can be re-fetched and re-uploaded. Local/dev
  // blobs (served from application_state via /api/video) and other relative
  // URLs are left untouched.
  if (!isRemoteProviderUrl(rec.videoUrl)) {
    return {
      recordingId,
      status: "skipped-local-media",
      changed: false,
      videoUrl: rec.videoUrl,
    };
  }

  if (!force && (await isAlreadyMarked(recordingId, rec.videoUrl))) {
    return {
      recordingId,
      status: "already-optimized",
      changed: false,
      videoUrl: rec.videoUrl,
    };
  }

  const fetched = await fetchProviderBytes(rec.videoUrl);
  if (!fetched.ok) {
    return { recordingId, status: fetched.reason, changed: false };
  }

  const videoFormat: VideoFormat = rec.videoFormat === "mp4" ? "mp4" : "webm";
  const seekable = await makeSeekable({
    mediaBytes: fetched.bytes,
    videoFormat,
  });

  if (!seekable.changed) {
    // Already seekable (or unimprovable) — remember so we don't refetch it.
    await markRecordingSeekable(recordingId, rec.videoUrl);
    return {
      recordingId,
      status: "already-optimized",
      changed: false,
      videoUrl: rec.videoUrl,
    };
  }

  const mimeType = videoFormat === "mp4" ? "video/mp4" : "video/webm";
  const upload = await uploadFile({
    data: seekable.bytes,
    filename: `${recordingId}.${videoFormat}`,
    mimeType,
    ownerEmail,
    skipCompressionWait: true,
  });

  if (!upload?.url) {
    // Could not re-upload — do NOT touch the row; the original still plays.
    return {
      recordingId,
      status: "skipped-upload-failed",
      changed: false,
      videoUrl: rec.videoUrl,
    };
  }

  await db
    .update(schema.recordings)
    .set({
      videoUrl: upload.url,
      videoSizeBytes: seekable.bytes.byteLength,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );

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
