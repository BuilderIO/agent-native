import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { formatAgentTimestamp } from "@shared/agent-context";
import { isImageRecording } from "@shared/recording-kind";
import { z } from "zod";

import { buildAgentEditedTimeline } from "../server/lib/agent-edited-timeline.js";
import {
  createAgentFrameMediaSource,
  loadAgentFrame,
  loadScreenshotJpeg,
} from "../server/lib/agent-frame-load.js";
import {
  checkAgentFrameClip,
  describeFrameFailure,
  frameFailureStatus,
} from "../server/lib/agent-frame-request.js";
import {
  clampAgentFrameAtMs,
  recommendedAgentFrames,
} from "../server/lib/agent-frame-store.js";
import {
  describeAgentAccessFailure,
  resolvePublicAgentAccess,
  type PublicAgentAccess,
  type PublicAgentRecording,
} from "../server/lib/public-agent-context.js";
import {
  isRecordingExpiredForViewer,
  recordingUsesSharePassword,
} from "../server/lib/recording-page-access.js";
import { numberListParam } from "./lib/cli-params.js";

const MAX_FRAMES_PER_CALL = 4;
// The MCP image limit: 2,000,000 base64 characters per image.
const MAX_IMAGE_BASE64_CHARS = 2_000_000;

const errors = defineActionErrors(
  "invalid_input",
  "no_access",
  "password_required",
  "expired",
  "unavailable",
  "redaction_pending",
  "not_ready",
  "recording_failed",
  "frames_unsupported",
  "media_unavailable",
  "frame_extraction_failed",
);

type FrameFailure = {
  atMs: number;
  statusCode: number;
  failureKind: string;
  error: string;
  nextStep: string;
};

function failWithNextStep(
  code: Parameters<typeof errors.fail>[1],
  statusCode: number,
  error: string,
  nextStep: string,
  failureKind: string,
): never {
  return errors.fail(`${error} ${nextStep}`, code, {
    statusCode,
    details: { failureKind, error, nextStep },
  });
}

function noAccess(): never {
  const failure = describeAgentAccessFailure({
    status: 404,
    body: { error: "Not found" },
  });
  return failWithNextStep(
    "no_access",
    404,
    String(failure.body.error),
    String(failure.body.nextStep),
    "access",
  );
}

/**
 * The connected user's own access (owner, share, organization, public),
 * through the check the HTTP routes use. Never grants what those routes would
 * refuse the same user.
 */
async function resolveFramesAccess(
  recordingId: string,
): Promise<PublicAgentAccess> {
  const viewerEmail = getRequestUserEmail() ?? null;
  const publicAccess = await resolvePublicAgentAccess(recordingId, {
    viewerEmail,
  });
  if (publicAccess.ok) return publicAccess.access;

  const { status } = publicAccess.failure;
  if (status === 410 || status === 401) {
    const failure = describeAgentAccessFailure(publicAccess.failure);
    return failWithNextStep(
      status === 410 ? "expired" : "password_required",
      status,
      String(failure.body.error),
      String(failure.body.nextStep),
      String(failure.body.failureKind),
    );
  }
  if (status !== 404) {
    return failWithNextStep(
      "invalid_input",
      status,
      "The clip id is missing.",
      "Pass the recordingId.",
      "request",
    );
  }

  // A private or organization clip the user was shared on, or one only its
  // owner can see (trashed, archived).
  const own = await resolveAccess("recording", recordingId);
  const recording = own?.resource as PublicAgentRecording | undefined;
  if (!own || !recording || recording.failureCode === "taken_down") {
    return noAccess();
  }
  const viewerIsOwner = own.role === "owner";
  if (recording.trashedAt || recording.archivedAt) {
    return failWithNextStep(
      "unavailable",
      404,
      recording.trashedAt
        ? "This clip is in the trash."
        : "This clip is archived.",
      "Ask the owner to restore the clip, then call this tool again.",
      "access",
    );
  }
  if (
    recordingUsesSharePassword(recording.visibility) &&
    recording.password &&
    !viewerIsOwner
  ) {
    const failure = describeAgentAccessFailure({
      status: 401,
      body: { error: "Password required", passwordRequired: true },
    });
    return failWithNextStep(
      "password_required",
      401,
      String(failure.body.error),
      String(failure.body.nextStep),
      "access",
    );
  }
  if (
    isRecordingExpiredForViewer({
      expiresAt: recording.expiresAt,
      viewerIsOwner,
    })
  ) {
    const failure = describeAgentAccessFailure({
      status: 410,
      body: { error: "Recording has expired", expired: true },
    });
    return failWithNextStep(
      "expired",
      410,
      String(failure.body.error),
      String(failure.body.nextStep),
      "expired",
    );
  }
  return {
    recording,
    viewerIsOwner,
    agentLinkCreatorEmail: null,
    apiToken: null,
  };
}

/** A failure as the frame route would answer for `error`, with its HTTP status kept. */
function frameFailureOf(atMs: number, error: unknown): FrameFailure {
  const statusCode = frameFailureStatus(error);
  return { atMs, statusCode, ...describeFrameFailure(error, statusCode) };
}

function withoutStatus({ statusCode: _statusCode, ...failure }: FrameFailure) {
  return failure;
}

function failAllFrames(failures: FrameFailure[]): never {
  // The first failure names the error.
  for (const first of failures) {
    const code =
      first.failureKind === "unsupported"
        ? "frames_unsupported"
        : first.failureKind === "media"
          ? "media_unavailable"
          : "frame_extraction_failed";
    return errors.fail(
      `No frame could be returned. ${first.error} ${first.nextStep}`,
      code,
      {
        statusCode: first.statusCode,
        details: {
          failures: failures.map(withoutStatus),
        },
      },
    );
  }
  // No timestamp was asked for: the clip has no recommended frames.
  return failWithNextStep(
    "invalid_input",
    400,
    "This clip has no recommended frames.",
    "Pass atMs with the timestamps to look at.",
    "request",
  );
}

export default defineAction({
  description:
    "Return a Clips recording (clip)'s video frames as images you can see, so you can look at what is on screen. Pass the recordingId: the <id> in a Clips link (/r/<id>, /share/<id>) or the id query parameter of a frame or context URL. Pass atMs (up to 4 timestamps in milliseconds of the clip as it plays, with the owner's cuts removed, the same times the agent context and transcript use) for specific moments; at most 4 frames come back per call, so call again for more. Without atMs you get the first 4 recommended frames, and the result lists every recommended moment (atMs, timestamp, reason) to ask for next. A screenshot recording returns its picture. A frame that cannot be produced is listed in failures with a nextStep; if none can, the call fails.",
  schema: z.object({
    recordingId: z.string().trim().min(1).describe("Recording ID."),
    atMs: numberListParam(
      z.array(z.number().int().min(0)).min(1).max(MAX_FRAMES_PER_CALL),
    )
      .optional()
      .describe(
        '1 to 4 timestamps in milliseconds of the clip as it plays: an array, one number, or a comma-separated string like "350,6789". Without it, the first 4 recommended frames.',
      ),
  }),
  outputSchema: z.object({
    recordingId: z.string(),
    title: z.string(),
    durationMs: z.number().nullable(),
    frames: z.array(
      z.object({
        atMs: z.number(),
        timestamp: z.string(),
        label: z.string(),
        requestedAtMs: z.number().optional(),
      }),
    ),
    recommendedFrames: z.array(
      z.object({
        atMs: z.number(),
        timestamp: z.string(),
        reason: z.string(),
      }),
    ),
    failures: z.array(
      z.object({
        atMs: z.number(),
        failureKind: z.string(),
        error: z.string(),
        nextStep: z.string(),
      }),
    ),
    _agentImages: z.array(
      z.object({
        data: z.string(),
        mediaType: z.literal("image/jpeg"),
        label: z.string(),
      }),
    ),
  }),
  errors,
  http: { method: "GET" },
  readOnly: true,
  mcpApp: { compactCatalog: true },
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (args) => {
    const access = await resolveFramesAccess(args.recordingId);
    const refusal = checkAgentFrameClip(access);
    if (refusal) {
      const { body } = refusal;
      return failWithNextStep(
        refusal.reason === "redaction"
          ? "redaction_pending"
          : refusal.reason === "preparing"
            ? "not_ready"
            : refusal.reason === "failed"
              ? "recording_failed"
              : "frames_unsupported",
        refusal.status,
        body.error,
        body.nextStep,
        body.failureKind,
      );
    }

    const recording = access.recording;
    // atMs in and out is on the edited timeline the agent context reports;
    // the media and the stored frames are in the original recording.
    const timeline = buildAgentEditedTimeline(
      recording.editsJson,
      typeof recording.durationMs === "number" ? recording.durationMs : 0,
    );
    const summary = {
      recordingId: recording.id,
      title: recording.title,
      durationMs:
        typeof recording.durationMs === "number" ? timeline.durationMs : null,
    };

    // A still image has one frame, the picture itself.
    if (isImageRecording(recording)) {
      let image: Uint8Array;
      try {
        image = await loadScreenshotJpeg(recording);
      } catch (error) {
        return failAllFrames([frameFailureOf(0, error)]);
      }
      const data = Buffer.from(image).toString("base64");
      if (data.length > MAX_IMAGE_BASE64_CHARS) {
        return failAllFrames([
          {
            atMs: 0,
            statusCode: 413,
            failureKind: "unsupported",
            error: "The screenshot is too large to return as an image.",
            nextStep:
              "Do not retry. Ask the owner for a smaller screenshot, or open the clip page to view it.",
          },
        ]);
      }
      return {
        ...summary,
        frames: [{ atMs: 0, timestamp: "0:00", label: "Screenshot" }],
        recommendedFrames: [],
        failures: [],
        _agentImages: [
          { data, mediaType: "image/jpeg" as const, label: "Screenshot" },
        ],
      };
    }

    const recommendedFrames = await recommendedAgentFrames(recording);
    const requested =
      args.atMs ??
      recommendedFrames
        .slice(0, MAX_FRAMES_PER_CALL)
        .map((frame) => frame.atMs);
    // Each served timestamp with the first one asked for that clamps to it.
    const asked = new Map<number, number>();
    for (const atMs of requested) {
      const clamped = clampAgentFrameAtMs(atMs, timeline.durationMs);
      if (!asked.has(clamped)) asked.set(clamped, atMs);
    }

    const frames: Array<{
      atMs: number;
      timestamp: string;
      label: string;
      requestedAtMs?: number;
    }> = [];
    const images: Array<{
      data: string;
      mediaType: "image/jpeg";
      label: string;
    }> = [];
    const failures: FrameFailure[] = [];

    // One at a time: the first miss cuts and stores the clip's recommended
    // frames from a single download, and the rest are served from them.
    const media = createAgentFrameMediaSource(recording);
    try {
      for (const [atMs, askedAtMs] of asked) {
        try {
          const loaded = await loadAgentFrame(
            recording,
            timeline.toSourceMs(atMs),
            { media },
          );
          const servedAtMs = timeline.fromSourceMs(loaded.atMs);
          const data = Buffer.from(loaded.frame).toString("base64");
          if (data.length > MAX_IMAGE_BASE64_CHARS) {
            failures.push({
              atMs,
              statusCode: 413,
              failureKind: "unsupported",
              error: "The frame is too large to return as an image.",
              nextStep:
                "Do not retry this timestamp. Try another one, or report the frame size.",
            });
            continue;
          }
          const timestamp = formatAgentTimestamp(servedAtMs);
          const label = `Frame at ${timestamp} (${servedAtMs} ms)`;
          frames.push({
            atMs: servedAtMs,
            timestamp,
            label,
            ...(servedAtMs === askedAtMs ? {} : { requestedAtMs: askedAtMs }),
          });
          images.push({ data, mediaType: "image/jpeg", label });
        } catch (error) {
          failures.push(frameFailureOf(atMs, error));
        }
      }
    } finally {
      await media.cleanup();
    }

    if (frames.length === 0) return failAllFrames(failures);

    return {
      ...summary,
      frames,
      recommendedFrames,
      failures: failures.map(withoutStatus),
      _agentImages: images,
    };
  },
});
