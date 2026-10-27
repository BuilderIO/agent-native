import { resolveMotionEase } from "./motion-easing";
import type { MotionEasingVariable } from "./motion-easing";
import type { MotionKeyframe } from "./motion-timeline";
import {
  isMotionPathSegmentV1,
  MOTION_TIMELINE_MAX_DURATION_MS,
  parseMotionPosition,
} from "./motion-timeline";

export type MotionAnimationStyleCategory = "basic" | "enter" | "cycle" | "exit";

export interface MotionAnimationStyleMetadata {
  name: string;
  category: MotionAnimationStyleCategory;
  description?: string;
}

export interface MotionAnimationStyleTrackDefinition {
  property: string;
  keyframes: MotionKeyframe[];
  enabled?: boolean;
  delayMs?: number;
  durationMs?: number;
}

export interface MotionAnimationStyleDefinition {
  id: string;
  name: string;
  category: MotionAnimationStyleCategory;
  description?: string;
  tracks: MotionAnimationStyleTrackDefinition[];
}

export const MOTION_ANIMATION_STYLE_MAX_DEFINITIONS = 64;
export const MOTION_ANIMATION_STYLE_MAX_TRACKS = 24;
export const MOTION_ANIMATION_STYLE_MAX_KEYFRAMES = 128;
export const MOTION_ANIMATION_STYLE_MAX_TOTAL_KEYFRAMES = 2_048;

const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_VALUE_LENGTH = 512;

/** Validates the bounded, target-independent style data stored in source. */
export function assertMotionAnimationStyleDefinitions(
  value: unknown,
  easingVariables: readonly MotionEasingVariable[] = [],
): asserts value is MotionAnimationStyleDefinition[] {
  if (!Array.isArray(value)) invalidStyle("animationStyles must be an array");
  if (value.length > MOTION_ANIMATION_STYLE_MAX_DEFINITIONS) {
    invalidStyle(
      `animationStyles must contain 0 to ${MOTION_ANIMATION_STYLE_MAX_DEFINITIONS} definitions`,
    );
  }

  const ids = new Set<string>();
  let totalKeyframes = 0;
  for (const [styleIndex, style] of value.entries()) {
    const path = `animationStyles[${styleIndex}]`;
    if (!isRecord(style)) invalidStyle(`${path} must be an object`);
    assertOnlyKeys(
      style,
      ["id", "name", "category", "description", "tracks"],
      path,
    );

    requireString(style.id, `${path}.id`);
    if (
      style.id.length > MAX_ID_LENGTH ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(style.id)
    ) {
      invalidStyle(
        `${path}.id must be a safe identifier up to ${MAX_ID_LENGTH} characters`,
      );
    }
    if (ids.has(style.id)) invalidStyle(`${path}.id must be unique`);
    ids.add(style.id);

    requireBoundedText(style.name, `${path}.name`, MAX_NAME_LENGTH);
    if (
      style.category !== "basic" &&
      style.category !== "enter" &&
      style.category !== "cycle" &&
      style.category !== "exit"
    ) {
      invalidStyle(`${path}.category is invalid`);
    }
    if (style.description !== undefined) {
      requireBoundedText(
        style.description,
        `${path}.description`,
        MAX_DESCRIPTION_LENGTH,
      );
    }
    if (!Array.isArray(style.tracks)) {
      invalidStyle(`${path}.tracks must be an array`);
    }
    if (
      style.tracks.length < 1 ||
      style.tracks.length > MOTION_ANIMATION_STYLE_MAX_TRACKS
    ) {
      invalidStyle(
        `${path}.tracks must contain 1 to ${MOTION_ANIMATION_STYLE_MAX_TRACKS} tracks`,
      );
    }

    for (const [trackIndex, track] of style.tracks.entries()) {
      const trackPath = `${path}.tracks[${trackIndex}]`;
      if (!isRecord(track)) invalidStyle(`${trackPath} must be an object`);
      assertOnlyKeys(
        track,
        ["property", "keyframes", "enabled", "delayMs", "durationMs"],
        trackPath,
      );

      requireString(track.property, `${trackPath}.property`);
      if (track.enabled !== undefined && typeof track.enabled !== "boolean") {
        invalidStyle(`${trackPath}.enabled must be a boolean`);
      }
      if (
        track.property.length > 128 ||
        !/^-?[a-zA-Z][a-zA-Z0-9-]*$/.test(track.property)
      ) {
        invalidStyle(`${trackPath}.property is not a safe CSS property`);
      }
      if (!Array.isArray(track.keyframes)) {
        invalidStyle(`${trackPath}.keyframes must be an array`);
      }
      if (
        track.keyframes.length < 1 ||
        track.keyframes.length > MOTION_ANIMATION_STYLE_MAX_KEYFRAMES
      ) {
        invalidStyle(
          `${trackPath}.keyframes must contain 1 to ${MOTION_ANIMATION_STYLE_MAX_KEYFRAMES} keyframes`,
        );
      }
      totalKeyframes += track.keyframes.length;
      if (totalKeyframes > MOTION_ANIMATION_STYLE_MAX_TOTAL_KEYFRAMES) {
        invalidStyle(
          `animationStyles must contain at most ${MOTION_ANIMATION_STYLE_MAX_TOTAL_KEYFRAMES} keyframes in total`,
        );
      }
      if (track.delayMs !== undefined) {
        requireFiniteNumber(track.delayMs, `${trackPath}.delayMs`);
        if (
          track.delayMs < 0 ||
          track.delayMs > MOTION_TIMELINE_MAX_DURATION_MS
        ) {
          invalidStyle(`${trackPath}.delayMs must be in [0, 120000]`);
        }
      }
      if (track.durationMs !== undefined) {
        requireFiniteNumber(track.durationMs, `${trackPath}.durationMs`);
        if (
          track.durationMs <= 0 ||
          track.durationMs > MOTION_TIMELINE_MAX_DURATION_MS
        ) {
          invalidStyle(`${trackPath}.durationMs must be in (0, 120000]`);
        }
      }

      for (const [keyframeIndex, keyframe] of track.keyframes.entries()) {
        const keyframePath = `${trackPath}.keyframes[${keyframeIndex}]`;
        if (!isRecord(keyframe))
          invalidStyle(`${keyframePath} must be an object`);
        assertOnlyKeys(
          keyframe,
          ["t", "value", "ease", "motionPath"],
          keyframePath,
        );
        requireFiniteNumber(keyframe.t, `${keyframePath}.t`);
        if (keyframe.t < 0 || keyframe.t > 1) {
          invalidStyle(`${keyframePath}.t must be in [0, 1]`);
        }
        requireSafeCssToken(keyframe.value, `${keyframePath}.value`);
        if (keyframe.ease !== undefined) {
          requireSafeCssToken(keyframe.ease, `${keyframePath}.ease`);
          assertEaseReference(
            keyframe.ease,
            `${keyframePath}.ease`,
            easingVariables,
          );
        }
        if (keyframe.motionPath !== undefined) {
          if (track.property !== "translate") {
            invalidStyle(
              `${keyframePath}.motionPath is only valid for translate tracks`,
            );
          }
          if (keyframeIndex === track.keyframes.length - 1) {
            invalidStyle(
              `${keyframePath}.motionPath requires a following keyframe`,
            );
          }
          if (!isMotionPathSegmentV1(keyframe.motionPath)) {
            invalidStyle(
              `${keyframePath}.motionPath must be a bounded version 1 cubic`,
            );
          }
          const nextKeyframe = track.keyframes[keyframeIndex + 1];
          if (
            !isRecord(nextKeyframe) ||
            typeof nextKeyframe.value !== "string" ||
            !parseMotionPosition(keyframe.value) ||
            !parseMotionPosition(nextKeyframe.value)
          ) {
            invalidStyle(
              `${keyframePath}.motionPath requires finite 2D px positions`,
            );
          }
        }
      }
    }
  }
}

function assertEaseReference(
  value: string,
  path: string,
  easingVariables: readonly MotionEasingVariable[],
): void {
  try {
    resolveMotionEase(value, easingVariables);
  } catch (error) {
    invalidStyle(
      error instanceof Error
        ? `${path} ${error.message}`
        : `${path} is not a valid timing function`,
    );
  }
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) invalidStyle(`${path} has unexpected field "${unexpected}"`);
}

function requireString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") invalidStyle(`${path} must be a string`);
}

function requireBoundedText(
  value: unknown,
  path: string,
  maximumLength: number,
): asserts value is string {
  requireString(value, path);
  if (
    value.trim().length === 0 ||
    value.length > maximumLength ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ) {
    invalidStyle(
      `${path} must be non-empty text up to ${maximumLength} characters`,
    );
  }
}

function requireFiniteNumber(
  value: unknown,
  path: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalidStyle(`${path} must be a finite number`);
  }
}

function requireSafeCssToken(
  value: unknown,
  path: string,
): asserts value is string {
  requireString(value, path);
  if (
    value.length > MAX_VALUE_LENGTH ||
    value.trim().length === 0 ||
    /[;{}<>]|\/\*|\*\/|\burl\s*\(/i.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    invalidStyle(`${path} is not a safe CSS token`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidStyle(message: string): never {
  throw new TypeError(`Invalid Motion animation style: ${message}.`);
}
