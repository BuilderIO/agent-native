import {
  SVG_FILL_GRADIENT_PROPERTY,
  SVG_STROKE_GRADIENT_PROPERTY,
} from "@shared/svg-paint-gradient";

import type { ElementInfo } from "../types";
import {
  boxGradientStroke,
  boxStrokeLayerPatch,
  withoutBoxStrokeLayer,
} from "./box-gradient-stroke";
import { isVectorShapeElement } from "./element-classification";
import {
  parseGradientLayer,
  parseSolidFillLayer,
  splitCssLayers,
} from "./fill-gradient-helpers";
import { shouldUseTextFill } from "./fill-properties";
import { authoredStyleValue } from "./interaction-state-helpers";
import {
  colorHasVisibleAlpha,
  cssLengthNumber,
  readTextStrokeStyle,
  strokeIsVisible,
} from "./position-helpers";

export type SwapFillStrokeResult =
  | { kind: "patch"; patch: Record<string, string> }
  | { kind: "unsupported-fill-paint" };

type Paint =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; css: string };

/**
 * Figma's Shift+X: the fill paint and the stroke paint trade places, and an
 * empty side stays empty on the other side. Stroke geometry (weight, style)
 * is kept; a new stroke gets 1px solid.
 */
export function swapFillStrokePatch(
  element: ElementInfo,
): SwapFillStrokeResult {
  const styles = element.computedStyles;

  if (isVectorShapeElement(element)) return vectorSwap(styles);

  const boxStyles = {
    ...styles,
    backgroundImage: authoredStyleValue(element, "backgroundImage") ?? "",
  };
  if (shouldUseTextFill(element, boxStyles)) return textSwap(styles);

  // A Design stroke holds one paint; several fills or an image have no
  // single stroke to become.
  const fillPaints = boxFillPaints(boxStyles);
  if (fillPaints === null || fillPaints.length > 1) {
    return { kind: "unsupported-fill-paint" };
  }
  const fill = fillPaints[0] ?? null;

  const borderExists = strokeIsVisible(styles.borderWidth, styles.borderStyle);
  const outlineExists =
    !borderExists && strokeIsVisible(styles.outlineWidth, styles.outlineStyle);
  const gradientStroke = borderExists ? boxGradientStroke(boxStyles) : null;
  const strokeColor = borderExists
    ? solidOrNull(styles.borderColor)
    : outlineExists
      ? solidOrNull(styles.outlineColor)
      : null;
  const stroke: Paint | null = gradientStroke
    ? { kind: "gradient", css: gradientStroke.layer }
    : strokeColor
      ? { kind: "solid", color: strokeColor }
      : null;

  const patch: Record<string, string> = {
    backgroundColor: stroke?.kind === "solid" ? stroke.color : "transparent",
  };
  if (fill?.kind === "gradient" || stroke?.kind === "gradient") {
    Object.assign(
      patch,
      boxStrokeLayerPatch(
        {
          backgroundImage: stroke?.kind === "gradient" ? stroke.css : "none",
          backgroundSize: "auto",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "0% 0%",
        },
        fill?.kind === "gradient" ? fill.css : null,
      ),
    );
  }
  if (fill) {
    patch.borderColor = fill.kind === "solid" ? fill.color : "transparent";
    patch.borderWidth = borderExists
      ? styles.borderWidth
      : outlineExists
        ? styles.outlineWidth
        : "1px";
    patch.borderStyle = borderExists ? styles.borderStyle : "solid";
  } else {
    patch.borderWidth = "0px";
    patch.borderStyle = "none";
  }
  if (outlineExists) {
    patch.outlineWidth = "0px";
    patch.outlineStyle = "none";
  }
  return { kind: "patch", patch };
}

/** Visible fill paints, or null when one has no stroke equivalent. */
function boxFillPaints(boxStyles: Record<string, string>): Paint[] | null {
  const paints: Paint[] = [];
  const base = solidOrNull(boxStyles.backgroundColor);
  if (base) paints.push({ kind: "solid", color: base });
  const layers = splitCssLayers(
    withoutBoxStrokeLayer(boxStyles).backgroundImage ?? "",
  ).filter((layer) => layer.trim() && layer.trim().toLowerCase() !== "none");
  for (const layer of layers) {
    const solid = parseSolidFillLayer(layer);
    if (solid) paints.push({ kind: "solid", color: solid });
    else if (parseGradientLayer(layer)) {
      paints.push({ kind: "gradient", css: layer });
    } else return null;
  }
  return paints;
}

function vectorSwap(styles: Record<string, string>): SwapFillStrokeResult {
  const fillGradient = styles[SVG_FILL_GRADIENT_PROPERTY]?.trim() || null;
  const strokeGradient = styles[SVG_STROKE_GRADIENT_PROPERTY]?.trim() || null;
  const fill = fillGradient ? null : solidOrNull(styles.fill);
  const stroke = strokeGradient ? null : solidOrNull(styles.stroke);
  const patch: Record<string, string> = {
    [SVG_FILL_GRADIENT_PROPERTY]: "none",
    [SVG_STROKE_GRADIENT_PROPERTY]: "none",
    fill: stroke ?? "none",
    stroke: fill ?? "none",
  };
  if ((fillGradient || fill) && cssLengthNumber(styles.strokeWidth) <= 0) {
    patch.strokeWidth = "1px";
  }
  // Re-assigned so they apply last: setting a gradient drops the inline
  // paint it replaces, which the solid writes above would otherwise restore.
  if (strokeGradient) {
    delete patch[SVG_FILL_GRADIENT_PROPERTY];
    patch[SVG_FILL_GRADIENT_PROPERTY] = strokeGradient;
  }
  if (fillGradient) {
    delete patch[SVG_STROKE_GRADIENT_PROPERTY];
    patch[SVG_STROKE_GRADIENT_PROPERTY] = fillGradient;
  }
  return { kind: "patch", patch };
}

function textSwap(styles: Record<string, string>): SwapFillStrokeResult {
  const textStroke = readTextStrokeStyle(styles);
  const fill = solidOrNull(styles.color);
  const stroke =
    cssLengthNumber(textStroke.width) > 0
      ? solidOrNull(textStroke.color)
      : null;
  return {
    kind: "patch",
    patch: {
      color: stroke ?? "transparent",
      "-webkit-text-stroke-color": fill ?? "transparent",
      "-webkit-text-stroke-width": fill
        ? cssLengthNumber(textStroke.width) > 0
          ? textStroke.width
          : "1px"
        : "0px",
    },
  };
}

function solidOrNull(value: string | undefined): string | null {
  return value && colorHasVisibleAlpha(value) ? value : null;
}
