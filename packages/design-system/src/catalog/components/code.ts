import {
  colorProp,
  enumProp,
  highContrastProp,
  TEXT_WEIGHTS,
  textProps,
  variantProp,
} from "../props.js";

export const codeProps = {
  variant: variantProp(["solid", "soft", "outline", "ghost"], "soft"),
  weight: enumProp(TEXT_WEIGHTS, "Font weight, one of the weight tokens."),
  truncate: textProps.truncate,
  wrap: textProps.wrap,
  color: colorProp,
  highContrast: highContrastProp,
} as const;
