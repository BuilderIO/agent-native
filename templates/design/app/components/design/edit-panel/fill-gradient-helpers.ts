import {
  alphaToOpacity,
  parseCssColor,
  rgbaToCss,
  withColorOpacity,
} from "@shared/color-utils";

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
      opacity: gradient ? averageGradientOpacity(gradient.stops) : 100,
      selected: selectedFillId === fillLayerId(index),
    });
  });

  return rows;
}

export function averageGradientOpacity(stops: DesignGradientStop[]): number {
  if (!stops.length) return 100;
  const total = stops.reduce((sum, stop) => {
    const parsed = parseCssColor(stop.color);
    return sum + (stop.opacity ?? (parsed ? alphaToOpacity(parsed.a) : 100));
  }, 0);
  return Math.round(total / stops.length);
}

/**
 * Marker used to non-destructively hide a single backgroundImage layer
 * (gradient or image). CSS strips comments from computed style values — a
 * trailing comment appended to a backgroundImage layer does not survive
 * getComputedStyle (verified: browsers normalize/serialize computed values
 * without their source comments) — so we can't tag the layer text itself.
 * Instead we pair the untouched original layer with a zero-size
 * background-size entry at the same index: `background-size: 0px 0px` makes
 * that layer render nothing while backgroundImage keeps the exact original
 * CSS text. Both backgroundImage and backgroundSize are real, valid,
 * positionally-paired CSS lists that DO round-trip through computed style,
 * so hiding survives reselect/reload with no React state stash required.
 */
const HIDDEN_LAYER_SIZE_MARKER = "0px 0px";

export function isLayerHiddenBySize(sizeEntry: string | undefined): boolean {
  return (
    (sizeEntry ?? "").trim().replace(/\s+/g, " ") === HIDDEN_LAYER_SIZE_MARKER
  );
}

/**
 * Rewrites the background-size list so `index` is hidden/shown via the
 * zero-size marker, padding shorter lists with "auto" (the CSS default) so
 * every other layer keeps rendering at its current/default size.
 *
 * `restoreValue` is the size to bring back when un-hiding (`hidden: false`).
 * Without it, re-showing always reset the layer to "auto", permanently
 * discarding whatever custom cover/contain/percentage size the layer had
 * before it was hidden — callers should capture the layer's own size entry
 * before hiding it (it's about to be overwritten with the marker) and pass
 * it back in here on the show path. Defaults to "auto" so existing callers
 * that don't have a stashed value keep today's behavior.
 */
export function withLayerSizeMarker(
  sizeLayers: string[],
  layerCount: number,
  index: number,
  hidden: boolean,
  restoreValue?: string,
): string {
  const next = Array.from(
    { length: layerCount },
    (_, i) => sizeLayers[i] || "auto",
  );
  next[index] = hidden ? HIDDEN_LAYER_SIZE_MARKER : restoreValue || "auto";
  return joinCssLayers(next);
}

export function splitCssLayers(value: string): string[] {
  const trimmed = value.trim();
  // CSS-wide keywords represent the property's default/inherited value as a
  // whole; they are not real comma-stack layers and cannot legally be
  // preserved beside a new gradient/image (`url(...), initial` invalidates
  // the entire declaration). Shorthand-authored page backgrounds commonly
  // surface as `initial` through CSSStyleDeclaration, so normalize these to
  // an empty editable layer stack before adding a real fill.
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

export function joinCssLayers(layers: string[]): string {
  const cleaned = layers.map((layer) => layer.trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(", ") : "none";
}

/** One fill layer's index-aligned parallel CSS values. */
export interface FillLayerArrays {
  backgroundImage: string[];
  backgroundSize: string[];
  backgroundRepeat: string[];
  backgroundPosition: string[];
}

/**
 * Removes the layer at `index` from all four index-aligned parallel fill
 * arrays (image/size/repeat/position) together, returning a single patch of
 * joined CSS layer-list strings ready to commit as one atomic style change.
 *
 * Splicing only `backgroundImage`/`backgroundSize` (as a previous version of
 * `removeLayer` did) and leaving `backgroundRepeat`/`backgroundPosition`
 * untouched shifts every remaining layer's index relative to those two
 * arrays, silently re-pairing each of them with the *next* layer's original
 * repeat/position. Splicing all four together — the same pattern
 * `reorderFillLayers` already uses for permutation — keeps every remaining
 * layer's size/repeat/position aligned with its own image after the removal.
 */
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
  const withoutIndex = (values: string[]) =>
    values.filter((_, layerIndex) => layerIndex !== index);
  return {
    backgroundImage: joinCssLayers(withoutIndex(layers.backgroundImage)),
    backgroundSize: joinCssLayers(withoutIndex(layers.backgroundSize)),
    backgroundRepeat: joinCssLayers(withoutIndex(layers.backgroundRepeat)),
    backgroundPosition: joinCssLayers(withoutIndex(layers.backgroundPosition)),
  };
}

/** One image-fill layer's four index-aligned CSS values. */
export interface ImageFillLayerStyles {
  backgroundImage: string;
  backgroundSize: string;
  backgroundRepeat: string;
  backgroundPosition: string;
}

/**
 * Sets one image-fill layer's four index-aligned CSS values at `index`,
 * preserving every sibling layer's own image/size/repeat/position — the
 * image-fill analog of `removeFillLayerAtIndex`/`reorderFillLayers`. `index`
 * may be one past the current layer count to append a new layer. Shorter
 * parallel arrays are padded with each property's CSS default (mirrors
 * `addFillLayerPatch`'s defaults) so sibling layers keep rendering unchanged.
 */
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
  const buildLayer = (existing: string[], fallback: string, override: string) =>
    joinCssLayers(
      Array.from({ length: layerCount }, (_, i) =>
        i === index ? override : existing[i] || fallback,
      ),
    );
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
      "no-repeat",
      imageStyles.backgroundRepeat,
    ),
    backgroundPosition: buildLayer(
      layers.backgroundPosition,
      "0% 0%",
      imageStyles.backgroundPosition,
    ),
  };
}

/**
 * Full patch-building logic behind `ColorInput`'s image-fill handler.
 *
 * Previously, editing the base fill row's image (via `ImageFillControls` ->
 * `DesignColorPicker.onImageFillChange`) always replaced the *whole*
 * `backgroundImage`/`backgroundSize`/`backgroundRepeat`/`backgroundPosition`
 * properties with a single-layer patch (see `imageFillToBackgroundStyles`),
 * silently discarding any other gradient/image layers already stacked below
 * it — there was no layer-index-aware merge at all.
 *
 * When `layerIndex` is a real index (editing an existing layer's own image),
 * only that layer's four values are overwritten, preserving every sibling —
 * see `setImageFillLayerPatch`. When `layerIndex` is `null` (the base
 * solid/text row switching its paint type to Image, with no layer selected
 * yet), the image becomes a new layer PREPENDED above the existing layer
 * stack — mirroring `solidToGradientPatch`'s solid -> gradient conversion —
 * instead of clobbering the whole background stack.
 */
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
  return {
    backgroundImage: joinCssLayers([
      imageStyles.backgroundImage,
      ...layers.backgroundImage,
    ]),
    backgroundSize: joinCssLayers([
      imageStyles.backgroundSize,
      ...layers.backgroundSize,
    ]),
    backgroundRepeat: joinCssLayers([
      imageStyles.backgroundRepeat,
      ...layers.backgroundRepeat,
    ]),
    backgroundPosition: joinCssLayers([
      imageStyles.backgroundPosition,
      ...layers.backgroundPosition,
    ]),
  };
}

/**
 * Patch for the Fill panel's "+" (add fill) action.
 *
 * Figma parity: clicking "+" always adds a new fill on top of whatever is
 * already there. The only exception is a genuinely empty fill state (no
 * visible base solid AND no existing background layers) — there "+" just
 * reveals the hidden base solid instead of stacking an empty default
 * gradient on top of nothing.
 *
 * Previously the caller only checked whether the base solid had visible
 * alpha, so an element with an existing gradient/image layer stack but a
 * *hidden* base solid (e.g. right after `solidToGradientPatch` converts
 * solid -> gradient and clears backgroundColor to "transparent") had "+"
 * silently un-hide the base solid instead of adding a new layer — the
 * opposite of what "+" is supposed to do, and it reintroduced the exact
 * phantom-second-fill problem `solidToGradientPatch` exists to avoid.
 */
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
    return { backgroundColor: cssColorOrFallback(backgroundColor, "#ffffff") };
  }

  const nextLayer = defaultGradientLayer(
    "linear",
    backgroundColor || "#ffffff",
  );
  if (backgroundLayers.length === 0) {
    return { backgroundImage: nextLayer };
  }

  // Prepending a layer without also prepending matching entries to the
  // other three index-aligned parallel arrays (size/repeat/position) would
  // shift every existing layer's index by one, silently re-pairing each of
  // them with the *previous* layer's size/repeat/position (same class of
  // bug `removeFillLayerAtIndex` above fixes for removal).
  return {
    backgroundImage: joinCssLayers([nextLayer, ...backgroundLayers]),
    backgroundSize: joinCssLayers(["auto", ...backgroundSizeLayers]),
    backgroundRepeat: joinCssLayers(["no-repeat", ...backgroundRepeatLayers]),
    backgroundPosition: joinCssLayers(["0% 0%", ...backgroundPositionLayers]),
  };
}

/**
 * Patch for removing just the base solid/text fill row — the row shown when
 * the base color has visible alpha, or always for a text fill. Must only
 * clear that one property, never `backgroundImage`, so any other stacked
 * gradient/image layers (each rendered as its own row with its own
 * independent remove button — see `removeFillLayerAtIndex`) are left
 * untouched. This used to also zero `backgroundImage` whenever the caller
 * had `onStylesChange` available, silently deleting every other fill layer
 * any time the base row's own remove button was clicked.
 */
export function removeBaseFillPatch(
  fillProperty: "color" | "backgroundColor",
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
  return { type, prefix, stops };
}

function parseGradientStop(
  part: string,
  index: number,
  total: number,
): DesignGradientStop | null {
  const color = readLeadingColor(part);
  if (!color) return null;
  const parsed = parseCssColor(color.value);
  const remaining = part.slice(color.raw.length);
  const positionMatch = remaining.match(/(-?\d+(?:\.\d+)?)%/);
  const position = positionMatch
    ? clampNumber(Number(positionMatch[1]), 0, 100)
    : total <= 1
      ? 0
      : Math.round((index / (total - 1)) * 100);

  return {
    id: `stop-${index}`,
    color: parsed ? rgbaToCss(parsed) : color.value,
    position,
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
    // Bare CSS color keyword — e.g. `linear-gradient(red, blue)` — not just
    // hex/rgb/hsl/function colors. Gradients written by hand or generated
    // from named-color CSS are common, and without this branch the leading
    // stop was silently misread as a gradient *prefix* (the first stop's
    // color was dropped, corrupting an otherwise-valid 2-stop gradient into
    // a broken 1-stop one with a garbage prefix). Require the matched word to
    // actually parse as a color so direction/shape prefix keywords ("to",
    // "circle", "closest-side", "from", "at", …) are never misclassified.
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
  // Recognize both diamond serializations — EditPanel's "closest-corner" and
  // GradientEditor's "ellipse closest-side" — so a diamond authored in either
  // place round-trips as diamond instead of flipping to radial.
  if (/closest-corner/i.test(layer) || /ellipse\s+closest-side/i.test(layer))
    return "diamond";
  if (functionName.toLowerCase() === "radial") return "radial";
  return "linear";
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
  return "90deg";
}

export function buildGradientLayer(
  type: DesignGradientType,
  stops: DesignGradientStop[],
  prefix = defaultGradientPrefix(type),
): string {
  const stopList = [...stops]
    .sort((a, b) => a.position - b.position)
    .map((stop) => {
      const parsed = parseCssColor(stop.color);
      const opacity = stop.opacity ?? (parsed ? alphaToOpacity(parsed.a) : 100);
      const color = parsed
        ? rgbaToCss(withColorOpacity(parsed, opacity))
        : stop.color;
      return `${color} ${clampNumber(stop.position, 0, 100)}%`;
    })
    .join(", ");

  if (type === "radial" || type === "diamond") {
    return `radial-gradient(${prefix}, ${stopList})`;
  }
  if (type === "angular") return `conic-gradient(${prefix}, ${stopList})`;
  return `linear-gradient(${prefix}, ${stopList})`;
}

export function defaultGradientStops(colorValue: string): DesignGradientStop[] {
  const parsed =
    parseCssColor(cssColorOrFallback(colorValue, "#000000")) ??
    parseCssColor("#000000");
  const start = parsed ? rgbaToCss(withColorOpacity(parsed, 100)) : "#000000";
  const end = parsed
    ? rgbaToCss(withColorOpacity(parsed, 0))
    : "rgba(0, 0, 0, 0)";

  return [
    { id: "stop-0", color: start, position: 0, opacity: 100 },
    { id: "stop-1", color: end, position: 100, opacity: 0 },
  ];
}

export function defaultGradientLayer(
  type: DesignGradientType,
  colorValue: string,
) {
  return buildGradientLayer(type, defaultGradientStops(colorValue));
}

/**
 * Atomic patch for switching a solid fill to a gradient paint type: prepends
 * a default gradient layer built from the current solid color AND clears the
 * solid backgroundColor underneath it.
 */
export function solidToGradientPatch(
  colorValue: string,
  backgroundLayers: string[],
  type: DesignGradientType,
): { backgroundImage: string; backgroundColor: string } {
  return {
    backgroundImage: joinCssLayers([
      defaultGradientLayer(type, cssColorOrFallback(colorValue, "#000000")),
      ...backgroundLayers,
    ]),
    // Convert the solid fill into the gradient instead of stacking the
    // gradient on top of it — leaving backgroundColor set kept a second
    // real fill alive (the default gradient fades to alpha-0, so the old
    // solid showed through) and the Fill panel correctly-but-confusingly
    // listed two rows for what the user meant as one type switch.
    backgroundColor: "transparent",
  };
}
