import {
  colorProp,
  highContrastProp,
  radiusProp,
  variantProp,
} from "../props.js";

export const avatarProps = {
  variant: variantProp(["solid", "soft"], "soft"),
  color: colorProp,
  highContrast: highContrastProp,
  radius: radiusProp,
} as const;
