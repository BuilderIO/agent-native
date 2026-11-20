import { enumProp } from "../props.js";

export const dataListProps = {
  orientation: enumProp(
    ["horizontal", "vertical"],
    "Labels beside their values, or above them.",
    "horizontal",
  ),
  trim: enumProp(
    ["normal", "start", "end", "both"],
    "Trims the leading of the first and last rows.",
  ),
} as const;
