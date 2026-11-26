import {
  colorProp,
  highContrastProp,
  radiusProp,
  variantProp,
} from "../props.js";

export const meterProps = {
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  highContrast: highContrastProp,
  radius: radiusProp,
} as const;
