/**
 * Motion easing engine — Figma Motion parity (curves + springs).
 *
 * Pure, dependency-free helpers shared by the MotionDock easing panel, the
 * shared timeline evaluator, and the motion compiler:
 *
 * - **Curve presets** matching Figma Motion's easing panel verbatim
 *   (Hold, Linear, Ease in, Ease out, Ease in and out, the three "back"
 *   overshoot curves, and Custom bezier).
 * - **Spring easing** stored in the timeline model as a compact
 *   `spring(bounce[, settle])` token (bounce ∈ [0, 1], like Figma's single
 *   normalized "Bounce" control) and compiled to pure CSS via the
 *   `linear(...)` timing function — sampled from a real damped-oscillator
 *   solution, so the persisted artifact stays plain CSS.
 * - **`linear(...)` evaluation** so scrub previews and CSS-recovered
 *   timelines replay spring easings exactly as the compiled stylesheet does.
 *
 * The canvas preview bridge (app/components/design/bridge/
 * motion-preview.bridge.ts) carries a dependency-free copy of the sampling
 * and evaluation algorithms below — keep the two in sync.
 */

// ─── Curve presets (Figma Motion easing panel, Curve tab) ────────────────────

export interface MotionCurvePreset {
  /** Menu label, verbatim from the Figma Motion easing panel. */
  label: string;
  /** CSS timing-function value stored on the keyframe. */
  value: string;
}

/**
 * Bezier-family presets exactly as labeled in Figma Motion's easing panel.
 *
 * - "Hold" jumps immediately to the segment's end value and stays
 *   (a discontinuous step) → CSS `step-start`.
 * - "Ease in and out" is the live-verified (.42, 0, .58, 1).
 * - The three "back" curves are overshoot beziers (control-point y outside
 *   [0, 1]); Figma's exact numbers are not published, so these use the
 *   canonical easeInBack / easeOutBack / easeInOutBack values.
 * - "Custom bezier" is not listed here: the easing panel switches to editable
 *   x1,y1,x2,y2 fields + a draggable curve for any unrecognised
 *   `cubic-bezier(...)` value.
 */
export const MOTION_CURVE_PRESETS: MotionCurvePreset[] = [
  { label: "Hold", value: "step-start" },
  { label: "Linear", value: "linear" },
  { label: "Ease in", value: "cubic-bezier(0.42, 0, 1, 1)" },
  { label: "Ease out", value: "cubic-bezier(0, 0, 0.58, 1)" },
  { label: "Ease in and out", value: "cubic-bezier(0.42, 0, 0.58, 1)" },
  { label: "Ease in back", value: "cubic-bezier(0.36, 0, 0.66, -0.56)" },
  { label: "Ease out back", value: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
  {
    label: "Ease in and out back",
    value: "cubic-bezier(0.68, -0.6, 0.32, 1.6)",
  },
];

// ─── Spring model ─────────────────────────────────────────────────────────────

/**
 * Editable spring parameters, matching Figma Motion's normalized spring UI:
 * a single "Bounce" value in [0, 1]. `settle` is the fraction of the segment
 * by which the spring reaches rest (1 = uses the whole segment) — it lets the
 * named presets differ in perceived speed while remaining segment-normalized.
 */
export interface MotionSpring {
  /** Normalized bounciness in [0, 1]. 0 = no overshoot. */
  bounce: number;
  /** Fraction of the segment at which the spring settles, in (0, 1]. */
  settle: number;
}

/** Default bounce for "Custom spring" (matches Figma's default of 0.25). */
export const MOTION_SPRING_DEFAULT_BOUNCE = 0.25;

export interface MotionSpringPreset {
  /** Menu label, verbatim from the Figma Motion easing panel (Spring tab). */
  label: string;
  spring: MotionSpring;
  /** The `spring(...)` token stored on the keyframe for this preset. */
  value: string;
}

function roundParam(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Serialize spring params into the timeline's `spring(...)` ease token. */
export function springToken(spring: MotionSpring): string {
  const bounce = roundParam(clamp01(spring.bounce));
  const settle = roundParam(Math.min(1, Math.max(0.05, spring.settle)));
  return settle === 1 ? `spring(${bounce})` : `spring(${bounce}, ${settle})`;
}

/**
 * Spring presets as named in Figma Motion's easing panel. "Bouncy" uses the
 * live-verified bounce of 0.69; Gentle/Quick/Slow expose no numbers in the
 * Figma UI, so their params are tuned approximations of the described feel
 * (Gentle: soft, no overshoot; Quick: fast settle; Slow: full-length glide).
 */
export const MOTION_SPRING_PRESETS: MotionSpringPreset[] = [
  { label: "Gentle", spring: { bounce: 0, settle: 0.8 } },
  { label: "Quick", spring: { bounce: 0.2, settle: 0.5 } },
  { label: "Bouncy", spring: { bounce: 0.69, settle: 1 } },
  { label: "Slow", spring: { bounce: 0, settle: 1 } },
].map((preset) => ({ ...preset, value: springToken(preset.spring) }));

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Parse a `spring(bounce[, settle])` ease token (or the bare keyword
 * `spring`, which maps to the default custom spring). Returns `null` when the
 * string is not a spring token.
 */
export function parseSpringToken(ease: string): MotionSpring | null {
  const raw = String(ease ?? "").trim();
  if (/^spring$/i.test(raw)) {
    return { bounce: MOTION_SPRING_DEFAULT_BOUNCE, settle: 1 };
  }
  const m = /^spring\(\s*([+-]?[\d.]+)\s*(?:,\s*([+-]?[\d.]+)\s*)?\)$/i.exec(
    raw,
  );
  if (!m) return null;
  const bounce = parseFloat(m[1]);
  if (!Number.isFinite(bounce)) return null;
  let settle = m[2] === undefined ? 1 : parseFloat(m[2]);
  if (!Number.isFinite(settle)) return null;
  settle = Math.min(1, Math.max(0.05, settle));
  return { bounce: clamp01(bounce), settle };
}

/**
 * Sample a normalized spring at progress `x ∈ [0, 1]`.
 *
 * Damped-oscillator position response scaled so the spring starts at 0,
 * ends at 1, and is at rest by `x = settle`:
 * - damping ratio ζ = 1 − bounce (underdamped when bounce > 0)
 * - natural frequency ω chosen so the decay envelope ≈ 0 at the settle point
 *
 * Output may overshoot above 1 for bounce > 0 (by design — that is the
 * bounce). Values at or after `settle` are exactly 1.
 */
export function sampleSpring(spring: MotionSpring, x: number): number {
  if (x <= 0) return 0;
  const settle = Math.min(1, Math.max(0.05, spring.settle));
  const u = x / settle;
  if (u >= 1) return 1;
  const zeta = Math.min(1, Math.max(0.02, 1 - clamp01(spring.bounce)));
  // Envelope e^(-ζω) ≈ EPS at u = 1 so the motion is visually at rest there.
  const EPS = 0.001;
  const omega = Math.log(1 / EPS) / zeta;
  if (zeta >= 1) {
    // Critically damped: y = 1 − e^(−ωu)(1 + ωu).
    return 1 - Math.exp(-omega * u) * (1 + omega * u);
  }
  const omegaD = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * u);
  return (
    1 -
    decay *
      (Math.cos(omegaD * u) + ((zeta * omega) / omegaD) * Math.sin(omegaD * u))
  );
}

function formatStop(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return (Math.round(n * 10000) / 10000).toString();
}

/**
 * Compile a spring into a CSS `linear(...)` timing function by sampling the
 * spring curve at evenly spaced stops. Deterministic: the same spring always
 * produces byte-identical CSS. Bouncier springs get more stops so the
 * oscillation survives the piecewise-linear approximation.
 */
export function springToCssLinear(spring: MotionSpring): string {
  const bounce = clamp01(spring.bounce);
  const samples = 16 + Math.round(bounce * 34); // 16 … 50 interior steps
  const stops: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = i / samples;
    stops.push(formatStop(i === samples ? 1 : sampleSpring(spring, x)));
  }
  return `linear(${stops.join(", ")})`;
}

/**
 * Convert a timeline ease token into a CSS-valid timing function.
 * `spring(...)` tokens compile to `linear(...)`; everything else (keywords,
 * `cubic-bezier(...)`, `steps(...)`, `linear(...)`) passes through untouched.
 */
export function motionEaseToCss(ease: string): string {
  const spring = parseSpringToken(ease);
  return spring ? springToCssLinear(spring) : ease;
}

// ─── CSS linear() evaluation ─────────────────────────────────────────────────

interface LinearStop {
  value: number;
  /** Input position in [0, 1], or null when the stop omitted a percentage. */
  position: number | null;
}

/**
 * Parse the argument list of a CSS `linear(...)` timing function. Each entry
 * is `<number> <percentage>{0,2}`; a stop with two percentages expands into
 * two stops. Returns `null` when `raw` is not a linear() function or has
 * fewer than two stops.
 */
export function parseCssLinearStops(raw: string): LinearStop[] | null {
  const m = /^linear\(([^)]*)\)$/i.exec(String(raw ?? "").trim());
  if (!m) return null;
  const entries = m[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length < 2) return null;
  const stops: LinearStop[] = [];
  for (const entry of entries) {
    const parts = entry.split(/\s+/);
    const value = parseFloat(parts[0]);
    if (!Number.isFinite(value)) return null;
    const positions: number[] = [];
    for (let i = 1; i < parts.length && i <= 2; i++) {
      if (!/%$/.test(parts[i])) return null;
      const pct = parseFloat(parts[i]);
      if (!Number.isFinite(pct)) return null;
      positions.push(pct / 100);
    }
    if (positions.length === 0) {
      stops.push({ value, position: null });
    } else {
      for (const position of positions) stops.push({ value, position });
    }
  }
  // Resolve omitted positions per the CSS spec: first defaults to 0, last to
  // 1, interior stops distribute evenly between the surrounding known
  // positions. Positions are also forced monotonic.
  if (stops[0].position === null) stops[0].position = 0;
  const last = stops[stops.length - 1];
  if (last.position === null) last.position = 1;
  let runningMax = stops[0].position as number;
  for (let i = 0; i < stops.length; i++) {
    const pos = stops[i].position;
    if (pos !== null) {
      const clamped = Math.max(runningMax, pos);
      stops[i].position = clamped;
      runningMax = clamped;
      continue;
    }
    // Find the next stop with a known position.
    let nextIdx = i + 1;
    while (nextIdx < stops.length && stops[nextIdx].position === null) {
      nextIdx++;
    }
    const prevPos = runningMax;
    const nextPos = Math.max(prevPos, stops[nextIdx].position as number);
    const span = nextIdx - (i - 1);
    for (let j = i; j < nextIdx; j++) {
      stops[j].position =
        prevPos + ((j - (i - 1)) / span) * (nextPos - prevPos);
    }
    i = nextIdx - 1;
    runningMax = nextPos;
  }
  return stops;
}

/**
 * Evaluate a CSS `linear(...)` timing function at progress `x ∈ [0, 1]`.
 * Returns `null` when `raw` is not a valid linear() function (so callers can
 * fall through to other easing forms).
 */
export function evaluateCssLinear(raw: string, x: number): number | null {
  const stops = parseCssLinearStops(raw);
  if (!stops) return null;
  const clamped = clamp01(x);
  if (clamped <= (stops[0].position as number)) return stops[0].value;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const aPos = a.position as number;
    const bPos = b.position as number;
    if (clamped > bPos) continue;
    if (bPos === aPos) return b.value;
    const ratio = (clamped - aPos) / (bPos - aPos);
    return a.value + (b.value - a.value) * ratio;
  }
  return stops[stops.length - 1].value;
}
