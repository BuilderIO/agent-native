import {
  colorProp,
  highContrastProp,
  popupColorProp,
  radiusProp,
  CONTROL_SIZES,
  sizeProp,
  variantProp,
} from "../props.js";

/** The input takes Input's props; the popup takes Menu's. */
export const comboboxProps = {
  size: sizeProp(CONTROL_SIZES, "md"),
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  radius: radiusProp,
} as const;

export const comboboxPopupProps = {
  variant: variantProp(["solid", "soft"], "soft"),
  color: popupColorProp,
  highContrast: highContrastProp,
} as const;
