import { colorProp, highContrastProp, variantProp } from "../props.js";

export const radioGroupProps = {
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  highContrast: highContrastProp,
} as const;
