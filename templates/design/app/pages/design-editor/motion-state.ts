import type { CodeLayerProjection } from "@shared/code-layer";
import {
  applyMotionAutoKeyframe,
  type MotionEase,
  type MotionTrack,
} from "@shared/motion-timeline";

import type { MotionDockTrack } from "@/components/design/MotionDock";

import { camelStyleProperty } from "./style-utils";

export interface MotionTimelineRow {
  id: string | null;
  designId: string;
  sourceRef: string | null;
  filePath: string | null;
  tracks: unknown;
  durationMs: number;
  defaultEase: string;
  compiledHash: string | null;
  cssHash?: string | null;
  source?: "stored" | "recovered-css" | "stored-css-drift";
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MotionTimelineQueryResult {
  designId: string;
  timelines: MotionTimelineRow[];
  count: number;
}

function isMotionTrack(value: unknown): value is MotionTrack {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as {
    targetNodeId?: unknown;
    property?: unknown;
    keyframes?: unknown;
  };
  return (
    typeof candidate.targetNodeId === "string" &&
    typeof candidate.property === "string" &&
    Array.isArray(candidate.keyframes)
  );
}

function normalizeMotionTracks(value: unknown): MotionTrack[] {
  return Array.isArray(value) ? value.filter(isMotionTrack) : [];
}

function labelForMotionTrack(
  track: MotionTrack,
  projection: CodeLayerProjection,
): string {
  const node = projection.nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] ===
        track.targetNodeId || candidate.id === track.targetNodeId,
  );
  return node?.layerName || node?.tag || track.targetNodeId;
}

export function hydrateMotionDockTracks(
  tracks: unknown,
  projection: CodeLayerProjection,
): MotionDockTrack[] {
  return normalizeMotionTracks(tracks).map((track) => ({
    ...track,
    label: labelForMotionTrack(track, projection),
  }));
}

export const MOTION_KEYFRAME_TIME_EPSILON = 0.002;

function motionCssPropertyName(property: string): string | null {
  const trimmed = property.trim();
  if (!trimmed || trimmed.startsWith("--")) return null;
  const cssName = trimmed
    .replace(/^css/, "")
    .replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
    .toLowerCase();
  return /^-?[a-z][a-z0-9-]*$/i.test(cssName) ? cssName : null;
}

/**
 * Properties auto-keyframe is allowed to record. Discrete / structural
 * properties (display, position, overflow, font-family, …) do not animate
 * meaningfully, so committing a multi-property style edit must not invent
 * tracks for them.
 */
const MOTION_ANIMATABLE_PROPERTIES = new Set([
  "opacity",
  "transform",
  "translate",
  "rotate",
  "scale",
  "filter",
  "backdrop-filter",
  "color",
  "background-color",
  "border-color",
  "outline-color",
  "fill",
  "stroke",
  "box-shadow",
  "text-shadow",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "top",
  "left",
  "right",
  "bottom",
  "inset",
  "border-radius",
  "border-width",
  "gap",
  "row-gap",
  "column-gap",
  "font-size",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-indent",
  "background-position",
  "background-size",
]);

export function isMotionAnimatableProperty(property: string): boolean {
  if (MOTION_ANIMATABLE_PROPERTIES.has(property)) return true;
  return (
    /^(margin|padding)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/.test(
      property,
    ) ||
    /^border-(top|right|bottom|left)-(color|width)$/.test(property) ||
    /^border-(top|bottom)-(left|right)-radius$/.test(property)
  );
}

/**
 * Item 7 — motion auto-key. The pure decision behind
 * upsertMotionKeyframesFromStyles (DesignEditor's useCallback wrapper, which
 * only resolves the DOM/projection-dependent targetNodeId and calls this):
 * given a style-change batch, key every ALREADY-tracked, motion-animatable
 * property on `targetNodeId` at the current playhead via
 * applyMotionAutoKeyframe. Matches Figma parity — arming auto-keyframe never
 * invents a new track for an untracked property; that stays a plain style
 * change regardless of this function's outcome (the caller commits the style
 * either way). Returns the SAME `tracks` reference when nothing changed, so
 * callers can cheaply detect "no-op" via reference equality (as the
 * setMotionTracks updater here does) without a separate dirty flag.
 * Extracted as a standalone pure function so the armed/wiring conditions
 * (property-name mapping to the shared motion catalog, playhead threading,
 * per-property track lookup) are directly unit-testable — see
 * DesignEditor.motion.test.ts.
 */
export function applyMotionAutoKeyframesForStyles(
  tracks: MotionDockTrack[],
  args: {
    targetNodeId: string;
    styles: Record<string, string | undefined>;
    playheadT: number;
    timelineDurationMs: number;
    defaultEase?: MotionEase;
  },
): MotionDockTrack[] {
  let next: MotionDockTrack[] = tracks;
  for (const [rawProperty, rawValue] of Object.entries(args.styles)) {
    if (rawValue === undefined) continue;
    const property = motionCssPropertyName(rawProperty);
    if (!property || !isMotionAnimatableProperty(property)) continue;
    const value = String(rawValue).trim();
    if (!value) continue;
    const keyed = applyMotionAutoKeyframe(
      next,
      {
        targetNodeId: args.targetNodeId,
        property,
        value,
        playheadT: args.playheadT,
        timelineDurationMs: args.timelineDurationMs,
      },
      args.defaultEase,
    );
    if (keyed) next = keyed as MotionDockTrack[];
  }
  return next;
}

export function computedMotionStyleValue(
  computedStyles: Record<string, string> | undefined,
  property: string,
): string | undefined {
  if (!computedStyles) return undefined;
  return (
    computedStyles[property] ??
    computedStyles[camelStyleProperty(property)] ??
    computedStyles[
      property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
    ]
  );
}

function defaultMotionBaseValue(property: string, nextValue: string): string {
  if (property === "opacity") return "1";
  if (property === "transform" || property === "filter") return "none";
  return nextValue;
}

export function upsertMotionStyleKeyframes(args: {
  tracks: MotionDockTrack[];
  targetNodeId: string;
  label: string;
  styles: Record<string, string>;
  computedStyles?: Record<string, string>;
  playhead: number;
  defaultEase?: string;
}): MotionDockTrack[] {
  const t = Math.max(0, Math.min(1, args.playhead));
  const ease = args.defaultEase ?? "ease";
  let nextTracks = args.tracks;

  for (const [rawProperty, rawValue] of Object.entries(args.styles)) {
    if (rawValue === undefined) continue;
    const value = String(rawValue).trim();
    if (!value) continue;
    const property = motionCssPropertyName(rawProperty);
    if (!property) continue;
    // Only record properties that actually animate; structural commits
    // (display, position, overflow, …) must not invent motion tracks.
    if (!isMotionAnimatableProperty(property)) continue;

    const existingIndex = nextTracks.findIndex(
      (track) =>
        track.targetNodeId === args.targetNodeId && track.property === property,
    );

    if (existingIndex >= 0) {
      nextTracks = nextTracks.map((track, index) => {
        if (index !== existingIndex) return track;
        const withoutCurrentTime = track.keyframes.filter(
          (keyframe) => Math.abs(keyframe.t - t) > MOTION_KEYFRAME_TIME_EPSILON,
        );
        return {
          ...track,
          label: track.label || args.label,
          keyframes: [...withoutCurrentTime, { t, value, ease }].sort(
            (a, b) => a.t - b.t,
          ),
        };
      });
      continue;
    }

    const baseValue =
      computedMotionStyleValue(args.computedStyles, property) ??
      computedMotionStyleValue(args.computedStyles, rawProperty) ??
      defaultMotionBaseValue(property, value);
    // A brand-new track whose committed value equals its base value would be
    // a from == to no-op animation — skip it instead of persisting it.
    if (value === baseValue) continue;
    const keyframes =
      t <= MOTION_KEYFRAME_TIME_EPSILON
        ? [
            { t: 0, value, ease },
            { t: 1, value: baseValue, ease },
          ]
        : t >= 1 - MOTION_KEYFRAME_TIME_EPSILON
          ? [
              { t: 0, value: baseValue, ease },
              { t: 1, value, ease },
            ]
          : [
              { t: 0, value: baseValue, ease },
              { t, value, ease },
              { t: 1, value: baseValue, ease },
            ];
    nextTracks = [
      ...nextTracks,
      {
        targetNodeId: args.targetNodeId,
        property,
        keyframes,
        label: args.label,
      },
    ];
  }

  return nextTracks;
}

export function motionTimelineFingerprint(
  fileId: string,
  timeline: MotionTimelineRow | null | undefined,
): string {
  if (!timeline) return `${fileId}:empty`;
  return [
    fileId,
    timeline.id ?? "css",
    timeline.updatedAt ?? "no-updated-at",
    timeline.compiledHash ?? "no-compiled-hash",
    timeline.cssHash ?? "no-css-hash",
    timeline.source ?? "stored",
    JSON.stringify(timeline.tracks),
  ].join(":");
}
