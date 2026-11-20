import { CONTROL_SIZES } from "../../tokens/roles.js";
import {
  colorProp,
  enumProp,
  radiusProp,
  sizeProp,
  variantProp,
} from "../props.js";

/**
 * A 3×3 matrix of flex alignments for a layout inspector. The value maps
 * 1:1 to `justify-content` and `align-items`.
 */
export const alignmentPickerProps = {
  size: sizeProp(CONTROL_SIZES, "1", "Matrix cell size, on a 4px gap"),
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  radius: radiusProp,
  direction: enumProp(
    ["row", "column"],
    "The layout's main axis. It orients the glyphs only: a row draws vertical bars, a column horizontal ones.",
    "row",
  ),
} as const;
