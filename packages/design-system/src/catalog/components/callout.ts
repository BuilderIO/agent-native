import { colorProp, highContrastProp, variantProp } from "../props.js";

export const calloutProps = {
  variant: variantProp(["soft", "surface", "outline"], "soft"),
  color: colorProp,
  highContrast: highContrastProp,
} as const;
