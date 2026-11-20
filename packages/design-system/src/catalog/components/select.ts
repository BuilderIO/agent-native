import { CONTROL_SIZES } from "../../tokens/roles.js";
import {
  colorProp,
  popupColorProp,
  highContrastProp,
  radiusProp,
  sizeProp,
  variantProp,
} from "../props.js";

/** On the root: the trigger and the popup share one size, as in Radix Themes. */
export const selectRootProps = {
  size: sizeProp(CONTROL_SIZES, "3"),
} as const;

export const selectTriggerProps = {
  variant: variantProp(["surface", "soft", "ghost"], "surface"),
  color: colorProp,
  radius: radiusProp,
} as const;

export const selectPopupProps = {
  variant: variantProp(["solid", "soft"], "soft"),
  color: popupColorProp,
  highContrast: highContrastProp,
} as const;
