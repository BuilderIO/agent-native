import { enumProp } from "../props.js";

export const popoverContentProps = {
  size: enumProp(
    ["1", "2", "3", "4"],
    "Padding and type step of the popup, as in Radix Themes.",
    "2",
  ),
} as const;
