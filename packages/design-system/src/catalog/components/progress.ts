import {
  colorProp,
  enumProp,
  highContrastProp,
  radiusProp,
  variantProp,
} from "../props.js";

export const progressProps = {
  size: enumProp(
    ["1", "2", "3"],
    "Track thickness: 1 is 4px, 2 is 6px, 3 is 8px.",
    "2",
  ),
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  highContrast: highContrastProp,
  radius: radiusProp,
  duration: {
    type: "string",
    description:
      "A CSS duration: an indeterminate bar fills over it, as in Radix Themes.",
  },
} as const;
