import {
  colorProp,
  enumProp,
  radiusProp,
  CONTROL_SIZES,
  sizeProp,
  variantProp,
} from "../props.js";

export const inputProps = {
  size: sizeProp(CONTROL_SIZES, "md"),
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  radius: radiusProp,
} as const;

/** A slot in the input's frame, for an icon, a button or text. */
export const inputSlotProps = {
  side: enumProp(
    ["left", "right"],
    "The side it sits on; unset, the first slot goes left and the next right.",
  ),
} as const;
