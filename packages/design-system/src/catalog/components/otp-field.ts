import {
  colorProp,
  radiusProp,
  CONTROL_SIZES,
  sizeProp,
  variantProp,
} from "../props.js";

export const otpFieldProps = {
  size: sizeProp(CONTROL_SIZES, "md"),
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  radius: radiusProp,
} as const;
