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
import { getAgentClipReadiness } from "@shared/agent-context";
import { isImageRecording } from "@shared/recording-kind";
import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  ensureRecordingThumbnail,
  RECORDING_THUMBNAIL_AT_MS,
} from "../../lib/ensure-recording-thumbnail.js";
import {
  isHeldForRedaction,
  REDACTION_HOLD_MESSAGE,
} from "../../lib/pending-redactions.js";
import {
  CLIPS_AGENT_ACCESS_PARAM,
  describeAgentAccessFailure,
  loadPublicAgentAccess,
  loadRecordingMediaFile,
  loadScreenshotImage,
  queryString,
  RecordingMediaFetchError,
  type PublicAgentAccess,
} from "../../lib/public-agent-context.js";
import {
  extractJpegFrameFromFile,
  probeMediaDurationMsFromFile,
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

function describeFrameFailure(error: unknown, status: number) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    error instanceof RecordingMediaFetchError &&
    (error.statusCode === 404 || error.statusCode === 410)
  ) {
    return {
      failureKind: "media",
      error: message,
      nextStep:
        "The stored media could not be retrieved. The agent link is valid; another Share with agents link will not restore it. Ask the owner to restore or replace the clip's media.",
    };
  }

  if (
    error instanceof RecordingMediaFetchError &&
    [401, 403].includes(error.statusCode)
  ) {
    return {
      failureKind: "media",
      error: message,
      nextStep:
        "The frame request passed the clip's share-access check, but Clips was denied access to the stored media. This is a media-storage issue, not a missing agent link. Ask the owner to check storage access or replace the clip's media; another Share with agents link will not help.",
    };
  }

  const nextStep =
    status === 413
      ? "The stored media is too large for frame inspection. The share link may still be valid; report that frames cannot be inspected at this size."
      : status === 422
        ? "This frame could not be extracted at the requested timestamp. Try a different timestamp; if the failure continues, report the frame error. Do not treat it as an access failure or missing media."
        : "Frame extraction or media storage failed after clip access was granted. Retry once; if it continues, report the returned error. Do not request another share link unless a context or transcript response has failureKind=access.";

  return { failureKind: "processing", error: message, nextStep };
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

async function extractFrameWithStaleDurationRecovery({
  mediaPath,
  atMs,
}: {
  mediaPath: string;
  atMs: number;
}): Promise<{ frame: Uint8Array; atMs: number }> {
  try {
    return {
      frame: await extractJpegFrameFromFile({ mediaPath, atMs }),
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

    const actualDurationMs = await probeMediaDurationMsFromFile(mediaPath);
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
          frame: await extractJpegFrameFromFile({ mediaPath, atMs: candidate }),
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
    token: queryString(query[CLIPS_AGENT_ACCESS_PARAM]),
  });

  if (!accessResult.ok) {
    const failure = describeAgentAccessFailure(accessResult.failure);
    setResponseStatus(event, failure.status);
    setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    return failure.body;
  }

  const recording = accessResult.access.recording;

  if (
    isHeldForRedaction(
      recording.editsJson,
      accessResult.access.viewerIsOwner ? "owner" : null,
    )
  ) {
    setResponseStatus(event, 409);
    setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    return {
      failureKind: "processing",
      error: REDACTION_HOLD_MESSAGE,
      nextStep:
        "Frames are temporarily withheld while the owner is editing or applying redactions. Wait for the owner to finish and save the clip, then fetch agentContextUrl again before requesting frames.",
      redactionPending: true,
    };
  }

  const readiness = getAgentClipReadiness(recording.status);
  if (readiness.state === "preparing") {
    const retryAfterSeconds = readiness.retryAfterSeconds ?? 15;
    setResponseStatus(event, 409);
    setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
    setResponseHeader(event, "Retry-After", String(retryAfterSeconds));
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    return {
      failureKind: "processing",
      error: `This clip is still ${recording.status} and its frames are not ready.`,
      nextStep:
        readiness.instruction ??
        "Wait 15 seconds, then fetch agentContextUrl again before requesting frames.",
      retryAfterSeconds,
    };
  }
  if (readiness.state === "failed") {
    setResponseStatus(event, 409);
    setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    return {
      failureKind: "processing",
      error: "This clip's recording failed, so its frames are unavailable.",
      nextStep:
        readiness.instruction ??
        "Do not retry this frame request. Ask the owner to retry or replace the clip.",
    };
  }

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
      const status =
        err instanceof RecordingMediaFetchError
          ? err.statusCode
          : err instanceof Error && /too large/i.test(err.message)
            ? 413
            : 502;
      setResponseStatus(event, status);
      setResponseHeader(
        event,
        "Content-Type",
        "application/json; charset=utf-8",
      );
      return describeFrameFailure(err, status);
    }
  }
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
    const media = await loadRecordingMediaFile(recording);
    try {
      const resolved = await extractFrameWithStaleDurationRecovery({
        mediaPath: media.path,
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
    } finally {
      await media.cleanup().catch(() => {});
    }
  } catch (err) {
    const isFrameError = err instanceof VideoFrameExtractionError;
    const status =
      err instanceof RecordingMediaFetchError
        ? err.statusCode
        : isFrameError && err.code === "FFMPEG_UNAVAILABLE"
          ? 503
          : err instanceof Error && /too large/i.test(err.message)
            ? 413
            : 422;
    setResponseStatus(event, status);
    setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    return describeFrameFailure(err, status);
  }
});
