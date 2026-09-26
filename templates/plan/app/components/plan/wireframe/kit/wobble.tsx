import { type CSSProperties } from "react";


const PLAN_WOBBLE_FILTER_BASE_ID = "plan-wobble";

export const DEFAULT_SKETCH = 12;

const SKETCH_CRISP_THRESHOLD = 2;

function clampSketch(sketch: number): number {
  if (!Number.isFinite(sketch)) return DEFAULT_SKETCH;
  return Math.max(0, Math.min(100, sketch));
}

function wobbleFilterId(sketch: number): string {
  return `${PLAN_WOBBLE_FILTER_BASE_ID}-${Math.round(clampSketch(sketch))}`;
}

function wobbleScale(sketch: number): number {
  return Number(((clampSketch(sketch) / 100) * 4.6).toFixed(2));
}

function wobbleBaseFrequency(sketch: number): number {
  return Number((0.01 + (clampSketch(sketch) / 100) * 0.008).toFixed(4));
}

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
