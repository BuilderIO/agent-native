import { COLORS, enumProp } from "../props.js";

export const separatorProps = {
  size: enumProp(
    ["1", "2", "3", "4"],
    "Length: 1 is 16px, 2 is 32px, 3 is 64px, 4 is the full length.",
    "4",
  ),
  color: enumProp(
    COLORS,
    "The scale the line draws from; gray unless set.",
    "gray",
  ),
} as const;
