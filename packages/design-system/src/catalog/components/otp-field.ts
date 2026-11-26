import { colorProp, radiusProp, variantProp } from "../props.js";

export const otpFieldProps = {
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  radius: radiusProp,
} as const;
