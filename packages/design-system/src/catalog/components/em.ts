import { textProps } from "../props.js";

/** Radix Themes' Em: inline text that truncates or wraps like Text. */
export const emProps = {
  truncate: textProps.truncate,
  wrap: textProps.wrap,
} as const;
