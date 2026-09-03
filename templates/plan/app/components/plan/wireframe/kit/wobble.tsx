import { type CSSProperties } from "react";

/**
 * The single hand-drawn wobble SVG filter, applied at the Screen level so the
 * whole frame wobbles together as one drawing.
 *
 * Mirrors the reference (Todo App Wireframes.html):
 *   feTurbulence fractalNoise baseFrequency 0.013 numOctaves 2 seed 7
 *   -> feDisplacementMap scale 1.4
 *
 * The filter geometry is driven per-render by `sketch` (0-100): we recompute
 * baseFrequency + displacement scale and give the filter a sketch-keyed id so
 * multiple screens at different sketch levels coexist on the same board.
 */

const PLAN_WOBBLE_FILTER_BASE_ID = "plan-wobble";

/** Default sketch level: low / crisp. Keep wireframes legible by default. */
export const DEFAULT_SKETCH = 12;

/** Below this, the wobble is disabled entirely (crisp lines). */
const SKETCH_CRISP_THRESHOLD = 2;

function clampSketch(sketch: number): number {
  if (!Number.isFinite(sketch)) return DEFAULT_SKETCH;
  return Math.max(0, Math.min(100, sketch));
}

/** Stable filter id for a given sketch level (rounded so ids are reusable). */
function wobbleFilterId(sketch: number): string {
  return `${PLAN_WOBBLE_FILTER_BASE_ID}-${Math.round(clampSketch(sketch))}`;
}

/** Displacement scale for a sketch level (0 -> 0, 100 -> 4.6). */
function wobbleScale(sketch: number): number {
  return Number(((clampSketch(sketch) / 100) * 4.6).toFixed(2));
}

/** Turbulence base frequency for a sketch level (0 -> 0.010, 100 -> 0.018). */
function wobbleBaseFrequency(sketch: number): number {
  return Number((0.01 + (clampSketch(sketch) / 100) * 0.008).toFixed(4));
}

/**
 * Style fragment to apply the wobble at the Screen level. Sets `--wobble` and
 * the `filter` so the whole subtree displaces as one. Returns `{}` (crisp) when
 * sketch is at/under the threshold.
 */
export function sketchStyle(sketch: number = DEFAULT_SKETCH): CSSProperties {
  const s = clampSketch(sketch);
  if (s <= SKETCH_CRISP_THRESHOLD) {
    return { ["--wobble" as string]: "none" };
  }
  const url = `url(#${wobbleFilterId(s)})`;
  return {
    ["--wobble" as string]: url,
    filter: url,
  };
}

/**
 * The SVG <filter> definitions for the wobble. Render ONCE per screen (or once
 * per board) — each distinct sketch level needs its matching filter id present
 * in the DOM. `PlanWobbleDefs` renders a single filter for one sketch level.
 */
export function PlanWobbleDefs({
  sketch = DEFAULT_SKETCH,
}: {
  sketch?: number;
}) {
  const s = clampSketch(sketch);
  if (s <= SKETCH_CRISP_THRESHOLD) return null;
  return (
    <svg
      aria-hidden
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <filter
        id={wobbleFilterId(s)}
        x="-3%"
        y="-3%"
        width="106%"
        height="106%"
        filterUnits="objectBoundingBox"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency={wobbleBaseFrequency(s)}
          numOctaves={2}
          seed={7}
          result="n"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="n"
          scale={wobbleScale(s)}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}
