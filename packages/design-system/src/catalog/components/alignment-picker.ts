import { colorProp, enumProp, radiusProp, variantProp } from "../props.js";

/**
 * A 3×3 matrix of flex alignments for a layout inspector. The value maps
 * 1:1 to `justify-content` and `align-items`.
 */
export const alignmentPickerProps = {
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  radius: radiusProp,
  direction: enumProp(
    ["row", "column"],
    "The layout's main axis. It orients the glyphs only: a row draws vertical bars, a column horizontal ones.",
    "row",
  ),
} as const;
