import { CONTROL_SIZES } from "../../tokens/roles.js";
import { colorProp, radiusProp, sizeProp, variantProp } from "../props.js";

export const otpFieldProps = {
  size: sizeProp(CONTROL_SIZES, "4"),
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  radius: radiusProp,
} as const;
