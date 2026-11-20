import { CONTROL_SIZES } from "../../tokens/roles.js";
import {
  colorProp,
  highContrastProp,
  radiusProp,
  sizeProp,
  variantProp,
} from "../props.js";

/** Not in Radix Themes: a row of Toggles that share their look and, single or multiple, their pressed state. */
export const toggleGroupProps = {
  size: sizeProp(CONTROL_SIZES, "3"),
  variant: variantProp(["ghost", "soft", "surface", "outline"], "ghost"),
  color: colorProp,
  highContrast: highContrastProp,
  radius: radiusProp,
} as const;
