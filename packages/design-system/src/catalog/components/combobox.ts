import { CONTROL_SIZES } from "../../tokens/roles.js";
import {
  colorProp,
  highContrastProp,
  popupColorProp,
  radiusProp,
  sizeProp,
  variantProp,
} from "../props.js";

/** The input takes Input's props; the popup takes Menu's. */
export const comboboxProps = {
  size: sizeProp(CONTROL_SIZES, "3"),
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  radius: radiusProp,
} as const;

export const comboboxPopupProps = {
  variant: variantProp(["solid", "soft"], "soft"),
  color: popupColorProp,
  highContrast: highContrastProp,
} as const;
