import { CONTROL_SIZES } from "../../tokens/roles.js";
import {
  colorProp,
  highContrastProp,
  radiusProp,
  sizeProp,
  variantProp,
} from "../props.js";

export const avatarProps = {
  size: sizeProp(CONTROL_SIZES, "3", "Diameter"),
  variant: variantProp(["solid", "soft"], "soft"),
  color: colorProp,
  highContrast: highContrastProp,
  radius: radiusProp,
} as const;
