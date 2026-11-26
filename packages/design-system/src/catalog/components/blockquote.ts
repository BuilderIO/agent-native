import { textProps } from "../props.js";

export const blockquoteProps = {
  weight: textProps.weight,
  truncate: textProps.truncate,
  wrap: textProps.wrap,
  color: textProps.color,
  highContrast: textProps.highContrast,
} as const;
