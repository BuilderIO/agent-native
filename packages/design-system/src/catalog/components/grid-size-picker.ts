import { CONTROL_SIZES } from "../../tokens/roles.js";
import { colorProp, radiusProp, sizeProp, variantProp } from "../props.js";

/**
 * A tile that draws a grid's columns and rows and reads "C × R", opening a
 * popover to set them by field or by sizing a matrix. It takes an Alignment
 * Picker's footprint, so a layout inspector can swap one for the other.
 */
export const gridSizePickerProps = {
  size: sizeProp(CONTROL_SIZES, "1", "Tile cell size, as in Alignment Picker"),
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  radius: radiusProp,
} as const;
