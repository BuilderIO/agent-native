import {
  colorProp,
  radiusProp,
  CONTROL_SIZES,
  sizeProp,
  variantProp,
} from "../props.js";

/** Base UI's number field, drawn as Input is, with its scrub area and steppers. */
export const numberFieldProps = {
  size: sizeProp(CONTROL_SIZES, "md"),
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  radius: radiusProp,
} as const;
