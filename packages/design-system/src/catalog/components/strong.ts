import { textProps } from "../props.js";

/** Radix Themes' Strong: inline text that truncates or wraps like Text. */
export const strongProps = {
  truncate: textProps.truncate,
  wrap: textProps.wrap,
} as const;
