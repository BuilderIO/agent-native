import { colorProp, enumProp, highContrastProp, sizeProp } from "../props.js";

/** Radix Themes' tab nav: Tabs' look for links between pages. */
export const tabNavProps = {
  size: sizeProp(["3", "4"], "4"),
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
