import {
  colorProp,
  highContrastProp,
  radiusProp,
  CONTROL_SIZES,
  sizeProp,
  variantProp,
} from "../props.js";

/** Not in Radix Themes: an Icon Button that stays filled while pressed. */
export const toggleProps = {
  size: sizeProp(CONTROL_SIZES, "md"),
  variant: variantProp(["ghost", "soft", "surface", "outline"], "ghost"),
  color: colorProp,
  highContrast: highContrastProp,
  radius: radiusProp,
} as const;
