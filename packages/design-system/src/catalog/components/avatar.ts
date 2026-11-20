import {
  colorProp,
  highContrastProp,
  radiusProp,
  SIZES,
  sizeProp,
  variantProp,
} from "../props.js";

export const avatarProps = {
  size: sizeProp(SIZES, "md", "Diameter"),
  variant: variantProp(["solid", "soft"], "soft"),
  color: colorProp,
  highContrast: highContrastProp,
  radius: radiusProp,
} as const;
