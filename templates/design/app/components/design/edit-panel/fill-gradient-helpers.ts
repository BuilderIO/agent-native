import {
  alphaToOpacity,
  defaultGradientEndColor,
  parseCssColor,
  rgbaToCss,
  withColorOpacity,
} from "@shared/color-utils";
import {
  gradientStopWithFillOpacity,
  gradientFillInterpolation,
  readGradientFillOpacity,
  splitCssLayers,
} from "@shared/gradient-opacity";
export { splitCssLayers } from "@shared/gradient-opacity";

import {
  type DesignFillRow,
  type DesignGradientStop,
  type DesignGradientType,
  type ExportSettingsValue,
} from "../inspector";
import { colorHasVisibleAlpha, cssColorOrFallback } from "./position-helpers";

export const SOLID_FILL_ID = "solid";
export const FILL_LAYER_PREFIX = "layer:";

interface ParsedGradientLayer {
  type: DesignGradientType;
  opacity?: number;
  prefix?: string;
  stops: DesignGradientStop[];
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettingsValue = {
  scale: 1,
  format: "png",
  suffix: "",
};

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function fillLayerId(index: number): string {
  return `${FILL_LAYER_PREFIX}${index}`;
}

export function fillLayerIndex(id: string): number | null {
  if (!id.startsWith(FILL_LAYER_PREFIX)) return null;
  const index = Number(id.slice(FILL_LAYER_PREFIX.length));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

export function buildFillRows(
  colorValue: string,
  backgroundLayers: string[],
  selectedFillId: string,
): DesignFillRow[] {
  const solid = parseCssColor(colorValue);
  const rows: DesignFillRow[] = [
    {
      id: SOLID_FILL_ID,
      label: "Solid", // i18n-ignore inspector fallback label
      type: "solid",
      value: colorValue,
      swatch: colorValue,
      opacity: solid ? alphaToOpacity(solid.a) : 100,
      selected: selectedFillId === SOLID_FILL_ID,
    },
  ];

  backgroundLayers.forEach((layer, index) => {
    const gradient = parseGradientLayer(layer);
    rows.push({
      id: fillLayerId(index),
      label: gradient
        ? `Gradient ${index + 1}` // i18n-ignore inspector fallback label
        : `Image ${index + 1}`, // i18n-ignore inspector fallback label
      type: gradient ? "gradient" : "image",
      value: layer,
      swatch: layer,
      opacity: gradient?.opacity ?? 100,
      selected: selectedFillId === fillLayerId(index),
    });
  });

  return rows;
}

const HIDDEN_LAYER_SIZE_MARKER = "0px 0px";

export function isLayerHiddenBySize(sizeEntry: string | undefined): boolean {
  return (
    (sizeEntry ?? "").trim().replace(/\s+/g, " ") === HIDDEN_LAYER_SIZE_MARKER
  );
}

export function withLayerSizeMarker(
  sizeLayers: string[],
  layerCount: number,
  index: number,
  hidden: boolean,
  restoreValue?: string,
): string {
  const next = alignCssLayerValues(sizeLayers, layerCount, "auto");
  next[index] = hidden ? HIDDEN_LAYER_SIZE_MARKER : restoreValue || "auto";
  return joinCssLayers(next);
}

export function joinCssLayers(layers: string[]): string {
  const cleaned = layers.map((layer) => layer.trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(", ") : "none";
}

export interface FillLayerArrays {
  backgroundImage: string[];
  backgroundSize: string[];
  backgroundRepeat: string[];
  backgroundPosition: string[];
}

export function removeFillLayerAtIndex(
  layers: FillLayerArrays,
  index: number,
): Record<
  | "backgroundImage"
  | "backgroundSize"
  | "backgroundRepeat"
  | "backgroundPosition",
  string
> {
  if (index < 0 || index >= layers.backgroundImage.length) {
    return {
      backgroundImage: joinCssLayers(layers.backgroundImage),
      backgroundSize: joinCssLayers(layers.backgroundSize),
      backgroundRepeat: joinCssLayers(layers.backgroundRepeat),
      backgroundPosition: joinCssLayers(layers.backgroundPosition),
    };
  }
  const layerCount = layers.backgroundImage.length;
  const withoutIndex = (values: string[], fallback: string) =>
    alignCssLayerValues(values, layerCount, fallback).filter(
      (_, layerIndex) => layerIndex !== index,
    );
  return {
    backgroundImage: joinCssLayers(
      layers.backgroundImage.filter((_, layerIndex) => layerIndex !== index),
    ),
    backgroundSize: joinCssLayers(withoutIndex(layers.backgroundSize, "auto")),
    backgroundRepeat: joinCssLayers(
      withoutIndex(layers.backgroundRepeat, "repeat"),
    ),
    backgroundPosition: joinCssLayers(
      withoutIndex(layers.backgroundPosition, "0% 0%"),
    ),
  };
}

export function reorderFillLayerArrays(
  layers: FillLayerArrays,
  from: number,
  to: number,
): Record<
  | "backgroundImage"
  | "backgroundSize"
  | "backgroundRepeat"
  | "backgroundPosition",
  string
> {
  const layerCount = layers.backgroundImage.length;
  if (
    from < 0 ||
    from >= layerCount ||
    to < 0 ||
    to >= layerCount ||
    from === to
  ) {
    return {
      backgroundImage: joinCssLayers(layers.backgroundImage),
      backgroundSize: joinCssLayers(layers.backgroundSize),
      backgroundRepeat: joinCssLayers(layers.backgroundRepeat),
      backgroundPosition: joinCssLayers(layers.backgroundPosition),
    };
  }
  const reorder = (values: string[], fallback: string) => {
    const next = alignCssLayerValues(values, layerCount, fallback);
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    return next;
  };
  return {
    backgroundImage: joinCssLayers(reorder(layers.backgroundImage, "none")),
    backgroundSize: joinCssLayers(reorder(layers.backgroundSize, "auto")),
    backgroundRepeat: joinCssLayers(reorder(layers.backgroundRepeat, "repeat")),
    backgroundPosition: joinCssLayers(
      reorder(layers.backgroundPosition, "0% 0%"),
    ),
  };
}

export interface ImageFillLayerStyles {
  backgroundImage: string;
  backgroundSize: string;
  backgroundRepeat: string;
  backgroundPosition: string;
}

export function alignCssLayerValues(
  values: string[],
  layerCount: number,
  fallback: string,
) {
  return Array.from({ length: layerCount }, (_, index) =>
    values.length ? values[index % values.length]! : fallback,
  );
}

export function setImageFillLayerPatch(
  layers: FillLayerArrays,
  index: number,
  imageStyles: ImageFillLayerStyles,
): Record<
  | "backgroundImage"
  | "backgroundSize"
  | "backgroundRepeat"
  | "backgroundPosition",
  string
> {
  const layerCount = Math.max(layers.backgroundImage.length, index + 1);
  const existingLayerCount = layers.backgroundImage.length;
  const buildLayer = (
    existing: string[],
    fallback: string,
    override: string,
  ) => {
    const aligned = alignCssLayerValues(existing, existingLayerCount, fallback);
    return joinCssLayers(
      Array.from({ length: layerCount }, (_, i) =>
        i === index ? override : (aligned[i] ?? fallback),
      ),
    );
  };
  return {
    backgroundImage: buildLayer(
      layers.backgroundImage,
      "none",
      imageStyles.backgroundImage,
    ),
    backgroundSize: buildLayer(
      layers.backgroundSize,
      "auto",
      imageStyles.backgroundSize,
    ),
    backgroundRepeat: buildLayer(
      layers.backgroundRepeat,
      "repeat",
      imageStyles.backgroundRepeat,
    ),
    backgroundPosition: buildLayer(
      layers.backgroundPosition,
      "0% 0%",
      imageStyles.backgroundPosition,
    ),
  };
}

export function imageFillChangePatch(
  layers: FillLayerArrays,
  layerIndex: number | null,
  imageStyles: ImageFillLayerStyles,
): Record<
  | "backgroundImage"
  | "backgroundSize"
  | "backgroundRepeat"
  | "backgroundPosition",
  string
> {
  if (layerIndex !== null) {
    return setImageFillLayerPatch(layers, layerIndex, imageStyles);
  }
  const existingLayerCount = layers.backgroundImage.length;
  return {
    backgroundImage: joinCssLayers([
      imageStyles.backgroundImage,
      ...layers.backgroundImage,
    ]),
    backgroundSize: joinCssLayers([
      imageStyles.backgroundSize,
      ...alignCssLayerValues(layers.backgroundSize, existingLayerCount, "auto"),
    ]),
    backgroundRepeat: joinCssLayers([
      imageStyles.backgroundRepeat,
      ...alignCssLayerValues(
        layers.backgroundRepeat,
        existingLayerCount,
        "repeat",
      ),
    ]),
    backgroundPosition: joinCssLayers([
      imageStyles.backgroundPosition,
      ...alignCssLayerValues(
        layers.backgroundPosition,
        existingLayerCount,
        "0% 0%",
      ),
    ]),
  };
}

// guard:allow-raw-color — Figma's new-fill paint; hex because solid layers need a parseable colour.
const NEW_FILL_COLOR = "#d9d9d9";

export function addFillLayerPatch(params: {
  backgroundColor: string | undefined;
  backgroundLayers: string[];
  backgroundSizeLayers: string[];
  backgroundRepeatLayers: string[];
  backgroundPositionLayers: string[];
}): Record<string, string> {
  const {
    backgroundColor,
    backgroundLayers,
    backgroundSizeLayers,
    backgroundRepeatLayers,
    backgroundPositionLayers,
  } = params;

  if (!colorHasVisibleAlpha(backgroundColor) && backgroundLayers.length === 0) {
    return {
      backgroundColor: cssColorOrFallback(backgroundColor, NEW_FILL_COLOR),
    };
  }

  const fillColor =
    colorHasVisibleAlpha(backgroundColor) && backgroundColor
      ? backgroundColor
      : NEW_FILL_COLOR;
  const nextLayer = buildSolidFillLayer(fillColor);
  if (backgroundLayers.length === 0) {
    return { backgroundImage: nextLayer };
  }

  return {
    backgroundImage: joinCssLayers([nextLayer, ...backgroundLayers]),
    backgroundSize: joinCssLayers(["auto", ...backgroundSizeLayers]),
    backgroundRepeat: joinCssLayers(["no-repeat", ...backgroundRepeatLayers]),
    backgroundPosition: joinCssLayers(["0% 0%", ...backgroundPositionLayers]),
  };
}

export function removeBaseFillPatch(
  fillProperty: "color" | "backgroundColor" | "fill",
): Record<string, string> {
  return { [fillProperty]: "transparent" };
}

export function parseGradientLayer(layer: string): ParsedGradientLayer | null {
  const match = layer.trim().match(/^(linear|radial|conic)-gradient\((.*)\)$/i);
  if (!match) return null;

  const parts = splitCssLayers(match[2] || "");
  const type = gradientTypeFromCss(match[1] || "", layer);
  const firstStop = parseGradientStop(parts[0] || "", 0, parts.length);
  const prefix = firstStop ? undefined : parts[0]?.trim();
  const stopParts = firstStop ? parts : parts.slice(1);
  const stops = stopParts
    .map((part, index) => parseGradientStop(part, index, stopParts.length))
    .filter((stop): stop is DesignGradientStop => Boolean(stop));

  if (!stops.length) return null;
  const fill = readGradientFillOpacity(stops);
  return {
    type,
    prefix,
    stops: fill.stops.map((stop) => normalizeGradientStop(stop)),
    ...(fill.opacity !== 100 ? { opacity: fill.opacity } : {}),
  };
}

export function buildSolidFillLayer(colorValue: string): string {
  const parsed = parseCssColor(colorValue);
  if (!parsed) throw new Error(`Invalid solid fill color: ${colorValue}`);
  return `linear-gradient(${rgbaToCss(parsed)} 0 0)`;
}

export function parseSolidFillLayer(layer: string): string | null {
  const match = layer.trim().match(/^linear-gradient\((.*)\)$/i);
  if (!match) return null;
  const stops = splitCssLayers(match[1] ?? "");
  if (stops.length === 1) {
    const [stop] = stops;
    if (!stop) return null;
    const color = readLeadingColor(stop);
    if (!color || !/^0\s+0$/.test(stop.slice(color.raw.length).trim()))
      return null;
    const parsed = parseCssColor(color.value);
    return parsed ? rgbaToCss(parsed) : null;
  }

  if (stops.length !== 2) return null;
  const firstColor = readLeadingColor(stops[0] ?? "");
  const secondColor = readLeadingColor(stops[1] ?? "");
  if (!firstColor || !secondColor) return null;
  if (
    stopPosition(stops[0] ?? "", firstColor.raw) !== "0px" ||
    stopPosition(stops[1] ?? "", secondColor.raw) !== "0px"
  ) {
    return null;
  }
  const first = parseCssColor(firstColor.value);
  const second = parseCssColor(secondColor.value);
  if (!first || !second || rgbaToCss(first) !== rgbaToCss(second)) return null;
  return rgbaToCss(first);
}

function stopPosition(stop: string, rawColor: string): string {
  return stop.slice(rawColor.length).trim();
}

function parseGradientStop(
  part: string,
  index: number,
  total: number,
): DesignGradientStop | null {
  const color = readLeadingColor(part);
  if (!color) return null;
  const remaining = part.slice(color.raw.length);
  const positionMatch = remaining.match(/(-?\d+(?:\.\d+)?)%/);
  const position = positionMatch
    ? clampNumber(Number(positionMatch[1]), 0, 100)
    : total <= 1
      ? 0
      : Math.round((index / (total - 1)) * 100);

  return {
    id: `stop-${index}`,
    color: color.value,
    position,
  };
}

function normalizeGradientStop<T extends DesignGradientStop>(stop: T): T {
  const parsed = parseCssColor(stop.color);
  return {
    ...stop,
    color: parsed ? rgbaToCss(parsed) : stop.color,
    opacity: parsed ? alphaToOpacity(parsed.a) : 100,
  };
}

function readLeadingColor(part: string): { raw: string; value: string } | null {
  const trimmed = part.trim();
  const hex = trimmed.match(/^#[0-9a-f]{3,8}\b/i);
  if (hex) return { raw: hex[0], value: hex[0] };
  const transparent = trimmed.match(/^transparent\b/i);
  if (transparent) {
    return { raw: transparent[0], value: "rgba(0, 0, 0, 0)" };
  }
  const functionName = trimmed.match(/^[a-z][a-z0-9-]*\(/i);
  if (!functionName) {
    const word = trimmed.match(/^[a-z]+\b/i);
    if (word && parseCssColor(word[0])) {
      return { raw: word[0], value: word[0] };
    }
    return null;
  }
  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        const raw = trimmed.slice(0, index + 1);
        return { raw, value: raw };
      }
    }
  }
  return null;
}

function gradientTypeFromCss(
  functionName: string,
  layer: string,
): DesignGradientType {
  if (functionName.toLowerCase() === "conic") return "angular";
  if (/closest-corner/i.test(layer) || /ellipse\s+closest-side/i.test(layer))
    return "diamond";
  if (functionName.toLowerCase() === "radial") return "radial";
  return "linear";
}

export function gradientShortLabel(type: DesignGradientType): string {
  if (type === "radial") return "Radial"; // i18n-ignore design inspector paint row
  if (type === "angular") return "Angular"; // i18n-ignore design inspector paint row
  if (type === "diamond") return "Diamond"; // i18n-ignore design inspector paint row
  return "Linear"; // i18n-ignore design inspector paint row
}

export function gradientLabel(type: DesignGradientType): string {
  if (type === "radial") {
    return "Radial gradient"; // i18n-ignore design inspector paint row
  }
  if (type === "angular") {
    return "Angular gradient"; // i18n-ignore design inspector paint row
  }
  if (type === "diamond") {
    return "Diamond gradient"; // i18n-ignore design inspector paint row
  }
  return "Linear gradient"; // i18n-ignore design inspector paint row
}

function defaultGradientPrefix(type: DesignGradientType): string {
  if (type === "radial") return "circle at 50% 50%";
  if (type === "angular") return "from 0deg at 50% 50%";
  if (type === "diamond") return "closest-corner at 50% 50%";
  return "180deg";
}

export function buildGradientLayer(
  type: DesignGradientType,
  stops: DesignGradientStop[],
  prefix = defaultGradientPrefix(type),
  fillOpacity = 100,
): string {
  const interpolation = /\bin\s/.test(prefix)
    ? ""
    : gradientFillInterpolation(
        stops.map((stop) => stop.color),
        fillOpacity,
      );
  const gradientPrefix = interpolation ? `${prefix} ${interpolation}` : prefix;
  const stopList = [...stops]
    .sort((a, b) => a.position - b.position)
    .map((stop) => {
      const parsed = parseCssColor(stop.color);
      const opacity = stop.opacity ?? (parsed ? alphaToOpacity(parsed.a) : 100);
      const color = parsed
        ? rgbaToCss(withColorOpacity(parsed, opacity))
        : stop.color;
      return `${gradientStopWithFillOpacity(color, fillOpacity)} ${clampNumber(stop.position, 0, 100)}%`;
    })
    .join(", ");

  if (type === "radial" || type === "diamond") {
    return `radial-gradient(${gradientPrefix}, ${stopList})`;
  }
  if (type === "angular")
    return `conic-gradient(${gradientPrefix}, ${stopList})`;
  return `linear-gradient(${gradientPrefix}, ${stopList})`;
}

export function defaultGradientStops(colorValue: string): DesignGradientStop[] {
  const parsed =
    parseCssColor(cssColorOrFallback(colorValue, "#000000")) ??
    parseCssColor("#000000");
  const opaque = withColorOpacity(parsed ?? { r: 0, g: 0, b: 0, a: 1 }, 100);
  return [
    { id: "stop-0", color: rgbaToCss(opaque), position: 0, opacity: 100 },
    {
      id: "stop-1",
      color: rgbaToCss(defaultGradientEndColor(opaque)),
      position: 100,
      opacity: 100,
    },
  ];
}

export function defaultGradientLayer(
  type: DesignGradientType,
  colorValue: string,
) {
  return buildGradientLayer(type, defaultGradientStops(colorValue));
}

export function solidToGradientPatch(
  colorValue: string,
  layers: FillLayerArrays,
  type: DesignGradientType,
): Record<
  | "backgroundColor"
  | "backgroundImage"
  | "backgroundSize"
  | "backgroundRepeat"
  | "backgroundPosition",
  string
> {
  const index = layers.backgroundImage.length;
  const converted = setImageFillLayerPatch(layers, index, {
    backgroundImage: defaultGradientLayer(
      type,
      cssColorOrFallback(colorValue, "#000000"), // guard:allow-raw-color — missing source paint converts to a concrete canvas fill.
    ),
    backgroundSize: "auto",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "0% 0%",
  });
  return {
    ...converted,
    backgroundColor: "transparent",
  };
}
