import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { formatAgentTimestamp } from "@shared/agent-context";
import { isImageRecording } from "@shared/recording-kind";
import { z } from "zod";

import { parseEdits } from "../app/lib/timestamp-mapping.js";
import { MAX_BURN_FPS } from "../app/lib/video-redactions.js";
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
import { findRecordingCaptureMarker } from "../server/lib/motion-capture.js";
import {
  DEFAULT_FILMSTRIP_SAMPLES,
  MAX_FILMSTRIP_SAMPLES,
  MAX_MOTION_EVIDENCE_IMAGES,
} from "../server/lib/motion-evidence.js";
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
import {
  inspectSourceFrames,
  SourceFrameEvidenceError,
  sourceIntervalLimitMs,
} from "../server/lib/source-frame-evidence.js";
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
  "source_timeline_unavailable",
  "marker_not_found",
  "marker_unaligned",
  "invalid_cursor",
  "source_media_changed",
  "crop_out_of_bounds",
);

const DEFAULT_MARKER_BEFORE_MS = 500;
const DEFAULT_MARKER_AFTER_MS = 1_500;

const SOURCE_ONLY_INPUTS = [
  "startMs",
  "endMs",
  "markerId",
  "beforeMs",
  "afterMs",
  "sampling",
  "maxFrames",
  "sampleCount",
  "cursor",
  "crop",
] as const;

const cropSchema = z.object({
  x: z.coerce.number().int().min(0).max(32768),
  y: z.coerce.number().int().min(0).max(32768),
  width: z.coerce.number().int().min(1).max(32768),
  height: z.coerce.number().int().min(1).max(32768),
});

const imageSchema = z.object({
  data: z.string(),
  mediaType: z.literal("image/jpeg"),
  label: z.string(),
});

const sourceEvidenceSchema = z.object({
  timeline: z.literal("source"),
  sampling: z.enum(["consecutive", "filmstrip"]),
  marker: z
    .object({
      id: z.string(),
      label: z.string(),
      kind: z.string(),
      mediaTimeMs: z.number(),
      uncertaintyMs: z.number(),
    })
    .nullable(),
  requestedRange: z.object({ startMs: z.number(), endMs: z.number() }),
  sourceDimensions: z.object({ width: z.number(), height: z.number() }),
  crop: z
    .object({
      sourcePixels: cropSchema,
      representation: z.literal("cropped supplement"),
    })
    .nullable(),
  returnedRange: z
    .object({ startPtsMs: z.number(), endPtsMs: z.number() })
    .nullable(),
  frames: z.array(
    z.object({
      id: z.string(),
      ptsMs: z.number(),
      targetMs: z.number().optional(),
      gapFromPreviousMs: z.number().nullable(),
      imageAttached: z.boolean(),
    }),
  ),
  gapMeasurements: z.object({
    basis: z.string(),
    includesPreviousPageBoundary: z.boolean(),
    count: z.number(),
    medianMs: z.number().nullable(),
    maxMs: z.number().nullable(),
  }),
  coverage: z.object({
    allDecodedFramesEnumerated: z.boolean(),
    enumerationStartedAtRequestedRange: z.boolean(),
    enumerationExhausted: z.boolean(),
    frameObservation: z.object({
      returnedFrameCount: z.number(),
      leadingUnobservedMs: z.number().nullable(),
      trailingUnobservedMs: z.number().nullable(),
    }),
    sparse: z.boolean(),
    interpolationUsed: z.literal(false),
    captureContinuity: z.literal("unavailable"),
    limitations: z.array(z.string()),
  }),
  pagination: z.object({
    truncated: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
});

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

type SourceTimelineArgs = {
  startMs?: number | undefined;
  endMs?: number | undefined;
  markerId?: string | undefined;
  beforeMs?: number | undefined;
  afterMs?: number | undefined;
  sampling?: "consecutive" | "filmstrip" | undefined;
  maxFrames?: number | undefined;
  sampleCount?: number | undefined;
  cursor?: string | undefined;
  crop?: z.infer<typeof cropSchema> | undefined;
};

async function sourceWindow(
  recordingId: string,
  viewerIsOwner: boolean,
  args: SourceTimelineArgs,
  rewindPreRollMs: number,
) {
  if (args.markerId === undefined) {
    if (args.startMs === undefined || args.endMs === undefined) {
      return failWithNextStep(
        "invalid_input",
        400,
        "The source timeline needs an interval.",
        "Pass startMs and endMs, or a capture markerId.",
        "request",
      );
    }
    if (args.beforeMs !== undefined || args.afterMs !== undefined) {
      return failWithNextStep(
        "invalid_input",
        400,
        "beforeMs and afterMs apply only with a markerId.",
        "Leave them out, or pass a markerId instead of startMs and endMs.",
        "request",
      );
    }
    return { startMs: args.startMs, endMs: args.endMs, marker: null };
  }
  if (args.startMs !== undefined || args.endMs !== undefined) {
    return failWithNextStep(
      "invalid_input",
      400,
      "Pass either a markerId or startMs and endMs, not both.",
      "Drop startMs and endMs to read around the marker.",
      "request",
    );
  }
  const callerEmail = getRequestUserEmail()?.trim().toLowerCase();
  const found =
    viewerIsOwner && callerEmail
      ? await findRecordingCaptureMarker(
          recordingId,
          callerEmail,
          args.markerId,
        )
      : undefined;
  if (!found) {
    return failWithNextStep(
      "marker_not_found",
      404,
      "No capture marker with that id belongs to this clip.",
      "Read the clip's markers with get-capture-session, then call again.",
      "request",
    );
  }
  if (found.mediaTimeMs === null) {
    return failWithNextStep(
      "marker_unaligned",
      409,
      "The recorder never acknowledged this marker, so it has no media time.",
      "Pass startMs and endMs on the source timeline instead.",
      "request",
    );
  }
  const uncertaintyMs = found.uncertaintyMs ?? 0;
  const marker = {
    id: found.id,
    label: found.label,
    kind: found.kind,
    mediaTimeMs: found.mediaTimeMs,
    sourceTimeMs: found.mediaTimeMs + rewindPreRollMs,
    uncertaintyMs,
  };
  return {
    startMs: Math.max(
      0,
      marker.sourceTimeMs -
        uncertaintyMs -
        (args.beforeMs ?? DEFAULT_MARKER_BEFORE_MS),
    ),
    endMs:
      marker.sourceTimeMs +
      uncertaintyMs +
      (args.afterMs ?? DEFAULT_MARKER_AFTER_MS),
    marker,
  };
}

function sourceDerivationOf(editsJson: string | null | undefined) {
  const edits = parseEdits(editsJson);
  const rewindPreRollMs = edits.rewindOriginalStartMs ?? 0;
  const redacted = (edits.burnedRedactions?.length ?? 0) > 0;
  return {
    rewindPreRollMs,
    sourceDerivation: [
      ...(redacted ? ["redacted" as const] : []),
      ...(rewindPreRollMs > 0 ? ["rewind_extended" as const] : []),
    ],
    limitations: [
      ...(redacted
        ? [
            `Redactions were burned into this media: it is a re-encode at up to ${MAX_BURN_FPS} fps, so redacted areas stay hidden and frame timing and pixels come from that re-encode, not the original capture.`,
          ]
        : []),
      ...(rewindPreRollMs > 0
        ? [
            `The first ${rewindPreRollMs} ms of this media are Rewind pre-roll added after capture; startMs and endMs are on this media, and a marker's window is shifted by the pre-roll (its sourceTimeMs).`,
          ]
        : []),
    ],
  };
}

async function sourceTimelineFrames(
  recording: PublicAgentRecording,
  viewerIsOwner: boolean,
  args: SourceTimelineArgs,
) {
  const sampling = args.sampling ?? "consecutive";
  if (sampling !== "filmstrip" && args.sampleCount !== undefined) {
    return failWithNextStep(
      "invalid_input",
      400,
      "sampleCount applies only to filmstrip sampling.",
      'Pass sampling "filmstrip" with it, or leave it out.',
      "request",
    );
  }
  const derivation = sourceDerivationOf(recording.editsJson);
  const { startMs, endMs, marker } = await sourceWindow(
    recording.id,
    viewerIsOwner,
    args,
    derivation.rewindPreRollMs,
  );
  let page;
  try {
    page = await inspectSourceFrames(
      {
        recording,
        recordingId: recording.id,
        mode: sampling,
        startMs,
        endMs,
        crop: args.crop,
        maxFrames: args.maxFrames ?? MAX_MOTION_EVIDENCE_IMAGES,
        sampleCount: args.sampleCount,
        cursor: args.cursor,
      },
      { maxImageBase64Chars: MAX_IMAGE_BASE64_CHARS },
    );
  } catch (error) {
    if (error instanceof SourceFrameEvidenceError) {
      return errors.fail(error.message, error.code, {
        statusCode: error.statusCode,
        details: { failureKind: "source", error: error.message },
      });
    }
    throw error;
  }
  const shown = page.images.map(({ ptsMs, jpegBytes }) => {
    const timestamp = formatAgentTimestamp(ptsMs);
    const label = `Source frame at ${timestamp} (${ptsMs} ms)`;
    return {
      frame: { atMs: Math.round(ptsMs), timestamp, label },
      image: {
        data: Buffer.from(jpegBytes).toString("base64"),
        mediaType: "image/jpeg" as const,
        label,
      },
    };
  });
  return {
    frames: shown.map(({ frame }) => frame),
    recommendedFrames: [],
    failures: page.evidence.frames.flatMap((frame) =>
      frame.imageAttached
        ? []
        : [
            {
              atMs: Math.round(frame.ptsMs),
              failureKind: "unsupported",
              error: "The frame is too large to return as an image.",
              nextStep:
                "Its timestamp stays in sourceEvidence. Ask for a crop to see that area.",
            },
          ],
    ),
    _agentImages: shown.map(({ image }) => image),
    sourceEvidence: {
      timeline: "source" as const,
      sampling,
      marker,
      sourceDerivation: derivation.sourceDerivation,
      ...(derivation.rewindPreRollMs > 0
        ? { rewindPreRollMs: derivation.rewindPreRollMs }
        : {}),
      ...page.evidence,
      coverage: {
        ...page.evidence.coverage,
        limitations: [
          ...page.evidence.coverage.limitations,
          ...derivation.limitations,
        ],
      },
    },
  };
}

export default defineAction({
  description:
    "Return a Clips recording (clip)'s video frames as images you can see, so you can look at what is on screen. Pass the recordingId: the <id> in a Clips link (/r/<id>, /share/<id>) or the id query parameter of a frame or context URL. Pass atMs (up to 4 timestamps in milliseconds of the clip as it plays, with the owner's cuts removed, the same times the agent context and transcript use) for specific moments; at most 4 frames come back per call, so call again for more. Without atMs you get the first 4 recommended frames, and the result lists every recommended moment (atMs, timestamp, reason) to ask for next. A screenshot recording returns its picture. A frame that cannot be produced is listed in failures with a nextStep; if none can, the call fails. For motion QA, pass timeline \"source\" with startMs and endMs on the unedited source recording, or a capture markerId, to get original decoded frames with their presentation timestamps, coverage limits, an optional crop and a nextCursor that pages through every frame; sourceEvidence holds that detail.",
  schema: z.object({
    recordingId: z.string().trim().min(1).describe("Recording ID."),
    atMs: numberListParam(
      z.array(z.number().int().min(0)).min(1).max(MAX_FRAMES_PER_CALL),
    )
      .optional()
      .describe(
        '1 to 4 timestamps in milliseconds of the clip as it plays: an array, one number, or a comma-separated string like "350,6789". Without it, the first 4 recommended frames.',
      ),
    timeline: z
      .enum(["edited", "source"])
      .optional()
      .describe(
        'Defaults to "edited", the clip as it plays. "source" reads original decoded frames of the unedited recording for motion QA; only the owner can use it on a clip with cuts. The inputs below apply only to "source".',
      ),
    startMs: z.coerce
      .number()
      .finite()
      .min(0)
      .optional()
      .describe("Source timeline: inclusive interval start in milliseconds."),
    endMs: z.coerce
      .number()
      .finite()
      .positive()
      .optional()
      .describe(
        "Source timeline: inclusive interval end in milliseconds. Up to 30 s for consecutive, 120 s for filmstrip.",
      ),
    markerId: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{64}$/)
      .optional()
      .describe(
        "Source timeline: a capture marker id from get-capture-session, instead of startMs and endMs. The window spans the marker's media time, widened by its uncertainty, beforeMs and afterMs.",
      ),
    beforeMs: z.coerce
      .number()
      .finite()
      .min(0)
      .max(sourceIntervalLimitMs("filmstrip"))
      .optional()
      .describe(
        `Source timeline with markerId: milliseconds before the marker; defaults to ${DEFAULT_MARKER_BEFORE_MS}.`,
      ),
    afterMs: z.coerce
      .number()
      .finite()
      .min(0)
      .max(sourceIntervalLimitMs("filmstrip"))
      .optional()
      .describe(
        `Source timeline with markerId: milliseconds after the marker; defaults to ${DEFAULT_MARKER_AFTER_MS}.`,
      ),
    sampling: z
      .enum(["consecutive", "filmstrip"])
      .optional()
      .describe(
        'Source timeline: "consecutive" (default) pages through every stored frame in the interval; "filmstrip" returns sparse evenly spaced samples for orientation.',
      ),
    maxFrames: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_MOTION_EVIDENCE_IMAGES)
      .optional()
      .describe("Source timeline: frames in this page, 1 to 4; defaults to 4."),
    sampleCount: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_FILMSTRIP_SAMPLES)
      .optional()
      .describe(
        `Source timeline filmstrip: total samples across the interval, 1 to ${MAX_FILMSTRIP_SAMPLES}; defaults to ${DEFAULT_FILMSTRIP_SAMPLES}.`,
      ),
    cursor: z
      .string()
      .min(1)
      .max(1024)
      .optional()
      .describe(
        "Source timeline: sourceEvidence.pagination.nextCursor from the previous page, with the same interval, sampling and crop.",
      ),
    crop: cropSchema
      .optional()
      .describe(
        "Source timeline: a source-pixel crop {x,y,width,height}, checked against the decoded video size. It supplements full-frame evidence.",
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
    _agentImages: z.array(imageSchema),
    sourceEvidence: sourceEvidenceSchema.optional(),
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
    const sourceInputs = SOURCE_ONLY_INPUTS.filter(
      (key) => args[key] !== undefined,
    );
    if (args.timeline !== "source" && sourceInputs.length > 0) {
      return failWithNextStep(
        "invalid_input",
        400,
        `${sourceInputs.join(", ")} apply only to the source timeline.`,
        'Pass timeline "source" with them, or leave them out.',
        "request",
      );
    }
    if (args.timeline === "source" && args.atMs !== undefined) {
      return failWithNextStep(
        "invalid_input",
        400,
        "atMs is a time on the edited timeline.",
        'With timeline "source", pass startMs and endMs or a markerId instead.',
        "request",
      );
    }
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

    if (args.timeline === "source") {
      if (isImageRecording(recording)) {
        return failWithNextStep(
          "frames_unsupported",
          422,
          "A screenshot has no source timeline.",
          "Call without timeline to get the picture.",
          "unsupported",
        );
      }
      if (timeline.hasCuts && !access.viewerIsOwner) {
        return failWithNextStep(
          "source_timeline_unavailable",
          403,
          "This clip has cuts, and only its owner can read the unedited source.",
          "Call without timeline to see the clip as it plays.",
          "access",
        );
      }
      return {
        ...summary,
        ...(await sourceTimelineFrames(recording, access.viewerIsOwner, args)),
      };
    }

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
