/**
 * Motion timeline types for the Design Studio motion dock (§6.3 + §4.3).
 *
 * A MotionTimeline compiles into a managed `<style data-agent-native-motion>`
 * block. The CSS is the runtime truth; the JSON `tracks` aid editing only.
 * `compiledHash` keeps the two in lockstep — `apply-motion-edit` must update
 * both atomically.
 */

import {
  evaluateCssLinear,
  parseSpringToken,
  sampleSpring,
} from "./motion-easing";

export type MotionEase =
  | "linear"
  | "ease"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "step-start"
  | "step-end"
  | string; // cubic-bezier(...), steps(...), linear(...), or spring(...)

/**
 * Timeline playback mode (Figma Motion parity):
 * - "loop": repeats continuously.
 * - "once": plays a single time and stops on the final frame.
 * - "ping-pong": plays forward then backward, repeating.
 */
export type MotionPlaybackMode = "loop" | "once" | "ping-pong";

/** Playback mode applied when a timeline predates the playbackMode field. */
export const MOTION_DEFAULT_PLAYBACK_MODE: MotionPlaybackMode = "once";

export interface MotionKeyframe {
  /**
   * Normalised time in [0, 1] within the TRACK's own span (which is the whole
   * timeline unless the track sets `delayMs`/`durationMs`). 0 = span start,
   * 1 = span end. Matches Figma's normalized `timelinePosition`.
   */
  t: number;
  /** CSS property value at this keyframe (e.g. "0px", "1", "#ff0000"). */
  value: string;
  /**
   * Easing of the SEGMENT that leaves this keyframe toward the next one
   * (standard CSS keyframe semantics; equivalently, Figma's "easing into the
   * following keyframe"). The last keyframe's ease has no effect.
   */
  ease?: MotionEase;
}

/**
 * One property track for a single target node.
 * A node may have multiple tracks (e.g. opacity + translate + rotate).
 */
export interface MotionTrack {
  /** Matches `data-agent-native-node-id` stamped on the target DOM element. */
  targetNodeId: string;
  /** CSS property name being animated (e.g. "opacity", "translate", "rotate"). */
  property: string;
  keyframes: MotionKeyframe[];
  /**
   * Start-time offset of this track within the timeline, in milliseconds
   * (compiled to `animation-delay`). Omitted / 0 = starts with the timeline.
   */
  delayMs?: number;
  /**
   * Duration of this track's own animation span in milliseconds (compiled to
   * a per-track `animation-duration`). Omitted = the timeline's `durationMs`.
   */
  durationMs?: number;
  /**
   * Timeline-level playback mode, persisted on the FIRST track only so the
   * stored `tracks` JSON column stays a plain array (additive, backward
   * compatible — older readers simply ignore the extra field). Use
   * `readTimelinePlaybackMode` / `withTimelinePlaybackMode`; do not read this
   * field directly.
   */
  timelinePlaybackMode?: MotionPlaybackMode;
}

/**
 * A complete animation timeline scoped to one design + source + screen/file.
 * A design may have many timelines (one per screen or logical animation group).
 */
export interface MotionTimeline {
  id: string;
  designId: string;
  /**
   * Opaque source reference identifying the screen or file this timeline
   * belongs to (fileId for inline designs, routeId for localhost/fusion).
   * `null` when scoped to the entire design.
   */
  sourceRef: string | null;
  /**
   * File path for real-app CSS module output.
   * `null` for inline designs (CSS lives in the managed `<style>` block).
   */
  filePath: string | null;
  tracks: MotionTrack[];
  /** Total animation duration in milliseconds. */
  durationMs: number;
  /**
   * Timeline playback mode. Omitted on rows written before this field existed
   * — treat as {@link MOTION_DEFAULT_PLAYBACK_MODE}.
   */
  playbackMode?: MotionPlaybackMode;
  /** Default easing applied to keyframe intervals that omit a per-keyframe ease. */
  defaultEase: MotionEase;
  /**
   * Hash of the compiled CSS output. Used by `apply-motion-edit` to detect
   * drift between the stored JSON tracks and the managed `<style>` block.
   * Cleared to `null` when tracks are edited but CSS has not yet been recompiled.
   */
  compiledHash: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Animatable-property catalog + track factory ──────────────────────────────
//
// Shared by the MotionDock UI (the "add a track" picker) and unit tests. These
// are pure helpers so the first-track-creation flow can be tested without
// mounting React. They power the "create the FIRST track" path: a freshly
// selected element has no tracks, so the dock seeds a default track from one of
// these presets and the keyframes below.

/**
 * One animatable-property preset offered when creating a brand-new track.
 * `from`/`to` seed the two default keyframes so the track is immediately
 * compilable and previewable (a track with < 1 keyframe is rejected by
 * `apply-motion-edit`).
 */
export interface MotionPropertyPreset {
  /** CSS property animated by the track (e.g. "opacity", "translate"). */
  property: string;
  /** Human-readable label for the picker, verbatim from Figma's Add-motion menu. */
  label: string;
  /** Value at t = 0. */
  from: string;
  /** Value at t = 1. */
  to: string;
  /**
   * Menu placement, matching Figma Motion's "Add motion" submenu: "primary"
   * items are listed directly; "more" items live under the "More" submenu.
   */
  group: "primary" | "more";
}

/**
 * Built-in property presets for the "Add motion" picker, matching Figma
 * Motion's submenu verbatim: Position / Scale / Rotation / Opacity, then
 * More ▸ Corner radius / Fill / Stroke paint / Stroke weight / Drop shadow.
 *
 * CSS mapping uses the modern individual transform properties (`translate`,
 * `scale`, `rotate`) instead of one shared `transform` string, so position,
 * scale, and rotation tracks compose freely on the same node without
 * colliding on a single (targetNodeId, property) pair.
 *
 * Every preset is a valid CSS identifier accepted by
 * `assertSafeMotionCssProperty` and yields two safe keyframe values. Presets
 * whose motion would be invisible with identical endpoints seed a small
 * visible change; color-like presets seed equal endpoints (edit values via
 * auto-keyframe or the inspector, as in Figma).
 */
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

/**
 * Build a brand-new {@link MotionTrack} for a target node + property, seeded
 * with two keyframes (start/end) so it is immediately valid for both the live
 * preview bridge and the `apply-motion-edit` managed CSS persist path. Used by
 * the MotionDock "create first track" path.
 *
 * When `preset` is omitted, a neutral 0 → 1 opacity-style pair is used so the
 * track still compiles; callers normally pass a {@link MotionPropertyPreset}.
 */
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

/**
 * Build a track from a {@link MotionPropertyPreset}. Thin wrapper over
 * {@link createMotionTrack} that forwards the preset's seed values.
 */
export function createMotionTrackFromPreset(
  targetNodeId: string,
  preset: MotionPropertyPreset,
  ease?: MotionEase,
): MotionTrack {
  return createMotionTrack(targetNodeId, preset.property, {
    from: preset.from,
    to: preset.to,
    ease,
  });
}

/**
 * Return `true` when a track for the given (targetNodeId, property) pair already
 * exists in `tracks`. The dock uses this to decide between "create a new track"
 * and "add a keyframe to the existing track" so a property is never duplicated.
 */
export function hasTrackFor(
  tracks: MotionTrack[],
  targetNodeId: string,
  property: string,
): boolean {
  return tracks.some(
    (t) => t.targetNodeId === targetNodeId && t.property === property,
  );
}

// ─── Keyframe helpers (pure; shared by MotionDock + tests) ────────────────────

/**
 * Two keyframes closer together than this (normalised time) are treated as the
 * same stop: upserts replace instead of accumulating invisible duplicates.
 */
export const MOTION_KEYFRAME_TIME_EPSILON = 0.002;

/** Return a copy of `keyframes` sorted ascending by `t` (stable). */
export function sortMotionKeyframes(
  keyframes: MotionKeyframe[],
): MotionKeyframe[] {
  return [...keyframes].sort((a, b) => a.t - b.t);
}

/**
 * Insert `keyframe` into `keyframes`, replacing any existing keyframe whose
 * `t` is within `epsilon` of the new keyframe's time (so repeated adds at the
 * same playhead position never accumulate invisible duplicates). Returns a new
 * sorted array; the input is not mutated.
 */
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

// ─── Easing evaluation ────────────────────────────────────────────────────────
//
// Mirrors CSS timing-function semantics closely enough for scrub preview and
// value sampling. The canvas preview bridge carries its own dependency-free
// copy of this algorithm (it cannot import modules); keep the two in sync.

const EASE_KEYWORD_BEZIERS: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

/** Evaluate y for a CSS cubic-bezier timing function at progress x ∈ [0, 1]. */
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

  // Newton-Raphson, falling back to bisection when the derivative flattens.
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

/**
 * Evaluate a {@link MotionEase} timing function at linear progress `x ∈ [0, 1]`.
 *
 * Supports the CSS keywords (`linear`, `ease*`, `step-start`, `step-end`),
 * `cubic-bezier(...)` (including overshoot control points, used by the "back"
 * curve presets), `steps(n, position)`, CSS `linear(...)` stop lists, and
 * `spring(bounce[, settle])` tokens evaluated with the real damped-oscillator
 * sampler from `motion-easing.ts`. Unknown values fall back to linear. The
 * result may leave [0, 1] for overshoot beziers and bouncy springs by design.
 */
export function evaluateMotionEase(
  ease: MotionEase | undefined,
  x: number,
): number {
  const clamped = x <= 0 ? 0 : x >= 1 ? 1 : x;
  const raw = String(ease ?? "ease")
    .trim()
    .toLowerCase();
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
      // x control points must stay in [0, 1] (CSS requirement); y may overshoot.
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

  // Real spring physics: `spring(bounce[, settle])` tokens (and the bare
  // `spring` keyword) sample the shared damped-oscillator solution.
  if (raw.startsWith("spring")) {
    const spring = parseSpringToken(raw);
    if (spring) return sampleSpring(spring, clamped);
    return clamped;
  }

  // CSS linear(...) stop lists (compiled springs / recovered timelines).
  if (raw.startsWith("linear(")) {
    const evaluated = evaluateCssLinear(raw, clamped);
    if (evaluated !== null) return evaluated;
  }

  return clamped;
}

// ─── Value sampling ───────────────────────────────────────────────────────────

type MotionValueSegment =
  | { kind: "lit"; text: string }
  | { kind: "num"; value: number; unit: string };

function formatSampledNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return (Math.round(n * 10000) / 10000).toString();
}

/** Parse a hex / rgb(a) CSS color into [r, g, b, a], or null. */
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
    // Skip numbers glued to an identifier (translate3d, matrix3d, …) or a hex
    // color literal — those belong to the literal chunk, not a numeric arg.
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

/**
 * Linearly interpolate two CSS values at `ratio`. Handles matching numeric
 * skeletons (`translateY(16px)` → `translateY(0px)`) and simple colors
 * (hex / rgb(a)); anything non-interpolable holds the `from` value.
 * `ratio` may leave [0, 1] for overshoot easing.
 */
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

/**
 * Sample the value of a keyframe list at normalised time `t ∈ [0, 1]`,
 * honouring per-keyframe easing (each keyframe's `ease` shapes the interval to
 * the NEXT keyframe, standard CSS semantics). Used by the dock's
 * "add keyframe at playhead" so new keyframes seed with the value currently
 * shown by the preview instead of a hardcoded placeholder.
 */
export function sampleMotionKeyframesAt(
  keyframes: MotionKeyframe[],
  t: number,
  defaultEase?: MotionEase,
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
    const eased = evaluateMotionEase(prev.ease ?? defaultEase, ratio);
    return lerpMotionValues(prev.value, next.value, eased);
  }
  return last.value;
}

// ─── Track timing (per-track offset + duration) ──────────────────────────────

export interface MotionTrackTiming {
  /** Track start offset within the timeline, ms. */
  startMs: number;
  /** Track animation span, ms. */
  durationMs: number;
  /** Track end (startMs + durationMs), ms. */
  endMs: number;
}

/**
 * Resolve a track's absolute timing within its timeline. Tracks without
 * explicit `delayMs`/`durationMs` span the whole timeline (legacy behavior).
 */
export function getMotionTrackTiming(
  track: Pick<MotionTrack, "delayMs" | "durationMs">,
  timelineDurationMs: number,
): MotionTrackTiming {
  const startMs = Math.max(0, track.delayMs ?? 0);
  const durationMs = Math.max(
    1,
    track.durationMs !== undefined && Number.isFinite(track.durationMs)
      ? track.durationMs
      : timelineDurationMs,
  );
  return { startMs, durationMs, endMs: startMs + durationMs };
}

/**
 * Map an absolute timeline time (ms) to a track-local normalised time in
 * [0, 1], clamping outside the track's span (matching the compiled CSS's
 * `animation-fill-mode: both`: the first keyframe value holds before the
 * span, the last keyframe value holds after it).
 */
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

/**
 * Sample a track's value at an absolute timeline time (ms), honouring the
 * track's own offset/duration and per-segment easing.
 */
export function sampleMotionTrackAtTimelineTime(
  track: MotionTrack,
  timelineTimeMs: number,
  timelineDurationMs: number,
  defaultEase?: MotionEase,
): string {
  return sampleMotionKeyframesAt(
    track.keyframes,
    timelineTimeToTrackTime(track, timelineTimeMs, timelineDurationMs),
    defaultEase,
  );
}

// ─── Timeline playback mode (persisted on the first track) ──────────────────

const MOTION_PLAYBACK_MODES: MotionPlaybackMode[] = [
  "loop",
  "once",
  "ping-pong",
];

/** Narrow an unknown value to a {@link MotionPlaybackMode}, or null. */
export function parseMotionPlaybackMode(
  value: unknown,
): MotionPlaybackMode | null {
  return MOTION_PLAYBACK_MODES.includes(value as MotionPlaybackMode)
    ? (value as MotionPlaybackMode)
    : null;
}

/**
 * Read the timeline-level playback mode persisted in a `tracks` array
 * (stamped on the first track — see {@link MotionTrack.timelinePlaybackMode}).
 * Returns null when no track carries the field (pre-playbackMode timelines).
 */
export function readTimelinePlaybackMode(
  tracks: MotionTrack[],
): MotionPlaybackMode | null {
  for (const track of tracks) {
    const mode = parseMotionPlaybackMode(track.timelinePlaybackMode);
    if (mode) return mode;
  }
  return null;
}

/**
 * Return a copy of `tracks` with the timeline-level playback mode stamped on
 * the first track only (and removed from every other track), keeping the
 * persisted JSON canonical. An empty `tracks` array is returned unchanged.
 */
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

// ─── Auto-keyframe (pure part) ───────────────────────────────────────────────

export interface MotionAutoKeyframeEdit {
  /** `data-agent-native-node-id` of the element whose property was edited. */
  targetNodeId: string;
  /** CSS property that was edited (e.g. "opacity", "translate"). */
  property: string;
  /** The new CSS value entered by the user. */
  value: string;
  /** Playhead position at edit time, normalised to the TIMELINE in [0, 1]. */
  playheadT: number;
  /** Timeline duration in ms (needed to map onto offset tracks). */
  timelineDurationMs: number;
}

/**
 * Auto-keyframe core logic (Figma Motion parity): when a keyframeable
 * property value is edited while auto-keyframe is armed, upsert a keyframe at
 * the playhead on the matching track — creating one at the playhead when the
 * playhead is not already on an existing keyframe, or replacing the keyframe
 * value when it is (within {@link MOTION_KEYFRAME_TIME_EPSILON}).
 *
 * Pure and UI-free: returns the updated tracks array, or `null` when no track
 * animates `(targetNodeId, property)` — in that case the caller should apply
 * the edit as a plain style change (Figma only auto-keys properties that
 * already have motion; new properties are added via "Add motion").
 */
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

// ─── Copy / paste animation + stagger (pure helpers) ─────────────────────────

/**
 * A layer's animation, detached from its node id — the payload behind
 * "Copy animation" / "Paste animation".
 */
export interface MotionAnimationClip {
  tracks: Array<Omit<MotionTrack, "targetNodeId" | "timelinePlaybackMode">>;
}

/**
 * Extract a node's tracks as a reusable {@link MotionAnimationClip}.
 * Returns null when the node has no tracks.
 */
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

/**
 * Apply a {@link MotionAnimationClip} to a target node, replacing any tracks
 * the node already has for the clip's properties (other properties are kept).
 * The timeline-level playback mode stamp is re-normalised afterwards.
 */
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

/**
 * Stagger helper: offset each listed node's tracks by `index * stepMs`
 * (Figma recommends 40–80ms between instances). Nodes keep their relative
 * internal offsets; nodes not listed are untouched.
 */
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
