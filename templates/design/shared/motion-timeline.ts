import type { MotionAnimationStyleDefinition } from "./motion-animation-styles";
import {
  evaluateCssLinear,
  isMotionEaseVariableReference,
  parseSpringToken,
  resolveMotionEase,
  sampleSpring,
} from "./motion-easing";
import type { MotionEasingVariable } from "./motion-easing";
import type { MotionNativeStyleInstance } from "./motion-native-style";

export type MotionEase =
  | "linear"
  | "ease"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "step-start"
  | "step-end"
  | (string & {});

export type MotionPlaybackMode = "loop" | "once" | "ping-pong";

export interface MotionPathPoint {
  x: number;
  y: number;
}

/** Offsets are in px relative to the segment's start and end keyframes. */
export interface MotionPathSegmentV1 {
  version: 1;
  type: "cubic";
  control1: MotionPathPoint;
  control2: MotionPathPoint;
}

export const MOTION_PATH_MAX_CONTROL_OFFSET_PX = 100_000;
export const MOTION_PATH_MAX_POSITION_PX = 1_000_000;
const MOTION_PATH_LENGTH_STEPS = 512;

export const MOTION_DEFAULT_PLAYBACK_MODE: MotionPlaybackMode = "once";
export const MOTION_TIMELINE_DEFAULT_DURATION_MS = 2_000;
export const MOTION_TIMELINE_MAX_DURATION_MS = 120_000;

export interface MotionKeyframe {
  t: number;
  value: string;
  ease?: MotionEase;
  motionPath?: MotionPathSegmentV1;
}

export interface MotionTrack {
  targetNodeId: string;
  property: string;
  keyframes: MotionKeyframe[];
  enabled?: boolean;
  delayMs?: number;
  durationMs?: number;
  timelinePlaybackMode?: MotionPlaybackMode;
}

export interface MotionTimeline {
  id: string;
  designId: string;
  sourceRef: string | null;
  filePath: string | null;
  tracks: MotionTrack[];
  animationStyles?: MotionAnimationStyleDefinition[];
  nativeStyles?: MotionNativeStyleInstance[];
  durationMs: number;
  playbackMode?: MotionPlaybackMode;
  defaultEase: MotionEase;
  compiledHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MotionPropertyPreset {
  property: string;
  label: string;
  from?: string;
  to?: string;
  group: "primary" | "more";
  additionalProperties?: readonly string[];
}

export const MOTION_PROPERTY_PRESETS: MotionPropertyPreset[] = [
  {
    property: "translate",
    label: "Position",
    from: "0px 16px",
    to: "0px 0px",
    group: "primary",
  },
  {
    property: "scale",
    label: "Scale",
    from: "0.8",
    to: "1",
    group: "primary",
  },
  {
    property: "rotate",
    label: "Rotation",
    from: "0deg",
    to: "360deg",
    group: "primary",
  },
  {
    property: "opacity",
    label: "Opacity",
    from: "0",
    to: "1",
    group: "primary",
  },
  {
    property: "border-radius",
    label: "Corner radius",
    from: "0px",
    to: "16px",
    group: "more",
  },
  {
    property: "background-color",
    label: "Fill",
    from: "#ffffff",
    to: "#ffffff",
    group: "more",
  },
  {
    property: "border-color",
    label: "Stroke paint",
    from: "#000000",
    to: "#000000",
    group: "more",
  },
  {
    property: "border-width",
    label: "Stroke weight",
    from: "0px",
    to: "2px",
    group: "more",
  },
  {
    property: "box-shadow",
    label: "Drop shadow",
    from: "0px 0px 0px 0px rgba(0, 0, 0, 0)",
    to: "0px 8px 24px 0px rgba(0, 0, 0, 0.25)",
    group: "more",
  },
];

export function createMotionTrack(
  targetNodeId: string,
  property: string,
  options: { from?: string; to?: string; ease?: MotionEase } = {},
): MotionTrack {
  const from = options.from ?? "0";
  const to = options.to ?? "1";
  return {
    targetNodeId,
    property,
    keyframes: [
      { t: 0, value: from, ...(options.ease ? { ease: options.ease } : {}) },
      { t: 1, value: to, ...(options.ease ? { ease: options.ease } : {}) },
    ],
  };
}

export function createMotionTrackFromPreset(
  targetNodeId: string,
  preset: MotionPropertyPreset,
  ease?: MotionEase,
): MotionTrack {
  return createMotionTrack(targetNodeId, preset.property, {
    from: preset.from ?? "0",
    to: preset.to ?? "1",
    ease,
  });
}

export function hasTrackFor(
  tracks: MotionTrack[],
  targetNodeId: string,
  property: string,
): boolean {
  return tracks.some(
    (t) => t.targetNodeId === targetNodeId && t.property === property,
  );
}

export const MOTION_KEYFRAME_TIME_EPSILON = 0.002;

export function sortMotionKeyframes(
  keyframes: MotionKeyframe[],
): MotionKeyframe[] {
  return [...keyframes].sort((a, b) => a.t - b.t);
}

export function upsertMotionKeyframeAtTime(
  keyframes: MotionKeyframe[],
  keyframe: MotionKeyframe,
  epsilon: number = MOTION_KEYFRAME_TIME_EPSILON,
): MotionKeyframe[] {
  const withoutCurrentTime = keyframes.filter(
    (existing) => Math.abs(existing.t - keyframe.t) > epsilon,
  );
  return sortMotionKeyframes([...withoutCurrentTime, keyframe]);
}

const EASE_KEYWORD_BEZIERS: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

function cubicBezierY(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x: number,
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const sampleDX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;

  let u = x;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(u) - x;
    if (Math.abs(err) < 1e-6) return sampleY(u);
    const d = sampleDX(u);
    if (Math.abs(d) < 1e-6) break;
    u = Math.min(1, Math.max(0, u - err / d));
  }
  let lo = 0;
  let hi = 1;
  u = x;
  while (hi - lo > 1e-6) {
    u = (lo + hi) / 2;
    if (sampleX(u) < x) lo = u;
    else hi = u;
  }
  return sampleY(u);
}

export function evaluateMotionEase(
  ease: MotionEase | undefined,
  x: number,
  easingVariables: readonly MotionEasingVariable[] = [],
): number {
  const clamped = x <= 0 ? 0 : x >= 1 ? 1 : x;
  const authoredEase = String(ease ?? "ease").trim();
  const raw = (
    isMotionEaseVariableReference(authoredEase)
      ? resolveMotionEase(authoredEase, easingVariables)
      : authoredEase
  ).toLowerCase();
  if (raw === "linear") return clamped;
  if (raw === "step-start") return clamped > 0 ? 1 : 0;
  if (raw === "step-end") return clamped >= 1 ? 1 : 0;

  const keyword = EASE_KEYWORD_BEZIERS[raw];
  if (keyword) {
    return cubicBezierY(
      keyword[0],
      keyword[1],
      keyword[2],
      keyword[3],
      clamped,
    );
  }

  const bezier = /^cubic-bezier\(([^)]+)\)$/.exec(raw);
  if (bezier) {
    const parts = bezier[1].split(",").map((part) => parseFloat(part));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const x1 = Math.min(1, Math.max(0, parts[0]));
      const x2 = Math.min(1, Math.max(0, parts[2]));
      return cubicBezierY(x1, parts[1], x2, parts[3], clamped);
    }
  }

  const steps = /^steps\(([^)]+)\)$/.exec(raw);
  if (steps) {
    const args = steps[1].split(",").map((part) => part.trim());
    const count = parseInt(args[0], 10);
    if (Number.isFinite(count) && count > 0) {
      if (clamped >= 1) return 1;
      const jumpStart = args[1] === "start" || args[1] === "jump-start";
      return Math.min(
        1,
        (Math.floor(clamped * count) + (jumpStart ? 1 : 0)) / count,
      );
    }
  }

  if (raw.startsWith("spring")) {
    const spring = parseSpringToken(raw);
    if (spring) return sampleSpring(spring, clamped);
    return clamped;
  }

  if (raw.startsWith("linear(")) {
    const evaluated = evaluateCssLinear(raw, clamped);
    if (evaluated !== null) return evaluated;
  }

  return clamped;
}

type MotionValueSegment =
  | { kind: "lit"; text: string }
  | { kind: "num"; value: number; unit: string };

function formatSampledNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 10000) / 10000;
  return (Object.is(rounded, -0) ? 0 : rounded).toString();
}

export function isMotionPathSegmentV1(
  value: unknown,
): value is MotionPathSegmentV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    candidate.type !== "cubic" ||
    Object.keys(candidate).some(
      (key) => !["version", "type", "control1", "control2"].includes(key),
    )
  ) {
    return false;
  }
  return (
    isMotionPathPoint(candidate.control1) &&
    isMotionPathPoint(candidate.control2)
  );
}

function isMotionPathPoint(value: unknown): value is MotionPathPoint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const point = value as Record<string, unknown>;
  return (
    Object.keys(point).every((key) => key === "x" || key === "y") &&
    isValidMotionPathCoordinate(point.x, MOTION_PATH_MAX_CONTROL_OFFSET_PX) &&
    isValidMotionPathCoordinate(point.y, MOTION_PATH_MAX_CONTROL_OFFSET_PX)
  );
}

function isValidMotionPathCoordinate(
  value: unknown,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= max
  );
}

/** Parses the bounded 2D px subset used by Position motion paths. */
export function parseMotionPosition(value: string): MotionPathPoint | null {
  if (value.trim().toLowerCase() === "none") return { x: 0, y: 0 };
  const number = "([+-]?(?:\\d+\\.?\\d*|\\.\\d+))";
  const match = new RegExp(
    `^\\s*${number}(px)?(?:\\s+${number}(px)?)?\\s*$`,
    "i",
  ).exec(value);
  if (!match) return null;

  const x = Number(match[1]);
  const y = match[3] === undefined ? 0 : Number(match[3]);
  const xUnit = match[2]?.toLowerCase() ?? "";
  const yUnit = match[4]?.toLowerCase() ?? "";
  if ((xUnit === "" && x !== 0) || (yUnit === "" && y !== 0)) return null;
  if (
    !isValidMotionPathCoordinate(x, MOTION_PATH_MAX_POSITION_PX) ||
    !isValidMotionPathCoordinate(y, MOTION_PATH_MAX_POSITION_PX)
  ) {
    return null;
  }
  return { x, y };
}

export function formatMotionPosition(point: MotionPathPoint): string {
  return `${formatSampledNumber(point.x)}px ${formatSampledNumber(point.y)}px`;
}

export interface MotionPathCubicPoints {
  start: MotionPathPoint;
  control1: MotionPathPoint;
  control2: MotionPathPoint;
  end: MotionPathPoint;
}

export function motionPathCubicPoints(
  start: MotionPathPoint,
  end: MotionPathPoint,
  segment?: MotionPathSegmentV1,
): MotionPathCubicPoints {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return {
    start,
    control1: segment
      ? { x: start.x + segment.control1.x, y: start.y + segment.control1.y }
      : { x: start.x + dx / 3, y: start.y + dy / 3 },
    control2: segment
      ? { x: end.x + segment.control2.x, y: end.y + segment.control2.y }
      : { x: end.x - dx / 3, y: end.y - dy / 3 },
    end,
  };
}

function cubicPoint(points: MotionPathCubicPoints, t: number): MotionPathPoint {
  const inverse = 1 - t;
  const startWeight = inverse * inverse * inverse;
  const control1Weight = 3 * inverse * inverse * t;
  const control2Weight = 3 * inverse * t * t;
  const endWeight = t * t * t;
  return {
    x:
      points.start.x * startWeight +
      points.control1.x * control1Weight +
      points.control2.x * control2Weight +
      points.end.x * endWeight,
    y:
      points.start.y * startWeight +
      points.control1.y * control1Weight +
      points.control2.y * control2Weight +
      points.end.y * endWeight,
  };
}

export function motionPathSegmentLength(points: MotionPathCubicPoints): number {
  let previous = points.start;
  let length = 0;
  for (let step = 1; step <= MOTION_PATH_LENGTH_STEPS; step += 1) {
    const current = cubicPoint(points, step / MOTION_PATH_LENGTH_STEPS);
    length += Math.hypot(current.x - previous.x, current.y - previous.y);
    previous = current;
  }
  return length;
}

/** Samples a cubic by arc length so temporal easing stays separate from path shape. */
export function sampleMotionPathPosition(
  start: MotionPathPoint,
  end: MotionPathPoint,
  segment: MotionPathSegmentV1,
  progress: number,
): MotionPathPoint {
  const points = motionPathCubicPoints(start, end, segment);

  const samples: MotionPathPoint[] = [points.start];
  const cumulative: number[] = [0];
  for (let step = 1; step <= MOTION_PATH_LENGTH_STEPS; step += 1) {
    const point = cubicPoint(points, step / MOTION_PATH_LENGTH_STEPS);
    samples.push(point);
    const previous = samples[step - 1]!;
    cumulative.push(
      cumulative[step - 1]! +
        Math.hypot(point.x - previous.x, point.y - previous.y),
    );
  }

  const total = cumulative[cumulative.length - 1]!;
  if (total === 0) return points.end;
  if (progress <= 0 || progress >= 1) {
    if (progress === 0) return points.start;
    if (progress === 1) return points.end;
    const atStart = progress < 0;
    const tangent = atStart
      ? {
          x:
            points.control1.x - points.start.x ||
            points.control2.x - points.start.x ||
            points.end.x - points.start.x,
          y:
            points.control1.y - points.start.y ||
            points.control2.y - points.start.y ||
            points.end.y - points.start.y,
        }
      : {
          x:
            points.end.x - points.control2.x ||
            points.end.x - points.control1.x ||
            points.end.x - points.start.x,
          y:
            points.end.y - points.control2.y ||
            points.end.y - points.control1.y ||
            points.end.y - points.start.y,
        };
    const magnitude = Math.hypot(tangent.x, tangent.y);
    if (magnitude === 0) return atStart ? points.start : points.end;
    const distance = total * (progress - (atStart ? 0 : 1));
    const origin = atStart ? points.start : points.end;
    return {
      x: origin.x + (tangent.x / magnitude) * distance,
      y: origin.y + (tangent.y / magnitude) * distance,
    };
  }
  const target = total * progress;
  let upper = 1;
  while (upper < cumulative.length && cumulative[upper]! < target) upper += 1;
  const lower = upper - 1;
  const segmentLength = cumulative[upper]! - cumulative[lower]!;
  const local =
    segmentLength > 0 ? (target - cumulative[lower]!) / segmentLength : 0;
  const parameter = (lower + local) / MOTION_PATH_LENGTH_STEPS;
  return cubicPoint(points, parameter);
}

function parseSimpleColor(
  value: string,
): [number, number, number, number] | null {
  const s = value.trim();
  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      return [
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16),
        h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1,
      ];
    }
    if (h.length === 6 || h.length === 8) {
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
        h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      ];
    }
    return null;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter((p) => p.length > 0);
    if (parts.length >= 3) {
      const alpha = parts[3];
      return [
        parseFloat(parts[0]),
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        alpha === undefined
          ? 1
          : alpha.endsWith("%")
            ? parseFloat(alpha) / 100
            : parseFloat(alpha),
      ];
    }
  }
  return null;
}

function formatSampledColor(c: [number, number, number, number]): string {
  const clamp255 = (x: number) => Math.round(Math.min(255, Math.max(0, x)));
  const a = Math.min(1, Math.max(0, c[3]));
  if (a >= 1) {
    return `rgb(${clamp255(c[0])}, ${clamp255(c[1])}, ${clamp255(c[2])})`;
  }
  return `rgba(${clamp255(c[0])}, ${clamp255(c[1])}, ${clamp255(c[2])}, ${Math.round(a * 1000) / 1000})`;
}

function tokenizeMotionValue(value: string): MotionValueSegment[] {
  const segs: MotionValueSegment[] = [];
  const numRe = /^[+-]?(?:\d+\.?\d*|\.\d+)/;
  let i = 0;
  let litStart = 0;
  while (i < value.length) {
    const prev = i > 0 ? value[i - 1] : "";
    if (!/[a-zA-Z#]/.test(prev)) {
      const nm = numRe.exec(value.slice(i));
      if (nm) {
        const um = /^[a-z%]+/i.exec(value.slice(i + nm[0].length));
        const unit = um ? um[0] : "";
        if (i > litStart) {
          segs.push({ kind: "lit", text: value.slice(litStart, i) });
        }
        segs.push({ kind: "num", value: parseFloat(nm[0]), unit });
        i += nm[0].length + unit.length;
        litStart = i;
        continue;
      }
    }
    i++;
  }
  if (value.length > litStart) {
    segs.push({ kind: "lit", text: value.slice(litStart) });
  }
  return segs;
}

function segmentShape(segs: MotionValueSegment[]): string {
  return segs
    .map((seg) =>
      seg.kind === "lit" ? `L${seg.text}` : `N${seg.unit || "<none>"}`,
    )
    .join(" ");
}

export function lerpMotionValues(
  from: string,
  to: string,
  ratio: number,
): string {
  if (from === to) return from;
  const colorFrom = parseSimpleColor(from);
  const colorTo = parseSimpleColor(to);
  if (colorFrom && colorTo) {
    return formatSampledColor([
      colorFrom[0] + (colorTo[0] - colorFrom[0]) * ratio,
      colorFrom[1] + (colorTo[1] - colorFrom[1]) * ratio,
      colorFrom[2] + (colorTo[2] - colorFrom[2]) * ratio,
      colorFrom[3] + (colorTo[3] - colorFrom[3]) * ratio,
    ]);
  }
  const fromSegs = tokenizeMotionValue(from);
  const toSegs = tokenizeMotionValue(to);
  if (
    fromSegs.length === toSegs.length &&
    segmentShape(fromSegs) === segmentShape(toSegs)
  ) {
    let out = "";
    let interpolated = false;
    for (let i = 0; i < fromSegs.length; i++) {
      const a = fromSegs[i];
      const b = toSegs[i];
      if (a.kind === "lit") {
        out += a.text;
        continue;
      }
      if (b.kind !== "num") return from;
      interpolated = true;
      out +=
        formatSampledNumber(a.value + (b.value - a.value) * ratio) +
        (a.unit || b.unit);
    }
    if (interpolated) return out;
  }
  return from;
}

export function sampleMotionKeyframesAt(
  keyframes: MotionKeyframe[],
  t: number,
  defaultEase?: MotionEase,
  easingVariables: readonly MotionEasingVariable[] = [],
): string {
  if (keyframes.length === 0) return "";
  const sorted = sortMotionKeyframes(keyframes);
  if (sorted.length === 1) return sorted[0].value;
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped <= sorted[0].t) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (clamped >= last.t) return last.value;
  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i];
    const next = sorted[i + 1];
    if (clamped < prev.t || clamped > next.t) continue;
    const span = next.t - prev.t;
    if (span <= 0) return prev.value;
    const ratio = (clamped - prev.t) / span;
    const eased = evaluateMotionEase(
      prev.ease ?? defaultEase,
      ratio,
      easingVariables,
    );
    if (prev.motionPath) {
      const start = parseMotionPosition(prev.value);
      const end = parseMotionPosition(next.value);
      if (!start || !end || !isMotionPathSegmentV1(prev.motionPath)) {
        throw new Error(
          "Cubic Position motion paths require finite two-dimensional px keyframes and version 1 control offsets.",
        );
      }
      return formatMotionPosition(
        sampleMotionPathPosition(start, end, prev.motionPath, eased),
      );
    }
    return lerpMotionValues(prev.value, next.value, eased);
  }
  return last.value;
}

export interface MotionTrackTiming {
  startMs: number;
  durationMs: number;
  endMs: number;
}

export function getMotionTrackTiming(
  track: Pick<MotionTrack, "delayMs" | "durationMs">,
  timelineDurationMs: number,
): MotionTrackTiming {
  const startMs = Math.max(0, track.delayMs ?? 0);
  const durationMs = Math.max(
    1,
    track.durationMs !== undefined && Number.isFinite(track.durationMs)
      ? track.durationMs
      : timelineDurationMs - startMs,
  );
  return { startMs, durationMs, endMs: startMs + durationMs };
}

export function hasPreviousMotionKeyframe(
  track: MotionTrack,
  currentTimelineTimeMs: number,
  timelineDurationMs: number,
): boolean {
  const timing = getMotionTrackTiming(track, timelineDurationMs);
  const previousTimeLimit =
    currentTimelineTimeMs - MOTION_KEYFRAME_TIME_EPSILON * timing.durationMs;
  return track.keyframes.some(
    (keyframe) =>
      timing.startMs + keyframe.t * timing.durationMs < previousTimeLimit,
  );
}

export function motionTimelineDurationForTracks(
  durationMs: number,
  tracks: readonly Pick<MotionTrack, "delayMs" | "durationMs">[],
): number {
  return tracks.reduce(
    (duration, track) =>
      Math.max(duration, getMotionTrackTiming(track, durationMs).endMs),
    durationMs,
  );
}

export function motionTimelineDurationForContent(
  durationMs: number,
  tracks: readonly Pick<MotionTrack, "delayMs" | "durationMs">[],
  textSpans: readonly Pick<MotionTrack, "delayMs" | "durationMs">[] = [],
): number {
  return Math.max(
    motionTimelineDurationForTracks(durationMs, tracks),
    ...textSpans.map(
      (span) =>
        Math.max(0, span.delayMs ?? 0) + Math.max(1, span.durationMs ?? 0),
    ),
  );
}

export function timelineTimeToTrackTime(
  track: Pick<MotionTrack, "delayMs" | "durationMs">,
  timelineTimeMs: number,
  timelineDurationMs: number,
): number {
  const timing = getMotionTrackTiming(track, timelineDurationMs);
  return Math.min(
    1,
    Math.max(0, (timelineTimeMs - timing.startMs) / timing.durationMs),
  );
}

export function sampleMotionTrackAtTimelineTime(
  track: MotionTrack,
  timelineTimeMs: number,
  timelineDurationMs: number,
  defaultEase?: MotionEase,
  easingVariables: readonly MotionEasingVariable[] = [],
): string {
  return sampleMotionKeyframesAt(
    track.keyframes,
    timelineTimeToTrackTime(track, timelineTimeMs, timelineDurationMs),
    defaultEase,
    easingVariables,
  );
}

const MOTION_PLAYBACK_MODES: MotionPlaybackMode[] = [
  "loop",
  "once",
  "ping-pong",
];

export function parseMotionPlaybackMode(
  value: unknown,
): MotionPlaybackMode | null {
  return MOTION_PLAYBACK_MODES.includes(value as MotionPlaybackMode)
    ? (value as MotionPlaybackMode)
    : null;
}

export function readTimelinePlaybackMode(
  tracks: MotionTrack[],
): MotionPlaybackMode | null {
  for (const track of tracks) {
    const mode = parseMotionPlaybackMode(track.timelinePlaybackMode);
    if (mode) return mode;
  }
  return null;
}

export function withTimelinePlaybackMode<T extends MotionTrack>(
  tracks: T[],
  mode: MotionPlaybackMode,
): T[] {
  return tracks.map((track, index) => {
    if (index === 0) return { ...track, timelinePlaybackMode: mode };
    if (track.timelinePlaybackMode === undefined) return track;
    const { timelinePlaybackMode: _drop, ...rest } = track;
    return rest as T;
  });
}

export interface MotionAutoKeyframeEdit {
  targetNodeId: string;
  property: string;
  value: string;
  playheadT: number;
  timelineDurationMs: number;
}

export function applyMotionAutoKeyframe(
  tracks: MotionTrack[],
  edit: MotionAutoKeyframeEdit,
  defaultEase?: MotionEase,
): MotionTrack[] | null {
  const index = tracks.findIndex(
    (track) =>
      track.targetNodeId === edit.targetNodeId &&
      track.property === edit.property,
  );
  if (index === -1) return null;
  const track = tracks[index];
  const playheadMs =
    Math.min(1, Math.max(0, edit.playheadT)) * edit.timelineDurationMs;
  const localT = timelineTimeToTrackTime(
    track,
    playheadMs,
    edit.timelineDurationMs,
  );
  const existing = track.keyframes.find(
    (kf) => Math.abs(kf.t - localT) <= MOTION_KEYFRAME_TIME_EPSILON,
  );
  const keyframe: MotionKeyframe = {
    t: existing ? existing.t : localT,
    value: edit.value,
    ...(existing?.motionPath ? { motionPath: existing.motionPath } : {}),
    ...(existing?.ease !== undefined
      ? { ease: existing.ease }
      : defaultEase !== undefined
        ? { ease: defaultEase }
        : {}),
  };
  const next = [...tracks];
  next[index] = {
    ...track,
    keyframes: upsertMotionKeyframeAtTime(track.keyframes, keyframe),
  };
  return next;
}

export interface MotionAnimationClip {
  tracks: Array<Omit<MotionTrack, "targetNodeId" | "timelinePlaybackMode">>;
}

export function copyLayerAnimation(
  tracks: MotionTrack[],
  targetNodeId: string,
): MotionAnimationClip | null {
  const layerTracks = tracks.filter(
    (track) => track.targetNodeId === targetNodeId,
  );
  if (layerTracks.length === 0) return null;
  return {
    tracks: layerTracks.map(
      ({ targetNodeId: _node, timelinePlaybackMode: _mode, ...rest }) => ({
        ...rest,
        keyframes: rest.keyframes.map((kf) => ({ ...kf })),
      }),
    ),
  };
}

export function pasteLayerAnimation(
  tracks: MotionTrack[],
  clip: MotionAnimationClip,
  targetNodeId: string,
): MotionTrack[] {
  const mode = readTimelinePlaybackMode(tracks);
  const clipProperties = new Set(clip.tracks.map((track) => track.property));
  const kept = tracks.filter(
    (track) =>
      !(
        track.targetNodeId === targetNodeId &&
        clipProperties.has(track.property)
      ),
  );
  const pasted: MotionTrack[] = clip.tracks.map((track) => ({
    ...track,
    keyframes: track.keyframes.map((kf) => ({ ...kf })),
    targetNodeId,
  }));
  const merged = [...kept, ...pasted];
  return mode ? withTimelinePlaybackMode(merged, mode) : merged;
}

export function staggerLayerTracks(
  tracks: MotionTrack[],
  orderedNodeIds: string[],
  stepMs: number,
): MotionTrack[] {
  const offsetByNode = new Map<string, number>();
  orderedNodeIds.forEach((nodeId, index) => {
    offsetByNode.set(nodeId, index * stepMs);
  });
  return tracks.map((track) => {
    const offset = offsetByNode.get(track.targetNodeId);
    if (offset === undefined || offset === 0) return track;
    return { ...track, delayMs: Math.max(0, (track.delayMs ?? 0) + offset) };
  });
}
