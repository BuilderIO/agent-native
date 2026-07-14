/**
 * GET /api/agent-frame.jpg?id=<recordingId>&atMs=<timestampMs>[&password=<pw>|&t=<token>]
 *
 * Extract a JPEG frame from a public clip for external agents.
 */

import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  CLIPS_AGENT_ACCESS_PARAM,
  loadPublicAgentAccess,
  loadRecordingMediaBytes,
  queryString,
  RecordingMediaFetchError,
  type PublicAgentAccess,
} from "../../lib/public-agent-context.js";
import {
  extractJpegFrame,
  VideoFrameExtractionError,
} from "../../lib/video-frame.js";

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

function cacheControlForAccess(access: PublicAgentAccess): string {
  return isPubliclyCacheableFrame(access)
    ? "public, max-age=300"
    : "private, max-age=0, no-store";
}

function applyFrameHeaders(event: H3Event, access: PublicAgentAccess) {
  setResponseHeader(event, "Content-Type", "image/jpeg");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "Cache-Control", cacheControlForAccess(access));
}

export default defineEventHandler(async (event: H3Event) => {
  const query = getQuery(event);
  const id = queryString(query.id);
  const accessResult = await loadPublicAgentAccess(event, id, {
    password: queryString(query.password),
    token: queryString(query[CLIPS_AGENT_ACCESS_PARAM]) || queryString(query.t),
  });

  if (!accessResult.ok) {
    setResponseStatus(event, accessResult.failure.status);
    setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    return accessResult.failure.body;
  }

  const recording = accessResult.access.recording;
  const durationMs =
    typeof recording.durationMs === "number" ? recording.durationMs : 0;
  const requestedMs = parseTimestampMs(
    queryString(query.atMs),
    queryString(query.tSeconds),
  );
  const atMs =
    durationMs > 0
      ? Math.min(requestedMs, Math.max(0, durationMs - 1))
      : requestedMs;
  const key = cacheKey({
    recordingId: recording.id,
    updatedAt: recording.updatedAt,
    atMs,
  });

  const access = accessResult.access;
  const cacheable = isPubliclyCacheableFrame(access);
  const cached = cacheable ? getCachedFrame(key) : null;
  if (cached) {
    applyFrameHeaders(event, access);
    return cached;
  }

  try {
    const media = await loadRecordingMediaBytes(recording);
    const frame = await extractJpegFrame({
      mediaBytes: media.bytes,
      mimeType: media.mimeType,
      atMs,
    });

    applyFrameHeaders(event, access);
    const buffer = Buffer.from(frame);
    if (cacheable) setCachedFrame(key, buffer);
    return buffer;
  } catch (err) {
    const isFrameError = err instanceof VideoFrameExtractionError;
    setResponseStatus(
      event,
      err instanceof RecordingMediaFetchError
        ? err.statusCode
        : isFrameError && err.code === "FFMPEG_UNAVAILABLE"
          ? 503
          : err instanceof Error && /too large/i.test(err.message)
            ? 413
            : 422,
    );
    setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    return {
      error: isFrameError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err),
    };
  }
});
