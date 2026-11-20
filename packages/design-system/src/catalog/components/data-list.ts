import { enumProp } from "../props.js";

export const dataListProps = {
  orientation: enumProp(
    ["horizontal", "vertical"],
    "Labels beside their values, or above them.",
    "horizontal",
  ),
  size: enumProp(["1", "2", "3"], "Type step and spacing of the rows.", "2"),
  trim: enumProp(
    ["normal", "start", "end", "both"],
    "Trims the leading of the first and last rows.",
  ),
} as const;
