import { COLORS, enumProp, highContrastProp, variantProp } from "../props.js";

/** Base UI's toast. `color` marks a status toast: success, danger and so on. */
export const toastProps = {
  variant: variantProp(["surface", "soft", "solid"], "surface"),
  color: enumProp(
    COLORS,
    "The status the toast reports; gray unless set.",
    "gray",
  ),
  highContrast: highContrastProp,
} as const;
