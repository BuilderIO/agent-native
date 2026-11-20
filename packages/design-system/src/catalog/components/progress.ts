import {
  colorProp,
  highContrastProp,
  radiusProp,
  variantProp,
} from "../props.js";

export const progressProps = {
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
