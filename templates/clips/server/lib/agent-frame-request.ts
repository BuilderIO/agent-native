/**
 * Checks and failure descriptions shared by the agent frame routes: the
 * single frame (/api/agent-frame.jpg) and the frame sheet
 * (/api/agent-frames.jpg). Both must refuse the same clips the same way.
 */

import { getAgentClipReadiness } from "@shared/agent-context";
import {
  embedFramesUnavailableReason,
  recordingEmbedProvider,
} from "@shared/embed-provider";
import {
  getQuery,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  isHeldForRedaction,
  REDACTION_HOLD_MESSAGE,
} from "./pending-redactions.js";
import {
  applyAgentJsonHeaders,
  CLIPS_AGENT_ACCESS_PARAM,
  describeAgentAccessFailure,
  loadPublicAgentAccess,
  queryString,
  RecordingMediaFetchError,
  type PublicAgentAccess,
} from "./public-agent-context.js";
import { VideoFrameExtractionError } from "./video-frame.js";

export function sendFrameJson<T>(
  event: H3Event,
  status: number,
  body: T,
  headers: Record<string, string> = {},
): T {
  setResponseStatus(event, status);
  // These paths end in .jpg, so an error without its own Cache-Control gets
  // the CDN's 4-hour image default, and a client could keep a "still
  // processing" answer after the clip is ready.
  applyAgentJsonHeaders(event);
  for (const [name, value] of Object.entries(headers)) {
    setResponseHeader(event, name, value);
  }
  return body;
}

/**
 * Grant access to a clip's frames, or answer with the JSON failure that says
 * why not: no access, a redaction hold, a clip still preparing or failed, or
 * a YouTube or legacy Loom embed with no Clips-hosted video.
 */
export async function loadAgentFrameAccess(
  event: H3Event,
): Promise<
  { ok: true; access: PublicAgentAccess } | { ok: false; body: unknown }
> {
  const query = getQuery(event);
  const accessResult = await loadPublicAgentAccess(
    event,
    queryString(query.id),
    {
      password: queryString(query.password),
      token: queryString(query[CLIPS_AGENT_ACCESS_PARAM]),
    },
  );

  if (!accessResult.ok) {
    const failure = describeAgentAccessFailure(accessResult.failure);
    return {
      ok: false,
      body: sendFrameJson(event, failure.status, failure.body),
    };
  }

  const recording = accessResult.access.recording;

  if (
    isHeldForRedaction(
      recording.editsJson,
      accessResult.access.viewerIsOwner ? "owner" : null,
    )
  ) {
    return {
      ok: false,
      body: sendFrameJson(event, 409, {
        failureKind: "processing",
        error: REDACTION_HOLD_MESSAGE,
        nextStep:
          "Frames are temporarily withheld while the owner is editing or applying redactions. Wait for the owner to finish and save the clip, then fetch agentContextUrl again before requesting frames.",
        redactionPending: true,
      }),
    };
  }

  const readiness = getAgentClipReadiness(recording.status);
  if (readiness.state === "preparing") {
    const retryAfterSeconds = readiness.retryAfterSeconds ?? 15;
    return {
      ok: false,
      body: sendFrameJson(
        event,
        409,
        {
          failureKind: "processing",
          error: `This clip is still ${recording.status} and its frames are not ready.`,
          nextStep:
            readiness.instruction ??
            "Wait 15 seconds, then fetch agentContextUrl again before requesting frames.",
          retryAfterSeconds,
        },
        { "Retry-After": String(retryAfterSeconds) },
      ),
    };
  }
  if (readiness.state === "failed") {
    return {
      ok: false,
      body: sendFrameJson(event, 409, {
        failureKind: "processing",
        error: "This clip's recording failed, so its frames are unavailable.",
        nextStep:
          readiness.instruction ??
          "Do not retry this frame request. Ask the owner to retry or replace the clip.",
      }),
    };
  }

  const embedProvider = recordingEmbedProvider(recording);
  if (embedProvider) {
    return {
      ok: false,
      body: sendFrameJson(event, 422, {
        failureKind: "unsupported",
        error: embedFramesUnavailableReason(embedProvider),
        nextStep:
          embedProvider === "youtube"
            ? "Do not retry this frame request. Read the transcript around the moment instead (apis.transcript), or open the clip to watch it in YouTube's player."
            : "This clip has an embedded Loom player instead of a Clips-hosted video file. Open the embedded player for visual review, or reimport the video into Clips before requesting frames.",
      }),
    };
  }

  return { ok: true, access: accessResult.access };
}

/** The HTTP status for a failure while loading media or extracting frames. */
export function frameFailureStatus(err: unknown): number {
  if (err instanceof RecordingMediaFetchError) return err.statusCode;
  if (err instanceof VideoFrameExtractionError) {
    if (err.code === "FFMPEG_UNAVAILABLE") return 503;
    return err.code === "NO_VIDEO_TRACK" ||
      err.code === "EMPTY_MEDIA" ||
      err.code === "NO_FRAME_AT_TIMESTAMP"
      ? 422
      : 502;
  }
  return err instanceof Error && /too large/i.test(err.message) ? 413 : 502;
}

export function describeFrameFailure(error: unknown, status: number) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    error instanceof VideoFrameExtractionError &&
    error.code === "NO_VIDEO_TRACK"
  ) {
    return {
      failureKind: "unsupported",
      error: message,
      nextStep:
        "This recording has no video track, so Clips cannot provide video frames. Do not retry with another timestamp. Continue with the transcript if available, and ask the owner to provide a video recording if visual inspection is needed.",
    };
  }

  if (
    error instanceof VideoFrameExtractionError &&
    error.code === "EMPTY_MEDIA"
  ) {
    return {
      failureKind: "processing",
      error: message,
      nextStep:
        "The stored recording is empty and has no frames to inspect. Do not retry with another timestamp. Ask the owner to replace or reupload the clip's video; the transcript may still be available.",
    };
  }

  if (
    error instanceof VideoFrameExtractionError &&
    error.code === "NO_FRAME_AT_TIMESTAMP"
  ) {
    return {
      failureKind: "processing",
      error: message,
      nextStep:
        "No frame was available at the requested timestamp. Try a different timestamp; if the failure continues, report the frame error. Do not treat it as an access failure or missing media.",
    };
  }

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
      : "Frame extraction or media storage failed after clip access was granted. Retry once; if it continues, report the returned error. Do not request another share link unless a context or transcript response has failureKind=access.";

  return { failureKind: "processing", error: message, nextStep };
}
