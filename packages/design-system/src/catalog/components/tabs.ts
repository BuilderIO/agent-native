import { colorProp, enumProp, highContrastProp } from "../props.js";

/** Radix Themes' tabs: a row of triggers over an underline indicator. */
export const tabsListProps = {
  size: enumProp(["1", "2"], "Trigger height: 1 is 24px, 2 is 32px.", "2"),
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
