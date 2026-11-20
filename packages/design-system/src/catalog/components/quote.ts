import { textProps } from "../props.js";

/** Radix Themes' Quote: inline text that truncates or wraps like Text. */
export const quoteProps = {
  truncate: textProps.truncate,
  wrap: textProps.wrap,
} as const;
