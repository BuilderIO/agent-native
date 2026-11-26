import { createHash } from "node:crypto";

import { preCompressionSourceMedia } from "./builder-media-compression.js";
import {
  DEFAULT_FILMSTRIP_SAMPLES,
  extractMotionEvidenceFrames,
  MAX_CONSECUTIVE_INTERVAL_MS,
  MAX_CURSOR_DUPLICATE_FRAMES,
  MAX_FILMSTRIP_INTERVAL_MS,
  MAX_FILMSTRIP_SAMPLES,
  MotionEvidenceExtractionError,
  type ConsecutiveMotionCursor,
  type MotionEvidenceCrop,
  type MotionEvidenceDimensions,
  type MotionEvidenceFrame,
  type MotionEvidenceMode,
} from "./motion-evidence.js";
import {
  loadRecordingMediaBytes,
  RecordingMediaFetchError,
  type PublicAgentRecording,
} from "./public-agent-context.js";

export type SourceFrameEvidenceErrorCode =
  | "invalid_input"
  | "invalid_cursor"
  | "source_media_changed"
  | "crop_out_of_bounds"
  | "frames_unsupported"
  | "media_unavailable"
  | "frame_extraction_failed";

export class SourceFrameEvidenceError extends Error {
  constructor(
    readonly code: SourceFrameEvidenceErrorCode,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "SourceFrameEvidenceError";
  }
}

interface ConsecutiveCursorPosition {
  mode: "consecutive";
  pts: number;
  ptsUs: number;
  samePtsSeen: number;
}

interface FilmstripCursorPosition {
  mode: "filmstrip";
  nextSampleIndex: number;
  sampleCount: number;
}

export type SourceFrameCursor = {
  v: 1;
  recordingId: string;
  startMs: number;
  endMs: number;
  mediaSha256: string;
  crop?: MotionEvidenceCrop;
} & (ConsecutiveCursorPosition | FilmstripCursorPosition);

export interface SourceFrameRequest {
  recordingId: string;
  mode: MotionEvidenceMode;
  startMs: number;
  endMs: number;
  crop?: MotionEvidenceCrop | undefined;
  sampleCount?: number | undefined;
}

export interface SourceFrameEvidenceInput extends SourceFrameRequest {
  recording: PublicAgentRecording;
  maxFrames: number;
  cursor?: string | undefined;
}

export interface SourceEvidenceFrame {
  id: string;
  ptsMs: number;
  targetMs?: number;
  gapFromPreviousMs: number | null;
  imageAttached: boolean;
}

export interface SourceFrameEvidence {
  requestedRange: { startMs: number; endMs: number };
  sourceDimensions: MotionEvidenceDimensions;
  crop: {
    sourcePixels: MotionEvidenceCrop;
    representation: "cropped supplement";
  } | null;
  returnedRange: { startPtsMs: number; endPtsMs: number } | null;
  frames: SourceEvidenceFrame[];
  gapMeasurements: {
    basis: string;
    includesPreviousPageBoundary: boolean;
    count: number;
    medianMs: number | null;
    maxMs: number | null;
  };
  coverage: {
    allDecodedFramesEnumerated: boolean;
    enumerationStartedAtRequestedRange: boolean;
    enumerationExhausted: boolean;
    frameObservation: {
      returnedFrameCount: number;
      leadingUnobservedMs: number | null;
      trailingUnobservedMs: number | null;
    };
    sparse: boolean;
    interpolationUsed: false;
    captureContinuity: "unavailable";
    limitations: string[];
  };
  pagination: { truncated: boolean; nextCursor: string | null };
}

export interface SourceFramePage {
  evidence: SourceFrameEvidence;
  images: Array<{ ptsMs: number; jpegBytes: Uint8Array }>;
}

function invalidCursor(message: string): never {
  throw new SourceFrameEvidenceError("invalid_cursor", message, 400);
}

function sameCrop(
  left: MotionEvidenceCrop | undefined,
  right: MotionEvidenceCrop | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cropOf(value: unknown): MotionEvidenceCrop | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return invalidCursor("The cursor crop is malformed.");
  const { x, y, width, height } = value;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return invalidCursor("The cursor crop is malformed.");
  }
  return { x, y, width, height };
}

function encodeCursor(payload: SourceFrameCursor): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeSourceFrameCursor(
  cursor: string,
  expected: SourceFrameRequest,
): SourceFrameCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return invalidCursor("The frame cursor is invalid or malformed.");
  }
  if (!isRecord(parsed)) {
    return invalidCursor("The frame cursor is invalid or malformed.");
  }
  const crop = cropOf(parsed.crop);
  if (
    parsed.v !== 1 ||
    parsed.recordingId !== expected.recordingId ||
    parsed.mode !== expected.mode ||
    parsed.startMs !== expected.startMs ||
    parsed.endMs !== expected.endMs ||
    !sameCrop(crop, expected.crop)
  ) {
    return invalidCursor(
      "The frame cursor does not match this recording and interval.",
    );
  }
  const { mediaSha256 } = parsed;
  if (typeof mediaSha256 !== "string" || !/^[a-f0-9]{64}$/.test(mediaSha256)) {
    return invalidCursor(
      "The frame cursor has no valid source-media identity.",
    );
  }
  const base = {
    v: 1 as const,
    recordingId: expected.recordingId,
    startMs: expected.startMs,
    endMs: expected.endMs,
    mediaSha256,
    ...(crop ? { crop } : {}),
  };
  if (expected.mode === "consecutive") {
    const { pts, ptsUs, samePtsSeen } = parsed;
    if (
      typeof pts !== "number" ||
      !Number.isSafeInteger(pts) ||
      typeof ptsUs !== "number" ||
      !Number.isSafeInteger(ptsUs) ||
      ptsUs < Math.floor(expected.startMs * 1000) ||
      ptsUs > Math.ceil(expected.endMs * 1000) ||
      typeof samePtsSeen !== "number" ||
      !Number.isInteger(samePtsSeen) ||
      samePtsSeen < 1 ||
      samePtsSeen > MAX_CURSOR_DUPLICATE_FRAMES
    ) {
      return invalidCursor("The consecutive-frame cursor is invalid.");
    }
    return { ...base, mode: "consecutive", pts, ptsUs, samePtsSeen };
  }
  const { nextSampleIndex, sampleCount } = parsed;
  if (
    typeof nextSampleIndex !== "number" ||
    !Number.isInteger(nextSampleIndex) ||
    nextSampleIndex < 1 ||
    typeof sampleCount !== "number" ||
    !Number.isInteger(sampleCount) ||
    sampleCount < 1 ||
    sampleCount > MAX_FILMSTRIP_SAMPLES ||
    nextSampleIndex >= sampleCount
  ) {
    return invalidCursor("The filmstrip cursor is invalid.");
  }
  if (
    expected.sampleCount !== undefined &&
    expected.sampleCount !== sampleCount
  )
    return invalidCursor(
      `The filmstrip cursor was issued for sampleCount ${sampleCount}; pass the same sampleCount or leave it out.`,
    );
  return { ...base, mode: "filmstrip", nextSampleIndex, sampleCount };
}

function median(values: number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const half = sorted.length / 2;
  const middle = Number.isInteger(half)
    ? sorted.slice(Math.max(0, half - 1), half + 1)
    : sorted.slice(Math.floor(half), Math.floor(half) + 1);
  if (middle.length === 0) return null;
  return middle.reduce((sum, value) => sum + value, 0) / middle.length;
}

function filmstripTargets(
  startMs: number,
  endMs: number,
  sampleCount: number,
  fromIndex: number,
  limit: number,
): number[] {
  const cellMs = (endMs - startMs) / sampleCount;
  return Array.from(
    { length: Math.max(0, Math.min(limit, sampleCount - fromIndex)) },
    (_, offset) => startMs + (fromIndex + offset + 0.5) * cellMs,
  );
}

export function sourceIntervalLimitMs(mode: MotionEvidenceMode): number {
  return mode === "consecutive"
    ? MAX_CONSECUTIVE_INTERVAL_MS
    : MAX_FILMSTRIP_INTERVAL_MS;
}

function checkInterval(request: SourceFrameRequest): void {
  if (request.endMs <= request.startMs) {
    throw new SourceFrameEvidenceError(
      "invalid_input",
      "endMs must be greater than startMs.",
      400,
    );
  }
  const limitMs = sourceIntervalLimitMs(request.mode);
  if (request.endMs - request.startMs > limitMs) {
    throw new SourceFrameEvidenceError(
      "invalid_input",
      `${request.mode} source intervals are limited to ${limitMs} ms.`,
      400,
    );
  }
}

async function loadSourceMedia(recording: PublicAgentRecording) {
  if (!recording.videoUrl) {
    throw new SourceFrameEvidenceError(
      "frames_unsupported",
      "The recording has no stored video media.",
      409,
    );
  }
  const original = await preCompressionSourceMedia(recording);
  try {
    return await loadRecordingMediaBytes(
      original
        ? {
            ...recording,
            videoUrl: original.videoUrl,
            videoSizeBytes: original.sizeBytes ?? 0,
          }
        : recording,
    );
  } catch (error) {
    if (error instanceof RecordingMediaFetchError) {
      throw new SourceFrameEvidenceError(
        "media_unavailable",
        error.message,
        error.statusCode,
      );
    }
    throw error;
  }
}

function extractionFailure(
  error: MotionEvidenceExtractionError,
): SourceFrameEvidenceError {
  switch (error.code) {
    case "crop_out_of_bounds":
      return new SourceFrameEvidenceError(
        "crop_out_of_bounds",
        error.message,
        422,
      );
    case "no_video":
      return new SourceFrameEvidenceError(
        "frames_unsupported",
        error.message,
        422,
      );
    case "ffmpeg_unavailable":
    case "decode_failed":
    case "timestamp_mismatch":
      return new SourceFrameEvidenceError(
        "frame_extraction_failed",
        error.message,
        422,
      );
  }
}

function limitationsFor(input: {
  crop: boolean;
  sparse: boolean;
  truncated: boolean;
  imagesOmitted: boolean;
}): string[] {
  return [
    "These timestamps and gaps describe decoded frames in the stored media; capture telemetry and presentation between encoded frames are unavailable here.",
    "An encoded-frame gap does not identify whether the recorder, processing pipeline, browser renderer, or target app caused it.",
    "Leading and trailing unobserved durations measure distance to returned decoded-frame timestamps; they do not prove what pixels were presented between encoded frames.",
    ...(input.crop
      ? [
          "This crop supplements a full-surface overview; it does not show behavior outside the selected source-pixel rectangle.",
        ]
      : []),
    ...(input.sparse
      ? [
          "Filmstrip mode is sparse orientation evidence and cannot exclude a defect between returned samples.",
        ]
      : []),
    ...(input.truncated
      ? [
          "This response is truncated; follow nextCursor before judging the full requested interval.",
        ]
      : []),
    ...(input.imagesOmitted
      ? [
          "One or more decoded JPEGs exceeded the live agent-image limit and were omitted; their timestamp metadata remains in this page.",
        ]
      : []),
  ];
}

export async function inspectSourceFrames(
  input: SourceFrameEvidenceInput,
  { maxImageBase64Chars }: { maxImageBase64Chars: number },
): Promise<SourceFramePage> {
  checkInterval(input);
  if (input.mode !== "filmstrip" && input.sampleCount !== undefined) {
    throw new SourceFrameEvidenceError(
      "invalid_input",
      "sampleCount applies only to filmstrip sampling.",
      400,
    );
  }
  const cursor = input.cursor
    ? decodeSourceFrameCursor(input.cursor, input)
    : null;
  const media = await loadSourceMedia(input.recording);
  const mediaSha256 = createHash("sha256").update(media.bytes).digest("hex");
  if (cursor && cursor.mediaSha256 !== mediaSha256) {
    throw new SourceFrameEvidenceError(
      "source_media_changed",
      "The stored recording media changed after this frame cursor was issued. Start a new inspection from the first page.",
      409,
    );
  }

  const after: ConsecutiveMotionCursor | undefined =
    cursor?.mode === "consecutive"
      ? {
          pts: cursor.pts,
          ptsUs: cursor.ptsUs,
          samePtsSeen: cursor.samePtsSeen,
        }
      : undefined;
  const sampleCount =
    cursor?.mode === "filmstrip"
      ? cursor.sampleCount
      : (input.sampleCount ?? DEFAULT_FILMSTRIP_SAMPLES);
  const filmstripStartIndex =
    cursor?.mode === "filmstrip" ? cursor.nextSampleIndex : 0;
  const targets =
    input.mode === "filmstrip"
      ? filmstripTargets(
          input.startMs,
          input.endMs,
          sampleCount,
          filmstripStartIndex,
          input.maxFrames,
        )
      : undefined;

  let frames: MotionEvidenceFrame[];
  let hasMore: boolean;
  let sourceDimensions: MotionEvidenceDimensions;
  let crop: MotionEvidenceCrop | null;
  try {
    ({ frames, hasMore, sourceDimensions, crop } =
      await extractMotionEvidenceFrames({
        mediaBytes: media.bytes,
        mimeType: media.mimeType,
        startMs: input.startMs,
        endMs: input.endMs,
        mode: input.mode,
        limit: input.maxFrames,
        ...(after ? { after } : {}),
        ...(targets ? { filmstripTargetsMs: targets } : {}),
        ...(input.crop ? { crop: input.crop } : {}),
      }));
  } catch (error) {
    if (error instanceof MotionEvidenceExtractionError) {
      throw extractionFailure(error);
    }
    throw error;
  }

  const precedingPtsUs = after?.ptsUs;
  let previousPtsUs = precedingPtsUs;
  const pageFrames = frames.map((frame) => {
    const gapFromPreviousMs =
      previousPtsUs === undefined ? null : (frame.ptsUs - previousPtsUs) / 1000;
    previousPtsUs = frame.ptsUs;
    return {
      frame,
      gapFromPreviousMs,
      imageAttached:
        Math.ceil(frame.jpegBytes.byteLength / 3) * 4 <= maxImageBase64Chars,
    };
  });
  const measuredGaps = pageFrames.flatMap(({ gapFromPreviousMs }) =>
    gapFromPreviousMs === null ? [] : [gapFromPreviousMs],
  );
  const firstFrame = frames.length > 0 ? frames[0] : undefined;
  const lastFrame = frames.length > 0 ? frames[frames.length - 1] : undefined;

  const cursorBase = {
    v: 1 as const,
    recordingId: input.recordingId,
    startMs: input.startMs,
    endMs: input.endMs,
    mediaSha256,
    ...(input.crop ? { crop: input.crop } : {}),
  };
  let nextCursor: string | null = null;
  if (input.mode === "consecutive" && hasMore && lastFrame) {
    if (lastFrame.samePtsOrdinal >= MAX_CURSOR_DUPLICATE_FRAMES) {
      throw new SourceFrameEvidenceError(
        "frame_extraction_failed",
        "Too many source frames share one presentation timestamp to paginate without ambiguity.",
        422,
      );
    }
    nextCursor = encodeCursor({
      ...cursorBase,
      mode: "consecutive",
      pts: lastFrame.pts,
      ptsUs: lastFrame.ptsUs,
      samePtsSeen: lastFrame.samePtsOrdinal,
    });
  } else if (input.mode === "filmstrip") {
    const nextSampleIndex = filmstripStartIndex + (targets?.length ?? 0);
    if (nextSampleIndex < sampleCount) {
      nextCursor = encodeCursor({
        ...cursorBase,
        mode: "filmstrip",
        nextSampleIndex,
        sampleCount,
      });
    }
  }

  const intervalMs = input.endMs - input.startMs;
  const leadingUnobservedMs = input.cursor
    ? null
    : firstFrame
      ? Math.max(0, firstFrame.ptsMs - input.startMs)
      : nextCursor
        ? null
        : intervalMs;
  const trailingUnobservedMs = nextCursor
    ? null
    : lastFrame
      ? Math.max(0, input.endMs - lastFrame.ptsMs)
      : precedingPtsUs !== undefined
        ? Math.max(0, input.endMs - precedingPtsUs / 1000)
        : input.cursor
          ? null
          : intervalMs;

  return {
    evidence: {
      requestedRange: { startMs: input.startMs, endMs: input.endMs },
      sourceDimensions,
      crop: crop
        ? { sourcePixels: crop, representation: "cropped supplement" }
        : null,
      returnedRange:
        firstFrame && lastFrame
          ? { startPtsMs: firstFrame.ptsMs, endPtsMs: lastFrame.ptsMs }
          : null,
      frames: pageFrames.map(({ frame, gapFromPreviousMs, imageAttached }) => ({
        id: `${input.recordingId}:${frame.ptsUs}:${frame.samePtsOrdinal}`,
        ptsMs: frame.ptsMs,
        ...(frame.targetMs === undefined ? {} : { targetMs: frame.targetMs }),
        gapFromPreviousMs,
        imageAttached,
      })),
      gapMeasurements: {
        basis: "actual presentation timestamps within this returned page",
        includesPreviousPageBoundary: precedingPtsUs !== undefined,
        count: measuredGaps.length,
        medianMs: median(measuredGaps),
        maxMs: measuredGaps.length ? Math.max(...measuredGaps) : null,
      },
      coverage: {
        allDecodedFramesEnumerated:
          input.mode === "consecutive" && !input.cursor && !nextCursor,
        enumerationStartedAtRequestedRange: !input.cursor,
        enumerationExhausted: !nextCursor,
        frameObservation: {
          returnedFrameCount: frames.length,
          leadingUnobservedMs,
          trailingUnobservedMs,
        },
        sparse: input.mode === "filmstrip",
        interpolationUsed: false,
        captureContinuity: "unavailable",
        limitations: limitationsFor({
          crop: Boolean(input.crop),
          sparse: input.mode === "filmstrip",
          truncated: Boolean(nextCursor),
          imagesOmitted: pageFrames.some(({ imageAttached }) => !imageAttached),
        }),
      },
      pagination: { truncated: Boolean(nextCursor), nextCursor },
    },
    images: pageFrames.flatMap(({ frame, imageAttached }) =>
      imageAttached ? [{ ptsMs: frame.ptsMs, jpegBytes: frame.jpegBytes }] : [],
    ),
  };
}
