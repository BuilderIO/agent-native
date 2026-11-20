import { colorProp, enumProp, highContrastProp } from "../props.js";

/** Radix Themes' tab nav: Tabs' look for links between pages. */
export const tabNavProps = {
  size: enumProp(["1", "2"], "Link height: 1 is 24px, 2 is 32px.", "2"),
  color: colorProp,
  highContrast: highContrastProp,
  justify: enumProp(
    ["start", "center", "end"],
    "Where the links sit along the row.",
    "start",
  ),
  wrap: enumProp(
    ["nowrap", "wrap", "wrap-reverse"],
    "Whether the links wrap onto more rows.",
    "nowrap",
  ),
} as const;
