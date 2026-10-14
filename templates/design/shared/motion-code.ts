import {
  assertMotionAnimationStyleDefinitions,
  type MotionAnimationStyleDefinition,
} from "./motion-animation-styles";
import { compile, hashCss } from "./motion-compiler";
import {
  assertValidMotionEasingVariables,
  isMotionEaseVariableReference,
  resolveMotionEase,
} from "./motion-easing";
import type { MotionEasingVariable } from "./motion-easing";
import {
  assertMotionNativeStyleInstances,
  type MotionNativeStyleInstance,
} from "./motion-native-style";
import {
  motionNativeStyleEndTimeMs,
  motionNativeStylesToTracks,
} from "./motion-native-style-runtime";
import type {
  MotionPlaybackMode,
  MotionTimeline,
  MotionTrack,
} from "./motion-timeline";
import {
  isMotionPathSegmentV1,
  motionTimelineDurationForTracks,
  MOTION_TIMELINE_MAX_DURATION_MS,
  parseMotionPosition,
} from "./motion-timeline";

export const MOTION_CODE_METADATA_VERSION = 3 as const;
const LEGACY_MOTION_CODE_METADATA_VERSION = 1;
export const MOTION_SOURCE_MARKER_NAME = "agent-native-motion-source";
export const MOTION_SOURCE_WRITE_UNAVAILABLE =
  "motion_source_write_unavailable";

export interface MotionCodeDocument {
  version: typeof MOTION_CODE_METADATA_VERSION;
  durationMs: number;
  defaultEase: string;
  playbackMode?: MotionPlaybackMode;
  tracks: MotionTrack[];
  animationStyles?: MotionAnimationStyleDefinition[];
  nativeStyles?: MotionNativeStyleInstance[];
  easingVariables?: MotionEasingVariable[];
  audioClips?: MotionAudioClip[];
}

export interface MotionAudioClip {
  id: string;
  name?: string;
  sourceUrl: string;
  timelineStartMs: number;
  sourceTrimStartMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
}

export interface MotionCodeCompileOptions {
  easingVariables?: readonly MotionEasingVariable[];
  audioClips?: readonly MotionAudioClip[];
}

export function motionAudioClipsEndTimeMs(
  audioClips: readonly MotionAudioClip[],
): number {
  assertMotionAudioClips(audioClips);
  return Math.ceil(
    Math.max(
      0,
      ...audioClips.map((clip) => clip.timelineStartMs + clip.durationMs),
    ),
  );
}

export type MotionSourceDocumentErrorCode =
  | "malformed-marker"
  | "unsupported-version"
  | "malformed-payload"
  | "invalid-document"
  | "duplicate-marker"
  | "unserializable-document";

export class MotionSourceDocumentError extends Error {
  constructor(
    readonly code: MotionSourceDocumentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MotionSourceDocumentError";
  }
}

export type MotionCodeMetadataReadResult =
  | { status: "absent" }
  | { status: "valid"; document: MotionCodeDocument }
  | { status: "invalid"; error: MotionSourceDocumentError };

export function motionCodeDocumentFromTimeline(
  timeline: MotionTimeline,
  options: MotionCodeCompileOptions = {},
): MotionCodeDocument {
  const audioClips = options.audioClips;
  const audioEndMs = motionAudioClipsEndTimeMs(audioClips ?? []);
  const nativeStyleEndMs = Math.ceil(
    Math.max(
      0,
      ...(timeline.nativeStyles ?? []).map(motionNativeStyleEndTimeMs),
    ),
  );
  const document: MotionCodeDocument = {
    version: MOTION_CODE_METADATA_VERSION,
    durationMs: Math.max(
      motionTimelineDurationForTracks(timeline.durationMs, timeline.tracks),
      nativeStyleEndMs,
      audioEndMs,
    ),
    defaultEase: timeline.defaultEase,
    tracks: timeline.tracks,
    ...(timeline.playbackMode ? { playbackMode: timeline.playbackMode } : {}),
    ...(timeline.animationStyles
      ? { animationStyles: timeline.animationStyles }
      : {}),
    ...(timeline.nativeStyles ? { nativeStyles: timeline.nativeStyles } : {}),
    ...(options.easingVariables !== undefined
      ? { easingVariables: [...options.easingVariables] }
      : {}),
    ...(audioClips !== undefined ? { audioClips: [...audioClips] } : {}),
  };
  assertMotionCodeDocument(document);
  return document;
}

export function compileMotionCode(
  timeline: MotionTimeline,
  options: MotionCodeCompileOptions = {},
) {
  const audioEndMs = motionAudioClipsEndTimeMs(options.audioClips ?? []);
  const nativeTracks = motionNativeStylesToTracks(timeline.nativeStyles ?? []);
  const nativeStyleEndMs = Math.ceil(
    Math.max(
      0,
      ...(timeline.nativeStyles ?? []).map(motionNativeStyleEndTimeMs),
    ),
  );
  const compiled = compile(
    {
      ...timeline,
      tracks: [...timeline.tracks, ...nativeTracks],
      durationMs: Math.max(timeline.durationMs, nativeStyleEndMs, audioEndMs),
    },
    options,
  );
  const css = withMotionCodeMetadata(
    compiled.css,
    motionCodeDocumentFromTimeline(timeline, options),
  );
  return { css, hash: hashCss(css) };
}

interface MarkerLocation {
  start: number;
  end: number;
  body: string;
}

/**
 * Serializes versioned authoring data into an inert CSS comment. The percent
 * encoding keeps the comment delimiter out of untrusted timeline values.
 */
export function encodeMotionCodeMetadata(document: MotionCodeDocument): string {
  assertMotionCodeDocument(document);
  let json: string;
  try {
    json = JSON.stringify(document);
  } catch {
    throw new MotionSourceDocumentError(
      "unserializable-document",
      "Motion source metadata must be serializable as JSON.",
    );
  }

  if (typeof json !== "string") {
    throw new MotionSourceDocumentError(
      "unserializable-document",
      "Motion source metadata must be serializable as JSON.",
    );
  }

  const payload = encodePayload(json);
  return `/* ${MOTION_SOURCE_MARKER_NAME}:v${document.version}:${payload} */`;
}

/** Reads metadata without conflating a missing marker with an unreadable one. */
export function decodeMotionCodeMetadata(
  css: string,
): MotionCodeMetadataReadResult {
  const scan = scanMotionSourceMarkers(css);
  if (scan.error) return { status: "invalid", error: scan.error };
  if (scan.markers.length === 0) return { status: "absent" };
  if (scan.markers.length > 1) {
    return {
      status: "invalid",
      error: new MotionSourceDocumentError(
        "duplicate-marker",
        "CSS contains more than one Motion source marker.",
      ),
    };
  }

  try {
    return {
      status: "valid",
      document: decodeMarker(scan.markers[0].body),
    };
  } catch (error) {
    return {
      status: "invalid",
      error:
        error instanceof MotionSourceDocumentError
          ? error
          : new MotionSourceDocumentError(
              "malformed-payload",
              "Motion source metadata could not be decoded.",
            ),
    };
  }
}

/**
 * Adds or replaces the single managed metadata comment while preserving all
 * other CSS text byte-for-byte. Invalid metadata is surfaced to the caller.
 */
export function withMotionCodeMetadata(
  css: string,
  document: MotionCodeDocument,
): string {
  const marker = encodeMotionCodeMetadata(document);
  const scan = scanMotionSourceMarkers(css);
  if (scan.error) throw scan.error;
  if (scan.markers.length > 1) {
    throw new MotionSourceDocumentError(
      "duplicate-marker",
      "CSS contains more than one Motion source marker.",
    );
  }

  const existing = scan.markers[0];
  if (existing) {
    const current = decodeMotionCodeMetadata(css);
    if (current.status === "invalid") throw current.error;
    return css.slice(0, existing.start) + marker + css.slice(existing.end);
  }

  if (css.length === 0) return marker;
  return `${css}${/[\t\n\f\r ]$/.test(css) ? "" : "\n"}${marker}`;
}

function encodePayload(json: string): string {
  // encodeURIComponent escapes slash; escaping its otherwise-safe asterisk
  // leaves a comment-safe alphabet with no possible `*/` sequence.
  return encodeURIComponent(json).replace(/\*/g, "%2A");
}

function decodeMarker(body: string): MotionCodeDocument {
  const marker = body.trim();
  const match = new RegExp(
    `^${MOTION_SOURCE_MARKER_NAME}:([^:]+):([\\s\\S]*)$`,
  ).exec(marker);
  if (!match) {
    throw new MotionSourceDocumentError(
      "malformed-marker",
      "Motion source marker has an invalid header.",
    );
  }

  const version = match[1];
  if (!/^v\d+$/.test(version)) {
    throw new MotionSourceDocumentError(
      "malformed-marker",
      `Motion source marker version "${version}" is malformed.`,
    );
  }
  const markerVersion = Number(version.slice(1));
  if (markerVersion > MOTION_CODE_METADATA_VERSION) {
    throw new MotionSourceDocumentError(
      "unsupported-version",
      `Motion code metadata version "${version}" is not supported.`,
    );
  }
  if (markerVersion < LEGACY_MOTION_CODE_METADATA_VERSION) {
    throw new MotionSourceDocumentError(
      "invalid-document",
      `Motion code metadata version "${version}" is not supported.`,
    );
  }

  let json: string;
  try {
    json = decodePayload(match[2]);
  } catch {
    throw new MotionSourceDocumentError(
      "malformed-payload",
      "Motion source marker contains invalid percent-encoded JSON.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new MotionSourceDocumentError(
      "malformed-payload",
      "Motion source marker does not contain valid JSON.",
    );
  }

  if (!isRecord(parsed) || typeof parsed.version !== "number") {
    throw new MotionSourceDocumentError(
      "invalid-document",
      "Motion source document must include a numeric version.",
    );
  }
  if (parsed.version !== markerVersion) {
    throw new MotionSourceDocumentError(
      "invalid-document",
      `Motion code metadata version ${parsed.version} does not match marker version ${markerVersion}.`,
    );
  }

  let document: unknown = parsed;
  try {
    if (markerVersion < MOTION_CODE_METADATA_VERSION) {
      assertOnlyKeys(
        parsed,
        markerVersion === LEGACY_MOTION_CODE_METADATA_VERSION
          ? [
              "version",
              "durationMs",
              "defaultEase",
              "playbackMode",
              "tracks",
              "animationStyles",
            ]
          : [
              "version",
              "durationMs",
              "defaultEase",
              "playbackMode",
              "tracks",
              "animationStyles",
              "nativeStyles",
              "easingVariables",
            ],
      );
      document = { ...parsed, version: MOTION_CODE_METADATA_VERSION };
    }
    assertMotionCodeDocument(document);
  } catch (error) {
    throw new MotionSourceDocumentError(
      "invalid-document",
      error instanceof Error
        ? error.message
        : "Motion code metadata contains an invalid document.",
    );
  }

  return document as MotionCodeDocument;
}

function decodePayload(payload: string): string {
  if (!/^(?:[A-Za-z0-9_.!~'()\-]|%[0-9A-F]{2})*$/.test(payload)) {
    throw new Error("Invalid Motion source encoding alphabet.");
  }
  const decoded = decodeURIComponent(payload);
  if (encodePayload(decoded) !== payload) {
    throw new Error("Motion source encoding is not canonical.");
  }
  return decoded;
}

function scanMotionSourceMarkers(css: string): {
  markers: MarkerLocation[];
  error?: MotionSourceDocumentError;
} {
  const markers: MarkerLocation[] = [];
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character !== "/" || css[index + 1] !== "*") continue;

    const endStart = css.indexOf("*/", index + 2);
    const bodyEnd = endStart === -1 ? css.length : endStart;
    const body = css.slice(index + 2, bodyEnd);
    if (isMotionMarkerBody(body)) {
      if (endStart === -1) {
        return {
          markers,
          error: new MotionSourceDocumentError(
            "malformed-marker",
            "Motion source marker comment is not closed.",
          ),
        };
      }
      markers.push({ start: index, end: endStart + 2, body });
    }

    if (endStart === -1) break;
    index = endStart + 1;
  }

  return { markers };
}

function isMotionMarkerBody(body: string): boolean {
  const candidate = body.trimStart();
  if (!candidate.startsWith(MOTION_SOURCE_MARKER_NAME)) return false;
  const next = candidate[MOTION_SOURCE_MARKER_NAME.length];
  return next === undefined || next === ":" || /\s/.test(next);
}

function assertMotionCodeDocument(
  value: unknown,
): asserts value is MotionCodeDocument {
  if (!isRecord(value)) invalidDocument("must be an object");
  if (value.version !== MOTION_CODE_METADATA_VERSION) {
    invalidDocument(`version must be ${MOTION_CODE_METADATA_VERSION}`);
  }
  requirePositiveInteger(value.durationMs, "durationMs");
  if (value.durationMs > MOTION_TIMELINE_MAX_DURATION_MS) {
    invalidDocument("durationMs must be at most 120000");
  }
  let easingVariables: readonly MotionEasingVariable[] = [];
  if (value.easingVariables !== undefined) {
    try {
      assertValidMotionEasingVariables(value.easingVariables);
      easingVariables = value.easingVariables;
    } catch (error) {
      invalidDocument(
        error instanceof Error
          ? error.message
          : "easingVariables contains an invalid definition",
      );
    }
  }
  assertEaseReference(value.defaultEase, "defaultEase", easingVariables);
  if (value.playbackMode !== undefined && !isPlaybackMode(value.playbackMode)) {
    invalidDocument("playbackMode is invalid");
  }
  assertOnlyKeys(value, [
    "version",
    "durationMs",
    "defaultEase",
    "playbackMode",
    "tracks",
    "animationStyles",
    "nativeStyles",
    "easingVariables",
    "audioClips",
  ]);
  if (!Array.isArray(value.tracks)) invalidDocument("tracks must be an array");
  if (value.tracks.length > 64) {
    invalidDocument("tracks must contain 0 to 64 tracks");
  }
  if (value.animationStyles !== undefined) {
    assertMotionAnimationStyleDefinitions(
      value.animationStyles,
      easingVariables,
    );
  }
  if (value.nativeStyles !== undefined) {
    assertMotionNativeStyleInstances(value.nativeStyles);
    const nativeStyleEndMs = Math.ceil(
      Math.max(0, ...value.nativeStyles.map(motionNativeStyleEndTimeMs)),
    );
    if (nativeStyleEndMs > MOTION_TIMELINE_MAX_DURATION_MS) {
      invalidDocument("nativeStyles exceed the 120000ms timeline limit");
    }
    if (value.durationMs < nativeStyleEndMs) {
      invalidDocument(
        "durationMs must cover every native style offset and duration",
      );
    }
    for (const [styleIndex, style] of value.nativeStyles.entries()) {
      const nativeEase = style.props.easing;
      if (
        typeof nativeEase === "string" &&
        (/^\s*var\s*\(/i.test(nativeEase) ||
          isMotionEaseVariableReference(nativeEase))
      ) {
        assertEaseReference(
          nativeEase,
          `nativeStyles[${styleIndex}].props.easing`,
          easingVariables,
        );
      }
    }
  }

  if (value.audioClips !== undefined) {
    assertMotionAudioClips(value.audioClips);
    const audioEndMs = motionAudioClipsEndTimeMs(value.audioClips);
    if (audioEndMs > MOTION_TIMELINE_MAX_DURATION_MS) {
      invalidDocument("audioClips exceed the 120000ms timeline limit");
    }
    if (value.durationMs < audioEndMs) {
      invalidDocument("durationMs must cover every audio clip");
    }
  }

  for (const [trackIndex, track] of value.tracks.entries()) {
    if (!isRecord(track))
      invalidDocument(`tracks[${trackIndex}] must be an object`);
    assertOnlyKeys(track, [
      "targetNodeId",
      "property",
      "keyframes",
      "enabled",
      "delayMs",
      "durationMs",
      "timelinePlaybackMode",
    ]);
    requireString(track.targetNodeId, `tracks[${trackIndex}].targetNodeId`);
    if (track.targetNodeId.trim().length === 0) {
      invalidDocument(`tracks[${trackIndex}].targetNodeId must not be empty`);
    }
    requireString(track.property, `tracks[${trackIndex}].property`);
    if (!/^-?[a-zA-Z][a-zA-Z0-9-]*$/.test(track.property)) {
      invalidDocument(`tracks[${trackIndex}].property is not a CSS property`);
    }
    if (!Array.isArray(track.keyframes)) {
      invalidDocument(`tracks[${trackIndex}].keyframes must be an array`);
    }
    if (track.enabled !== undefined && typeof track.enabled !== "boolean") {
      invalidDocument(`tracks[${trackIndex}].enabled must be a boolean`);
    }
    if (track.keyframes.length < 1 || track.keyframes.length > 128) {
      invalidDocument(
        `tracks[${trackIndex}].keyframes must contain 1 to 128 keyframes`,
      );
    }
    if (track.delayMs !== undefined) {
      requireNonNegativeNumber(track.delayMs, `tracks[${trackIndex}].delayMs`);
      if (track.delayMs > MOTION_TIMELINE_MAX_DURATION_MS) {
        invalidDocument(`tracks[${trackIndex}].delayMs is too large`);
      }
    }
    if (track.durationMs !== undefined) {
      requirePositiveNumber(
        track.durationMs,
        `tracks[${trackIndex}].durationMs`,
      );
      if (track.durationMs > MOTION_TIMELINE_MAX_DURATION_MS) {
        invalidDocument(`tracks[${trackIndex}].durationMs is too large`);
      }
    }
    if (
      track.timelinePlaybackMode !== undefined &&
      !isPlaybackMode(track.timelinePlaybackMode)
    ) {
      invalidDocument(`tracks[${trackIndex}].timelinePlaybackMode is invalid`);
    }

    for (const [keyframeIndex, keyframe] of track.keyframes.entries()) {
      if (!isRecord(keyframe)) {
        invalidDocument(
          `tracks[${trackIndex}].keyframes[${keyframeIndex}] must be an object`,
        );
      }
      requireFiniteNumber(
        keyframe.t,
        `tracks[${trackIndex}].keyframes[${keyframeIndex}].t`,
      );
      if (keyframe.t < 0 || keyframe.t > 1) {
        invalidDocument(
          `tracks[${trackIndex}].keyframes[${keyframeIndex}].t must be in [0, 1]`,
        );
      }
      requireSafeCssToken(
        keyframe.value,
        `tracks[${trackIndex}].keyframes[${keyframeIndex}].value`,
      );
      if (keyframe.ease !== undefined) {
        assertEaseReference(
          keyframe.ease,
          `tracks[${trackIndex}].keyframes[${keyframeIndex}].ease`,
          easingVariables,
        );
      }
      if (keyframe.motionPath !== undefined) {
        if (track.property !== "translate") {
          invalidDocument(
            `tracks[${trackIndex}].keyframes[${keyframeIndex}].motionPath is only valid for translate tracks`,
          );
        }
        if (keyframeIndex === track.keyframes.length - 1) {
          invalidDocument(
            `tracks[${trackIndex}].keyframes[${keyframeIndex}].motionPath must belong to a keyframe with a following keyframe`,
          );
        }
        if (!isMotionPathSegmentV1(keyframe.motionPath)) {
          invalidDocument(
            `tracks[${trackIndex}].keyframes[${keyframeIndex}].motionPath must be a finite version 1 cubic with bounded control offsets`,
          );
        }
        const nextKeyframe = track.keyframes[keyframeIndex + 1];
        if (
          !isRecord(nextKeyframe) ||
          typeof nextKeyframe.value !== "string" ||
          !parseMotionPosition(keyframe.value) ||
          !parseMotionPosition(nextKeyframe.value)
        ) {
          invalidDocument(
            `tracks[${trackIndex}].keyframes[${keyframeIndex}].motionPath requires a following finite 2D px Position keyframe`,
          );
        }
      }
      assertOnlyKeys(keyframe, ["t", "value", "ease", "motionPath"]);
    }
  }
  if (
    motionTimelineDurationForTracks(value.durationMs, value.tracks) !==
    value.durationMs
  ) {
    invalidDocument("durationMs must cover every track delay and duration");
  }
}

function assertMotionAudioClips(
  value: unknown,
): asserts value is MotionAudioClip[] {
  if (!Array.isArray(value)) invalidDocument("audioClips must be an array");
  if (value.length > 64) {
    invalidDocument("audioClips must contain 0 to 64 clips");
  }

  const ids = new Set<string>();
  for (const [clipIndex, clip] of value.entries()) {
    const path = `audioClips[${clipIndex}]`;
    if (!isRecord(clip)) invalidDocument(`${path} must be an object`);
    assertOnlyKeys(clip, [
      "id",
      "name",
      "sourceUrl",
      "timelineStartMs",
      "sourceTrimStartMs",
      "durationMs",
      "volume",
      "muted",
    ]);
    requireString(clip.id, `${path}.id`);
    if (
      clip.id.trim().length === 0 ||
      clip.id.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(clip.id)
    ) {
      invalidDocument(`${path}.id must be a non-empty identifier`);
    }
    if (ids.has(clip.id)) invalidDocument(`${path}.id must be unique`);
    ids.add(clip.id);

    if (clip.name !== undefined) {
      requireString(clip.name, `${path}.name`);
      if (
        clip.name.trim().length === 0 ||
        clip.name.length > 240 ||
        /[\u0000-\u001f\u007f]/.test(clip.name)
      ) {
        invalidDocument(
          `${path}.name must contain 1 to 240 printable characters`,
        );
      }
    }

    assertAudioSourceUrl(clip.sourceUrl, `${path}.sourceUrl`);
    requireNonNegativeNumber(clip.timelineStartMs, `${path}.timelineStartMs`);
    requireNonNegativeNumber(
      clip.sourceTrimStartMs,
      `${path}.sourceTrimStartMs`,
    );
    requirePositiveNumber(clip.durationMs, `${path}.durationMs`);
    if (clip.timelineStartMs > MOTION_TIMELINE_MAX_DURATION_MS) {
      invalidDocument(
        `${path}.timelineStartMs exceeds the 120000ms timeline limit`,
      );
    }
    if (clip.durationMs > MOTION_TIMELINE_MAX_DURATION_MS) {
      invalidDocument(`${path}.durationMs exceeds the 120000ms timeline limit`);
    }
    if (
      clip.timelineStartMs + clip.durationMs >
      MOTION_TIMELINE_MAX_DURATION_MS
    ) {
      invalidDocument(`${path} exceeds the 120000ms timeline limit`);
    }
    if (clip.sourceTrimStartMs + clip.durationMs > Number.MAX_SAFE_INTEGER) {
      invalidDocument(
        `${path}.sourceTrimStartMs and durationMs exceed safe precision`,
      );
    }
    requireFiniteNumber(clip.volume, `${path}.volume`);
    if (clip.volume < 0 || clip.volume > 1) {
      invalidDocument(`${path}.volume must be in [0, 1]`);
    }
    if (typeof clip.muted !== "boolean") {
      invalidDocument(`${path}.muted must be a boolean`);
    }
  }
}

function assertAudioSourceUrl(
  value: unknown,
  path: string,
): asserts value is string {
  requireString(value, path);
  if (
    value.length === 0 ||
    value.length > 4096 ||
    value !== value.trim() ||
    /[\\\u0000-\u0020\u007f]/.test(value) ||
    value.startsWith("//")
  ) {
    invalidDocument(`${path} must be a safe audio URL`);
  }

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  if (hasScheme && !/^https?:\/\//i.test(value)) {
    invalidDocument(`${path} must use HTTP(S) or a relative URL`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value, "https://motion-source.invalid/");
  } catch {
    invalidDocument(`${path} must be a valid audio URL`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    invalidDocument(`${path} must use HTTP(S) or a relative URL`);
  }
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: string[],
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) invalidDocument(`unexpected field "${unexpected}"`);
}

function assertEaseReference(
  value: unknown,
  path: string,
  easingVariables: readonly MotionEasingVariable[],
): asserts value is string {
  requireSafeCssToken(value, path);
  try {
    resolveMotionEase(value, easingVariables);
  } catch (error) {
    invalidDocument(
      error instanceof Error
        ? `${path} ${error.message}`
        : `${path} is not a supported timing function`,
    );
  }
}

function requireString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") invalidDocument(`${path} must be a string`);
}

function requireFiniteNumber(
  value: unknown,
  path: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalidDocument(`${path} must be a finite number`);
  }
}

function requirePositiveNumber(
  value: unknown,
  path: string,
): asserts value is number {
  requireFiniteNumber(value, path);
  if (value <= 0) invalidDocument(`${path} must be positive`);
}

function requireNonNegativeNumber(
  value: unknown,
  path: string,
): asserts value is number {
  requireFiniteNumber(value, path);
  if (value < 0) invalidDocument(`${path} must be non-negative`);
}

function requirePositiveInteger(
  value: unknown,
  path: string,
): asserts value is number {
  requirePositiveNumber(value, path);
  if (!Number.isInteger(value)) invalidDocument(`${path} must be an integer`);
}

function requireSafeCssToken(
  value: unknown,
  path: string,
): asserts value is string {
  requireString(value, path);
  if (
    value.trim().length === 0 ||
    /[;{}<>]|\/\*|\*\/|\burl\s*\(/i.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    invalidDocument(`${path} is not a safe CSS token`);
  }
}

function isPlaybackMode(
  value: unknown,
): value is "loop" | "once" | "ping-pong" {
  return value === "loop" || value === "once" || value === "ping-pong";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidDocument(message: string): never {
  throw new TypeError(`Invalid Motion code metadata: ${message}.`);
}
