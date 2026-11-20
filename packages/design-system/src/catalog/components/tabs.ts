import { colorProp, enumProp, highContrastProp, sizeProp } from "../props.js";

/** Radix Themes' tabs: a row of triggers over an underline indicator. */
export const tabsListProps = {
  size: sizeProp(["3", "4"], "4"),
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
