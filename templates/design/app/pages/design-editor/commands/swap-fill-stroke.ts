import { parseCssColor, rgbaToCss } from "@shared/color-utils";

import { isVectorShapeElement } from "@/components/design/edit-panel/element-classification";
import type { ElementInfo } from "@/components/design/types";

export interface SwapFillStrokeArgs {
  canEditDesign: boolean;
  selectedElement: ElementInfo | null;
  handleStylesChange: (styles: Record<string, string>) => void;
}

function hasPaint(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "transparent") {
    return false;
  }
  const color = parseCssColor(value);
  return color ? color.a > 0 : true;
}

function swappedPaint(
  paint: string,
  opacity: string | undefined,
): { paint: string; opacity: string } {
  const alpha = Number.parseFloat(opacity ?? "1");
  if (!Number.isFinite(alpha) || alpha >= 1) return { paint, opacity: "" };
  const color = parseCssColor(paint);
  if (color) {
    return { paint: rgbaToCss({ ...color, a: color.a * alpha }), opacity: "" };
  }
  // A gradient value has nowhere to carry alpha, so it keeps its opacity.
  return { paint, opacity: String(alpha) };
}

/**
 * Figma's Shift+X. Matches Figma even when one side is empty: an element with
 * a fill and no stroke ends up with a stroke and no fill (not a no-op). Both
 * sides commit together so the swap is a single undo step.
 */
export function runSwapFillStroke({
  canEditDesign,
  selectedElement,
  handleStylesChange,
}: SwapFillStrokeArgs): void {
  if (!canEditDesign || !selectedElement) return;
  if (isVectorShapeElement(selectedElement)) {
    const styles = selectedElement.computedStyles;
    // SVG gradient styles render as url(#id), but the editor's authored
    // custom properties hold the portable gradient values. Capture both
    // before committing either side so Shift+X can rebuild each definition
    // without leaving the other paint pointing at a removed id.
    const fill =
      selectedElement.inlineStyles?.["--an-vector-fill-gradient"] ||
      styles["--an-vector-fill-gradient"] ||
      styles.fill ||
      "";
    const stroke =
      selectedElement.inlineStyles?.["--an-vector-stroke-gradient"] ||
      styles["--an-vector-stroke-gradient"] ||
      styles.stroke ||
      "";
    const fillHasPaint = hasPaint(fill);
    const strokeWidth = Number.parseFloat(styles.strokeWidth ?? "0");
    const strokeOpacity = Number.parseFloat(styles.strokeOpacity ?? "1");
    const strokeHasPaint =
      hasPaint(stroke) && strokeWidth > 0 && strokeOpacity > 0;
    if (!fillHasPaint && !strokeHasPaint) return;
    // Opacity rides in the colours where it can: an inline fill-opacity
    // would override the fill-opacity="0" that keeps an open path's chord
    // unpainted. An empty value removes the old declaration.
    const nextFill = strokeHasPaint
      ? swappedPaint(stroke, styles.strokeOpacity)
      : { paint: "none", opacity: "" };
    const nextStroke = fillHasPaint
      ? swappedPaint(fill, styles.fillOpacity)
      : { paint: "none", opacity: "" };
    // Removing only the inline value would leave an imported SVG's
    // presentation opacity multiplying the swapped colour.
    const opacityFor = (
      next: { paint: string; opacity: string },
      current: string | undefined,
    ) =>
      next.opacity === "" &&
      next.paint !== "none" &&
      Number.parseFloat(current ?? "1") < 1
        ? "1"
        : next.opacity;
    const fillOpacity = opacityFor(nextFill, styles.fillOpacity);
    const strokeOpacityValue = opacityFor(nextStroke, styles.strokeOpacity);
    handleStylesChange({
      fill: nextFill.paint,
      fillOpacity,
      stroke: nextStroke.paint,
      strokeOpacity: strokeOpacityValue,
      ...(fillHasPaint && !strokeHasPaint ? { strokeWidth: "1px" } : {}),
    });
    return;
  }
  const currentFill = selectedElement.computedStyles.backgroundColor ?? "";
  const currentStroke = selectedElement.computedStyles.borderColor ?? "";
  handleStylesChange({
    backgroundColor: currentStroke || "transparent",
    borderColor: currentFill || "transparent",
  });
}
