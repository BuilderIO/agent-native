import {
  colorProp,
  enumProp,
  highContrastProp,
  TEXT_SIZES,
  TEXT_WEIGHTS,
  textProps,
  variantProp,
} from "../props.js";

export const codeProps = {
  size: enumProp(
    TEXT_SIZES,
    "A step of the type scale; unset, it follows the surrounding text.",
  ),
  variant: variantProp(["solid", "soft", "outline", "ghost"], "soft"),
  weight: enumProp(TEXT_WEIGHTS, "Font weight, one of the weight tokens."),
  truncate: textProps.truncate,
  wrap: textProps.wrap,
  color: colorProp,
  highContrast: highContrastProp,
} as const;
