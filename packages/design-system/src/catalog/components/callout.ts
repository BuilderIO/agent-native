import {
  colorProp,
  enumProp,
  highContrastProp,
  variantProp,
} from "../props.js";

export const calloutProps = {
  size: enumProp(
    ["1", "2", "3"],
    "Padding, gap and type step of the callout: compact, standard, roomy.",
    "2",
  ),
  variant: variantProp(["soft", "surface", "outline"], "soft"),
  color: colorProp,
  highContrast: highContrastProp,
} as const;
