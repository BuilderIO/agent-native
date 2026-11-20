import { colorProp, enumProp, highContrastProp } from "../props.js";

/** Radix Themes' tabs: a row of triggers over an underline indicator. */
export const tabsListProps = {
  color: colorProp,
  highContrast: highContrastProp,
  justify: enumProp(
    ["start", "center", "end"],
    "Where the triggers sit along the list.",
    "start",
  ),
  wrap: enumProp(
    ["nowrap", "wrap", "wrap-reverse"],
    "Whether the triggers wrap onto more rows.",
    "nowrap",
  ),
} as const;
