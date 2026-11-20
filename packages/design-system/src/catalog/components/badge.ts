import {
  booleanProp,
  colorProp,
  highContrastProp,
  radiusProp,
  variantProp,
} from "../props.js";

export const badgeProps = {
  variant: variantProp(["solid", "soft", "surface", "outline"], "soft"),
  color: colorProp,
  highContrast: highContrastProp,
  radius: radiusProp,
  dot: booleanProp(
    "Shows only a dot in the badge's color; the label stays for assistive technology.",
  ),
} as const;
