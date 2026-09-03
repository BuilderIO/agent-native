/**
 * GET /api/agent-frame.jpg?id=<recordingId>&atMs=<timestampMs>[&password=<pw>|&t=<token>]
 *
 * Extract a JPEG frame from a public clip for external agents.
 */

import { runWithRequestContext } from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  getRequestURL,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  ensureRecordingThumbnail,
  RECORDING_THUMBNAIL_AT_MS,
} from "../../lib/ensure-recording-thumbnail.js";
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
  probeMediaDurationMs,
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
  frame: Uint8Array,
  mimeType: string,
): Promise<void> {
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
  const location = getRequestURL(event);
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

async function extractFrameWithStaleDurationRecovery({
  media,
  mimeType,
  atMs,
}: {
  media: Uint8Array;
  mimeType: string;
  atMs: number;
}): Promise<{ frame: Uint8Array; atMs: number }> {
  try {
    return {
      frame: await extractJpegFrame({ mediaBytes: media, mimeType, atMs }),
      atMs,
    };
  } catch (error) {
    if (
      !(error instanceof VideoFrameExtractionError) ||
      error.code !== "NO_VIDEO" ||
      atMs <= 0
    ) {
      throw error;
    }

    const actualDurationMs = await probeMediaDurationMs(media, mimeType);
    if (actualDurationMs === null || actualDurationMs > atMs + 1) {
      throw error;
    }

    const candidates = [
      Math.max(0, actualDurationMs - 1),
      Math.max(0, actualDurationMs - 1000),
      0,
    ].filter((candidate, index, values) => values.indexOf(candidate) === index);
    for (const candidate of candidates) {
      if (candidate === atMs) continue;
      try {
        return {
          frame: await extractJpegFrame({
            mediaBytes: media,
            mimeType,
            atMs: candidate,
          }),
          atMs: candidate,
        };
      } catch (candidateError) {
        if (
          !(candidateError instanceof VideoFrameExtractionError) ||
          candidateError.code !== "NO_VIDEO"
        ) {
          throw candidateError;
        }
      }
    }
    throw error;
  }
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
    if (requestedMs === RECORDING_THUMBNAIL_AT_MS) {
      await persistDefaultThumbnailIfMissing(
        access,
        new Uint8Array(cached),
        recording.videoFormat === "mp4" ? "video/mp4" : "video/webm",
      );
    }
    applyFrameHeaders(event);
    return cached;
  }

  try {
    const media = await loadRecordingMediaBytes(recording);
    const resolved = await extractFrameWithStaleDurationRecovery({
      media: media.bytes,
      mimeType: media.mimeType,
      atMs,
    });

    if (requestedMs === RECORDING_THUMBNAIL_AT_MS) {
      await persistDefaultThumbnailIfMissing(
        access,
        resolved.frame,
        media.mimeType,
      );
    }

    if (resolved.atMs !== atMs) {
      return redirectToResolvedFrame(event, access, resolved.atMs);
    }

    applyFrameHeaders(event);
    const buffer = Buffer.from(resolved.frame);
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
