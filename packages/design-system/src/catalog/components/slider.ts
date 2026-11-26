import {
  colorProp,
  highContrastProp,
  radiusProp,
  variantProp,
} from "../props.js";

export const sliderProps = {
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  highContrast: highContrastProp,
  radius: radiusProp,
} as const;
