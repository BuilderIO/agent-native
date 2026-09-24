/**
 * Generate and attach a timeline filmstrip sprite to a stored recording.
 *
 * This is the sibling of `ensure-seekable-video.ts` and follows the same shape:
 * re-fetch the stored provider media, run one ffmpeg pass, upload the result,
 * and point the recording row at it. Nothing here is destructive — a recording
 * without a sprite still renders a filmstrip, because the editor falls back to
 * extracting frames in the browser.
 *
 * Local/dev media (relative `/api/video/...` URLs backed by application_state)
 * is skipped rather than special-cased: there is no absolute URL to fetch
 * server-side, and the browser fallback already covers that environment.
 */

import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";
import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../../server/db/index.js";
import { deleteRecordingMediaObjects } from "../../server/lib/recording-media-cleanup.js";
import { ownerEmailMatches } from "../../server/lib/recordings.js";
import {
  DEFAULT_FILMSTRIP_FRAME_COUNT,
  generateFilmstripSprite,
  type FilmstripSpriteGrid,
} from "../../server/lib/video-filmstrip-sprite.js";
import { isLoomRecordingSource } from "../../shared/loom.js";
import {
  fetchProviderBytes,
  isRemoteProviderUrl,
} from "./ensure-seekable-video.js";

export type EnsureFilmstripStatus =
  | "generated"
  | "already-generated"
  | "not-found"
  | "skipped-not-ready"
  | "skipped-no-media"
  | "skipped-local-media"
  | "skipped-no-duration"
  | "skipped-no-ffmpeg"
  | "skipped-fetch-failed"
  | "skipped-too-large"
  | "skipped-upload-failed"
  | "failed-ffmpeg"
  | "failed-empty-output";

export interface EnsureFilmstripResult {
  recordingId: string;
  status: EnsureFilmstripStatus;
  changed: boolean;
  filmstripUrl?: string | null;
  grid?: FilmstripSpriteGrid;
  detail?: string;
}

/** application_state key recording which media a sprite was generated from. */
export function filmstripMarkerKey(recordingId: string): string {
  return `recording-filmstrip-${recordingId}`;
}

async function isAlreadyGenerated(
  recordingId: string,
  videoUrl: string,
): Promise<boolean> {
  const marker = await readAppState(filmstripMarkerKey(recordingId)).catch(
    () => null,
  );
  return Boolean(
    marker &&
    typeof marker === "object" &&
    (marker as { videoUrl?: unknown }).videoUrl === videoUrl,
  );
}

/**
 * Ensure one recording has a filmstrip sprite. Owner-scoped: pass the resolved
 * owner email so the lookup can only touch that owner's rows.
 */
export async function ensureRecordingFilmstrip(params: {
  recordingId: string;
  ownerEmail: string;
  frameCount?: number;
  force?: boolean;
}): Promise<EnsureFilmstripResult> {
  const {
    recordingId,
    ownerEmail,
    frameCount = DEFAULT_FILMSTRIP_FRAME_COUNT,
    force = false,
  } = params;
  const db = getDb();

  const [rec] = await db
    .select({
      id: schema.recordings.id,
      status: schema.recordings.status,
      videoUrl: schema.recordings.videoUrl,
      durationMs: schema.recordings.durationMs,
      filmstripUrl: schema.recordings.filmstripUrl,
      sourceAppName: schema.recordings.sourceAppName,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );

  if (!rec) return { recordingId, status: "not-found", changed: false };
  if (rec.status !== "ready") {
    return { recordingId, status: "skipped-not-ready", changed: false };
  }
  if (isLoomRecordingSource(rec)) {
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
      filmstripUrl: rec.filmstripUrl,
    };
  }
  if (rec.durationMs <= 0) {
    return { recordingId, status: "skipped-no-duration", changed: false };
  }

  if (
    !force &&
    rec.filmstripUrl &&
    (await isAlreadyGenerated(recordingId, rec.videoUrl))
  ) {
    return {
      recordingId,
      status: "already-generated",
      changed: false,
      filmstripUrl: rec.filmstripUrl,
    };
  }

  const fetched = await fetchProviderBytes(rec.videoUrl);
  if (!fetched.ok) {
    return { recordingId, status: fetched.reason, changed: false };
  }

  const sprite = await generateFilmstripSprite({
    mediaBytes: fetched.bytes,
    durationMs: rec.durationMs,
    frameCount,
  });

  if (sprite.status !== "generated" || !sprite.sprite) {
    return {
      recordingId,
      status: sprite.status,
      changed: false,
      filmstripUrl: rec.filmstripUrl,
      detail: sprite.detail,
    };
  }

  const upload = await uploadFile({
    data: sprite.sprite.bytes,
    filename: `${recordingId}-filmstrip-${Date.now()}.jpg`,
    mimeType: "image/jpeg",
    ownerEmail,
    stableUrl: true,
    recordAsset: false,
  }).catch((err) => {
    console.warn("[ensure-recording-filmstrip] sprite upload failed", {
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
      filmstripUrl: rec.filmstripUrl,
    };
  }

  const { grid } = sprite.sprite;
  const updated = await db
    .update(schema.recordings)
    .set({
      filmstripUrl: upload.url,
      filmstripFrameCount: grid.frameCount,
      filmstripColumns: grid.columns,
      filmstripRows: grid.rows,
      filmstripFrameWidth: grid.frameWidth,
      filmstripFrameHeight: grid.frameHeight,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        // Don't attach a sprite generated from media the row no longer points at.
        eq(schema.recordings.videoUrl, rec.videoUrl),
        // Ensure no concurrent job modified filmstripUrl in the interim.
        rec.filmstripUrl
          ? eq(schema.recordings.filmstripUrl, rec.filmstripUrl)
          : isNull(schema.recordings.filmstripUrl),
      ),
    )
    .returning({
      id: schema.recordings.id,
      filmstripUrl: schema.recordings.filmstripUrl,
    });

  if (updated.length !== 1 || updated[0]?.filmstripUrl !== upload.url) {
    await deleteRecordingMediaObjects({
      id: recordingId,
      filmstripUrl: upload.url,
    }).catch(() => {});
    return {
      recordingId,
      status: "skipped-upload-failed",
      changed: false,
      filmstripUrl: rec.filmstripUrl,
      detail: "Recording changed while the filmstrip sprite was uploading.",
    };
  }

  if (rec.filmstripUrl && rec.filmstripUrl !== upload.url) {
    await deleteRecordingMediaObjects({
      id: recordingId,
      filmstripUrl: rec.filmstripUrl,
    }).catch(() => {});
  }

  await writeAppState(filmstripMarkerKey(recordingId), {
    recordingId,
    videoUrl: rec.videoUrl,
    at: new Date().toISOString(),
  });
  await writeAppState("refresh-signal", { ts: Date.now() });

  return {
    recordingId,
    status: "generated",
    changed: true,
    filmstripUrl: upload.url,
    grid,
  };
}
