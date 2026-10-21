import { splitCssLayers } from "@shared/gradient-opacity";
import { isEffectPaint } from "@shared/native-effect-paint";
import type { EffectColor, EffectPaint } from "@shared/native-effects";

import { gradientToCss, parseGradientCss } from "./GradientEditor";
import {
  nativeEffectColorFromCss,
  nativeEffectColorToCss,
} from "./NativeShaderColorControls";

export class NativeShaderPaintValueError extends TypeError {
  constructor(
    readonly code:
      | "native-paint-invalid-color"
      | "native-paint-invalid-gradient"
      | "native-paint-unsupported-geometry"
      | "native-paint-unsupported-interpolation",
  ) {
    super(code);
    this.name = "NativeShaderPaintValueError";
  }
}

const COLOR_REFERENCE: EffectColor = {
  space: "srgb",
  components: [0, 0, 0],
  alpha: 1,
};

export function nativeEffectPaintToCss(paint: EffectPaint): string {
  if (paint.kind === "solid") return nativeEffectColorToCss(paint.color);
  return gradientToCss({
    kind: paint.kind,
    angle: paint.angle,
    stops: paint.stops.map((stop, index) => ({
      id: `native-paint-${index}`,
      position: stop.position * 100,
      color: nativeEffectColorToCss(stop.color),
    })),
    ...(paint.opacity === undefined ? {} : { opacity: paint.opacity * 100 }),
    ...(paint.interpolation === undefined
      ? {}
      : { interpolation: paint.interpolation }),
  });
}

export function nativeEffectPaintFromCss(
  css: string,
  previous?: EffectPaint,
  maxStops = 8,
): EffectPaint {
  if (
    previous &&
    isEffectPaint(previous, maxStops) &&
    nativeEffectPaintToCss(previous) === css
  )
    return previous;
  const previousColors = previous
    ? previous.kind === "solid"
      ? [previous.color]
      : previous.stops.map((stop) => stop.color)
    : [];
  const readColor = (value: string): EffectColor => {
    const unchanged = previousColors.find(
      (color) => nativeEffectColorToCss(color) === value,
    );
    if (unchanged) return unchanged;
    const color = nativeEffectColorFromCss(value, COLOR_REFERENCE);
    if (!color)
      throw new NativeShaderPaintValueError("native-paint-invalid-color");
    return color;
  };
  const gradient = parseGradientCss(css);
  if (!gradient) {
    if (/gradient\s*\(/i.test(css))
      throw new NativeShaderPaintValueError("native-paint-invalid-gradient");
    return { kind: "solid", color: readColor(css) };
  }
  const gradientMatch = css
    .trim()
    .match(/^(linear|radial|conic)-gradient\(([\s\S]*)\)$/i);
  const prefix =
    splitCssLayers(gradientMatch?.[2] ?? "")[0]
      ?.replace(/\s+in\s+[\s\S]*$/i, "")
      .trim() ?? "";
  const degrees = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)deg";
  const supportedGeometry =
    gradient.kind === "linear"
      ? new RegExp(`^${degrees}$`, "i").test(prefix)
      : gradient.kind === "angular"
        ? new RegExp(`^from ${degrees} at center$`, "i").test(prefix)
        : gradient.kind === "radial"
          ? /^circle at center$/i.test(prefix)
          : /^ellipse closest-side at center$/i.test(prefix);
  if (!supportedGeometry)
    throw new NativeShaderPaintValueError("native-paint-unsupported-geometry");
  if (gradient.stops.length > maxStops)
    throw new NativeShaderPaintValueError("native-paint-invalid-gradient");
  const interpolation =
    gradient.interpolation ||
    (gradient.stops.some((stop) =>
      /\b(?:color|oklch|oklab|lab|lch)\s*\(/i.test(stop.color),
    )
      ? "in oklab"
      : "in srgb");
  if (
    interpolation !== "in srgb" &&
    interpolation !== "in srgb-linear" &&
    interpolation !== "in display-p3" &&
    interpolation !== "in oklab"
  ) {
    throw new NativeShaderPaintValueError(
      "native-paint-unsupported-interpolation",
    );
  }
  const paint: EffectPaint = {
    kind: gradient.kind,
    angle: gradient.angle,
    stops: gradient.stops.map((stop) => ({
      position: stop.position / 100,
      color: readColor(stop.color),
    })),
    ...(gradient.opacity === undefined
      ? {}
      : { opacity: gradient.opacity / 100 }),
    interpolation,
  };
  if (!isEffectPaint(paint, maxStops))
    throw new NativeShaderPaintValueError("native-paint-invalid-gradient");
  return paint;
}
