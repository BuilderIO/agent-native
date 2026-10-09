import { parseCssColorExtended } from "./color-utils";
import { compositeOver, type Rgb, type Rgba } from "./wcag-contrast";

/**
 * What sits behind a text layer, read from the canvas iframe as the computed
 * paint of the element and each ancestor, nearest first. The answer is a
 * solid color, or the reason there is none: a made-up background would give a
 * made-up contrast ratio.
 */

/** The computed paint of one element, as the canvas bridge reports it. */
export interface PaintLayer {
  backgroundColor: string;
  backgroundImage: string;
  opacity: string;
  mixBlendMode: string;
}

export type TextBackgroundReason =
  /** No canvas iframe answered: a URL screen, a missing bridge, a closed screen. */
  | "no-screen"
  /** The reply was not the list of layers the bridge sends. */
  | "bad-reply"
  /** Every ancestor is transparent, so the page behind is not known. */
  | "no-opaque-background"
  /** A gradient or image paints behind the text, and has no single color. */
  | "image"
  /** An ancestor's opacity or blend mode changes what the text sits on. */
  | "blending"
  /** A background color the editor cannot read. */
  | "unreadable-color";

export type TextBackground =
  | { kind: "ready"; color: Rgb }
  | { kind: "unavailable"; reason: TextBackgroundReason };

function isPaintLayer(value: unknown): value is PaintLayer {
  if (typeof value !== "object" || value === null) return false;
  const layer = value as Record<string, unknown>;
  return (
    typeof layer.backgroundColor === "string" &&
    typeof layer.backgroundImage === "string" &&
    typeof layer.opacity === "string" &&
    typeof layer.mixBlendMode === "string"
  );
}

/** The bridge's reply as a list of layers, or null when it is anything else. */
export function readPaintLayers(payload: unknown): PaintLayer[] | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  return payload.every(isPaintLayer) ? (payload as PaintLayer[]) : null;
}

/**
 * The solid color behind the text: the nearest opaque background above it,
 * with any translucent backgrounds in between painted over it. The first
 * layer is the text's own element.
 */
export function resolveTextBackground(
  layers: readonly PaintLayer[],
): TextBackground {
  const translucent: Rgba[] = [];
  for (const layer of layers) {
    const opacity = Number.parseFloat(layer.opacity);
    if (
      !Number.isFinite(opacity) ||
      opacity < 1 ||
      (layer.mixBlendMode !== "normal" && layer.mixBlendMode !== "")
    ) {
      return { kind: "unavailable", reason: "blending" };
    }
    if (layer.backgroundImage !== "none" && layer.backgroundImage !== "") {
      return { kind: "unavailable", reason: "image" };
    }
    const source = layer.backgroundColor.trim();
    if (source === "" || source === "transparent") continue;
    const color = parseCssColorExtended(source);
    if (!color) return { kind: "unavailable", reason: "unreadable-color" };
    if (color.a <= 0) continue;
    if (color.a < 1) {
      translucent.push(color);
      continue;
    }
    // An opaque layer ends the walk: everything above it is hidden behind it.
    let painted: Rgb = { r: color.r, g: color.g, b: color.b };
    for (let index = translucent.length - 1; index >= 0; index -= 1) {
      painted = compositeOver(translucent[index]!, painted);
    }
    return { kind: "ready", color: painted };
  }
  return { kind: "unavailable", reason: "no-opaque-background" };
}
