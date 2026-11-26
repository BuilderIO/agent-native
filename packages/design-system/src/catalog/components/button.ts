import {
  booleanProp,
  colorProp,
  highContrastProp,
  radiusProp,
  CONTROL_SIZES,
  sizeProp,
  VARIANTS,
  variantProp,
} from "../props.js";

/** Button and Icon Button share their props, as in Radix Themes. */
export const buttonProps = {
  size: sizeProp(CONTROL_SIZES, "md"),
  variant: variantProp(VARIANTS, "solid"),
  color: colorProp,
  highContrast: highContrastProp,
  radius: radiusProp,
  loading: booleanProp(
    "Shows a spinner over the content, keeping the width, and disables the button.",
  ),
} as const;

export const iconButtonProps = buttonProps;

/**
 * ButtonLink and IconButtonLink: Button's look on a link, which has no
 * loading state.
 */
export const buttonLinkProps = {
  size: buttonProps.size,
  variant: buttonProps.variant,
  color: buttonProps.color,
  highContrast: buttonProps.highContrast,
  radius: buttonProps.radius,
} as const;
