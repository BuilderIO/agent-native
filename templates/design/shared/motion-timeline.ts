/**
 * Motion timeline types for the Design Studio motion dock (§6.3 + §4.3).
 *
 * A MotionTimeline compiles into a managed `<style data-agent-native-motion>`
 * block. The CSS is the runtime truth; the JSON `tracks` aid editing only.
 * `compiledHash` keeps the two in lockstep — `apply-motion-edit` must update
 * both atomically.
 */

export type MotionEase =
  | "linear"
  | "ease"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "step-start"
  | "step-end"
  | string; // cubic-bezier(...) or steps(...)

export interface MotionKeyframe {
  /** Normalised time in [0, 1] where 0 = 0% and 1 = 100% of `durationMs`. */
  t: number;
  /** CSS property value at this keyframe (e.g. "0px", "1", "#ff0000"). */
  value: string;
  /** Per-keyframe easing applied between this keyframe and the next. */
  ease?: MotionEase;
}

/**
 * One property track for a single target node.
 * A node may have multiple tracks (e.g. opacity + transform).
 */
export interface MotionTrack {
  /** Matches `data-agent-native-node-id` stamped on the target DOM element. */
  targetNodeId: string;
  /** CSS property name being animated (e.g. "opacity", "transform", "color"). */
  property: string;
  keyframes: MotionKeyframe[];
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
  /** CSS property animated by the track (e.g. "opacity", "transform"). */
  property: string;
  /** Human-readable label for the picker (e.g. "Opacity", "Slide up"). */
  label: string;
  /** Value at t = 0. */
  from: string;
  /** Value at t = 1. */
  to: string;
}

/**
 * Built-in property presets for the "add a track" picker. Ordered most-common
 * first. Every preset is a valid CSS identifier accepted by
 * `assertSafeCssProperty` and yields two safe keyframe values.
 */
export const MOTION_PROPERTY_PRESETS: MotionPropertyPreset[] = [
  { property: "opacity", label: "Fade (opacity)", from: "0", to: "1" },
  {
    property: "transform",
    label: "Slide up (translateY)",
    from: "translateY(16px)",
    to: "translateY(0px)",
  },
  {
    property: "transform",
    label: "Scale (zoom in)",
    from: "scale(0.8)",
    to: "scale(1)",
  },
  {
    property: "filter",
    label: "Blur in",
    from: "blur(8px)",
    to: "blur(0px)",
  },
  {
    property: "color",
    label: "Color",
    from: "#000000",
    to: "#000000",
  },
  {
    property: "background-color",
    label: "Background color",
    from: "#ffffff",
    to: "#ffffff",
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
 * `cubic-bezier(...)` (including overshoot control points, which is how the
 * dock's "Spring" preset is expressed), `steps(n, position)`, and a `spring`
 * keyword approximated by an overshoot bezier. Unknown values fall back to
 * linear. The result may leave [0, 1] for overshoot beziers by design.
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

  // Spring approximation: a gentle overshoot bezier.
  if (raw.startsWith("spring")) {
    return cubicBezierY(0.34, 1.56, 0.64, 1, clamped);
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
