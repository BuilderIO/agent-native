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
  return { paint, opacity: String(alpha) };
}

export function runSwapFillStroke({
  canEditDesign,
  selectedElement,
  handleStylesChange,
}: SwapFillStrokeArgs): void {
  if (!canEditDesign || !selectedElement) return;
  if (isVectorShapeElement(selectedElement)) {
    const styles = selectedElement.computedStyles;
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
    const nextFill = strokeHasPaint
      ? swappedPaint(stroke, styles.strokeOpacity)
      : { paint: "none", opacity: "" };
    const nextStroke = fillHasPaint
      ? swappedPaint(fill, styles.fillOpacity)
      : { paint: "none", opacity: "" };
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
