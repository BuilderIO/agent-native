import {
  booleanProp,
  colorProp,
  highContrastProp,
  radiusProp,
  sizeProp,
  variantProp,
} from "../props.js";

export const badgeProps = {
  size: sizeProp(["1", "2", "3"], "2"),
  variant: variantProp(["solid", "soft", "surface", "outline"], "soft"),
  color: colorProp,
  highContrast: highContrastProp,
  radius: radiusProp,
  dot: booleanProp(
    "Shows only a dot in the badge's color; the label stays for assistive technology.",
  ),
} as const;
