import { enumProp, TEXT_SIZES, textProps } from "../props.js";

export const blockquoteProps = {
  size: enumProp(TEXT_SIZES, "A step of the type scale; unset, it inherits."),
  weight: textProps.weight,
  truncate: textProps.truncate,
  wrap: textProps.wrap,
  color: textProps.color,
  highContrast: textProps.highContrast,
} as const;
