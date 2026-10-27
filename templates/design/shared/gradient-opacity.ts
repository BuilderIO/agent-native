import { parseCssColor } from "./color-utils";

export function splitCssLayers(value: string): string[] {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed === "none" ||
    /^(?:initial|inherit|unset|revert|revert-layer)$/i.test(trimmed)
  ) {
    return [];
  }
  const layers: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      const layer = trimmed.slice(start, index).trim();
      if (layer) layers.push(layer);
      start = index + 1;
    }
  }

  const finalLayer = trimmed.slice(start).trim();
  if (finalLayer) layers.push(finalLayer);
  return layers;
}

export function gradientStopWithFillOpacity(
  color: string,
  opacity = 100,
): string {
  return opacity === 100
    ? color
    : `color-mix(in srgb, ${color} ${opacity}%, transparent)`;
}

function colorMixOpacityLayer(
  value: string,
): { color: string; opacity: number } | null {
  const trimmed = value.trim();
  const open = trimmed.match(/^color-mix\s*\(/i);
  if (!open) return null;
  const openingParen = open[0].lastIndexOf("(");
  let depth = 0;
  let closingParen = -1;
  for (let index = openingParen; index < trimmed.length; index += 1) {
    if (trimmed[index] === "(") depth += 1;
    if (trimmed[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        closingParen = index;
        break;
      }
    }
  }
  if (closingParen !== trimmed.length - 1) return null;

  const args = splitCssLayers(trimmed.slice(openingParen + 1, closingParen));
  if (args.length !== 3 || !/^in\s+srgb$/i.test(args[0] ?? "")) return null;
  const colorWeight = (args[1] ?? "").match(/^(.+)\s+(\d+(?:\.\d+)?)%$/);
  const transparentWeight = (args[2] ?? "").match(
    /^transparent(?:\s+(\d+(?:\.\d+)?)%)?$/i,
  );
  if (!colorWeight || !transparentWeight) return null;

  const opacity = Number(colorWeight[2]);
  const transparentOpacity = transparentWeight[1]
    ? Number(transparentWeight[1])
    : 100 - opacity;
  if (
    opacity < 0 ||
    opacity > 100 ||
    transparentOpacity < 0 ||
    transparentOpacity > 100 ||
    Math.abs(opacity + transparentOpacity - 100) > 0.01
  ) {
    return null;
  }
  return { color: colorWeight[1]!.trim(), opacity };
}

export function readGradientFillOpacity<T extends { color: string }>(
  stops: T[],
): {
  stops: T[];
  opacity: number;
} {
  const matches = stops.map((stop) => colorMixOpacityLayer(stop.color));
  const opacity = matches[0]?.opacity;
  if (
    opacity === undefined ||
    matches.some((match) => !match || match.opacity !== opacity)
  ) {
    return { stops, opacity: 100 };
  }
  return {
    stops: stops.map((stop, index) => ({
      ...stop,
      color: matches[index]!.color,
    })),
    opacity,
  };
}

export function gradientFillInterpolation(
  colors: string[],
  opacity = 100,
): string {
  return opacity !== 100 && colors.every((color) => parseCssColor(color))
    ? "in srgb"
    : "";
}
