import {
  alphaToOpacity,
  parseCssColor,
  rgbaToCss,
  withColorOpacity,
} from "@shared/color-utils";

import { DesignColorPicker, type DesignPaintType } from "../inspector";
import { parseGradientLayer } from "./fill-gradient-helpers";
import type { StyleChangeMeta } from "./style-change-types";

export const BOX_STROKE_PAINT_TYPES: DesignPaintType[] = [
  "solid",
  "linear",
  "radial",
  "angular",
  "diamond",
];

export const SVG_PAINT_TYPES: DesignPaintType[] = ["solid", "linear", "radial"];

export function gradientSolidFallback(gradient: string): string {
  const parsed = parseGradientLayer(gradient);
  const stop = parsed?.stops[0];
  const color = stop ? parseCssColor(stop.color) : null;
  if (!color) return "#000000"; // guard:allow-raw-color — concrete paint for an unreadable gradient.
  const opacity =
    ((stop?.opacity ?? alphaToOpacity(color.a)) * (parsed?.opacity ?? 100)) /
    100;
  return rgbaToCss(withColorOpacity(color, opacity));
}

export function PaintInput({
  solidColor,
  gradient,
  supportedPaintTypes,
  open,
  onOpenChange,
  onSolidChange,
  onGradientChange,
}: {
  solidColor: string;
  gradient: string | null;
  supportedPaintTypes: DesignPaintType[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSolidChange: (color: string, meta?: StyleChangeMeta) => void;
  onGradientChange: (gradient: string) => void;
}) {
  const parsed = gradient ? parseGradientLayer(gradient) : null;
  return (
    <DesignColorPicker
      open={open}
      onOpenChange={onOpenChange}
      value={gradient ?? solidColor}
      paintType={parsed ? parsed.type : "solid"}
      gradientType={parsed?.type}
      supportedPaintTypes={supportedPaintTypes}
      onChange={(next) => {
        if (parseCssColor(next)) onSolidChange(next, { phase: "preview" });
      }}
      onChangeComplete={(next) => {
        if (parseCssColor(next)) onSolidChange(next, { phase: "commit" });
      }}
      onPaintValueChange={(next) => {
        if (parseGradientLayer(next)) onGradientChange(next);
        else if (parseCssColor(next)) onSolidChange(next);
      }}
      onPaintTypeChange={(type) => {
        if (type !== "solid" || !gradient) return false;
        onSolidChange(gradientSolidFallback(gradient));
        return true;
      }}
    />
  );
}
