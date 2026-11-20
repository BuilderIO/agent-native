import { CONTROL_SIZES } from "../../tokens/roles.js";
import {
  colorProp,
  highContrastProp,
  radiusProp,
  variantProp,
  sizeProp,
} from "../props.js";

export const switchProps = {
  size: sizeProp(CONTROL_SIZES, "3"),
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  highContrast: highContrastProp,
  radius: radiusProp,
} as const;
