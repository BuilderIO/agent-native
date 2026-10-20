import type { EffectColor, EffectColorStop } from "./native-effects";

export const MAX_EFFECT_PAINT_STOPS = 8;

export type EffectPaintInterpolation =
  | ""
  | "in srgb"
  | "in srgb-linear"
  | "in oklab"
  | "in display-p3";

export type EffectPaint =
  | { kind: "solid"; color: EffectColor }
  | {
      kind: "linear" | "radial" | "angular" | "diamond";
      /** CSS degrees, clockwise from the upward direction. */
      angle: number;
      stops: EffectColorStop[];
      /** Normalized fill opacity, independent of each stop's alpha. */
      opacity?: number;
      interpolation?: EffectPaintInterpolation;
    };

export interface EffectPaintProperty {
  type: "paint";
  label: string;
  default: EffectPaint;
  maxCount: number;
  group?: string;
  rebuild?: boolean;
}

export class NativeEffectPaintValueError extends TypeError {
  readonly code = "effect-paint-value-invalid";

  constructor() {
    super("Native paint has an invalid value or capacity.");
    this.name = "NativeEffectPaintValueError";
  }
}

const INTERPOLATIONS: readonly EffectPaintInterpolation[] = [
  "",
  "in srgb",
  "in srgb-linear",
  "in oklab",
  "in display-p3",
];

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function unit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function color(value: unknown): value is EffectColor {
  return (
    object(value) &&
    keys(value, ["space", "components", "alpha"]) &&
    (value.space === "srgb" || value.space === "display-p3") &&
    Array.isArray(value.components) &&
    value.components.length === 3 &&
    Array.from(value.components).every(unit) &&
    unit(value.alpha)
  );
}

export function isEffectPaint(
  value: unknown,
  maxCount = MAX_EFFECT_PAINT_STOPS,
): value is EffectPaint {
  if (
    !Number.isInteger(maxCount) ||
    maxCount < 1 ||
    maxCount > MAX_EFFECT_PAINT_STOPS ||
    !object(value)
  )
    return false;
  if (value.kind === "solid")
    return keys(value, ["kind", "color"]) && color(value.color);
  return (
    ["linear", "radial", "angular", "diamond"].includes(String(value.kind)) &&
    keys(value, ["kind", "angle", "stops", "opacity", "interpolation"]) &&
    typeof value.angle === "number" &&
    Number.isFinite(value.angle) &&
    Math.abs(value.angle) <= 1_000_000 &&
    (value.opacity === undefined || unit(value.opacity)) &&
    (value.interpolation === undefined ||
      INTERPOLATIONS.includes(
        value.interpolation as EffectPaintInterpolation,
      )) &&
    Array.isArray(value.stops) &&
    value.stops.length >= 2 &&
    value.stops.length <= maxCount &&
    Array.from(value.stops).every(
      (stop) =>
        object(stop) &&
        keys(stop, ["position", "color"]) &&
        unit(stop.position) &&
        color(stop.color),
    )
  );
}

export function effectPaintColors(paint: EffectPaint): EffectColor[] {
  return paint.kind === "solid"
    ? [paint.color]
    : paint.stops.map((stop) => stop.color);
}

export function effectPaintInterpolation(
  paint: Exclude<EffectPaint, { kind: "solid" }>,
): Exclude<EffectPaintInterpolation, ""> {
  if (paint.interpolation) return paint.interpolation;
  return paint.stops.every((stop) => stop.color.space === "srgb")
    ? "in srgb"
    : "in oklab";
}

export function packEffectPaint(
  paint: EffectPaint,
  maxCount: number,
  linearColor: (color: EffectColor) => [number, number, number],
): Float32Array {
  if (!isEffectPaint(paint, maxCount)) throw new NativeEffectPaintValueError();
  const packed = new Float32Array((1 + 2 * maxCount) * 4);
  const kinds = ["solid", "linear", "radial", "angular", "diamond"];
  const interpolation =
    paint.kind === "solid"
      ? 0
      : ["in srgb", "in srgb-linear", "in oklab", "in display-p3"].indexOf(
          effectPaintInterpolation(paint),
        );
  const stops =
    paint.kind === "solid"
      ? [{ position: 0, color: paint.color }]
      : [...paint.stops].sort((a, b) => a.position - b.position);
  // Kind and interpolation share one scalar to preserve the existing 32-slot globals ABI.
  packed.set([
    kinds.indexOf(paint.kind) + 8 * interpolation,
    stops.length,
    paint.kind === "solid" ? 0 : ((paint.angle % 360) * Math.PI) / 180,
    paint.kind === "solid" ? 1 : (paint.opacity ?? 1),
  ]);
  for (const [index, stop] of stops.entries()) {
    packed.set(
      [...linearColor(stop.color), stop.color.alpha],
      (1 + index * 2) * 4,
    );
    packed[(2 + index * 2) * 4] = stop.position;
  }
  return packed;
}

export function nativeEffectPaintWgsl(
  slot: number,
  functionName = "sampleNativePaint",
  maxCount = MAX_EFFECT_PAINT_STOPS,
): string {
  if (
    !Number.isInteger(slot) ||
    slot < 0 ||
    !Number.isInteger(maxCount) ||
    maxCount < 1 ||
    maxCount > MAX_EFFECT_PAINT_STOPS ||
    slot + 1 + maxCount * 2 > 32 ||
    !/^[A-Za-z][A-Za-z0-9_]*$/.test(functionName)
  )
    throw new RangeError(
      "Native paint helper needs a valid uniform range and function name.",
    );
  const prefix = functionName;
  return `
fn ${prefix}Encode(c: vec3f) -> vec3f {
  let magnitude = abs(c);
  return sign(c) * select(1.055 * pow(magnitude, vec3f(1.0 / 2.4)) - 0.055, magnitude * 12.92, magnitude <= vec3f(0.0031308));
}
fn ${prefix}Decode(c: vec3f) -> vec3f {
  let magnitude = abs(c);
  return sign(c) * select(pow((magnitude + 0.055) / 1.055, vec3f(2.4)), magnitude / 12.92, magnitude <= vec3f(0.04045));
}
fn ${prefix}ToSpace(rgb: vec3f, mode: u32) -> vec3f {
  if (mode == 1u) { return rgb; }
  if (mode == 2u) {
    let lms = vec3f(dot(rgb, vec3f(0.4122214708, 0.5363325363, 0.0514459929)), dot(rgb, vec3f(0.2119034982, 0.6806995451, 0.1073969566)), dot(rgb, vec3f(0.0883024619, 0.2817188376, 0.6299787005)));
    let root = sign(lms) * pow(abs(lms), vec3f(1.0 / 3.0));
    return vec3f(dot(root, vec3f(0.2104542553, 0.7936177850, -0.0040720468)), dot(root, vec3f(1.9779984951, -2.4285922050, 0.4505937099)), dot(root, vec3f(0.0259040371, 0.7827717662, -0.8086757660)));
  }
  if (mode == 3u) {
    return ${prefix}Encode(vec3f(dot(rgb, vec3f(0.8224620106, 0.1775379894, 0.0)), dot(rgb, vec3f(0.0331941591, 0.9668058409, 0.0)), dot(rgb, vec3f(0.0170826307, 0.0723974407, 0.9105199286))));
  }
  return ${prefix}Encode(rgb);
}
fn ${prefix}FromSpace(value: vec3f, mode: u32) -> vec3f {
  if (mode == 1u) { return value; }
  if (mode == 2u) {
    let root = vec3f(value.x + 0.3963377774 * value.y + 0.2158037573 * value.z, value.x - 0.1055613458 * value.y - 0.0638541728 * value.z, value.x - 0.0894841775 * value.y - 1.2914855480 * value.z);
    let lms = root * root * root;
    return vec3f(dot(lms, vec3f(4.0767416621, -3.3077115913, 0.2309699292)), dot(lms, vec3f(-1.2684380046, 2.6097574011, -0.3413193965)), dot(lms, vec3f(-0.0041960863, -0.7034186147, 1.7076147010)));
  }
  let rgb = ${prefix}Decode(value);
  if (mode == 3u) {
    return vec3f(1.2249401 * rgb.r - 0.2249401 * rgb.g, -0.0420569 * rgb.r + 1.0420569 * rgb.g, -0.0196376 * rgb.r - 0.0786361 * rgb.g + 1.0982737 * rgb.b);
  }
  return rgb;
}
fn ${prefix}(uv: vec2f, viewport: vec2f) -> vec4f {
  let header = globals.params[${slot}];
  let encoded = u32(header.x);
  let kind = encoded % 8u;
  let mode = encoded / 8u;
  let count = min(u32(header.y), ${maxCount}u);
  let first = globals.params[${slot + 1}];
  if (kind == 0u) { return vec4f(first.rgb * first.a, first.a); }
  let size = max(viewport, vec2f(0.0001));
  let pixel = (uv - 0.5) * size;
  var position = 0.0;
  if (kind == 1u) {
    let direction = vec2f(sin(header.z), -cos(header.z));
    let span = dot(abs(direction), size);
    position = 0.5 + dot(pixel, direction) / max(span, 0.0001);
  } else if (kind == 2u) {
    position = length(pixel) / max(length(size * 0.5), 0.0001);
  } else if (kind == 3u) {
    position = fract((atan2(pixel.x, -pixel.y) - header.z) / 6.283185307179586 + 1.0);
  } else {
    position = length((uv - 0.5) * 2.0);
  }
  position = clamp(position, 0.0, 1.0);
  var lower = first;
  var upper = first;
  var lowerPosition = globals.params[${slot + 2}].x;
  var upperPosition = lowerPosition;
  for (var i = 1u; i < count; i += 1u) {
    let color = globals.params[${slot + 1}u + i * 2u];
    let stopPosition = globals.params[${slot + 2}u + i * 2u].x;
    if (stopPosition <= position) {
      lower = color;
      lowerPosition = stopPosition;
      upper = color;
      upperPosition = stopPosition;
    } else {
      upper = color;
      upperPosition = stopPosition;
      break;
    }
  }
  if (position <= lowerPosition || upperPosition <= lowerPosition) { return vec4f(lower.rgb * lower.a, lower.a) * header.w; }
  let weight = clamp((position - lowerPosition) / (upperPosition - lowerPosition), 0.0, 1.0);
  let alpha = mix(lower.a, upper.a, weight);
  let premultiplied = mix(${prefix}ToSpace(lower.rgb, mode) * lower.a, ${prefix}ToSpace(upper.rgb, mode) * upper.a, weight);
  if (alpha == 0.0) { return vec4f(0.0); }
  return vec4f(${prefix}FromSpace(premultiplied / alpha, mode) * alpha, alpha) * header.w;
}
`;
}
