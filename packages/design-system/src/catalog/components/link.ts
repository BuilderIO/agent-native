import { enumProp, textProps } from "../props.js";

export const linkProps = {
  underline: enumProp(
    ["auto", "always", "hover", "none"],
    "When the underline shows; `auto` shows it on hover, and always in high contrast.",
    "auto",
  ),
  weight: textProps.weight,
  trim: textProps.trim,
  truncate: textProps.truncate,
  wrap: textProps.wrap,
  color: textProps.color,
  highContrast: textProps.highContrast,
} as const;
