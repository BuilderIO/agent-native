import { enumProp, TEXT_SIZES, textProps } from "../props.js";

export const linkProps = {
  size: enumProp(
    TEXT_SIZES,
    "A step of the type scale; unset, it follows the surrounding text.",
  ),
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
