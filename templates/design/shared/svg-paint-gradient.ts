import {
  gradientStopWithFillOpacity,
  readGradientFillOpacity,
} from "./gradient-opacity";


export type SvgPaintGradientKind = "fill" | "stroke";

export const SVG_FILL_GRADIENT_PROPERTY = "--an-vector-fill-gradient";
export const SVG_STROKE_GRADIENT_PROPERTY = "--an-vector-stroke-gradient";

export function svgPaintGradientProperty(kind: SvgPaintGradientKind): string {
  return kind === "fill"
    ? SVG_FILL_GRADIENT_PROPERTY
    : SVG_STROKE_GRADIENT_PROPERTY;
}

export function svgPaintGradientKindForProperty(
  property: string,
): SvgPaintGradientKind | null {
  if (property === SVG_FILL_GRADIENT_PROPERTY) return "fill";
  if (property === SVG_STROKE_GRADIENT_PROPERTY) return "stroke";
  return null;
}

export function svgPaintGradientId(
  nodeId: string,
  kind: SvgPaintGradientKind,
): string {
  return `${nodeId.replace(/[^A-Za-z0-9_-]/g, "-")}-${kind}-gradient`;
}

export interface SvgGradientStop {
  color: string;
  offset: number;
}

export interface SvgPaintGradient {
  type: "linear" | "radial";
  angle: number;
  stops: SvgGradientStop[];
}

function leadingColor(part: string): string | null {
  const hex = part.match(/^#[0-9a-f]{3,8}\b/i);
  if (hex) return hex[0];
  if (/^transparent\b/i.test(part)) return "transparent";
  if (!/^(?:rgba?|hsla?|color-mix|oklch|oklab|lab|lch|color)\(/i.test(part)) {
    return null;
  }
  let depth = 0;
  for (let index = 0; index < part.length; index += 1) {
    if (part[index] === "(") depth += 1;
    if (part[index] === ")" && --depth === 0) return part.slice(0, index + 1);
  }
  return null;
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

export function svgPaintGradientOpacity(css: string): {
  gradient: string;
  opacity: number;
} {
  const match = css.trim().match(/^([a-z-]+-gradient)\((.*)\)$/is);
  if (!match) return { gradient: css, opacity: 100 };
  const parts = splitTopLevel(match[2]!);
  const colors = parts.map(leadingColor);
  const read = readGradientFillOpacity(
    colors.flatMap((color) => (color ? [{ color }] : [])),
  );
  if (read.opacity === 100) return { gradient: css, opacity: 100 };
  let stopIndex = 0;
  const unwrapped = parts.map((part, index) => {
    const color = colors[index];
    return color
      ? read.stops[stopIndex++]!.color + part.slice(color.length)
      : part;
  });
  return {
    gradient: `${match[1]}(${unwrapped.join(", ")})`,
    opacity: read.opacity,
  };
}

export function svgPaintGradientWithOpacity(
  css: string,
  opacity: number,
): string {
  const base = svgPaintGradientOpacity(css).gradient;
  if (opacity === 100) return base;
  const match = base.trim().match(/^([a-z-]+-gradient)\((.*)\)$/is);
  if (!match) return base;
  const wrapped = splitTopLevel(match[2]!).map((part) => {
    const color = leadingColor(part);
    return color
      ? gradientStopWithFillOpacity(color, opacity) + part.slice(color.length)
      : part;
  });
  return `${match[1]}(${wrapped.join(", ")})`;
}

export function parseSvgPaintGradient(css: string): SvgPaintGradient | null {
  const match = css.trim().match(/^(linear|radial)-gradient\((.*)\)$/is);
  if (!match) return null;
  const type = match[1]!.toLowerCase() as "linear" | "radial";
  if (type === "radial" && /closest-corner|closest-side/i.test(match[2]!)) {
    return null;
  }
  const parts = splitTopLevel(match[2]!);
  let angle = 180;
  const first = parts[0] ?? "";
  if (!leadingColor(first)) {
    parts.shift();
    const degrees = first.match(/(-?\d+(?:\.\d+)?)deg/);
    if (degrees) angle = Number(degrees[1]);
  }
  const stops: SvgGradientStop[] = [];
  parts.forEach((part, index) => {
    const color = leadingColor(part);
    if (!color) return;
    const position = part.slice(color.length).match(/(-?\d+(?:\.\d+)?)%/);
    const offset = position
      ? Number(position[1])
      : parts.length <= 1
        ? 0
        : (index / (parts.length - 1)) * 100;
    stops.push({
      // guard:allow-raw-color — the paint's own transparent stop, not UI chrome.
      color: color.toLowerCase() === "transparent" ? "rgba(0, 0, 0, 0)" : color,
      offset: Math.min(100, Math.max(0, offset)),
    });
  });
  return stops.length >= 1 ? { type, angle, stops } : null;
}

export interface SvgViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function parseSvgViewBox(value: string | null | undefined): SvgViewBox {
  const numbers = (value ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((entry) => Number.isFinite(entry));
  if (numbers.length !== 4) return { x: 0, y: 0, width: 100, height: 100 };
  const [x, y, width, height] = numbers as [number, number, number, number];
  return { x, y, width, height };
}

export interface SvgGradientElementSpec {
  tag: "linearGradient" | "radialGradient";
  attributes: Record<string, string>;
  stops: Array<Record<string, string>>;
}

function round(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export function svgGradientElementSpec(
  id: string,
  gradient: SvgPaintGradient,
  box: SvgViewBox,
): SvgGradientElementSpec {
  const stops = gradient.stops.map((stop) => ({
    offset: `${round(stop.offset)}%`,
    "stop-color": stop.color,
  }));
  if (gradient.type === "radial") {
    return {
      tag: "radialGradient",
      attributes: {
        id,
        gradientUnits: "userSpaceOnUse",
        cx: round(box.x + box.width / 2),
        cy: round(box.y + box.height / 2),
        r: round(Math.hypot(box.width, box.height) / 2),
      },
      stops,
    };
  }
  const radians = (gradient.angle * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  return {
    tag: "linearGradient",
    attributes: {
      id,
      gradientUnits: "userSpaceOnUse",
      x1: round(box.x + box.width * (0.5 - sin / 2)),
      y1: round(box.y + box.height * (0.5 + cos / 2)),
      x2: round(box.x + box.width * (0.5 + sin / 2)),
      y2: round(box.y + box.height * (0.5 - cos / 2)),
    },
    stops,
  };
}

function attributesMarkup(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${value.replace(/"/g, "&quot;")}"`)
    .join("");
}

export function svgGradientDefsMarkup(
  kind: SvgPaintGradientKind,
  spec: SvgGradientElementSpec,
): string {
  const stops = spec.stops
    .map((stop) => `<stop${attributesMarkup(stop)}></stop>`)
    .join("");
  return `<defs data-an-vector-paint-gradient="${kind}"><${spec.tag}${attributesMarkup(spec.attributes)}>${stops}</${spec.tag}></defs>`;
}
