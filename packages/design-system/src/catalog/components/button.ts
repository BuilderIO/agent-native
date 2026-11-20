import { CONTROL_SIZES } from "../../tokens/roles.js";
import {
  booleanProp,
  colorProp,
  highContrastProp,
  radiusProp,
  sizeProp,
  VARIANTS,
  variantProp,
} from "../props.js";

/** Button and Icon Button share their props, as in Radix Themes. */
export const buttonProps = {
  size: sizeProp(CONTROL_SIZES, "3"),
  variant: variantProp(VARIANTS, "solid"),
  color: colorProp,
  highContrast: highContrastProp,
  radius: radiusProp,
  loading: booleanProp(
    "Shows a spinner over the content, keeping the width, and disables the button.",
  ),
} as const;

export const iconButtonProps = buttonProps;
