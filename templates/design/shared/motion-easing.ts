

export interface MotionCurvePreset {
  label: string;
  value: string;
}

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


export interface MotionSpring {
  bounce: number;
  settle: number;
}

export const MOTION_SPRING_DEFAULT_BOUNCE = 0.25;

export interface MotionSpringPreset {
  label: string;
  spring: MotionSpring;
  value: string;
}

function roundParam(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function springToken(spring: MotionSpring): string {
  const bounce = roundParam(clamp01(spring.bounce));
  const settle = roundParam(Math.min(1, Math.max(0.05, spring.settle)));
  return settle === 1 ? `spring(${bounce})` : `spring(${bounce}, ${settle})`;
}

export const MOTION_SPRING_PRESETS: MotionSpringPreset[] = [
  { label: "Gentle", spring: { bounce: 0, settle: 0.8 } },
  { label: "Quick", spring: { bounce: 0.2, settle: 0.5 } },
  { label: "Bouncy", spring: { bounce: 0.69, settle: 1 } },
  { label: "Slow", spring: { bounce: 0, settle: 1 } },
].map((preset) => ({ ...preset, value: springToken(preset.spring) }));

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

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

export function sampleSpring(spring: MotionSpring, x: number): number {
  if (x <= 0) return 0;
  const settle = Math.min(1, Math.max(0.05, spring.settle));
  const u = x / settle;
  if (u >= 1) return 1;
  const zeta = Math.min(1, Math.max(0.02, 1 - clamp01(spring.bounce)));
  const EPS = 0.001;
  const omega = Math.log(1 / EPS) / zeta;
  if (zeta >= 1) {
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

export function springToCssLinear(spring: MotionSpring): string {
  const bounce = clamp01(spring.bounce);
  const samples = 16 + Math.round(bounce * 34);
  const stops: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = i / samples;
    stops.push(formatStop(i === samples ? 1 : sampleSpring(spring, x)));
  }
  return `linear(${stops.join(", ")})`;
}

export function motionEaseToCss(ease: string): string {
  const spring = parseSpringToken(ease);
  return spring ? springToCssLinear(spring) : ease;
}


interface LinearStop {
  value: number;
  position: number | null;
}

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
