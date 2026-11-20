import { enumProp } from "../props.js";

export const dialogContentProps = {
  size: enumProp(
    ["1", "2", "3", "4"],
    "Padding and type step of the popup, as in Radix Themes.",
    "3",
  ),
} as const;
