import { enumProp, radiusProp } from "../props.js";

export const scrollAreaProps = {
  size: enumProp(
    ["1", "2", "3"],
    "Scrollbar thickness: 1 is 4px, 2 is 8px, 3 is 12px.",
    "1",
  ),
  radius: radiusProp,
  scrollbars: enumProp(
    ["vertical", "horizontal", "both"],
    "Which scrollbars it draws.",
    "both",
  ),
} as const;
