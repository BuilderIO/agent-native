import { COLORS, enumProp } from "../props.js";

export const separatorProps = {
  color: enumProp(
    COLORS,
    "The scale the line draws from; gray unless set.",
    "gray",
  ),
} as const;
