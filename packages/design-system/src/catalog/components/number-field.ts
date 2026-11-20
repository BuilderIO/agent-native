import { CONTROL_SIZES } from "../../tokens/roles.js";
import { colorProp, radiusProp, sizeProp, variantProp } from "../props.js";

/** Base UI's number field, drawn as Input is, with its scrub area and steppers. */
export const numberFieldProps = {
  size: sizeProp(CONTROL_SIZES, "3"),
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  radius: radiusProp,
} as const;
