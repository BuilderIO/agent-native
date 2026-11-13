/**
 * GET /api/agent-frame.jpg?id=<recordingId>&atMs=<timestampMs>[&password=<pw>|&t=<token>]
 *
 * Extract a JPEG frame from a public clip for external agents. For a
 * screenshot, the picture itself in its stored format.
 */

import {
  getForwardedRequestURL,
  runWithRequestContext,
} from "@agent-native/core/server";
import { isImageRecording } from "@shared/recording-kind";
import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  type H3Event,
} from "h3";

import { buildAgentEditedTimeline } from "../../lib/agent-edited-timeline.js";
import {
  createAgentFrameMediaSource,
  loadAgentFrame,
} from "../../lib/agent-frame-load.js";
import {
  describeFrameFailure,
  frameFailureStatus,
  loadAgentFrameAccess,
  sendFrameJson,
} from "../../lib/agent-frame-request.js";
import { clampAgentFrameAtMs } from "../../lib/agent-frame-store.js";
import {
  ensureRecordingThumbnail,
  RECORDING_THUMBNAIL_AT_MS,
} from "../../lib/ensure-recording-thumbnail.js";
import {
  CLIPS_AGENT_ACCESS_PARAM,
  loadScreenshotImage,
  queryString,
  type PublicAgentAccess,
} from "../../lib/public-agent-context.js";
const MAX_CACHED_FRAMES = 64;
const MAX_CACHED_FRAME_BYTES = 2 * 1024 * 1024;

const frameCache = new Map<string, Buffer>();

function parseTimestampMs(rawAtMs: string, rawT: string): number {
  if (rawAtMs) {
    const atMs = Number(rawAtMs);
    return Number.isFinite(atMs) ? Math.max(0, Math.round(atMs)) : 0;
  }
  if (!rawT) return 0;
  const seconds = Number(rawT);
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0;
}

function cacheKey({
  recordingId,
  updatedAt,
  atMs,
}: {
  recordingId: string;
  updatedAt: string;
  atMs: number;
}): string {
  return `${recordingId}:${updatedAt}:${atMs}`;
}

function getCachedFrame(key: string): Buffer | null {
  const cached = frameCache.get(key);
  if (!cached) return null;
  frameCache.delete(key);
  frameCache.set(key, cached);
  return cached;
}

function setCachedFrame(key: string, frame: Buffer) {
  if (frame.byteLength > MAX_CACHED_FRAME_BYTES) return;
  frameCache.set(key, frame);
  while (frameCache.size > MAX_CACHED_FRAMES) {
    const oldest = frameCache.keys().next().value;
    if (!oldest) break;
    frameCache.delete(oldest);
  }
}

function isPubliclyCacheableFrame(access: PublicAgentAccess): boolean {
  return (
    access.recording.visibility === "public" &&
    !access.recording.password &&
    !access.apiToken
  );
}

function cacheControlForAccess(): string {
  return "private, max-age=0, no-store";
}

function applyFrameHeaders(event: H3Event) {
  setResponseHeader(event, "Content-Type", "image/jpeg");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "Cache-Control", cacheControlForAccess());
}

async function persistDefaultThumbnailIfMissing(
  access: PublicAgentAccess,
  requestedMs: number,
  frame: Uint8Array,
  mimeType: string,
): Promise<void> {
  if (requestedMs !== RECORDING_THUMBNAIL_AT_MS) return;
  if (access.recording.thumbnailUrl) return;
  try {
    await runWithRequestContext(
      {
        userEmail: access.recording.ownerEmail,
        orgId: access.recording.orgId ?? undefined,
      },
      () =>
        ensureRecordingThumbnail({
          recordingId: access.recording.id,
          ownerEmail: access.recording.ownerEmail,
          thumbnailBytes: frame,
          mimeType,
        }),
    );
  } catch (err: unknown) {
    console.warn("[agent-frame] thumbnail persistence skipped", {
      recordingId: access.recording.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function redirectToResolvedFrame(
  event: H3Event,
  access: PublicAgentAccess,
  atMs: number,
): Response {
  const location = getForwardedRequestURL(event);
  location.search = "";
  location.searchParams.set("id", access.recording.id);
  location.searchParams.set("atMs", String(atMs));
  if (access.apiToken) {
    location.searchParams.set(CLIPS_AGENT_ACCESS_PARAM, access.apiToken);
  }
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": cacheControlForAccess(),
      Location: location.href,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default defineEventHandler(async (event: H3Event) => {
  const query = getQuery(event);
  const accessResult = await loadAgentFrameAccess(event);
  if (!accessResult.ok) return accessResult.body;
  const recording = accessResult.access.recording;

  // A still image has one frame, the picture itself; there is no video to
  // cut one from.
  if (isImageRecording(recording)) {
    try {
      const image = await loadScreenshotImage(recording);
      setResponseHeader(event, "Content-Type", image.mimeType);
      setResponseHeader(event, "Cache-Control", "private, no-store");
      setResponseHeader(event, "X-Content-Type-Options", "nosniff");
      return Buffer.from(image.bytes);
    } catch (err) {
      // Pass the storage outcome on, as the video path does: a timeout or a
      // missing object is not the same failure to retry as a bad gateway.
      const status = frameFailureStatus(err);
      return sendFrameJson(event, status, describeFrameFailure(err, status));
    }
  }
  // atMs is on the edited timeline the context reports; the media and the
  // stored frames are in the original recording.
  const timeline = buildAgentEditedTimeline(
    recording.editsJson,
    typeof recording.durationMs === "number" ? recording.durationMs : 0,
  );
  const requestedMs = parseTimestampMs(
    queryString(query.atMs),
    queryString(query.tSeconds),
  );
  const atMs = timeline.toSourceMs(
    clampAgentFrameAtMs(
      parseTimestampMs(queryString(query.atMs), queryString(query.tSeconds)),
      timeline.durationMs,
    ),
  );
  const key = cacheKey({
    recordingId: recording.id,
    updatedAt: recording.updatedAt,
    atMs,
  });

  const access = accessResult.access;
  const cacheable = isPubliclyCacheableFrame(access);
  const storedMimeType =
    recording.videoFormat === "mp4" ? "video/mp4" : "video/webm";
  const cached = cacheable ? getCachedFrame(key) : null;
  if (cached) {
    await persistDefaultThumbnailIfMissing(
      access,
      requestedMs,
      new Uint8Array(cached),
      storedMimeType,
    );
    applyFrameHeaders(event);
    return cached;
  }

  const media = createAgentFrameMediaSource(recording);
  try {
    let loaded: Awaited<ReturnType<typeof loadAgentFrame>>;
    try {
      loaded = await loadAgentFrame(recording, atMs, {
        media,
        onFrame: (frame, mimeType) =>
          persistDefaultThumbnailIfMissing(
            access,
            requestedMs,
            frame,
            mimeType,
          ),
      });
    } finally {
      await media.cleanup();
    }
    if (loaded.moved) {
      return redirectToResolvedFrame(
        event,
        access,
        timeline.fromSourceMs(loaded.atMs),
      );
    }
    applyFrameHeaders(event);
    const buffer = Buffer.from(loaded.frame);
    if (cacheable) setCachedFrame(key, buffer);
    return buffer;
  } catch (err) {
    const status = frameFailureStatus(err);
    return sendFrameJson(event, status, describeFrameFailure(err, status));
  }
});
