import { enumProp, radiusProp } from "../props.js";

export const scrollAreaProps = {
  radius: radiusProp,
  scrollbars: enumProp(
    ["vertical", "horizontal", "both"],
    "Which scrollbars it draws.",
    "both",
  ),
} as const;
